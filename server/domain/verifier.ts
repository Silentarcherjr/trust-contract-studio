/**
 * Independent Proof Engine.
 *
 * Pure, deterministic functions from (obligation, observations) to a verdict.
 * The signature is the guarantee: the verifier receives observations gathered
 * through server/sandbox/observe.ts and nothing else, so neither the agent's
 * claims nor the executor's attempt log can influence a verdict.
 */
import {
  OBSERVABLE_STORES,
  formatCents,
  type ObligationKind,
  type StoreName,
  type Verdict,
} from "../../shared/domain.js";
import type { VerificationReason } from "../db/schema.js";
import type {
  MemoryObservation,
  Observation,
  RefundObservation,
  SubscriptionObservation,
} from "../sandbox/observe.js";
import { lineageClosure } from "../sandbox/memory.js";

export const VERIFIER_VERSION = "tcs-verifier/1.0.0";

export interface VerifierResult {
  verdict: Verdict;
  reasons: VerificationReason[];
}

export interface ObservationSet {
  subscription?: Observation<SubscriptionObservation>;
  refunds?: Observation<RefundObservation>;
  memories?: Observation<MemoryObservation>;
}

const pass = (code: string, message: string, refs?: string[]): VerificationReason =>
  refs ? { code, message, refs } : { code, message };

/** FAILED dominates UNKNOWN, which dominates VERIFIED. */
export function combine(verdicts: Verdict[]): Verdict {
  if (verdicts.includes("FAILED")) return "FAILED";
  if (verdicts.includes("UNKNOWN") || verdicts.length === 0) return "UNKNOWN";
  return "VERIFIED";
}

function unavailable(obs: Observation<unknown> | undefined, what: string): VerifierResult | null {
  if (!obs) {
    return { verdict: "UNKNOWN", reasons: [pass("no_observation", `No observation of ${what} was collected.`)] };
  }
  if (!obs.ok) {
    return {
      verdict: "UNKNOWN",
      reasons: [pass(obs.error === "timeout" ? "observation_timeout" : "unobservable", `${obs.source}: ${obs.detail}`)],
    };
  }
  return null;
}

export function verifyCancel(obs: ObservationSet): VerifierResult {
  const blocked = unavailable(obs.subscription, "the subscription");
  if (blocked || !obs.subscription?.ok) return blocked!;
  const { subscription, chargesAfterCancel } = obs.subscription.data;
  if (!subscription) {
    return { verdict: "FAILED", reasons: [pass("not_found", "Billing has no record of this subscription.")] };
  }
  if (subscription.status !== "canceled") {
    return {
      verdict: "FAILED",
      reasons: [pass("still_active", `Billing reports the subscription as "${subscription.status}".`, [subscription.id])],
    };
  }
  const unrefunded = chargesAfterCancel.filter((c) => c.refundedCents < c.amountCents);
  if (unrefunded.length) {
    return {
      verdict: "FAILED",
      reasons: unrefunded.map((c) =>
        pass(
          "charge_after_cancel",
          `Contradiction: canceled at ${subscription.canceledAt}, but ${c.id} (${formatCents(c.amountCents)}) was charged at ${c.createdAt}.`,
          [c.id],
        ),
      ),
    };
  }
  const reasons = [pass("canceled", `Billing reports canceled at ${subscription.canceledAt}.`, [subscription.id])];
  if (chargesAfterCancel.length) {
    reasons.push(pass("late_charge_refunded", "A charge after cancellation exists but is fully refunded.", chargesAfterCancel.map((c) => c.id)));
  }
  return { verdict: "VERIFIED", reasons };
}

export function verifyRefund(params: { chargeId: string; amountCents: number }, obs: ObservationSet): VerifierResult {
  const blocked = unavailable(obs.refunds, "refunds");
  if (blocked || !obs.refunds?.ok) return blocked!;
  const { charge, refunds } = obs.refunds.data;
  if (!charge) {
    return { verdict: "FAILED", reasons: [pass("not_found", `Charge ${params.chargeId} does not exist.`)] };
  }
  const live = refunds.filter((r) => r.status !== "voided");
  const total = live.reduce((s, r) => s + r.amountCents, 0);
  if (total === params.amountCents) {
    return {
      verdict: "VERIFIED",
      reasons: [pass("exact_amount", `Refunds total ${formatCents(total)} across ${live.length} live refund(s).`, live.map((r) => r.id))],
    };
  }
  if (total > params.amountCents) {
    // Keep the earliest refunds that fit the promise; the rest are excess.
    let kept = 0;
    const excess: string[] = [];
    for (const r of live) {
      if (kept + r.amountCents <= params.amountCents) kept += r.amountCents;
      else excess.push(r.id);
    }
    return {
      verdict: "FAILED",
      reasons: [
        pass(
          "over_refunded",
          `Promised ${formatCents(params.amountCents)} but ${live.length} live refunds total ${formatCents(total)} — over by ${formatCents(total - params.amountCents)}.`,
          excess,
        ),
      ],
    };
  }
  return {
    verdict: "FAILED",
    reasons: [
      pass(
        "under_refunded",
        `Promised ${formatCents(params.amountCents)} but only ${formatCents(total)} has been refunded.`,
        live.map((r) => r.id),
      ),
    ],
  };
}

function scopeCheck(stores: StoreName[]): { unobservable: StoreName[]; observable: StoreName[] } {
  const observableSet = new Set<StoreName>(OBSERVABLE_STORES);
  return {
    observable: stores.filter((s) => observableSet.has(s)),
    unobservable: stores.filter((s) => !observableSet.has(s)),
  };
}

function memoryPreamble(obs: ObservationSet, stores: StoreName[]): { result: VerifierResult } | { data: MemoryObservation; unobservable: StoreName[]; observable: StoreName[] } {
  const blocked = unavailable(obs.memories, "memory stores");
  if (blocked || !obs.memories?.ok) return { result: blocked! };
  const data = obs.memories.data;
  if (data.stale) {
    return {
      result: {
        verdict: "UNKNOWN",
        reasons: [pass("stale_observation", `The memory read replica is ${data.replicaLagMs}ms behind; stale reads are never accepted as proof.`)],
      },
    };
  }
  return { data, ...scopeCheck(stores) };
}

export function verifyErase(params: { stores: StoreName[] }, obs: ObservationSet): VerifierResult {
  const pre = memoryPreamble(obs, params.stores);
  if ("result" in pre) return pre.result;
  const residual = pre.data.records.filter((r) => r.kind === "pii" && !r.deleted && pre.observable.includes(r.store));
  const reasons: VerificationReason[] = [];
  const verdicts: Verdict[] = [];
  if (residual.length) {
    verdicts.push("FAILED");
    reasons.push(pass("residual_personal_data", `${residual.length} personal-data record(s) are still live: ${residual.map((r) => r.label).join(", ")}.`, residual.map((r) => r.id)));
  } else if (pre.observable.length) {
    verdicts.push("VERIFIED");
    reasons.push(pass("erased", `No live personal data in ${pre.observable.join(", ")}.`));
  }
  for (const store of pre.unobservable) {
    verdicts.push("UNKNOWN");
    reasons.push(pass("unobservable_store", `${store} has no read interface; erasure there cannot be confirmed.`));
  }
  return { verdict: combine(verdicts), reasons };
}

export function verifyPurge(params: { stores: StoreName[] }, obs: ObservationSet): VerifierResult {
  const pre = memoryPreamble(obs, params.stores);
  if ("result" in pre) return pre.result;
  const records = pre.data.records;
  const roots = records.filter((r) => r.kind === "pii").map((r) => r.id);
  const closure = lineageClosure(records, roots);
  const inScope = (store: StoreName) => pre.observable.includes(store);

  const lineageResidue = records.filter((r) => r.kind !== "pii" && !r.deleted && closure.has(r.id) && inScope(r.store));
  const untracked = records.filter((r) => !r.deleted && !closure.has(r.id) && r.containsSubjectIdentifier && inScope(r.store));
  const outOfScope = records.filter((r) => r.kind !== "pii" && !r.deleted && closure.has(r.id) && !inScope(r.store));

  const reasons: VerificationReason[] = [];
  const verdicts: Verdict[] = [];
  if (lineageResidue.length) {
    verdicts.push("FAILED");
    reasons.push(pass("residual_lineage", `${lineageResidue.length} derived memor${lineageResidue.length === 1 ? "y is" : "ies are"} still live: ${lineageResidue.map((r) => `${r.label} (${r.store})`).join(", ")}.`, lineageResidue.map((r) => r.id)));
  }
  if (untracked.length) {
    verdicts.push("FAILED");
    reasons.push(pass("untracked_copy", `${untracked.length} live record(s) contain the subject's identifiers without any recorded lineage.`, untracked.map((r) => r.id)));
  }
  if (!lineageResidue.length && !untracked.length && pre.observable.length) {
    verdicts.push("VERIFIED");
    reasons.push(pass("purged", `No live derived memory traced to the subject in ${pre.observable.join(", ")}.`));
  }
  for (const store of pre.unobservable) {
    verdicts.push("UNKNOWN");
    reasons.push(pass("unobservable_store", `${store} has no read interface; purge there cannot be confirmed.`));
  }
  if (outOfScope.length) {
    reasons.push(pass("out_of_scope_residue", `Note: ${outOfScope.length} derived record(s) remain in stores outside this obligation's scope.`, outOfScope.map((r) => r.id)));
  }
  return { verdict: combine(verdicts), reasons };
}

export function verifyVoidRefunds(params: { refundIds: string[] }, obs: ObservationSet): VerifierResult {
  const blocked = unavailable(obs.refunds, "refunds");
  if (blocked || !obs.refunds?.ok) return blocked!;
  const byId = new Map(obs.refunds.data.refunds.map((r) => [r.id, r]));
  const notVoided = params.refundIds.filter((id) => byId.get(id)?.status !== "voided");
  return notVoided.length
    ? { verdict: "FAILED", reasons: [pass("not_voided", `${notVoided.length} refund(s) are not voided.`, notVoided)] }
    : { verdict: "VERIFIED", reasons: [pass("voided", `All ${params.refundIds.length} refund(s) report as voided.`, params.refundIds)] };
}

export function verifyDeleteMemories(params: { memoryIds: string[] }, obs: ObservationSet): VerifierResult {
  const blocked = unavailable(obs.memories, "memory stores");
  if (blocked || !obs.memories?.ok) return blocked!;
  if (obs.memories.data.stale) {
    return { verdict: "UNKNOWN", reasons: [pass("stale_observation", "The memory read replica is behind; stale reads are never accepted as proof.")] };
  }
  const byId = new Map(obs.memories.data.records.map((r) => [r.id, r]));
  const live = params.memoryIds.filter((id) => !byId.get(id)?.deleted);
  return live.length
    ? { verdict: "FAILED", reasons: [pass("still_live", `${live.length} memory record(s) are still live.`, live)] }
    : { verdict: "VERIFIED", reasons: [pass("deleted", `All ${params.memoryIds.length} record(s) report as deleted.`, params.memoryIds)] };
}

/** Dispatch by kind. Params are already validated against the kind schema. */
export function verifyObligation(kind: ObligationKind, params: Record<string, unknown>, obs: ObservationSet): VerifierResult {
  switch (kind) {
    case "cancel_subscription":
      return verifyCancel(obs);
    case "refund_charge":
      return verifyRefund(params as { chargeId: string; amountCents: number }, obs);
    case "erase_personal_data":
      return verifyErase(params as { stores: StoreName[] }, obs);
    case "purge_derived_memories":
      return verifyPurge(params as { stores: StoreName[] }, obs);
    case "void_refunds":
      return verifyVoidRefunds(params as { refundIds: string[] }, obs);
    case "delete_memories":
      return verifyDeleteMemories(params as { memoryIds: string[] }, obs);
  }
}
