/**
 * Contract lifecycle. Every status change in the app goes through
 * assertTransition(); there is no other code path that writes status.
 */
import type { ContractStatus } from "../../shared/domain.js";
import { ContractError } from "./errors.js";

export const TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  awaiting_approval: ["awaiting_approval", "ready"],
  ready: ["awaiting_approval", "executing"],
  executing: ["verifying", "interrupted"],
  interrupted: ["executing"],
  verifying: ["verified", "failed", "unknown"],
  verified: ["verifying"],
  failed: ["verifying", "awaiting_approval"],
  unknown: ["verifying", "awaiting_approval"],
};

export function canTransition(
  from: ContractStatus,
  to: ContractStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(
  from: ContractStatus,
  to: ContractStatus,
): void {
  if (!canTransition(from, to)) {
    throw new ContractError(
      `A contract that is "${from}" cannot move to "${to}".`,
      "invalid_transition",
      409,
    );
  }
}

/** Statuses in which obligations may be edited on the canvas. */
export const EDITABLE_STATUSES: readonly ContractStatus[] = [
  "awaiting_approval",
  "ready",
];
