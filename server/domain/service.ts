/**
 * Contract service: the single implementation behind every shared action.
 * Every function takes the caller's identity and scopes all reads and writes
 * to that owner.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  KIND_INFO,
  REAL_BILLING_SCENARIOS,
  SCENARIO_INFO,
  obligationParamsSchemas,
  type ContractStatus,
  type ObligationDraft,
  type ObligationKind,
  type Scenario,
  type Verdict,
  last,
} from "../../shared/domain.js";
import type { Db } from "../db/index.js";
import {
  approvals,
  attempts,
  auditEvents,
  contracts,
  evidence,
  obligations,
  receipts,
  runs,
  sbxCharges,
  sbxCustomers,
  sbxFaults,
  sbxMemories,
  sbxRefunds,
  sbxSubscriptions,
  verifications,
} from "../db/schema.js";
import { dodoConfig, dodoEffects } from "../providers/dodo.js";
import {
  consumeFault,
  getScenario,
  setScenario,
  usesRealBilling,
} from "../sandbox/faults.js";
import {
  observeMemories,
  observeRefunds,
  observeSubscription,
  type Observation,
} from "../sandbox/observe.js";
import { type RealBilling, seedSandbox } from "../sandbox/seed.js";
import { liveVectorIds, vectorEngineName } from "../sandbox/vector-index.js";
import { ContractError } from "./errors.js";
import { executeObligations, executionOrder } from "./executor.js";
import {
  canonicalJson,
  digestOf,
  hmac,
  newId,
  nowIso,
  receiptKey,
  safeEqualHex,
  sha256,
} from "./integrity.js";
import {
  loadSubject,
  planFromGoal,
  type PlannedObligation,
  type SubjectContext,
} from "./planner.js";
import { assertRateLimit } from "./rate-limit.js";
import { planRepairs } from "./repair.js";
import { EDITABLE_STATUSES, assertTransition } from "./state-machine.js";
import {
  VERIFIER_VERSION,
  combine,
  verifyObligation,
  type ObservationSet,
} from "./verifier.js";

export interface Actor {
  email: string;
  /** The framework's ActionCaller: "frontend", "tool", "cli", "mcp", ... */
  caller: string;
}

/**
 * Surfaces where a person is directly at the controls. Only the app UI:
 * the CLI is driven by coding agents too, so it does not count as a person.
 * The actions that use this also declare `uiOnly`, so the framework proves
 * the request came from the signed-in UI before the caller reaches here.
 */
export const HUMAN_CALLERS: ReadonlySet<string> = new Set(["frontend"]);

/** After this long without progress, an "executing" contract counts as interrupted. */
export const STALE_RUN_MS = 5 * 60 * 1000;

type ContractRow = typeof contracts.$inferSelect;
type ObligationRow = typeof obligations.$inferSelect;

// ---------------------------------------------------------------------------
// Audit log (hash-chained per workspace; tamper-evident, not immutable)
// ---------------------------------------------------------------------------
export async function appendAudit(
  db: Db,
  owner: string,
  e: {
    contractId?: string | null;
    actor: string;
    caller: string;
    type: string;
    payload?: Record<string, unknown>;
  },
) {
  for (let i = 0; i < 4; i++) {
    const [last] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.ownerEmail, owner))
      .orderBy(desc(auditEvents.seq))
      .limit(1);
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? "genesis";
    const createdAt = nowIso();
    const payload = e.payload ?? {};
    const hash = sha256(
      prevHash +
        canonicalJson({
          seq,
          contractId: e.contractId ?? null,
          actor: e.actor,
          caller: e.caller,
          type: e.type,
          payload,
          createdAt,
        }),
    );
    try {
      await db.insert(auditEvents).values({
        id: newId("evt"),
        ownerEmail: owner,
        contractId: e.contractId ?? null,
        seq,
        actor: e.actor,
        caller: e.caller,
        type: e.type,
        payload,
        prevHash,
        hash,
        createdAt,
      });
      return;
    } catch (err) {
      if (i === 3) throw err; // seq collision under concurrency: retry
    }
  }
}

export async function verifyAuditChain(db: Db, owner: string) {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.ownerEmail, owner))
    .orderBy(asc(auditEvents.seq));
  let prev = "genesis";
  for (const r of rows) {
    const expected = sha256(
      prev +
        canonicalJson({
          seq: r.seq,
          contractId: r.contractId,
          actor: r.actor,
          caller: r.caller,
          type: r.type,
          payload: r.payload,
          createdAt: r.createdAt,
        }),
    );
    if (r.prevHash !== prev || r.hash !== expected) {
      return {
        intact: false,
        events: rows.length,
        brokenAtSeq: r.seq,
        head: last(rows)?.hash ?? null,
      };
    }
    prev = r.hash;
  }
  return {
    intact: true,
    events: rows.length,
    brokenAtSeq: null,
    head: last(rows)?.hash ?? null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function requireHuman(actor: Actor, what: string) {
  if (!HUMAN_CALLERS.has(actor.caller)) {
    throw new ContractError(
      `${what} requires a person at the Studio UI. Agents, scripts and external callers (${actor.caller}) cannot do this.`,
      "human_required",
      403,
    );
  }
}

async function requireContract(
  db: Db,
  owner: string,
  contractId: string,
): Promise<ContractRow> {
  const [row] = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.ownerEmail, owner), eq(contracts.id, contractId)));
  // Same answer whether the id does not exist or belongs to someone else.
  if (!row) throw new ContractError("Contract not found.", "not_found", 404);
  return row;
}

async function contractObligations(db: Db, owner: string, contractId: string) {
  return db
    .select()
    .from(obligations)
    .where(
      and(
        eq(obligations.ownerEmail, owner),
        eq(obligations.contractId, contractId),
      ),
    )
    .orderBy(asc(obligations.round), asc(obligations.position));
}

/** Optimistic-concurrency status change, validated by the state machine. */
async function transition(
  db: Db,
  contract: ContractRow,
  to: ContractStatus,
  extra: Partial<ContractRow> = {},
) {
  assertTransition(contract.status as ContractStatus, to);
  const [updated] = await db
    .update(contracts)
    .set({
      ...extra,
      status: to,
      version: contract.version + 1,
      updatedAt: nowIso(),
    })
    .where(
      and(
        eq(contracts.id, contract.id),
        eq(contracts.ownerEmail, contract.ownerEmail),
        eq(contracts.version, contract.version),
      ),
    )
    .returning();
  if (!updated) {
    throw new ContractError(
      "The contract changed while you were working. Reload and try again.",
      "version_conflict",
      409,
    );
  }
  return updated;
}

async function bumpVersion(
  db: Db,
  contract: ContractRow,
  expectedVersion?: number,
) {
  if (expectedVersion !== undefined && expectedVersion !== contract.version) {
    throw new ContractError(
      "The contract changed while you were working. Reload and try again.",
      "version_conflict",
      409,
      { currentVersion: contract.version },
    );
  }
  const [updated] = await db
    .update(contracts)
    .set({ version: contract.version + 1, updatedAt: nowIso() })
    .where(
      and(
        eq(contracts.id, contract.id),
        eq(contracts.version, contract.version),
      ),
    )
    .returning();
  if (!updated)
    throw new ContractError(
      "The contract changed while you were working. Reload and try again.",
      "version_conflict",
      409,
    );
  return updated;
}

/** Most obligations one contract may hold (drafts are capped lower). */
export const MAX_OBLIGATIONS_PER_CONTRACT = 16;

/**
 * Refund verification checks the charge's total of live refunds against the
 * promise, so one contract may hold only one refund promise per charge
 * (repairs of that promise excluded). Two promises on one charge would each
 * see the other's refund and both read as over-refunded.
 */
function assertOneRefundPerCharge(
  existing: {
    id?: string;
    kind: string;
    params: unknown;
    repairOf?: string | null;
  }[],
  kind: string,
  params: Record<string, unknown>,
  excludeId?: string,
) {
  if (kind !== "refund_charge") return;
  const clash = existing.some(
    (o) =>
      o.id !== excludeId &&
      o.kind === "refund_charge" &&
      !o.repairOf &&
      (o.params as { chargeId?: string }).chargeId === params.chargeId,
  );
  if (clash) {
    throw new ContractError(
      "This contract already promises a refund of that charge. Edit that clause's amount instead.",
      "duplicate_refund_promise",
      422,
    );
  }
}

function paramsHashOf(kind: string, params: Record<string, unknown>) {
  return digestOf({ kind, params });
}

function defaultsFor(
  kind: ObligationKind,
  subject: SubjectContext,
): Record<string, unknown> {
  switch (kind) {
    case "cancel_subscription":
      return {
        customerId: subject.customerId,
        subscriptionId: subject.subscriptionId,
      };
    case "refund_charge": {
      const latest = last(subject.charges);
      return {
        customerId: subject.customerId,
        chargeId: latest?.id,
        amountCents: latest?.amountCents,
      };
    }
    case "erase_personal_data":
      return { customerId: subject.customerId, stores: ["profile_db"] };
    case "purge_derived_memories":
      return {
        customerId: subject.customerId,
        stores: ["memory_store", "vector_index"],
      };
    default:
      return { customerId: subject.customerId };
  }
}

/** Validates params by kind and checks every referenced id belongs to the subject. */
async function validateParams(
  db: Db,
  owner: string,
  kind: ObligationKind,
  params: Record<string, unknown>,
) {
  const parsed = obligationParamsSchemas[kind].safeParse(params);
  if (!parsed.success) {
    throw new ContractError(
      `Invalid parameters for ${KIND_INFO[kind].label}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
      "invalid_params",
      422,
    );
  }
  const p = parsed.data as Record<string, unknown>;
  const subject = await loadSubject(db, owner);
  if (p.customerId !== subject.customerId) {
    throw new ContractError(
      "Obligations may only target the requesting customer.",
      "invalid_params",
      422,
    );
  }
  if ("subscriptionId" in p && p.subscriptionId !== subject.subscriptionId) {
    throw new ContractError(
      "Unknown subscription for this customer.",
      "invalid_params",
      422,
    );
  }
  if ("chargeId" in p) {
    const [charge] = await db
      .select()
      .from(sbxCharges)
      .where(
        and(
          eq(sbxCharges.ownerEmail, owner),
          eq(sbxCharges.id, p.chargeId as string),
          eq(sbxCharges.customerId, subject.customerId),
        ),
      );
    if (!charge)
      throw new ContractError(
        "Unknown charge for this customer.",
        "invalid_params",
        422,
      );
    if ("amountCents" in p && (p.amountCents as number) > charge.amountCents) {
      throw new ContractError(
        "A refund cannot exceed the original charge.",
        "invalid_params",
        422,
      );
    }
  }
  // Repair-only ids must belong to this customer (and charge), whoever edits them.
  if (Array.isArray(p.refundIds) && p.refundIds.length) {
    const ids = p.refundIds as string[];
    const found = await db
      .select({ id: sbxRefunds.id })
      .from(sbxRefunds)
      .where(
        and(
          eq(sbxRefunds.ownerEmail, owner),
          eq(sbxRefunds.chargeId, p.chargeId as string),
          inArray(sbxRefunds.id, ids),
        ),
      );
    if (found.length !== new Set(ids).size)
      throw new ContractError(
        "Unknown refund for this charge.",
        "invalid_params",
        422,
      );
  }
  if (Array.isArray(p.memoryIds) && p.memoryIds.length) {
    const ids = p.memoryIds as string[];
    const found = await db
      .select({ id: sbxMemories.id })
      .from(sbxMemories)
      .where(
        and(
          eq(sbxMemories.ownerEmail, owner),
          eq(sbxMemories.customerId, subject.customerId),
          inArray(sbxMemories.id, ids),
        ),
      );
    if (found.length !== new Set(ids).size)
      throw new ContractError(
        "Unknown memory for this customer.",
        "invalid_params",
        422,
      );
  }
  return p;
}

// ---------------------------------------------------------------------------
// Workspace / demo
// ---------------------------------------------------------------------------
export async function resetDemo(
  db: Db,
  actor: Actor,
  input: { scenario: Scenario },
) {
  const owner = actor.email;
  await assertRateLimit(db, owner, "reset");
  let real: RealBilling | undefined;
  if (REAL_BILLING_SCENARIOS.includes(input.scenario)) {
    const cfg = dodoConfig();
    if (!cfg) {
      throw new ContractError(
        "The real-billing scenario is not configured on this server (Dodo Payments test-mode key and test ids).",
        "real_billing_unavailable",
        503,
      );
    }
    // Stop the previous real test subscription of this workspace, if any, so
    // test renewals do not pile up. Best effort: the reset continues anyway.
    if (await usesRealBilling(db, owner)) {
      const previous = await db
        .select({ id: sbxSubscriptions.id, status: sbxSubscriptions.status })
        .from(sbxSubscriptions)
        .where(eq(sbxSubscriptions.ownerEmail, owner));
      for (const p of previous.filter((p) => p.status === "active")) {
        await dodoEffects.cancelSubscription(p.id).catch(() => undefined);
      }
    }
    try {
      real = await dodoEffects.startSubscription(cfg);
    } catch (err) {
      throw new ContractError(
        `Dodo Payments (test mode) did not start a test subscription: ${(err as Error).message.slice(0, 160)}`,
        "real_billing_unavailable",
        502,
      );
    }
  }
  const tables = [
    contracts,
    obligations,
    approvals,
    runs,
    attempts,
    evidence,
    verifications,
    receipts,
    auditEvents,
    sbxCustomers,
    sbxSubscriptions,
    sbxCharges,
    sbxRefunds,
    sbxMemories,
    sbxFaults,
  ] as const;
  for (const t of tables) {
    await db.delete(t).where(eq(t.ownerEmail, owner));
  }
  const seeded = await seedSandbox(db, owner, real);
  await setScenario(db, owner, input.scenario);
  await appendAudit(db, owner, {
    actor: owner,
    caller: actor.caller,
    type: "workspace.reset",
    payload: { scenario: input.scenario },
  });
  return { scenario: input.scenario, requesterId: seeded.requesterId };
}

export async function getWorkspace(db: Db, owner: string) {
  const scenario = await getScenario(db, owner);
  const customers = await db
    .select()
    .from(sbxCustomers)
    .where(eq(sbxCustomers.ownerEmail, owner))
    .orderBy(asc(sbxCustomers.createdAt));
  const [subject, ...bystanders] = customers;
  if (!subject)
    return {
      seeded: false as const,
      scenario,
      scenarioInfo: SCENARIO_INFO[scenario],
      realBillingAvailable: dodoConfig() !== null,
    };
  const [sub] = await db
    .select()
    .from(sbxSubscriptions)
    .where(
      and(
        eq(sbxSubscriptions.ownerEmail, owner),
        eq(sbxSubscriptions.customerId, subject.id),
      ),
    );
  const charges = await db
    .select()
    .from(sbxCharges)
    .where(
      and(
        eq(sbxCharges.ownerEmail, owner),
        eq(sbxCharges.customerId, subject.id),
      ),
    )
    .orderBy(asc(sbxCharges.createdAt));
  const refunds = await db
    .select()
    .from(sbxRefunds)
    .where(
      and(
        eq(sbxRefunds.ownerEmail, owner),
        eq(sbxRefunds.customerId, subject.id),
      ),
    )
    .orderBy(asc(sbxRefunds.createdAt));
  const mems = await db
    .select()
    .from(sbxMemories)
    .where(
      and(
        eq(sbxMemories.ownerEmail, owner),
        eq(sbxMemories.customerId, subject.id),
      ),
    )
    .orderBy(asc(sbxMemories.createdAt), asc(sbxMemories.id));
  // Embeddings live in the pgvector engine; it decides what is live.
  const [liveVectors, vectorEngine] = await Promise.all([
    liveVectorIds(owner),
    vectorEngineName(),
  ]);
  return {
    seeded: true as const,
    scenario,
    scenarioInfo: SCENARIO_INFO[scenario],
    subject: { id: subject.id, displayName: subject.displayName },
    bystanders: bystanders.map((c) => ({
      id: c.id,
      displayName: c.displayName,
    })),
    subscription: sub
      ? {
          id: sub.id,
          plan: sub.plan,
          status: sub.status,
          canceledAt: sub.canceledAt,
          priceCents: sub.priceCents,
        }
      : null,
    charges: charges.map((c) => ({
      id: c.id,
      amountCents: c.amountCents,
      description: c.description,
      createdAt: c.createdAt,
    })),
    refunds: refunds.map((r) => ({
      id: r.id,
      chargeId: r.chargeId,
      amountCents: r.amountCents,
      status: r.status,
      createdAt: r.createdAt,
    })),
    // Lineage registry: labels and links only. Content is never returned, and
    // the third-party export's live state is unknown by construction.
    vectorEngine,
    billingProvider: REAL_BILLING_SCENARIOS.includes(scenario)
      ? "Dodo Payments (test mode, real API)"
      : "Sandbox",
    realBillingAvailable: dodoConfig() !== null,
    lineage: mems.map((m) => ({
      id: m.id,
      store: m.store,
      kind: m.kind,
      label: m.label,
      derivedFrom: m.derivedFrom,
      state:
        m.store === "analytics_export"
          ? "unobservable"
          : (m.store === "vector_index" ? !liveVectors.has(m.id) : m.deletedAt)
            ? "deleted"
            : "live",
    })),
  };
}

export async function listContracts(db: Db, owner: string) {
  const rows = await db
    .select()
    .from(contracts)
    .where(eq(contracts.ownerEmail, owner))
    .orderBy(desc(contracts.createdAt))
    .limit(50);
  return rows.map((c) => ({
    id: c.id,
    goal: c.goal,
    status: c.status,
    scenario: c.scenario,
    round: c.round,
    createdAt: c.createdAt,
  }));
}

// ---------------------------------------------------------------------------
// Drafting & editing (Promise Canvas)
// ---------------------------------------------------------------------------
export async function draftContract(
  db: Db,
  actor: Actor,
  input: { goal: string; obligations?: ObligationDraft[] | undefined },
) {
  const owner = actor.email;
  await assertRateLimit(db, owner, "draft");
  const subject = await loadSubject(db, owner);
  let planned: PlannedObligation[];
  let unmatched: string[] = [];
  let limitations: string[];
  let plannedBy: string;

  const templatePlan = planFromGoal(input.goal, subject);
  if (input.obligations?.length) {
    plannedBy = actor.caller === "tool" ? "agent" : "person";
    planned = input.obligations.map((d) => ({
      kind: d.kind,
      title: d.title ?? KIND_INFO[d.kind].label,
      params: { ...defaultsFor(d.kind, subject), ...d.params },
      dependsOn: d.dependsOn ?? [],
    }));
    limitations = templatePlan.limitations;
  } else {
    plannedBy = "template";
    planned = templatePlan.obligations;
    unmatched = templatePlan.unmatchedClauses;
    limitations = templatePlan.limitations;
  }
  if (!planned.length) {
    throw new ContractError(
      "None of this request maps to an obligation the Studio can verify.",
      "no_verifiable_obligations",
      422,
      { unmatchedClauses: templatePlan.unmatchedClauses },
    );
  }
  for (const [i, p] of planned.entries()) {
    p.params = await validateParams(db, owner, p.kind, p.params);
    assertOneRefundPerCharge(planned.slice(0, i), p.kind, p.params);
    if (p.dependsOn.some((d) => d < 0 || d >= i)) {
      throw new ContractError(
        "dependsOn may only reference earlier obligations.",
        "invalid_dependencies",
        422,
      );
    }
  }

  const scenario = await getScenario(db, owner);
  const now = nowIso();
  const contractId = newId("ctr");
  const ids = planned.map(() => newId("obl"));
  await db.insert(contracts).values({
    id: contractId,
    ownerEmail: owner,
    goal: input.goal,
    status: "awaiting_approval",
    scenario,
    plannedBy,
    round: 1,
    version: 1,
    limitations,
    unmatchedClauses: unmatched,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(obligations).values(
    planned.map((p, i) => ({
      id: ids[i]!,
      ownerEmail: owner,
      contractId,
      position: i,
      kind: p.kind,
      title: p.title,
      params: p.params,
      paramsHash: paramsHashOf(p.kind, p.params),
      dependsOn: p.dependsOn.map((d) => ids[d]!),
      requiresApproval: KIND_INFO[p.kind].sensitive ? 1 : 0,
      approval: KIND_INFO[p.kind].sensitive ? "pending" : "not_required",
      execution: "not_started",
      verdict: null,
      repairOf: null,
      round: 1,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await appendAudit(db, owner, {
    contractId,
    actor: owner,
    caller: actor.caller,
    type: "contract.drafted",
    payload: {
      plannedBy,
      obligations: planned.length,
      unmatched: unmatched.length,
    },
  });
  await refreshReadiness(db, owner, contractId);
  return getContractView(db, owner, contractId);
}

export async function updateObligation(
  db: Db,
  actor: Actor,
  input: {
    contractId: string;
    obligationId: string;
    expectedVersion?: number | undefined;
    title?: string | undefined;
    params?: Record<string, unknown> | undefined;
    dependsOn?: string[] | undefined;
    remove?: boolean | undefined;
  },
) {
  const owner = actor.email;
  let contract = await requireContract(db, owner, input.contractId);
  if (!EDITABLE_STATUSES.includes(contract.status as ContractStatus)) {
    throw new ContractError(
      `Obligations cannot be edited while the contract is "${contract.status}".`,
      "not_editable",
      409,
    );
  }
  const all = await contractObligations(db, owner, contract.id);
  const ob = all.find((o) => o.id === input.obligationId);
  if (!ob) throw new ContractError("Obligation not found.", "not_found", 404);
  if (ob.execution === "succeeded") {
    throw new ContractError(
      "This obligation already ran; edit a repair instead.",
      "already_executed",
      409,
    );
  }
  contract = await bumpVersion(db, contract, input.expectedVersion);

  if (input.remove) {
    await db
      .delete(obligations)
      .where(and(eq(obligations.ownerEmail, owner), eq(obligations.id, ob.id)));
    for (const other of all.filter((o) => o.dependsOn.includes(ob.id))) {
      await db
        .update(obligations)
        .set({
          dependsOn: other.dependsOn.filter((d) => d !== ob.id),
          updatedAt: nowIso(),
        })
        .where(eq(obligations.id, other.id));
    }
    await appendAudit(db, owner, {
      contractId: contract.id,
      actor: owner,
      caller: actor.caller,
      type: "obligation.removed",
      payload: { obligationId: ob.id, kind: ob.kind },
    });
    await refreshReadiness(db, owner, contract.id);
    return getContractView(db, owner, contract.id);
  }

  const patch: Partial<ObligationRow> = {
    updatedAt: nowIso(),
    version: ob.version + 1,
  };
  const changed: string[] = [];
  if (
    input.title !== undefined &&
    input.title.trim() &&
    input.title !== ob.title
  ) {
    patch.title = input.title.trim().slice(0, 140);
    changed.push("title");
  }
  if (input.params) {
    const merged = await validateParams(db, owner, ob.kind as ObligationKind, {
      ...ob.params,
      ...input.params,
    });
    if (!ob.repairOf) assertOneRefundPerCharge(all, ob.kind, merged, ob.id);
    const hash = paramsHashOf(ob.kind, merged);
    if (hash !== ob.paramsHash) {
      patch.params = merged;
      patch.paramsHash = hash;
      changed.push("params");
      // Any approval was for the old parameters; it no longer applies.
      if (ob.requiresApproval) patch.approval = "pending";
    }
  }
  if (input.dependsOn) {
    const ids = new Set(all.map((o) => o.id));
    if (input.dependsOn.some((d) => !ids.has(d) || d === ob.id)) {
      throw new ContractError(
        "Dependencies must reference other obligations in this contract.",
        "invalid_dependencies",
        422,
      );
    }
    executionOrder(
      all.map((o) =>
        o.id === ob.id ? { ...o, dependsOn: input.dependsOn! } : o,
      ),
    );
    const before = [...ob.dependsOn].sort().join(",");
    const after = [...new Set(input.dependsOn)].sort().join(",");
    if (before !== after) {
      patch.dependsOn = [...new Set(input.dependsOn)];
      changed.push("dependsOn");
    }
  }
  // The person approved this clause as written, in this order. A new title
  // or new dependencies change what they approved, so the approval no longer
  // applies (the parameter hash alone does not cover them).
  if (
    ob.requiresApproval &&
    ob.approval !== "pending" &&
    (changed.includes("title") || changed.includes("dependsOn"))
  ) {
    patch.approval = "pending";
  }
  await db
    .update(obligations)
    .set(patch)
    .where(and(eq(obligations.ownerEmail, owner), eq(obligations.id, ob.id)));
  await appendAudit(db, owner, {
    contractId: contract.id,
    actor: owner,
    caller: actor.caller,
    type: "obligation.updated",
    payload: {
      obligationId: ob.id,
      changed,
      approvalReset: patch.approval === "pending" && ob.approval !== "pending",
    },
  });
  await refreshReadiness(db, owner, contract.id);
  return getContractView(db, owner, contract.id);
}

export async function addObligation(
  db: Db,
  actor: Actor,
  input: {
    contractId: string;
    draft: ObligationDraft;
    expectedVersion?: number | undefined;
  },
) {
  const owner = actor.email;
  let contract = await requireContract(db, owner, input.contractId);
  if (!EDITABLE_STATUSES.includes(contract.status as ContractStatus)) {
    throw new ContractError(
      `Obligations cannot be added while the contract is "${contract.status}".`,
      "not_editable",
      409,
    );
  }
  const subject = await loadSubject(db, owner);
  const params = await validateParams(db, owner, input.draft.kind, {
    ...defaultsFor(input.draft.kind, subject),
    ...input.draft.params,
  });
  const existing = await contractObligations(db, owner, contract.id);
  if (existing.length >= MAX_OBLIGATIONS_PER_CONTRACT) {
    throw new ContractError(
      `A contract can hold at most ${MAX_OBLIGATIONS_PER_CONTRACT} obligations.`,
      "too_many_obligations",
      422,
    );
  }
  assertOneRefundPerCharge(existing, input.draft.kind, params);
  contract = await bumpVersion(db, contract, input.expectedVersion);
  const all = await contractObligations(db, owner, contract.id);
  const now = nowIso();
  const id = newId("obl");
  await db.insert(obligations).values({
    id,
    ownerEmail: owner,
    contractId: contract.id,
    position: all.length,
    kind: input.draft.kind,
    title: input.draft.title ?? KIND_INFO[input.draft.kind].label,
    params,
    paramsHash: paramsHashOf(input.draft.kind, params),
    dependsOn: [],
    requiresApproval: 1,
    approval: "pending",
    execution: "not_started",
    verdict: null,
    repairOf: null,
    round: contract.round,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  await appendAudit(db, owner, {
    contractId: contract.id,
    actor: owner,
    caller: actor.caller,
    type: "obligation.added",
    payload: { obligationId: id, kind: input.draft.kind },
  });
  await refreshReadiness(db, owner, contract.id);
  return getContractView(db, owner, contract.id);
}

/** awaiting_approval ⇄ ready, depending on whether any decision is pending. */
async function refreshReadiness(db: Db, owner: string, contractId: string) {
  const contract = await requireContract(db, owner, contractId);
  if (!EDITABLE_STATUSES.includes(contract.status as ContractStatus))
    return contract;
  const obs = await contractObligations(db, owner, contractId);
  const pending = obs.some(
    (o) => o.execution !== "succeeded" && o.approval === "pending",
  );
  const target: ContractStatus = pending ? "awaiting_approval" : "ready";
  return target === contract.status
    ? contract
    : transition(db, contract, target);
}

// ---------------------------------------------------------------------------
// Approvals (human only)
// ---------------------------------------------------------------------------
export async function decideApproval(
  db: Db,
  actor: Actor,
  input: {
    contractId: string;
    obligationId: string;
    decision: "approved" | "rejected";
    paramsHash: string;
    note?: string | undefined;
  },
) {
  const owner = actor.email;
  const contract = await requireContract(db, owner, input.contractId);
  if (!HUMAN_CALLERS.has(actor.caller)) {
    await appendAudit(db, owner, {
      contractId: contract.id,
      actor: owner,
      caller: actor.caller,
      type: "approval.refused_non_human",
      payload: { obligationId: input.obligationId, decision: input.decision },
    });
    requireHuman(actor, "Approving or rejecting an obligation");
  }
  if (!EDITABLE_STATUSES.includes(contract.status as ContractStatus)) {
    throw new ContractError(
      `Decisions are closed while the contract is "${contract.status}".`,
      "not_decidable",
      409,
    );
  }
  const [ob] = await db
    .select()
    .from(obligations)
    .where(
      and(
        eq(obligations.ownerEmail, owner),
        eq(obligations.id, input.obligationId),
        eq(obligations.contractId, contract.id),
      ),
    );
  if (!ob) throw new ContractError("Obligation not found.", "not_found", 404);
  if (!ob.requiresApproval)
    throw new ContractError(
      "This obligation does not need a decision.",
      "not_required",
      409,
    );
  if (ob.execution === "succeeded")
    throw new ContractError(
      "This obligation already ran.",
      "already_executed",
      409,
    );
  if (input.paramsHash !== ob.paramsHash) {
    throw new ContractError(
      "The obligation changed after you reviewed it. Review the new parameters and decide again.",
      "stale_approval",
      409,
      { currentParamsHash: ob.paramsHash },
    );
  }
  await db.insert(approvals).values({
    id: newId("apr"),
    ownerEmail: owner,
    contractId: contract.id,
    obligationId: ob.id,
    decision: input.decision,
    paramsHash: ob.paramsHash,
    decidedBy: owner,
    caller: actor.caller,
    note: input.note?.slice(0, 500) ?? null,
    createdAt: nowIso(),
  });
  await db
    .update(obligations)
    .set({
      approval: input.decision,
      version: ob.version + 1,
      updatedAt: nowIso(),
    })
    .where(eq(obligations.id, ob.id));
  await appendAudit(db, owner, {
    contractId: contract.id,
    actor: owner,
    caller: actor.caller,
    type: `approval.${input.decision}`,
    payload: { obligationId: ob.id, paramsHash: ob.paramsHash },
  });
  await refreshReadiness(db, owner, contract.id);
  return getContractView(db, owner, contract.id);
}

// ---------------------------------------------------------------------------
// Execution & verification
// ---------------------------------------------------------------------------
export async function executeContract(
  db: Db,
  actor: Actor,
  input: { contractId: string; paceMs?: number | undefined },
) {
  const owner = actor.email;
  await assertRateLimit(db, owner, "execute");
  let contract = await requireContract(db, owner, input.contractId);
  // A run whose function was killed (timeout, deploy, crash) leaves the
  // contract "executing" with nobody working on it. After a grace period it
  // is treated as interrupted, so it can be resumed; the executor's
  // idempotency keys keep the resume from repeating finished work.
  if (
    contract.status === "executing" &&
    Date.now() - Date.parse(contract.updatedAt) > STALE_RUN_MS
  ) {
    contract = await transition(db, contract, "interrupted");
    await appendAudit(db, owner, {
      contractId: contract.id,
      actor: "worker",
      caller: actor.caller,
      type: "execution.interrupted",
      payload: { reason: "stale_run" },
    });
  }
  const status = contract.status as ContractStatus;
  if (status !== "ready" && status !== "interrupted") {
    throw new ContractError(
      status === "awaiting_approval"
        ? "Some obligations still need a human decision."
        : `A contract that is "${status}" cannot be executed.`,
      status === "awaiting_approval"
        ? "approval_pending"
        : "invalid_transition",
      409,
    );
  }
  contract = await transition(db, contract, "executing");
  const runId = newId("run");
  await db.insert(runs).values({
    id: runId,
    ownerEmail: owner,
    contractId: contract.id,
    kind: "execute",
    round: contract.round,
    status: "running",
    triggeredBy: owner,
    caller: actor.caller,
    startedAt: nowIso(),
    finishedAt: null,
  });
  await appendAudit(db, owner, {
    contractId: contract.id,
    actor: owner,
    caller: actor.caller,
    type: status === "interrupted" ? "execution.resumed" : "execution.started",
    payload: { runId, round: contract.round },
  });

  let result: Awaited<ReturnType<typeof executeObligations>>;
  try {
    result = await executeObligations(db, {
      owner,
      contractId: contract.id,
      runId,
      paceMs: Math.max(0, Math.min(input.paceMs ?? 0, 2000)),
      onEvent: async () => {},
    });
  } catch (err) {
    // Leave the contract resumable instead of stuck in "executing".
    result = { interrupted: true } as typeof result;
    contract = await requireContract(db, owner, contract.id);
    await db
      .update(runs)
      .set({ status: "interrupted", finishedAt: nowIso() })
      .where(and(eq(runs.ownerEmail, owner), eq(runs.id, runId)));
    await transition(db, contract, "interrupted");
    await appendAudit(db, owner, {
      contractId: contract.id,
      actor: "worker",
      caller: actor.caller,
      type: "execution.interrupted",
      payload: { runId, reason: "error" },
    });
    throw err;
  }

  contract = await requireContract(db, owner, contract.id);
  if (result.interrupted) {
    await db
      .update(runs)
      .set({ status: "interrupted", finishedAt: nowIso() })
      .where(eq(runs.id, runId));
    await transition(db, contract, "interrupted");
    await appendAudit(db, owner, {
      contractId: contract.id,
      actor: "worker",
      caller: actor.caller,
      type: "execution.interrupted",
      payload: { runId },
    });
    return getContractView(db, owner, contract.id);
  }
  await db
    .update(runs)
    .set({ status: "completed", finishedAt: nowIso() })
    .where(eq(runs.id, runId));
  await appendAudit(db, owner, {
    contractId: contract.id,
    actor: owner,
    caller: actor.caller,
    type: "execution.completed",
    payload: { runId },
  });
  contract = await transition(db, contract, "verifying");
  await runVerification(db, actor, contract);
  return getContractView(db, owner, contract.id);
}

export async function verifyContract(
  db: Db,
  actor: Actor,
  input: { contractId: string },
) {
  const owner = actor.email;
  await assertRateLimit(db, owner, "verify");
  let contract = await requireContract(db, owner, input.contractId);
  contract = await transition(db, contract, "verifying");
  await runVerification(db, actor, contract);
  return getContractView(db, owner, contract.id);
}

async function runVerification(db: Db, actor: Actor, contract: ContractRow) {
  const owner = actor.email;
  const runId = newId("run");
  await db.insert(runs).values({
    id: runId,
    ownerEmail: owner,
    contractId: contract.id,
    kind: "verify",
    round: contract.round,
    status: "running",
    triggeredBy: owner,
    caller: actor.caller,
    startedAt: nowIso(),
    finishedAt: null,
  });

  const all = await contractObligations(db, owner, contract.id);
  const pursued = all.filter((o) => o.approval !== "rejected");
  const cache = new Map<string, Observation<unknown>>();
  const observe = async <T>(key: string, fn: () => Promise<Observation<T>>) => {
    if (!cache.has(key)) cache.set(key, await fn());
    return cache.get(key) as Observation<T>;
  };

  const verdicts: Verdict[] = [];
  for (const ob of pursued) {
    const p = ob.params as {
      subscriptionId: string;
      chargeId: string;
      customerId: string;
    };
    const set: ObservationSet = {};
    switch (ob.kind as ObligationKind) {
      case "cancel_subscription":
        set.subscription = await observe(`sub:${p.subscriptionId}`, () =>
          observeSubscription(db, owner, p.subscriptionId),
        );
        break;
      case "refund_charge":
      case "void_refunds":
        set.refunds = await observe(`ref:${p.chargeId}`, () =>
          observeRefunds(db, owner, p.chargeId),
        );
        break;
      default:
        set.memories = await observe(`mem:${p.customerId}`, () =>
          observeMemories(db, owner, p.customerId),
        );
    }
    const result = verifyObligation(ob.kind as ObligationKind, ob.params, set);
    const verificationId = newId("ver");
    await db.insert(verifications).values({
      id: verificationId,
      ownerEmail: owner,
      contractId: contract.id,
      obligationId: ob.id,
      runId,
      round: contract.round,
      verdict: result.verdict,
      reasons: result.reasons,
      verifierVersion: VERIFIER_VERSION,
      checkedAt: nowIso(),
    });
    for (const o of Object.values(set)) {
      if (!o) continue;
      const observed = o as unknown as Record<string, unknown>;
      await db.insert(evidence).values({
        id: newId("evd"),
        ownerEmail: owner,
        contractId: contract.id,
        obligationId: ob.id,
        verificationId,
        source: o.source,
        observed,
        observedAt: o.observedAt,
        digest: digestOf(observed),
      });
    }
    await db
      .update(obligations)
      .set({ verdict: result.verdict, updatedAt: nowIso() })
      .where(eq(obligations.id, ob.id));
    verdicts.push(result.verdict);
  }
  // Observation faults model transient conditions: they clear after one pass.
  await consumeFault(db, owner, "billing.observe_timeout");
  await consumeFault(db, owner, "memory.stale_read");

  const overall = combine(verdicts);
  const fresh = await requireContract(db, owner, contract.id);
  await transition(
    db,
    fresh,
    overall === "VERIFIED"
      ? "verified"
      : overall === "FAILED"
        ? "failed"
        : "unknown",
  );
  await db
    .update(runs)
    .set({ status: "completed", finishedAt: nowIso() })
    .where(eq(runs.id, runId));
  await appendAudit(db, owner, {
    contractId: contract.id,
    actor: "verifier",
    caller: actor.caller,
    type: "verification.completed",
    payload: {
      runId,
      overall,
      verified: verdicts.filter((v) => v === "VERIFIED").length,
      failed: verdicts.filter((v) => v === "FAILED").length,
      unknown: verdicts.filter((v) => v === "UNKNOWN").length,
    },
  });
  return overall;
}

// ---------------------------------------------------------------------------
// Repair (Human Repair Studio)
// ---------------------------------------------------------------------------
export async function proposeRepair(
  db: Db,
  actor: Actor,
  input: { contractId: string },
) {
  const owner = actor.email;
  await assertRateLimit(db, owner, "repair");
  let contract = await requireContract(db, owner, input.contractId);
  if (contract.status !== "failed" && contract.status !== "unknown") {
    throw new ContractError(
      "Repairs can only be proposed for FAILED or UNKNOWN contracts.",
      "invalid_transition",
      409,
    );
  }
  const all = await contractObligations(db, owner, contract.id);
  const latest = await latestVerifications(db, owner, contract.id);
  const failing = all
    .filter((o) => o.verdict === "FAILED" || o.verdict === "UNKNOWN")
    .map((o) => ({
      id: o.id,
      kind: o.kind as ObligationKind,
      params: o.params,
      verdict: o.verdict!,
      reasons: latest.get(o.id)?.reasons ?? [],
    }));
  const charges = await db
    .select()
    .from(sbxCharges)
    .where(eq(sbxCharges.ownerEmail, owner));
  const plan = planRepairs(
    failing,
    new Map(charges.map((c) => [c.id, c.amountCents])),
  );
  // A real provider cannot void a refund: say so instead of proposing it.
  if (await usesRealBilling(db, owner)) {
    for (const p of plan.proposals.filter((p) => p.kind === "void_refunds")) {
      plan.needsHuman.push({
        obligationId: p.repairOf,
        reason: `Dodo Payments cannot reverse a refund through its API, so the over-refund (${(p.params.refundIds as string[]).length} extra refund(s)) needs a person to recover. ${p.rationale}`,
      });
    }
    plan.proposals = plan.proposals.filter((p) => p.kind !== "void_refunds");
  }

  if (plan.proposals.length) {
    const round = contract.round + 1;
    const now = nowIso();
    const startPos = all.length;
    const rows = [];
    for (const [i, p] of plan.proposals.entries()) {
      const params = await validateParams(db, owner, p.kind, p.params);
      rows.push({
        id: newId("obl"),
        ownerEmail: owner,
        contractId: contract.id,
        position: startPos + i,
        kind: p.kind,
        title: p.title,
        params,
        paramsHash: paramsHashOf(p.kind, params),
        dependsOn: [],
        requiresApproval: 1,
        approval: "pending",
        execution: "not_started",
        verdict: null,
        repairOf: p.repairOf,
        round,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    // Validate every proposal before changing status, so a rejected proposal
    // cannot leave the contract in a new round with no repairs.
    contract = await transition(db, contract, "awaiting_approval", { round });
    await db.insert(obligations).values(rows);
    await appendAudit(db, owner, {
      contractId: contract.id,
      actor: owner,
      caller: actor.caller,
      type: "repair.proposed",
      payload: {
        round,
        proposals: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          repairOf: r.repairOf,
        })),
      },
    });
  }
  return { plan, view: await getContractView(db, owner, contract.id) };
}

async function latestVerifications(db: Db, owner: string, contractId: string) {
  const rows = await db
    .select()
    .from(verifications)
    .where(
      and(
        eq(verifications.ownerEmail, owner),
        eq(verifications.contractId, contractId),
      ),
    )
    .orderBy(asc(verifications.checkedAt));
  const map = new Map<string, (typeof rows)[number]>();
  for (const r of rows) map.set(r.obligationId, r);
  return map;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
export async function getContractView(
  db: Db,
  owner: string,
  contractId: string,
) {
  const contract = await requireContract(db, owner, contractId);
  const obs = await contractObligations(db, owner, contractId);
  const decisions = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.ownerEmail, owner),
        eq(approvals.contractId, contractId),
      ),
    )
    .orderBy(asc(approvals.createdAt));
  const runRows = await db
    .select()
    .from(runs)
    .where(and(eq(runs.ownerEmail, owner), eq(runs.contractId, contractId)))
    .orderBy(asc(runs.startedAt));
  const attemptRows = await db
    .select()
    .from(attempts)
    .where(
      and(eq(attempts.ownerEmail, owner), eq(attempts.contractId, contractId)),
    )
    .orderBy(asc(attempts.createdAt));
  const verRows = await db
    .select()
    .from(verifications)
    .where(
      and(
        eq(verifications.ownerEmail, owner),
        eq(verifications.contractId, contractId),
      ),
    )
    .orderBy(asc(verifications.checkedAt));
  const evRows = verRows.length
    ? await db
        .select()
        .from(evidence)
        .where(
          and(
            eq(evidence.ownerEmail, owner),
            inArray(
              evidence.verificationId,
              verRows.map((v) => v.id),
            ),
          ),
        )
    : [];
  const audit = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.ownerEmail, owner),
        eq(auditEvents.contractId, contractId),
      ),
    )
    .orderBy(asc(auditEvents.seq));
  const latest = new Map<string, (typeof verRows)[number]>();
  for (const v of verRows) latest.set(v.obligationId, v);

  const evidenceView = evRows.map((e) => ({
    id: e.id,
    obligationId: e.obligationId,
    verificationId: e.verificationId,
    source: e.source,
    observedAt: e.observedAt,
    digest: e.digest,
    intact: digestOf(e.observed) === e.digest,
    observed: e.observed,
  }));

  return {
    contract: {
      id: contract.id,
      goal: contract.goal,
      status: contract.status as ContractStatus,
      scenario: contract.scenario as Scenario,
      plannedBy: contract.plannedBy,
      round: contract.round,
      version: contract.version,
      limitations: contract.limitations,
      unmatchedClauses: contract.unmatchedClauses,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
    },
    obligations: obs.map((o) => {
      const v = latest.get(o.id);
      const lastDecision =
        last(decisions.filter((d) => d.obligationId === o.id)) ?? null;
      return {
        id: o.id,
        position: o.position,
        round: o.round,
        kind: o.kind as ObligationKind,
        title: o.title,
        params: o.params,
        paramsHash: o.paramsHash,
        dependsOn: o.dependsOn,
        requiresApproval: o.requiresApproval === 1,
        approval: o.approval,
        execution: o.execution,
        verdict: o.verdict as Verdict | null,
        repairOf: o.repairOf,
        version: o.version,
        expectedEvidence: KIND_INFO[o.kind as ObligationKind].expectedEvidence,
        reasons: v?.reasons ?? [],
        lastDecision: lastDecision && {
          decision: lastDecision.decision,
          decidedBy: lastDecision.decidedBy,
          caller: lastDecision.caller,
          createdAt: lastDecision.createdAt,
          matchesCurrentParams: lastDecision.paramsHash === o.paramsHash,
        },
        evidenceIntact: evidenceView
          .filter((e) => e.verificationId === v?.id)
          .every((e) => e.intact),
      };
    }),
    runs: runRows,
    attempts: attemptRows.map((a) => ({
      id: a.id,
      runId: a.runId,
      obligationId: a.obligationId,
      attemptNo: a.attemptNo,
      provider: a.provider,
      operation: a.operation,
      outcome: a.outcome,
      claim: a.claim,
      idempotencyKey: a.idempotencyKey,
      durationMs: a.durationMs,
      createdAt: a.createdAt,
      response: a.response,
    })),
    verifications: verRows.map((v) => ({
      id: v.id,
      obligationId: v.obligationId,
      runId: v.runId,
      round: v.round,
      verdict: v.verdict as Verdict,
      reasons: v.reasons,
      checkedAt: v.checkedAt,
    })),
    evidence: evidenceView,
    audit: audit.map((a) => ({
      seq: a.seq,
      type: a.type,
      actor: a.actor,
      caller: a.caller,
      payload: a.payload,
      createdAt: a.createdAt,
      hash: a.hash,
    })),
  };
}

export type ContractView = Awaited<ReturnType<typeof getContractView>>;

// ---------------------------------------------------------------------------
// Proof receipts
// ---------------------------------------------------------------------------
export async function exportReceipt(
  db: Db,
  actor: Actor,
  input: { contractId: string },
) {
  const owner = actor.email;
  await assertRateLimit(db, owner, "receipt");
  const view = await getContractView(db, owner, input.contractId);
  if (!["verified", "failed", "unknown"].includes(view.contract.status)) {
    throw new ContractError(
      "Run verification before exporting a receipt.",
      "not_verified",
      409,
    );
  }
  const chain = await verifyAuditChain(db, owner);
  const { key, ephemeral } = receiptKey();
  const latestVer = new Map<string, (typeof view.verifications)[number]>();
  for (const v of view.verifications) latestVer.set(v.obligationId, v);

  const obligationEntries = view.obligations.map((o) => {
    const v = latestVer.get(o.id);
    const ev = view.evidence.filter((e) => e.verificationId === v?.id);
    const intact = ev.every((e) => e.intact);
    let verdict: Verdict | "NOT_PURSUED" =
      o.approval === "rejected"
        ? "NOT_PURSUED"
        : ((v?.verdict ?? "UNKNOWN") as Verdict);
    const reasons = [...(v?.reasons ?? [])];
    if (verdict !== "NOT_PURSUED" && !intact) {
      verdict = "UNKNOWN";
      reasons.push({
        code: "evidence_integrity_failed",
        message:
          "Stored evidence no longer matches its digest; this result cannot be relied on. Re-run verification.",
      });
    }
    return {
      id: o.id,
      kind: o.kind,
      title: o.title,
      round: o.round,
      repairOf: o.repairOf,
      params: o.params,
      paramsHash: o.paramsHash,
      approval: o.lastDecision
        ? { ...o.lastDecision, state: o.approval }
        : { state: o.approval },
      execution: o.execution,
      verdict,
      reasons,
      verifiedAt: v?.checkedAt ?? null,
      evidence: ev.map((e) => ({
        id: e.id,
        source: e.source,
        observedAt: e.observedAt,
        digest: e.digest,
        integrity: e.intact ? "intact" : "MISMATCH",
      })),
      history: view.verifications
        .filter((x) => x.obligationId === o.id)
        .map((x) => ({
          round: x.round,
          verdict: x.verdict,
          checkedAt: x.checkedAt,
        })),
    };
  });
  const pursued = obligationEntries
    .filter((o) => o.verdict !== "NOT_PURSUED")
    .map((o) => o.verdict as Verdict);
  const body = {
    schema: "tcs.proof-receipt/v1",
    receiptId: newId("rcpt"),
    issuedAt: nowIso(),
    issuer: "Trust Contract Studio — sandbox workspace",
    verifierVersion: VERIFIER_VERSION,
    contract: {
      id: view.contract.id,
      goal: view.contract.goal,
      plannedBy: view.contract.plannedBy,
      scenario: view.contract.scenario,
      rounds: view.contract.round,
      createdAt: view.contract.createdAt,
    },
    overall: combine(pursued),
    summary: {
      VERIFIED: pursued.filter((v) => v === "VERIFIED").length,
      FAILED: pursued.filter((v) => v === "FAILED").length,
      UNKNOWN: pursued.filter((v) => v === "UNKNOWN").length,
      NOT_PURSUED: obligationEntries.length - pursued.length,
    },
    obligations: obligationEntries,
    agentClaims: {
      recorded: view.attempts.filter((a) => a.outcome !== "skipped").length,
      usedAsEvidence: 0,
      note: "Executor self-reports are kept for comparison only. Every verdict is computed from provider observations.",
    },
    auditChain: chain,
    limitations: [
      ...view.contract.limitations,
      "This receipt describes sandbox providers with synthetic data. It is not a legal compliance attestation.",
      "Integrity: HMAC-SHA256 lets the issuing server detect edits to this receipt. It is not a public-key signature or a trusted timestamp.",
      ...(ephemeral
        ? [
            "The signing key is ephemeral (RECEIPT_SIGNING_KEY not set); this receipt can only be checked until the server restarts.",
          ]
        : []),
    ],
  };
  const digest = sha256(canonicalJson(body));
  const signature = hmac(digest, key);
  await db.insert(receipts).values({
    id: body.receiptId,
    ownerEmail: owner,
    contractId: view.contract.id,
    body,
    digest,
    signature,
    createdAt: body.issuedAt,
  });
  await appendAudit(db, owner, {
    contractId: view.contract.id,
    actor: owner,
    caller: actor.caller,
    type: "receipt.exported",
    payload: { receiptId: body.receiptId, digest, overall: body.overall },
  });
  return {
    ...body,
    integrity: {
      algorithm: "HMAC-SHA256(SHA-256(canonical JSON))",
      digest,
      signature,
    },
  };
}

/** The latest proof receipt issued for a contract, with its integrity block. */
export async function getLatestReceipt(
  db: Db,
  owner: string,
  contractId: string,
) {
  await requireContract(db, owner, contractId);
  const [row] = await db
    .select()
    .from(receipts)
    .where(
      and(eq(receipts.ownerEmail, owner), eq(receipts.contractId, contractId)),
    )
    .orderBy(desc(receipts.createdAt))
    .limit(1);
  if (!row) {
    throw new ContractError(
      "No receipt has been issued for this contract yet. Call export-receipt first.",
      "not_found",
      404,
    );
  }
  const body = row.body as Record<string, unknown> & { receiptId: string };
  return {
    ...body,
    integrity: {
      algorithm: "HMAC-SHA256(SHA-256(canonical JSON))",
      digest: row.digest,
      signature: row.signature,
    },
  };
}

/** Depth and key checks for an untrusted receipt before canonicalising it. */
function receiptShapeProblem(value: unknown, depth = 0): string | null {
  if (depth > 32) return "it is nested too deeply";
  if (Array.isArray(value)) {
    for (const v of value) {
      const p = receiptShapeProblem(v, depth + 1);
      if (p) return p;
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype")
        return `it contains the reserved key "${k}"`;
      const p = receiptShapeProblem(v, depth + 1);
      if (p) return p;
    }
  }
  return null;
}

export function checkReceipt(receipt: Record<string, unknown>) {
  const problem = receiptShapeProblem(receipt);
  if (problem) {
    return {
      digestMatches: false,
      signatureValid: false,
      message: `Malformed: ${problem}.`,
    };
  }
  const { integrity, ...body } = receipt as {
    integrity?: { digest?: string; signature?: string };
  } & Record<string, unknown>;
  if (!integrity?.digest || !integrity.signature) {
    return {
      digestMatches: false,
      signatureValid: false,
      message: "Receipt has no integrity block.",
    };
  }
  const digest = sha256(canonicalJson(body));
  const digestMatches = digest === integrity.digest;
  const { key, ephemeral } = receiptKey();
  const signatureValid =
    digestMatches &&
    /^[0-9a-f]+$/.test(integrity.signature) &&
    safeEqualHex(hmac(digest, key), integrity.signature);
  return {
    digestMatches,
    signatureValid,
    ephemeralKey: ephemeral,
    message: signatureValid
      ? "Intact: this receipt was issued by this server and has not been edited."
      : digestMatches
        ? "Content is self-consistent but the signature does not match this server's key."
        : "Tampered: the receipt content does not match its digest.",
  };
}

// ---------------------------------------------------------------------------
// Replay Lab adversary: edit stored evidence without fixing its digest.
// ---------------------------------------------------------------------------
export async function tamperEvidence(
  db: Db,
  actor: Actor,
  input: { contractId: string },
) {
  requireHuman(actor, "The evidence-tampering drill");
  const owner = actor.email;
  const contract = await requireContract(db, owner, input.contractId);
  const [target] = await db
    .select()
    .from(evidence)
    .where(
      and(eq(evidence.ownerEmail, owner), eq(evidence.contractId, contract.id)),
    )
    .orderBy(desc(evidence.observedAt))
    .limit(1);
  if (!target)
    throw new ContractError(
      "There is no evidence to tamper with yet.",
      "no_evidence",
      409,
    );
  const forged = {
    ...target.observed,
    forged: true,
    note: "Edited to look like success",
  };
  await db
    .update(evidence)
    .set({ observed: forged })
    .where(eq(evidence.id, target.id));
  await appendAudit(db, owner, {
    contractId: contract.id,
    actor: owner,
    caller: actor.caller,
    type: "lab.evidence_tampered",
    payload: { evidenceId: target.id },
  });
  return getContractView(db, owner, contract.id);
}
