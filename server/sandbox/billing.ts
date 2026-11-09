/**
 * Sandbox billing provider — mutating API used only by the executor.
 *
 * Modeled on a legacy billing API: idempotency keys are supported, but there
 * is no per-charge refund cap. That gap is deliberate: it is what lets a
 * duplicate refund actually happen, so the verifier has something real to find.
 */
import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { sbxCharges, sbxRefunds, sbxSubscriptions } from "../db/schema.js";
import { ContractError, ProviderTimeout } from "../domain/errors.js";
import { newId, nowIso } from "../domain/integrity.js";
import { dodoConfig, dodoEffects } from "../providers/dodo.js";
import { takeFault, usesRealBilling } from "./faults.js";

export async function cancelSubscription(
  db: Db,
  owner: string,
  input: { customerId: string; subscriptionId: string; idempotencyKey: string },
) {
  const [sub] = await db
    .select()
    .from(sbxSubscriptions)
    .where(
      and(
        eq(sbxSubscriptions.ownerEmail, owner),
        eq(sbxSubscriptions.id, input.subscriptionId),
        eq(sbxSubscriptions.customerId, input.customerId),
      ),
    );
  if (!sub) {
    throw new ContractError(
      "Subscription not found",
      "provider_not_found",
      404,
    );
  }
  if (await usesRealBilling(db, owner)) {
    // Real provider (Dodo, test mode). The local row only mirrors what the
    // UI shows; the verifier reads Dodo itself.
    const res = await dodoEffects.cancelSubscription(sub.id);
    const canceledAt = res.cancelled_at ?? nowIso();
    await db
      .update(sbxSubscriptions)
      .set({ status: "canceled", canceledAt, updatedAt: nowIso() })
      .where(eq(sbxSubscriptions.id, sub.id));
    return { subscriptionId: sub.id, status: res.status, canceledAt };
  }
  if (sub.status === "canceled") {
    return {
      subscriptionId: sub.id,
      status: "canceled",
      canceledAt: sub.canceledAt,
    };
  }
  // Fault: provider answers 200 OK but never applies the change.
  if (await takeFault(db, owner, "billing.cancel_noop")) {
    return { subscriptionId: sub.id, status: "canceled", canceledAt: nowIso() };
  }
  const canceledAt = nowIso();
  await db
    .update(sbxSubscriptions)
    .set({ status: "canceled", canceledAt, updatedAt: canceledAt })
    .where(eq(sbxSubscriptions.id, sub.id));

  // Fault: a renewal job that was already queued bills the customer anyway.
  if (await takeFault(db, owner, "billing.renewal_after_cancel")) {
    await db.insert(sbxCharges).values({
      id: newId("ch"),
      ownerEmail: owner,
      customerId: sub.customerId,
      amountCents: sub.priceCents,
      description: "Studio Plus — renewal (queued before cancel)",
      createdAt: new Date(Date.parse(canceledAt) + 1000).toISOString(),
    });
  }
  return { subscriptionId: sub.id, status: "canceled", canceledAt };
}

export async function refundCharge(
  db: Db,
  owner: string,
  input: {
    customerId: string;
    chargeId: string;
    amountCents: number;
    idempotencyKey: string;
  },
) {
  const [charge] = await db
    .select()
    .from(sbxCharges)
    .where(
      and(
        eq(sbxCharges.ownerEmail, owner),
        eq(sbxCharges.id, input.chargeId),
        eq(sbxCharges.customerId, input.customerId),
      ),
    );
  if (!charge) {
    throw new ContractError("Charge not found", "provider_not_found", 404);
  }
  if (await usesRealBilling(db, owner)) {
    // Real provider (Dodo, test mode). Dodo documents no idempotency key, so
    // there is nothing to send that would make a retry safe.
    const cfg = dodoConfig();
    if (!cfg)
      throw new ContractError(
        "Real billing is not configured.",
        "provider_error",
        503,
      );
    const refund = await dodoEffects.refund({
      paymentId: charge.id,
      productId: cfg.productId,
      amountCents: input.amountCents,
      reason: "Trust Contract Studio: promised refund",
    });
    await db.insert(sbxRefunds).values({
      id: refund.refund_id,
      ownerEmail: owner,
      customerId: input.customerId,
      chargeId: input.chargeId,
      amountCents: input.amountCents,
      idempotencyKey: `${input.idempotencyKey}:${refund.refund_id}`,
      status: "succeeded",
      createdAt: nowIso(),
      voidedAt: null,
    });
    // Fault: the refund is applied at Dodo, but the response is treated as lost.
    if (await takeFault(db, owner, "billing.refund_lost_response")) {
      throw new ProviderTimeout("billing", "refunds.create", true);
    }
    return {
      refundId: refund.refund_id,
      amountCents: input.amountCents,
      replayed: false,
    };
  }
  const [existing] = await db
    .select()
    .from(sbxRefunds)
    .where(
      and(
        eq(sbxRefunds.ownerEmail, owner),
        eq(sbxRefunds.idempotencyKey, input.idempotencyKey),
      ),
    );
  // Fault: on a genuine retry, the provider fails to honor the key.
  if (existing && !(await takeFault(db, owner, "billing.ignore_idempotency"))) {
    return {
      refundId: existing.id,
      amountCents: existing.amountCents,
      replayed: true,
    };
  }
  const refundId = newId("re");
  await db.insert(sbxRefunds).values({
    id: refundId,
    ownerEmail: owner,
    customerId: input.customerId,
    chargeId: input.chargeId,
    amountCents: input.amountCents,
    idempotencyKey: input.idempotencyKey,
    status: "succeeded",
    createdAt: nowIso(),
    voidedAt: null,
  });
  // Fault: the refund is applied but the response never reaches the caller.
  if (await takeFault(db, owner, "billing.refund_lost_response")) {
    throw new ProviderTimeout("billing", "refunds.create", true);
  }
  return { refundId, amountCents: input.amountCents, replayed: false };
}

export async function voidRefunds(
  db: Db,
  owner: string,
  input: { customerId: string; chargeId: string; refundIds: string[] },
) {
  if (await usesRealBilling(db, owner)) {
    throw new ContractError(
      "Dodo Payments cannot reverse a refund through its API. Recovering the duplicate needs a person.",
      "provider_irreversible",
      422,
    );
  }
  const rows = await db
    .select()
    .from(sbxRefunds)
    .where(
      and(
        eq(sbxRefunds.ownerEmail, owner),
        eq(sbxRefunds.customerId, input.customerId),
        eq(sbxRefunds.chargeId, input.chargeId),
        inArray(sbxRefunds.id, input.refundIds),
      ),
    );
  if (rows.length !== input.refundIds.length) {
    throw new ContractError(
      "Some refunds were not found",
      "provider_not_found",
      404,
    );
  }
  const voidedAt = nowIso();
  await db
    .update(sbxRefunds)
    .set({ status: "voided", voidedAt })
    .where(
      and(
        eq(sbxRefunds.ownerEmail, owner),
        inArray(sbxRefunds.id, input.refundIds),
      ),
    );
  return { voided: input.refundIds, voidedAt };
}
