/**
 * The vector index store, on a real vector engine: PostgreSQL + pgvector.
 *
 * - Production (DATABASE_URL is a Postgres URL, e.g. Neon): the same database,
 *   with the `vector` extension. Nearest-neighbour searches are exact cosine
 *   searches scoped by owner (no approximate index; see SCHEMA).
 * - Local development and tests (the app runs on PGlite, which cannot load
 *   extensions into the framework's instance): a separate PGlite instance with
 *   `@electric-sql/pglite-pgvector`, on disk under data/ in dev, in memory
 *   under Vitest or when TCS_VECTOR_STORE=memory.
 *
 * Deletes are physical: a deleted embedding is gone from the engine. The
 * observation layer asks this engine, not the sandbox bookkeeping tables,
 * whether a vector is still live, and runs nearest-neighbour searches with
 * the subject's identifiers to find disguised copies with no lineage.
 *
 * Embeddings are LEXICAL and deterministic: feature-hashed character trigrams
 * and words, L2-normalised. No model, no network, no credits. They catch
 * reformatted copies of an identifier (casing, punctuation, "(at)" for "@"),
 * not deep paraphrases. Every query is scoped by owner_email.
 */
import { createHash } from "node:crypto";

export const VECTOR_DIMENSIONS = 256;

/** Cosine distance under which a live vector counts as a copy of an identifier. */
export const NEAR_DUPLICATE_MAX_DISTANCE = 0.35;

export interface VectorRow {
  id: string;
  ownerEmail: string;
  customerId: string;
  label: string;
  sourceText: string;
}

export interface NearestMatch {
  id: string;
  label: string;
  distance: number;
}

interface Engine {
  name: string;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

// --- Embeddings --------------------------------------------------------------

function normalise(text: string) {
  return text
    .toLowerCase()
    .replace(/\(at\)|\[at\]|\sat\s/g, "@")
    .replace(/\(dot\)|\[dot\]|\sdot\s/g, ".")
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim();
}

function bucket(feature: string) {
  const h = createHash("sha256").update(feature).digest();
  return {
    index: h.readUInt32BE(0) % VECTOR_DIMENSIONS,
    sign: h[4]! & 1 ? 1 : -1,
  };
}

/** Deterministic lexical embedding (character trigrams + words). */
export function embed(text: string): number[] {
  const v: number[] = Array.from({ length: VECTOR_DIMENSIONS }, () => 0);
  const norm = normalise(text);
  const compact = norm.replace(/[\s.@-]+/g, "");
  for (let i = 0; i + 3 <= compact.length; i++) {
    const { index, sign } = bucket(`c:${compact.slice(i, i + 3)}`);
    v[index]! += sign;
  }
  for (const word of norm.split(/[\s@.]+/).filter((w) => w.length > 1)) {
    const { index, sign } = bucket(`w:${word}`);
    v[index]! += 2 * sign;
  }
  const len = Math.hypot(...v) || 1;
  return v.map((x) => x / len);
}

const literal = (v: number[]) => `[${v.map((x) => x.toFixed(6)).join(",")}]`;

// --- Engines -----------------------------------------------------------------

const SCHEMA = [
  "CREATE EXTENSION IF NOT EXISTS vector",
  `CREATE TABLE IF NOT EXISTS tcs_vector_index (
     id text PRIMARY KEY,
     owner_email text NOT NULL,
     customer_id text NOT NULL,
     label text NOT NULL,
     source_text text NOT NULL,
     embedding vector(${VECTOR_DIMENSIONS}) NOT NULL,
     created_at text NOT NULL
   )`,
  "CREATE INDEX IF NOT EXISTS tcs_vector_index_owner_idx ON tcs_vector_index (owner_email)",
  // Searches are exact (owner filter, then a full cosine sort). Each
  // workspace holds a handful of vectors, and an approximate HNSW scan
  // filters by owner only after the scan, so other workspaces' identical
  // demo vectors could crowd out this one's disguised copy.
  "DROP INDEX IF EXISTS tcs_vector_index_hnsw",
];

let enginePromise: Promise<Engine> | null = null;

function usesHostedPostgres() {
  const url = process.env.DATABASE_URL ?? "";
  return /^postgres(ql)?:\/\//.test(url);
}

async function createEngine(): Promise<Engine> {
  if (usesHostedPostgres()) {
    const { default: postgres } = await import("postgres");
    // Serverless + pooled connections: one connection, no prepared statements.
    const client = postgres(process.env.DATABASE_URL!, {
      max: 1,
      prepare: false,
      idle_timeout: 20,
      onnotice: () => {},
    });
    const engine: Engine = {
      name: "pgvector on PostgreSQL",
      query: async <T>(sql: string, params: unknown[] = []) =>
        (await client.unsafe(sql, params as never[])) as unknown as T[],
    };
    for (const statement of SCHEMA) await engine.query(statement);
    return engine;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  const inMemory =
    process.env.TCS_VECTOR_STORE === "memory" || Boolean(process.env.VITEST);
  const dataDir = inMemory ? undefined : localVectorDir();
  const db = await PGlite.create(dataDir, { extensions: { vector } });
  const engine: Engine = {
    name: "pgvector on PGlite (local)",
    query: async <T>(sql: string, params: unknown[] = []) =>
      (await db.query<T>(sql, params)).rows,
  };
  for (const statement of SCHEMA) await engine.query(statement);
  return engine;
}

/**
 * A local vector engine directory per app database, so two dev servers (for
 * example the E2E server next to a normal one) never open the same PGlite
 * directory: pglite:./data/e2e-pglite → ./data/e2e-pglite-vector.
 */
export function localVectorDir() {
  if (process.env.TCS_VECTOR_PGLITE_DIR)
    return process.env.TCS_VECTOR_PGLITE_DIR;
  const url = process.env.DATABASE_URL ?? "";
  const match = url.match(/^pglite:(.+)$/);
  return match
    ? `${match[1]!.replace(/\/+$/, "")}-vector`
    : "./data/vector-pglite";
}

function engine() {
  enginePromise ??= createEngine().catch((err) => {
    enginePromise = null;
    throw err;
  });
  return enginePromise;
}

/** Tests: drop the cached engine so the next call creates a fresh one. */
export function resetVectorEngineForTesting() {
  enginePromise = null;
}

// --- Store API ---------------------------------------------------------------

export async function vectorEngineName() {
  return (await engine()).name;
}

export async function upsertVectors(rows: VectorRow[]) {
  if (!rows.length) return;
  const e = await engine();
  const now = new Date().toISOString();
  for (const r of rows) {
    await e.query(
      `INSERT INTO tcs_vector_index (id, owner_email, customer_id, label, source_text, embedding, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
       ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label,
         source_text = EXCLUDED.source_text, embedding = EXCLUDED.embedding`,
      [
        r.id,
        r.ownerEmail,
        r.customerId,
        r.label,
        r.sourceText,
        literal(embed(r.sourceText)),
        now,
      ],
    );
  }
}

/** Physical delete. Returns the ids that were actually removed. */
export async function deleteVectors(owner: string, ids: string[]) {
  if (!ids.length) return [];
  const e = await engine();
  const rows = await e.query<{ id: string }>(
    "DELETE FROM tcs_vector_index WHERE owner_email = $1 AND id = ANY($2::text[]) RETURNING id",
    [owner, ids],
  );
  return rows.map((r) => r.id);
}

export async function deleteAllVectors(owner: string) {
  const e = await engine();
  await e.query("DELETE FROM tcs_vector_index WHERE owner_email = $1", [owner]);
}

/** Ids of the owner's vectors that are live in the engine. */
export async function liveVectorIds(owner: string): Promise<Set<string>> {
  const e = await engine();
  const rows = await e.query<{ id: string }>(
    "SELECT id FROM tcs_vector_index WHERE owner_email = $1",
    [owner],
  );
  return new Set(rows.map((r) => r.id));
}

/** Live vectors within `maxDistance` (cosine) of `text`, nearest first. */
export async function nearestVectors(
  owner: string,
  text: string,
  { k = 5, maxDistance = NEAR_DUPLICATE_MAX_DISTANCE } = {},
): Promise<NearestMatch[]> {
  const e = await engine();
  const rows = await e.query<{
    id: string;
    label: string;
    distance: number | string;
  }>(
    `SELECT id, label, embedding <=> $2::vector AS distance
       FROM tcs_vector_index
      WHERE owner_email = $1
      ORDER BY embedding <=> $2::vector
      LIMIT $3`,
    [owner, literal(embed(text)), k],
  );
  return rows
    .map((r) => ({ id: r.id, label: r.label, distance: Number(r.distance) }))
    .filter((r) => r.distance <= maxDistance);
}
