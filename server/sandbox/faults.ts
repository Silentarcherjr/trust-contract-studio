/**
 * Fault injection for the Adversarial Replay Lab.
 *
 * A workspace has exactly one active scenario. Each scenario enables a small
 * set of named faults inside the sandbox providers. Faults are consumed once
 * so a repair round runs against well-behaved providers, which is what makes
 * "fail → repair → re-verify" reproducible.
 */
import { and, eq } from "drizzle-orm";

import type { Scenario } from "../../shared/domain.js";
import type { Db } from "../db/index.js";
import { sbxFaults } from "../db/schema.js";
import { nowIso } from "../domain/integrity.js";

export type FaultKey =
  | "billing.refund_lost_response"
  | "billing.ignore_idempotency"
  | "billing.cancel_noop"
  | "billing.renewal_after_cancel"
  | "billing.observe_timeout"
  | "memory.skip_vector_index"
  | "memory.stale_read"
  | "worker.crash_after_first";

export const SCENARIO_FAULTS: Record<Scenario, FaultKey[]> = {
  clean: [],
  showcase: [
    "billing.refund_lost_response",
    "billing.ignore_idempotency",
    "memory.skip_vector_index",
  ],
  duplicate_refund: [
    "billing.refund_lost_response",
    "billing.ignore_idempotency",
  ],
  incomplete_deletion: ["memory.skip_vector_index"],
  provider_timeout: ["billing.refund_lost_response", "billing.observe_timeout"],
  stale_read: ["memory.stale_read"],
  silent_failure: ["billing.cancel_noop"],
  contradictory_evidence: ["billing.renewal_after_cancel"],
  interrupted: ["worker.crash_after_first"],
};

/**
 * Evaluation only: per-workspace fault sets that replace the scenario's list.
 * `scripts/eval/outcome-eval.ts` uses this to run every combination of
 * faults. No action, route or agent tool can reach it.
 */
const evalFaultOverride = new Map<string, FaultKey[]>();
export function setFaultOverrideForEval(
  owner: string,
  keys: FaultKey[] | null,
) {
  if (keys) evalFaultOverride.set(owner, keys);
  else evalFaultOverride.delete(owner);
}
export const ALL_FAULT_KEYS: FaultKey[] = [
  "billing.refund_lost_response",
  "billing.ignore_idempotency",
  "billing.cancel_noop",
  "billing.renewal_after_cancel",
  "billing.observe_timeout",
  "memory.skip_vector_index",
  "memory.stale_read",
  "worker.crash_after_first",
];

export async function setScenario(db: Db, owner: string, scenario: Scenario) {
  await db.delete(sbxFaults).where(eq(sbxFaults.ownerEmail, owner));
  await db.insert(sbxFaults).values({
    ownerEmail: owner,
    scenario,
    consumed: [],
    updatedAt: nowIso(),
  });
}

export async function getScenario(db: Db, owner: string): Promise<Scenario> {
  const [row] = await db
    .select()
    .from(sbxFaults)
    .where(eq(sbxFaults.ownerEmail, owner));
  return (row?.scenario as Scenario) ?? "clean";
}

export async function faultActive(
  db: Db,
  owner: string,
  key: FaultKey,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(sbxFaults)
    .where(eq(sbxFaults.ownerEmail, owner));
  if (!row) return false;
  const enabled =
    evalFaultOverride.get(owner) ??
    SCENARIO_FAULTS[row.scenario as Scenario] ??
    [];
  return enabled.includes(key) && !row.consumed.includes(key);
}

export async function consumeFault(db: Db, owner: string, key: FaultKey) {
  const [row] = await db
    .select()
    .from(sbxFaults)
    .where(eq(sbxFaults.ownerEmail, owner));
  if (!row || row.consumed.includes(key)) return;
  await db
    .update(sbxFaults)
    .set({ consumed: [...row.consumed, key], updatedAt: nowIso() })
    .where(and(eq(sbxFaults.ownerEmail, owner)));
}

/** Check-and-consume in one call, for faults that fire exactly once. */
export async function takeFault(db: Db, owner: string, key: FaultKey) {
  const active = await faultActive(db, owner, key);
  if (active) await consumeFault(db, owner, key);
  return active;
}
