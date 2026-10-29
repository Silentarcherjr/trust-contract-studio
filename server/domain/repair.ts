/**
 * Repair planner: deterministic proposals derived from verifier reasons.
 * Proposals are new obligations that still need a human decision before
 * anything runs. Some failures (timeouts, stale reads) need no side effect —
 * only a fresh observation — and are returned as "reverify" suggestions.
 */
import type { ObligationKind } from "../../shared/domain.js";
import type { VerificationReason } from "../db/schema.js";

export interface RepairProposal {
  kind: ObligationKind;
  title: string;
  params: Record<string, unknown>;
  repairOf: string;
  rationale: string;
}

export interface RepairPlan {
  proposals: RepairProposal[];
  reverify: { obligationId: string; reason: string }[];
  needsHuman: { obligationId: string; reason: string }[];
}

interface FailedObligation {
  id: string;
  kind: ObligationKind;
  params: Record<string, unknown>;
  verdict: string;
  reasons: VerificationReason[];
}

export function planRepairs(failed: FailedObligation[], chargeAmounts: Map<string, number>): RepairPlan {
  const plan: RepairPlan = { proposals: [], reverify: [], needsHuman: [] };
  for (const ob of failed) {
    const customerId = ob.params.customerId as string;
    for (const reason of ob.reasons) {
      switch (reason.code) {
        case "over_refunded":
          plan.proposals.push({
            kind: "void_refunds",
            title: `Void ${reason.refs?.length ?? 0} duplicate refund(s)`,
            params: { customerId, chargeId: ob.params.chargeId, refundIds: reason.refs ?? [] },
            repairOf: ob.id,
            rationale: reason.message,
          });
          break;
        case "under_refunded":
          plan.proposals.push({
            kind: "refund_charge",
            title: "Retry the refund",
            params: { ...ob.params },
            repairOf: ob.id,
            rationale: reason.message,
          });
          break;
        case "still_active":
          plan.proposals.push({
            kind: "cancel_subscription",
            title: "Retry the cancellation",
            params: { ...ob.params },
            repairOf: ob.id,
            rationale: reason.message,
          });
          break;
        case "charge_after_cancel":
          for (const chargeId of reason.refs ?? []) {
            plan.proposals.push({
              kind: "refund_charge",
              title: "Refund the charge made after cancellation",
              params: { customerId, chargeId, amountCents: chargeAmounts.get(chargeId) ?? 0 },
              repairOf: ob.id,
              rationale: reason.message,
            });
          }
          break;
        case "residual_personal_data":
        case "residual_lineage":
        case "untracked_copy":
          plan.proposals.push({
            kind: "delete_memories",
            title: `Delete ${reason.refs?.length ?? 0} residual record(s)`,
            params: { customerId, memoryIds: reason.refs ?? [] },
            repairOf: ob.id,
            rationale: reason.message,
          });
          break;
        case "observation_timeout":
        case "stale_observation":
        case "no_observation":
          plan.reverify.push({ obligationId: ob.id, reason: reason.message });
          break;
        case "unobservable_store":
          plan.needsHuman.push({
            obligationId: ob.id,
            reason: `${reason.message} Either narrow the scope on the canvas or accept UNKNOWN for that store.`,
          });
          break;
        default:
          break;
      }
    }
  }
  // De-duplicate reverify entries per obligation.
  plan.reverify = plan.reverify.filter((r, i, arr) => arr.findIndex((x) => x.obligationId === r.obligationId) === i);
  return plan;
}
