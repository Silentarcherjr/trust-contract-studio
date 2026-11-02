/**
 * Trust Contract Studio — shared domain vocabulary.
 *
 * Imported by server code (actions, verifier, executor) and by the React UI so
 * both sides agree on statuses, obligation kinds and fault scenarios.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Verdicts: the only three answers the proof engine ever gives.
// ---------------------------------------------------------------------------
export const VERDICTS = ["VERIFIED", "FAILED", "UNKNOWN"] as const;
export type Verdict = (typeof VERDICTS)[number];

// ---------------------------------------------------------------------------
// Contract lifecycle (enforced by server/domain/state-machine.ts)
// ---------------------------------------------------------------------------
export const CONTRACT_STATUSES = [
  "awaiting_approval",
  "ready",
  "executing",
  "interrupted",
  "verifying",
  "verified",
  "failed",
  "unknown",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const APPROVAL_STATES = [
  "not_required",
  "pending",
  "approved",
  "rejected",
] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const EXECUTION_STATES = [
  "not_started",
  "succeeded",
  "errored",
  "timed_out",
  "skipped",
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

// ---------------------------------------------------------------------------
// Obligation catalog. A promise is only accepted into a contract when it maps
// to one of these kinds, because each kind has a deterministic verifier.
// ---------------------------------------------------------------------------
export const OBSERVABLE_STORES = [
  "profile_db",
  "memory_store",
  "vector_index",
] as const;
export const ALL_STORES = [...OBSERVABLE_STORES, "analytics_export"] as const;
export type StoreName = (typeof ALL_STORES)[number];

export const STORE_LABELS: Record<StoreName, string> = {
  profile_db: "Profile database",
  memory_store: "Agent memory store",
  vector_index: "Vector index",
  analytics_export: "Analytics export (third party)",
};

const storeSchema = z.enum(ALL_STORES);

export const obligationParamsSchemas = {
  cancel_subscription: z.object({
    customerId: z.string(),
    subscriptionId: z.string(),
  }),
  refund_charge: z.object({
    customerId: z.string(),
    chargeId: z.string(),
    amountCents: z.number().int().positive().max(1_000_000),
  }),
  erase_personal_data: z.object({
    customerId: z.string(),
    stores: z.array(storeSchema).min(1),
  }),
  purge_derived_memories: z.object({
    customerId: z.string(),
    stores: z.array(storeSchema).min(1),
  }),
  // Repair-only kinds.
  void_refunds: z.object({
    customerId: z.string(),
    chargeId: z.string(),
    refundIds: z.array(z.string()).min(1),
  }),
  delete_memories: z.object({
    customerId: z.string(),
    memoryIds: z.array(z.string()).min(1),
  }),
} as const;

export type ObligationKind = keyof typeof obligationParamsSchemas;
export const OBLIGATION_KINDS = Object.keys(
  obligationParamsSchemas,
) as ObligationKind[];
export const PRIMARY_KINDS = [
  "cancel_subscription",
  "refund_charge",
  "erase_personal_data",
  "purge_derived_memories",
] as const satisfies readonly ObligationKind[];

export type ObligationParams<K extends ObligationKind = ObligationKind> =
  z.infer<(typeof obligationParamsSchemas)[K]>;

export interface KindInfo {
  label: string;
  /** Plain-language statement of what "done" means, shown on the canvas. */
  expectedEvidence: string;
  /** Default: sensitive kinds require a human decision before execution. */
  sensitive: boolean;
  repairOnly?: boolean;
}

export const KIND_INFO: Record<ObligationKind, KindInfo> = {
  cancel_subscription: {
    label: "Cancel subscription",
    expectedEvidence:
      "Billing reports the subscription as canceled AND the ledger shows no charge created after the cancellation time.",
    sensitive: true,
  },
  refund_charge: {
    label: "Refund charge",
    expectedEvidence:
      "Non-voided refunds against the charge sum to exactly the promised amount — no less, no more.",
    sensitive: true,
  },
  erase_personal_data: {
    label: "Erase personal data",
    expectedEvidence:
      "No live personal-data record for the customer remains in any in-scope store.",
    sensitive: true,
  },
  purge_derived_memories: {
    label: "Purge derived memories",
    expectedEvidence:
      "No live memory descended from the customer's personal data remains, and no live memory contains a fingerprint of it.",
    sensitive: true,
  },
  void_refunds: {
    label: "Void duplicate refunds",
    expectedEvidence: "Every listed refund is reported as voided by billing.",
    sensitive: true,
    repairOnly: true,
  },
  delete_memories: {
    label: "Delete residual memories",
    expectedEvidence: "Every listed memory is reported as deleted.",
    sensitive: true,
    repairOnly: true,
  },
};

// ---------------------------------------------------------------------------
// Adversarial scenarios (Replay Lab). Faults are injected inside the sandbox
// providers, never inside the verifier.
// ---------------------------------------------------------------------------
export const SCENARIOS = [
  "clean",
  "showcase",
  "duplicate_refund",
  "incomplete_deletion",
  "provider_timeout",
  "stale_read",
  "silent_failure",
  "contradictory_evidence",
  "interrupted",
  "disguised_copy",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface ScenarioInfo {
  title: string;
  summary: string;
  /** What the verifier is expected to conclude on the first verification. */
  expected: Partial<Record<(typeof PRIMARY_KINDS)[number], Verdict>>;
}

export const SCENARIO_INFO: Record<Scenario, ScenarioInfo> = {
  clean: {
    title: "Clean run",
    summary: "Every provider behaves. All obligations should verify.",
    expected: {
      cancel_subscription: "VERIFIED",
      refund_charge: "VERIFIED",
      erase_personal_data: "VERIFIED",
      purge_derived_memories: "VERIFIED",
    },
  },
  showcase: {
    title: "Showcase (demo)",
    summary:
      "Two silent failures in one run: a retried refund is paid twice and a vector-index replica keeps derived memories.",
    expected: {
      cancel_subscription: "VERIFIED",
      refund_charge: "FAILED",
      erase_personal_data: "VERIFIED",
      purge_derived_memories: "FAILED",
    },
  },
  duplicate_refund: {
    title: "Duplicate refund",
    summary:
      "The refund is applied but its response is lost; the retry hits a billing API that ignores idempotency keys.",
    expected: { refund_charge: "FAILED" },
  },
  incomplete_deletion: {
    title: "Incomplete deletion",
    summary:
      "The memory provider reports success but a lagging vector-index replica keeps copies of derived memories.",
    expected: { purge_derived_memories: "FAILED" },
  },
  provider_timeout: {
    title: "Provider timeout",
    summary:
      "Billing's read API times out during verification, so cancellation and refund cannot be observed.",
    expected: { cancel_subscription: "UNKNOWN", refund_charge: "UNKNOWN" },
  },
  stale_read: {
    title: "Stale read",
    summary:
      "The memory read API serves a lagging replica; stale observations are never accepted as proof.",
    expected: {
      erase_personal_data: "UNKNOWN",
      purge_derived_memories: "UNKNOWN",
    },
  },
  silent_failure: {
    title: "Silent failure",
    summary:
      "Cancel returns 200 OK and the agent reports success, but the subscription is still active.",
    expected: { cancel_subscription: "FAILED" },
  },
  contradictory_evidence: {
    title: "Contradictory evidence",
    summary:
      "The subscription reads as canceled, yet the ledger records a renewal charge after cancellation.",
    expected: { cancel_subscription: "FAILED" },
  },
  interrupted: {
    title: "Interrupted execution",
    summary:
      "The worker crashes after the first obligation. Resuming must not repeat completed side effects.",
    expected: {
      cancel_subscription: "VERIFIED",
      refund_charge: "VERIFIED",
      erase_personal_data: "VERIFIED",
      purge_derived_memories: "VERIFIED",
    },
  },
  disguised_copy: {
    title: "Disguised copy",
    summary:
      "After the purge, a re-indexing job re-embeds the customer's email in a reformatted form with no lineage. Text matching misses it; a vector-similarity search finds it.",
    expected: {
      cancel_subscription: "VERIFIED",
      refund_charge: "VERIFIED",
      erase_personal_data: "VERIFIED",
      purge_derived_memories: "FAILED",
    },
  },
};

// ---------------------------------------------------------------------------
// Input schema for agent- or user-authored obligations.
// ---------------------------------------------------------------------------
export const obligationDraftSchema = z.object({
  kind: z.enum(PRIMARY_KINDS),
  title: z.string().min(3).max(140).optional(),
  params: z.record(z.string(), z.unknown()),
  dependsOn: z
    .array(z.number().int().min(0))
    .default([])
    .describe(
      "Indexes of earlier obligations in this list that must succeed first.",
    ),
});
export type ObligationDraft = z.infer<typeof obligationDraftSchema>;

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

/** Last element of an array (Array.prototype.at is outside this project's lib). */
export function last<T>(items: readonly T[]): T | undefined {
  return items.length ? items[items.length - 1] : undefined;
}
