/**
 * Executor: carries out approved obligations against the sandbox providers.
 *
 * - Every side effect carries an idempotency key derived from the obligation
 *   id and its approved parameter hash.
 * - Timeouts are retried a bounded number of times with the same key.
 * - Approval is re-checked here, at the moment of execution, against the
 *   approval record's parameter hash (defense in depth: the canvas status
 *   column alone is never trusted).
 * - Each attempt records what the executing agent *claims* happened. Claims
 *   are displayed for contrast and are never read by the verifier.
 */
import { and, asc, eq } from "drizzle-orm";

import {
  formatCents,
  last,
  type ObligationKind,
  type StoreName,
} from "../../shared/domain.js";
import type { Db } from "../db/index.js";
import { approvals, attempts, obligations } from "../db/schema.js";
import * as billing from "../sandbox/billing.js";
import { takeFault } from "../sandbox/faults.js";
import * as memory from "../sandbox/memory.js";
import { ContractError, ProviderTimeout } from "./errors.js";
import { newId, nowIso } from "./integrity.js";

export const MAX_ATTEMPTS = 3;

type ObligationRow = typeof obligations.$inferSelect;

export interface ExecuteContext {
  owner: string;
  contractId: string;
  runId: string;
  paceMs: number;
  onEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

/** Kahn topological order, stable by (round, position). Throws on cycles. */
export function executionOrder(
  rows: Pick<ObligationRow, "id" | "dependsOn" | "round" | "position">[],
): string[] {
  const sorted = [...rows].sort(
    (a, b) => a.round - b.round || a.position - b.position,
  );
  const ids = new Set(sorted.map((r) => r.id));
  const indegree = new Map(
    sorted.map((r) => [r.id, r.dependsOn.filter((d) => ids.has(d)).length]),
  );
  const order: string[] = [];
  while (order.length < sorted.length) {
    const next = sorted.find(
      (r) => !order.includes(r.id) && indegree.get(r.id) === 0,
    );
    if (!next)
      throw new ContractError(
        "Obligation dependencies form a cycle.",
        "dependency_cycle",
        422,
      );
    order.push(next.id);
    for (const r of sorted) {
      if (r.dependsOn.includes(next.id))
        indegree.set(r.id, (indegree.get(r.id) ?? 0) - 1);
    }
  }
  return order;
}

interface Operation {
  provider: string;
  operation: string;
  call: () => Promise<Record<string, unknown>>;
  claim: (res: Record<string, unknown>) => string;
}

function operationFor(
  db: Db,
  owner: string,
  ob: ObligationRow,
  key: string,
): Operation {
  // Params were validated against the kind's schema when the obligation was saved.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = ob.params as Record<string, any>;
  const kind = ob.kind as ObligationKind;
  switch (kind) {
    case "cancel_subscription":
      return {
        provider: "billing",
        operation: "subscriptions.cancel",
        call: () =>
          billing.cancelSubscription(db, owner, {
            customerId: p.customerId,
            subscriptionId: p.subscriptionId,
            idempotencyKey: key,
          }),
        claim: () => `Done — subscription ${p.subscriptionId} is canceled.`,
      };
    case "refund_charge":
      return {
        provider: "billing",
        operation: "refunds.create",
        call: () =>
          billing.refundCharge(db, owner, {
            customerId: p.customerId,
            chargeId: p.chargeId,
            amountCents: p.amountCents,
            idempotencyKey: key,
          }),
        claim: (r) =>
          `Done — refunded ${formatCents(Number(r.amountCents))} on ${p.chargeId}.`,
      };
    case "erase_personal_data":
      return {
        provider: "memory",
        operation: "subjects.erase",
        call: () =>
          memory.erasePersonalData(db, owner, {
            customerId: p.customerId,
            stores: p.stores as StoreName[],
          }),
        claim: () =>
          `Done — personal data erased from ${(p.stores as string[]).join(", ")}.`,
      };
    case "purge_derived_memories":
      return {
        provider: "memory",
        operation: "memories.purge_derived",
        call: () =>
          memory.purgeDerivedMemories(db, owner, {
            customerId: p.customerId,
            stores: p.stores as StoreName[],
          }),
        claim: () =>
          "Done — all memories derived from the customer's data are gone.",
      };
    case "void_refunds":
      return {
        provider: "billing",
        operation: "refunds.void",
        call: () =>
          billing.voidRefunds(db, owner, {
            customerId: p.customerId,
            chargeId: p.chargeId,
            refundIds: p.refundIds as string[],
          }),
        claim: () =>
          `Done — voided ${(p.refundIds as string[]).length} refund(s).`,
      };
    case "delete_memories":
      return {
        provider: "memory",
        operation: "memories.delete",
        call: () =>
          memory.deleteMemories(db, owner, {
            customerId: p.customerId,
            memoryIds: p.memoryIds as string[],
          }),
        claim: () =>
          `Done — deleted ${(p.memoryIds as string[]).length} residual record(s).`,
      };
  }
}

export async function executeObligations(
  db: Db,
  ctx: ExecuteContext,
): Promise<{ interrupted: boolean }> {
  const { owner, contractId, runId } = ctx;
  const rows = await db
    .select()
    .from(obligations)
    .where(
      and(
        eq(obligations.ownerEmail, owner),
        eq(obligations.contractId, contractId),
      ),
    );
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
  const byId = new Map(rows.map((r) => [r.id, r]));
  const state = new Map(rows.map((r) => [r.id, r.execution]));
  let executedThisRun = 0;

  const setExecution = async (ob: ObligationRow, execution: string) => {
    state.set(ob.id, execution);
    await db
      .update(obligations)
      .set({ execution, updatedAt: nowIso() })
      .where(and(eq(obligations.ownerEmail, owner), eq(obligations.id, ob.id)));
  };

  const record = async (
    ob: ObligationRow,
    a: Omit<
      typeof attempts.$inferInsert,
      | "id"
      | "ownerEmail"
      | "contractId"
      | "runId"
      | "obligationId"
      | "createdAt"
    >,
  ) => {
    await db.insert(attempts).values({
      id: newId("att"),
      ownerEmail: owner,
      contractId,
      runId,
      obligationId: ob.id,
      createdAt: nowIso(),
      ...a,
    });
  };

  for (const id of executionOrder(rows)) {
    const ob = byId.get(id)!;
    if (state.get(id) === "succeeded") continue; // resume: never repeat a completed side effect
    const key = `${ob.id}:${ob.paramsHash.slice(0, 16)}`;
    const skip = async (outcome: string, claim: string) => {
      await record(ob, {
        attemptNo: 0,
        idempotencyKey: key,
        provider: "studio",
        operation: "gate",
        request: {},
        outcome,
        response: null,
        claim,
        durationMs: 0,
      });
      await setExecution(ob, "skipped");
      await ctx.onEvent("execution.skipped", {
        obligationId: ob.id,
        outcome,
        claim,
      });
    };

    if (ob.approval === "rejected") {
      if (state.get(id) !== "skipped")
        await skip(
          "skipped",
          "Not pursued — a human rejected this obligation.",
        );
      continue;
    }
    if (ob.requiresApproval) {
      const latest = last(decisions.filter((d) => d.obligationId === ob.id));
      if (
        !latest ||
        latest.decision !== "approved" ||
        latest.paramsHash !== ob.paramsHash
      ) {
        await skip(
          "unauthorized",
          "Blocked — no human approval matches these exact parameters.",
        );
        continue;
      }
    }
    const blockedBy = ob.dependsOn.filter(
      (d) => byId.has(d) && state.get(d) !== "succeeded",
    );
    if (blockedBy.length) {
      await skip(
        "blocked",
        `Blocked — waiting on ${blockedBy.length} unfinished dependenc${blockedBy.length === 1 ? "y" : "ies"}.`,
      );
      continue;
    }

    const op = operationFor(db, owner, ob, key);
    let final = "errored";
    for (let attemptNo = 1; attemptNo <= MAX_ATTEMPTS; attemptNo++) {
      const started = Date.now();
      const request = { ...ob.params, idempotencyKey: key };
      try {
        const res = await op.call();
        await record(ob, {
          attemptNo,
          idempotencyKey: key,
          provider: op.provider,
          operation: op.operation,
          request,
          outcome: "ok",
          response: res,
          claim: op.claim(res),
          durationMs: Date.now() - started,
        });
        final = "succeeded";
        break;
      } catch (err) {
        if (err instanceof ProviderTimeout) {
          await record(ob, {
            attemptNo,
            idempotencyKey: key,
            provider: op.provider,
            operation: op.operation,
            request,
            outcome: "timeout",
            response: { error: err.message },
            claim:
              attemptNo < MAX_ATTEMPTS
                ? "No response from provider — retrying with the same idempotency key."
                : "Gave up after repeated timeouts; outcome unknown.",
            durationMs: Date.now() - started,
          });
          await ctx.onEvent("execution.retry", {
            obligationId: ob.id,
            attemptNo,
          });
          final = "timed_out";
          // Half the step pace (max 1 s) per attempt: a retry is visible in demo
          // mode without slowing normal runs noticeably.
          await sleep(Math.min(Math.round(ctx.paceMs / 2), 1000) * attemptNo);
          continue;
        }
        const message =
          err instanceof ContractError ? err.message : "Provider error";
        await record(ob, {
          attemptNo,
          idempotencyKey: key,
          provider: op.provider,
          operation: op.operation,
          request,
          outcome: "error",
          response: { error: message },
          claim: `Provider rejected the request: ${message}`,
          durationMs: Date.now() - started,
        });
        final = "errored";
        break;
      }
    }
    await setExecution(ob, final);
    await ctx.onEvent("execution.finished", {
      obligationId: ob.id,
      execution: final,
    });
    await sleep(ctx.paceMs);

    if (final === "succeeded") {
      executedThisRun++;
      if (
        executedThisRun === 1 &&
        (await takeFault(db, owner, "worker.crash_after_first"))
      ) {
        return { interrupted: true };
      }
    }
  }
  return { interrupted: false };
}
