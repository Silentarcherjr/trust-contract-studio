/**
 * Handwritten PostgreSQL migrations, applied in order by the framework's
 * runMigrations() at startup (server/plugins/db.ts) and by the test harness.
 * Additive only: never drop or rename columns in a later entry.
 */
export interface TcsMigration {
  version: number;
  name: string;
  sql: string;
}

const T = "TEXT NOT NULL";

export const TCS_MIGRATIONS: TcsMigration[] = [
  {
    version: 1,
    name: "tcs-contracts",
    sql: `CREATE TABLE IF NOT EXISTS tcs_contracts (
      id TEXT PRIMARY KEY, owner_email ${T}, goal ${T}, status ${T},
      scenario ${T}, planned_by ${T}, round INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1, limitations JSONB NOT NULL,
      unmatched_clauses JSONB NOT NULL, created_at ${T}, updated_at ${T})`,
  },
  {
    version: 2,
    name: "tcs-obligations",
    sql: `CREATE TABLE IF NOT EXISTS tcs_obligations (
      id TEXT PRIMARY KEY, owner_email ${T}, contract_id ${T},
      position INTEGER NOT NULL, kind ${T}, title ${T}, params JSONB NOT NULL,
      params_hash ${T}, depends_on JSONB NOT NULL,
      requires_approval INTEGER NOT NULL, approval ${T}, execution ${T},
      verdict TEXT, repair_of TEXT, round INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1, created_at ${T}, updated_at ${T})`,
  },
  {
    version: 3,
    name: "tcs-approvals",
    sql: `CREATE TABLE IF NOT EXISTS tcs_approvals (
      id TEXT PRIMARY KEY, owner_email ${T}, contract_id ${T},
      obligation_id ${T}, decision ${T}, params_hash ${T}, decided_by ${T},
      caller ${T}, note TEXT, created_at ${T})`,
  },
  {
    version: 4,
    name: "tcs-runs",
    sql: `CREATE TABLE IF NOT EXISTS tcs_runs (
      id TEXT PRIMARY KEY, owner_email ${T}, contract_id ${T}, kind ${T},
      round INTEGER NOT NULL, status ${T}, triggered_by ${T}, caller ${T},
      started_at ${T}, finished_at TEXT)`,
  },
  {
    version: 5,
    name: "tcs-attempts",
    sql: `CREATE TABLE IF NOT EXISTS tcs_attempts (
      id TEXT PRIMARY KEY, owner_email ${T}, contract_id ${T}, run_id ${T},
      obligation_id ${T}, attempt_no INTEGER NOT NULL, idempotency_key ${T},
      provider ${T}, operation ${T}, request JSONB NOT NULL, outcome ${T},
      response JSONB, claim ${T}, duration_ms INTEGER NOT NULL, created_at ${T})`,
  },
  {
    version: 6,
    name: "tcs-evidence",
    sql: `CREATE TABLE IF NOT EXISTS tcs_evidence (
      id TEXT PRIMARY KEY, owner_email ${T}, contract_id ${T},
      obligation_id ${T}, verification_id ${T}, source ${T},
      observed JSONB NOT NULL, observed_at ${T}, digest ${T})`,
  },
  {
    version: 7,
    name: "tcs-verifications",
    sql: `CREATE TABLE IF NOT EXISTS tcs_verifications (
      id TEXT PRIMARY KEY, owner_email ${T}, contract_id ${T},
      obligation_id ${T}, run_id ${T}, round INTEGER NOT NULL, verdict ${T},
      reasons JSONB NOT NULL, verifier_version ${T}, checked_at ${T})`,
  },
  {
    version: 8,
    name: "tcs-receipts",
    sql: `CREATE TABLE IF NOT EXISTS tcs_receipts (
      id TEXT PRIMARY KEY, owner_email ${T}, contract_id ${T},
      body JSONB NOT NULL, digest ${T}, signature ${T}, created_at ${T})`,
  },
  {
    version: 9,
    name: "tcs-audit-events",
    sql: `CREATE TABLE IF NOT EXISTS tcs_audit_events (
      id TEXT PRIMARY KEY, owner_email ${T}, contract_id TEXT,
      seq INTEGER NOT NULL, actor ${T}, caller ${T}, type ${T},
      payload JSONB NOT NULL, prev_hash ${T}, hash ${T}, created_at ${T},
      UNIQUE (owner_email, seq))`,
  },
  {
    version: 10,
    name: "sbx-customers",
    sql: `CREATE TABLE IF NOT EXISTS sbx_customers (
      id TEXT PRIMARY KEY, owner_email ${T}, display_name ${T}, created_at ${T})`,
  },
  {
    version: 11,
    name: "sbx-subscriptions",
    sql: `CREATE TABLE IF NOT EXISTS sbx_subscriptions (
      id TEXT PRIMARY KEY, owner_email ${T}, customer_id ${T}, plan ${T},
      price_cents INTEGER NOT NULL, status ${T}, canceled_at TEXT,
      updated_at ${T})`,
  },
  {
    version: 12,
    name: "sbx-charges",
    sql: `CREATE TABLE IF NOT EXISTS sbx_charges (
      id TEXT PRIMARY KEY, owner_email ${T}, customer_id ${T},
      amount_cents INTEGER NOT NULL, description ${T}, created_at ${T})`,
  },
  {
    version: 13,
    name: "sbx-refunds",
    sql: `CREATE TABLE IF NOT EXISTS sbx_refunds (
      id TEXT PRIMARY KEY, owner_email ${T}, customer_id ${T}, charge_id ${T},
      amount_cents INTEGER NOT NULL, idempotency_key ${T}, status ${T},
      created_at ${T}, voided_at TEXT)`,
  },
  {
    version: 14,
    name: "sbx-memories",
    sql: `CREATE TABLE IF NOT EXISTS sbx_memories (
      id TEXT PRIMARY KEY, owner_email ${T}, customer_id ${T}, store ${T},
      kind ${T}, label ${T}, content ${T}, derived_from JSONB NOT NULL,
      created_at ${T}, deleted_at TEXT)`,
  },
  {
    version: 15,
    name: "sbx-faults",
    sql: `CREATE TABLE IF NOT EXISTS sbx_faults (
      owner_email TEXT PRIMARY KEY, scenario ${T}, consumed JSONB NOT NULL,
      updated_at ${T})`,
  },
  {
    version: 16,
    name: "tcs-indexes",
    sql: `CREATE INDEX IF NOT EXISTS tcs_obligations_contract_idx ON tcs_obligations (contract_id)`,
  },
  {
    version: 19,
    name: "sbx-memories-truth-subject",
    // Evaluation ground truth: which customer a record is really about. Set
    // only for fault-injected copies with no lineage. Never read by the
    // observation layer or the verifier (see scripts/eval/outcome-eval.ts).
    sql: `ALTER TABLE sbx_memories ADD COLUMN IF NOT EXISTS truth_subject TEXT`,
  },
  {
    version: 18,
    name: "tcs-rate-events",
    sql: `CREATE TABLE IF NOT EXISTS tcs_rate_events (
      id TEXT PRIMARY KEY, owner_email ${T}, type ${T}, created_at ${T})`,
  },
  {
    version: 17,
    name: "tcs-contracts-owner-idx",
    sql: `CREATE INDEX IF NOT EXISTS tcs_contracts_owner_idx ON tcs_contracts (owner_email, created_at)`,
  },
];
