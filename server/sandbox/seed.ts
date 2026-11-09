/**
 * Synthetic demo data. Every name, email, phone number and address below is
 * fictional (".test" TLD, 555 numbers) and safe to show in a public demo.
 */
import type { Db } from "../db/index.js";
import {
  sbxCharges,
  sbxCustomers,
  sbxMemories,
  sbxSubscriptions,
} from "../db/schema.js";
import { newId } from "../domain/integrity.js";
import { deleteAllVectors, upsertVectors } from "./vector-index.js";

export interface SeedResult {
  requesterId: string;
  bystanderId: string;
  subscriptionId: string;
  latestChargeId: string;
}

/** Real Dodo (test mode) ids that replace the requester's billing records. */
export interface RealBilling {
  subscriptionId: string;
  paymentId: string;
  amountCents: number;
  createdAt: string;
}

export async function seedSandbox(
  db: Db,
  owner: string,
  real?: RealBilling,
): Promise<SeedResult> {
  const ada = newId("cus");
  const ben = newId("cus");
  await db.insert(sbxCustomers).values([
    {
      id: ada,
      ownerEmail: owner,
      displayName: "Ada Quinn",
      createdAt: "2025-01-04T09:00:00.000Z",
    },
    {
      id: ben,
      ownerEmail: owner,
      displayName: "Ben Ortiz",
      createdAt: "2025-02-11T09:00:00.000Z",
    },
  ]);

  const sub = real?.subscriptionId ?? newId("sub");
  await db.insert(sbxSubscriptions).values([
    {
      id: sub,
      ownerEmail: owner,
      customerId: ada,
      plan: real
        ? "Studio Plus, 2 seats (Dodo test mode)"
        : "Studio Plus (monthly)",
      priceCents: real?.amountCents ?? 10000,
      status: "active",
      canceledAt: null,
      updatedAt: "2026-10-01T08:00:00.000Z",
    },
    {
      id: newId("sub"),
      ownerEmail: owner,
      customerId: ben,
      plan: "Studio Plus (monthly)",
      priceCents: 10000,
      status: "active",
      canceledAt: null,
      updatedAt: "2026-10-01T08:00:00.000Z",
    },
  ]);

  const septCharge = newId("ch");
  const octCharge = real?.paymentId ?? newId("ch");
  await db.insert(sbxCharges).values([
    ...(real
      ? []
      : [
          {
            id: septCharge,
            ownerEmail: owner,
            customerId: ada,
            amountCents: 10000,
            description: "Studio Plus — September 2026",
            createdAt: "2026-09-01T08:00:00.000Z",
          },
        ]),
    {
      id: octCharge,
      ownerEmail: owner,
      customerId: ada,
      amountCents: real?.amountCents ?? 10000,
      description: real
        ? "Studio Plus, 2 seats — Dodo test payment"
        : "Studio Plus — October 2026",
      createdAt: real?.createdAt ?? "2026-10-01T08:00:00.000Z",
    },
    {
      id: newId("ch"),
      ownerEmail: owner,
      customerId: ben,
      amountCents: 10000,
      description: "Studio Plus — October 2026",
      createdAt: "2026-10-01T08:00:00.000Z",
    },
  ]);

  // Memory lineage: personal data → derived memories → embeddings / exports.
  const at = "2026-09-15T12:00:00.000Z";
  const m = (
    customerId: string,
    store: string,
    kind: string,
    label: string,
    content: string,
    derivedFrom: string[] = [],
  ) => ({
    id: newId("mem"),
    ownerEmail: owner,
    customerId,
    store,
    kind,
    label,
    content,
    derivedFrom,
    createdAt: at,
    deletedAt: null,
  });

  const name = m(ada, "profile_db", "pii", "Full name", "Ada Quinn");
  const email = m(
    ada,
    "profile_db",
    "pii",
    "Email address",
    "ada.quinn@example.test",
  );
  const phone = m(ada, "profile_db", "pii", "Phone number", "+1-555-0142");
  const address = m(
    ada,
    "profile_db",
    "pii",
    "Postal address",
    "12 Lantern Row, Springfield",
  );
  const contactPref = m(
    ada,
    "memory_store",
    "derived",
    "Contact preference",
    "Ada prefers email (ada.quinn@example.test) after 6pm",
    [email.id],
  );
  const locality = m(
    ada,
    "memory_store",
    "derived",
    "Locality note",
    "Lives near Lantern Row; likes local pickup",
    [address.id],
  );
  const churnSummary = m(
    ada,
    "memory_store",
    "derived",
    "Support summary",
    "Ada Quinn asked about pricing twice before cancelling",
    [name.id],
  );
  const embedPref = m(
    ada,
    "vector_index",
    "embedding",
    "Embedding of contact preference",
    "vec[ada.quinn@example.test · evenings]",
    [contactPref.id],
  );
  const embedLocality = m(
    ada,
    "vector_index",
    "embedding",
    "Embedding of locality note",
    "vec[Lantern Row · pickup]",
    [locality.id],
  );
  const export1 = m(
    ada,
    "analytics_export",
    "export",
    "Churn-risk segment export",
    "segment=churn-risk; subject=Ada Quinn",
    [churnSummary.id],
  );

  const benEmail = m(
    ben,
    "profile_db",
    "pii",
    "Email address",
    "ben.ortiz@example.test",
  );
  const benPref = m(
    ben,
    "memory_store",
    "derived",
    "Contact preference",
    "Ben prefers SMS",
    [benEmail.id],
  );

  await db
    .insert(sbxMemories)
    .values([
      name,
      email,
      phone,
      address,
      contactPref,
      locality,
      churnSummary,
      embedPref,
      embedLocality,
      export1,
      benEmail,
      benPref,
    ]);

  // The vector index lives in a real pgvector engine: each embedding row is
  // the vector of the memory it was derived from.
  await deleteAllVectors(owner);
  await upsertVectors([
    {
      id: embedPref.id,
      ownerEmail: owner,
      customerId: ada,
      label: embedPref.label,
      sourceText: contactPref.content,
    },
    {
      id: embedLocality.id,
      ownerEmail: owner,
      customerId: ada,
      label: embedLocality.label,
      sourceText: locality.content,
    },
  ]);

  return {
    requesterId: ada,
    bystanderId: ben,
    subscriptionId: sub,
    latestChargeId: octCharge,
  };
}
