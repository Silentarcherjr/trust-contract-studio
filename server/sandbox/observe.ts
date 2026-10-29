/**
 * Read-only observation interface over the sandbox providers.
 *
 * This is the ONLY module the proof engine uses to learn about the world.
 * It performs SELECTs only, never reads the executor's attempt log or the
 * agent's claims, and never returns raw personal data: memory observations
 * carry labels, lineage ids and a boolean identifier match instead of content.
 */
import { and, eq, inArray, ne } from "drizzle-orm";

import { OBSERVABLE_STORES, type StoreName } from "../../shared/domain.js";
import type { Db } from "../db/index.js";
import {
  sbxCharges,
  sbxMemories,
  sbxRefunds,
  sbxSubscriptions,
} from "../db/schema.js";
import { nowIso } from "../domain/integrity.js";
import { faultActive } from "./faults.js";

export type Observation<T> =
  | { source: string; ok: true; observedAt: string; data: T }
  | {
      source: string;
      ok: false;
      observedAt: string;
      error: "timeout" | "unobservable";
      detail: string;
    };

export interface SubscriptionObservation {
  subscription: { id: string; status: string; canceledAt: string | null } | null;
  /** Charges created after cancellation, with how much of each was refunded. */
  chargesAfterCancel: { id: string; amountCents: number; createdAt: string; refundedCents: number }[];
}

export interface RefundObservation {
  charge: { id: string; amountCents: number } | null;
  refunds: { id: string; amountCents: number; status: string; createdAt: string }[];
}

export interface MemoryRecordObservation {
  id: string;
  store: StoreName;
  kind: string;
  label: string;
  derivedFrom: string[];
  deleted: boolean;
  /** Whether live content contains one of the subject's identifiers. */
  containsSubjectIdentifier: boolean;
}

export interface MemoryObservation {
  stale: boolean;
  replicaLagMs: number;
  observableStores: StoreName[];
  records: MemoryRecordObservation[];
}

async function billingTimeout(db: Db, owner: string) {
  return faultActive(db, owner, "billing.observe_timeout");
}

export async function observeSubscription(
  db: Db,
  owner: string,
  subscriptionId: string,
): Promise<Observation<SubscriptionObservation>> {
  const source = "billing.subscriptions.read";
  if (await billingTimeout(db, owner)) {
    return { source, ok: false, observedAt: nowIso(), error: "timeout", detail: "Billing read API did not answer within 5s" };
  }
  const [sub] = await db
    .select()
    .from(sbxSubscriptions)
    .where(and(eq(sbxSubscriptions.ownerEmail, owner), eq(sbxSubscriptions.id, subscriptionId)));
  let chargesAfterCancel: SubscriptionObservation["chargesAfterCancel"] = [];
  if (sub?.canceledAt) {
    const charges = await db
      .select()
      .from(sbxCharges)
      .where(and(eq(sbxCharges.ownerEmail, owner), eq(sbxCharges.customerId, sub.customerId)));
    const late = charges.filter((c) => c.createdAt > sub.canceledAt!);
    const refunds = late.length
      ? await db
          .select()
          .from(sbxRefunds)
          .where(
            and(
              eq(sbxRefunds.ownerEmail, owner),
              inArray(sbxRefunds.chargeId, late.map((c) => c.id)),
              ne(sbxRefunds.status, "voided"),
            ),
          )
      : [];
    chargesAfterCancel = late.map((c) => ({
      id: c.id,
      amountCents: c.amountCents,
      createdAt: c.createdAt,
      refundedCents: refunds.filter((r) => r.chargeId === c.id).reduce((s, r) => s + r.amountCents, 0),
    }));
  }
  return {
    source,
    ok: true,
    observedAt: nowIso(),
    data: {
      subscription: sub ? { id: sub.id, status: sub.status, canceledAt: sub.canceledAt } : null,
      chargesAfterCancel,
    },
  };
}

export async function observeRefunds(
  db: Db,
  owner: string,
  chargeId: string,
): Promise<Observation<RefundObservation>> {
  const source = "billing.refunds.list";
  if (await billingTimeout(db, owner)) {
    return { source, ok: false, observedAt: nowIso(), error: "timeout", detail: "Billing read API did not answer within 5s" };
  }
  const [charge] = await db
    .select()
    .from(sbxCharges)
    .where(and(eq(sbxCharges.ownerEmail, owner), eq(sbxCharges.id, chargeId)));
  const refunds = await db
    .select()
    .from(sbxRefunds)
    .where(and(eq(sbxRefunds.ownerEmail, owner), eq(sbxRefunds.chargeId, chargeId)));
  return {
    source,
    ok: true,
    observedAt: nowIso(),
    data: {
      charge: charge ? { id: charge.id, amountCents: charge.amountCents } : null,
      refunds: refunds
        .map((r) => ({ id: r.id, amountCents: r.amountCents, status: r.status, createdAt: r.createdAt }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    },
  };
}

export async function observeMemories(
  db: Db,
  owner: string,
  customerId: string,
): Promise<Observation<MemoryObservation>> {
  const source = "memory.records.scan";
  const stale = await faultActive(db, owner, "memory.stale_read");
  const rows = await db
    .select()
    .from(sbxMemories)
    .where(
      and(
        eq(sbxMemories.ownerEmail, owner),
        eq(sbxMemories.customerId, customerId),
        inArray(sbxMemories.store, [...OBSERVABLE_STORES]),
      ),
    );
  // Identifier fingerprints come from the subject's personal-data records.
  // Sandbox soft-deletes keep the value, which is what makes this scan possible.
  const identifiers = rows
    .filter((r) => r.kind === "pii")
    .map((r) => r.content.toLowerCase())
    .filter((v) => v.length >= 6);
  return {
    source,
    ok: true,
    observedAt: nowIso(),
    data: {
      stale,
      replicaLagMs: stale ? 4200 : 0,
      observableStores: [...OBSERVABLE_STORES],
      records: rows
        .map((r) => ({
          id: r.id,
          store: r.store as StoreName,
          kind: r.kind,
          label: r.label,
          derivedFrom: r.derivedFrom,
          deleted: r.deletedAt !== null,
          containsSubjectIdentifier:
            r.deletedAt === null &&
            r.kind !== "pii" &&
            identifiers.some((id) => r.content.toLowerCase().includes(id)),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    },
  };
}

export function unobservable(store: StoreName): Observation<never> {
  return {
    source: `${store}.read`,
    ok: false,
    observedAt: nowIso(),
    error: "unobservable",
    detail: `${store} has no read interface in this workspace; deletion there cannot be confirmed.`,
  };
}
