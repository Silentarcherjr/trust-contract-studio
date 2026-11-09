/**
 * Shared ground truth for the evaluations: an oracle that reads the sandbox
 * tables directly (no code shared with the verifier or the observation
 * layer), plus the demo request and the helpers that run it.
 */
import { and, eq } from "drizzle-orm";

import type { Db } from "../../server/db/index.js";
import * as schema from "../../server/db/schema.js";
import * as svc from "../../server/domain/service.js";
import { liveVectorIds } from "../../server/sandbox/vector-index.js";

export const GOAL =
  "Cancel my subscription, refund $100, and delete my personal data and associated memories.";
export const ROOT_KINDS = [
  "cancel_subscription",
  "refund_charge",
  "erase_personal_data",
  "purge_derived_memories",
] as const;
export type RootKind = (typeof ROOT_KINDS)[number];
export type Verdict = "VERIFIED" | "FAILED" | "UNKNOWN";

// ---------------------------------------------------------------------------
// Oracle: ground truth from raw sandbox tables (independent implementation)
// ---------------------------------------------------------------------------
export async function oracle(
  db: Db,
  owner: string,
  kind: RootKind,
  params: Record<string, unknown>,
): Promise<boolean> {
  const { sbxSubscriptions, sbxCharges, sbxRefunds, sbxMemories } = schema;
  const liveRefundCents = async (chargeId: string) => {
    const rows = await db
      .select()
      .from(sbxRefunds)
      .where(
        and(
          eq(sbxRefunds.ownerEmail, owner),
          eq(sbxRefunds.chargeId, chargeId),
        ),
      );
    return rows
      .filter((r) => r.status !== "voided")
      .reduce((s, r) => s + r.amountCents, 0);
  };

  if (kind === "cancel_subscription") {
    // Done means: canceled, and no charge after cancellation that is not
    // fully refunded.
    const [sub] = await db
      .select()
      .from(sbxSubscriptions)
      .where(
        and(
          eq(sbxSubscriptions.ownerEmail, owner),
          eq(sbxSubscriptions.id, String(params.subscriptionId)),
        ),
      );
    if (!sub || sub.status !== "canceled" || !sub.canceledAt) return false;
    const charges = await db
      .select()
      .from(sbxCharges)
      .where(
        and(
          eq(sbxCharges.ownerEmail, owner),
          eq(sbxCharges.customerId, sub.customerId),
        ),
      );
    for (const c of charges.filter((x) => x.createdAt > sub.canceledAt!)) {
      if ((await liveRefundCents(c.id)) < c.amountCents) return false;
    }
    return true;
  }

  if (kind === "refund_charge") {
    // Done means: non-voided refunds sum to exactly the promised amount.
    return (
      (await liveRefundCents(String(params.chargeId))) ===
      Number(params.amountCents)
    );
  }

  const customerId = String(params.customerId);
  const stores = (params.stores as string[]) ?? [];
  const rows = await db
    .select()
    .from(sbxMemories)
    .where(
      and(
        eq(sbxMemories.ownerEmail, owner),
        eq(sbxMemories.customerId, customerId),
      ),
    );
  // Embeddings live in the pgvector engine: physical presence there is truth.
  const liveVectors = await liveVectorIds(owner);
  const live = (r: (typeof rows)[number]) =>
    r.store === "vector_index" ? liveVectors.has(r.id) : r.deletedAt === null;

  if (kind === "erase_personal_data") {
    // Done means: no live personal-data record in any in-scope store.
    return !rows.some(
      (r) => r.kind === "pii" && live(r) && stores.includes(r.store),
    );
  }

  // purge_derived_memories. Done means: no live in-scope memory descends from
  // the subject's personal data, and none contains one of its identifiers.
  const derived = new Set(
    rows.filter((r) => r.kind === "pii").map((r) => r.id),
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of rows) {
      if (!derived.has(r.id) && r.derivedFrom.some((d) => derived.has(d))) {
        derived.add(r.id);
        grew = true;
      }
    }
  }
  const identifiers = rows
    .filter((r) => r.kind === "pii")
    .map((r) => r.content.toLowerCase())
    .filter((v) => v.length >= 6);
  return !rows.some(
    (r) =>
      r.kind !== "pii" &&
      live(r) &&
      stores.includes(r.store) &&
      (derived.has(r.id) ||
        r.truthSubject === customerId ||
        identifiers.some((id) => r.content.toLowerCase().includes(id))),
  );
}

export async function approveAll(
  db: Db,
  who: svc.Actor,
  view: svc.ContractView,
) {
  for (const o of view.obligations.filter((x) => x.approval === "pending")) {
    view = await svc.decideApproval(db, who, {
      contractId: view.contract.id,
      obligationId: o.id,
      decision: "approved",
      paramsHash: o.paramsHash,
    });
  }
  return view;
}

export async function execute(db: Db, who: svc.Actor, contractId: string) {
  let resumed = 0;
  await svc.executeContract(db, who, { contractId });
  let view = await svc.getContractView(db, who.email, contractId);
  while (view.contract.status === "interrupted" && resumed < 3) {
    resumed++;
    await svc.executeContract(db, who, { contractId });
    view = await svc.getContractView(db, who.email, contractId);
  }
  return { view, resumed };
}
