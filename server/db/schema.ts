/**
 * Persistent state for Trust Contract Studio.
 *
 * Two families of tables live here:
 *  - tcs_*  : the contract workspace (contracts, obligations, approvals,
 *             attempts, evidence, verifications, receipts, audit log).
 *  - sbx_*  : isolated sandbox providers (billing + memory). The verifier only
 *             ever reads these through server/sandbox/observe.ts.
 *
 * Every row carries owner_email so all reads are scoped to one workspace.
 */
import { integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";

export const contracts = pgTable("tcs_contracts", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  goal: text("goal").notNull(),
  status: text("status").notNull(),
  scenario: text("scenario").notNull(),
  plannedBy: text("planned_by").notNull(),
  round: integer("round").notNull().default(1),
  version: integer("version").notNull().default(1),
  limitations: jsonb("limitations").$type<string[]>().notNull(),
  unmatchedClauses: jsonb("unmatched_clauses").$type<string[]>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const obligations = pgTable("tcs_obligations", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  contractId: text("contract_id").notNull(),
  position: integer("position").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  params: jsonb("params").$type<Record<string, unknown>>().notNull(),
  paramsHash: text("params_hash").notNull(),
  dependsOn: jsonb("depends_on").$type<string[]>().notNull(),
  requiresApproval: integer("requires_approval").notNull(),
  approval: text("approval").notNull(),
  execution: text("execution").notNull(),
  verdict: text("verdict"),
  repairOf: text("repair_of"),
  round: integer("round").notNull().default(1),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const approvals = pgTable("tcs_approvals", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  contractId: text("contract_id").notNull(),
  obligationId: text("obligation_id").notNull(),
  decision: text("decision").notNull(),
  paramsHash: text("params_hash").notNull(),
  decidedBy: text("decided_by").notNull(),
  caller: text("caller").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull(),
});

export const runs = pgTable("tcs_runs", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  contractId: text("contract_id").notNull(),
  kind: text("kind").notNull(), // execute | verify
  round: integer("round").notNull(),
  status: text("status").notNull(), // running | completed | interrupted
  triggeredBy: text("triggered_by").notNull(),
  caller: text("caller").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
});

export const attempts = pgTable("tcs_attempts", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  contractId: text("contract_id").notNull(),
  runId: text("run_id").notNull(),
  obligationId: text("obligation_id").notNull(),
  attemptNo: integer("attempt_no").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  outcome: text("outcome").notNull(), // ok | error | timeout | skipped
  response: jsonb("response").$type<Record<string, unknown> | null>(),
  /** What the executing agent reported. Recorded for contrast, never trusted. */
  claim: text("claim").notNull(),
  durationMs: integer("duration_ms").notNull(),
  createdAt: text("created_at").notNull(),
});

export const evidence = pgTable("tcs_evidence", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  contractId: text("contract_id").notNull(),
  obligationId: text("obligation_id").notNull(),
  verificationId: text("verification_id").notNull(),
  source: text("source").notNull(),
  observed: jsonb("observed").$type<Record<string, unknown>>().notNull(),
  observedAt: text("observed_at").notNull(),
  digest: text("digest").notNull(),
});

export const verifications = pgTable("tcs_verifications", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  contractId: text("contract_id").notNull(),
  obligationId: text("obligation_id").notNull(),
  runId: text("run_id").notNull(),
  round: integer("round").notNull(),
  verdict: text("verdict").notNull(),
  reasons: jsonb("reasons").$type<VerificationReason[]>().notNull(),
  verifierVersion: text("verifier_version").notNull(),
  checkedAt: text("checked_at").notNull(),
});

export const receipts = pgTable("tcs_receipts", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  contractId: text("contract_id").notNull(),
  body: jsonb("body").$type<Record<string, unknown>>().notNull(),
  digest: text("digest").notNull(),
  signature: text("signature").notNull(),
  createdAt: text("created_at").notNull(),
});

/** Rate-limit ledger. Deliberately NOT wiped by a demo reset. */
export const rateEvents = pgTable("tcs_rate_events", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  type: text("type").notNull(),
  createdAt: text("created_at").notNull(),
});

export const auditEvents = pgTable("tcs_audit_events", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  contractId: text("contract_id"),
  seq: integer("seq").notNull(),
  actor: text("actor").notNull(),
  caller: text("caller").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
  createdAt: text("created_at").notNull(),
});

// --------------------------------------------------------------------------
// Sandbox providers
// --------------------------------------------------------------------------
export const sbxCustomers = pgTable("sbx_customers", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sbxSubscriptions = pgTable("sbx_subscriptions", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  customerId: text("customer_id").notNull(),
  plan: text("plan").notNull(),
  priceCents: integer("price_cents").notNull(),
  status: text("status").notNull(), // active | canceled
  canceledAt: text("canceled_at"),
  updatedAt: text("updated_at").notNull(),
});

export const sbxCharges = pgTable("sbx_charges", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  customerId: text("customer_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  description: text("description").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sbxRefunds = pgTable("sbx_refunds", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  customerId: text("customer_id").notNull(),
  chargeId: text("charge_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull(), // succeeded | voided
  createdAt: text("created_at").notNull(),
  voidedAt: text("voided_at"),
});

export const sbxMemories = pgTable("sbx_memories", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  customerId: text("customer_id").notNull(),
  store: text("store").notNull(),
  kind: text("kind").notNull(), // pii | derived | embedding | export
  label: text("label").notNull(),
  content: text("content").notNull(),
  derivedFrom: jsonb("derived_from").$type<string[]>().notNull(),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const sbxFaults = pgTable("sbx_faults", {
  ownerEmail: text("owner_email").primaryKey(),
  scenario: text("scenario").notNull(),
  consumed: jsonb("consumed").$type<string[]>().notNull(),
  updatedAt: text("updated_at").notNull(),
});

export interface VerificationReason {
  code: string;
  message: string;
  /** Optional ids the reason refers to (refunds, memories, charges). */
  refs?: string[];
}
