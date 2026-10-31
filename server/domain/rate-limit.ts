/**
 * Per-workspace rate limits for mutating operations. Counts live in their own
 * table so a demo reset cannot be used to clear them.
 */
import { and, eq, gte, lt } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { rateEvents } from "../db/schema.js";
import { ContractError } from "./errors.js";
import { newId } from "./integrity.js";

export type LimitedOperation =
  | "reset"
  | "draft"
  | "execute"
  | "verify"
  | "repair"
  | "receipt";

const WINDOW_MS = 10 * 60_000;

/** Calls allowed per workspace per 10 minutes. Mutable for tests. */
export const RATE_LIMITS: Record<LimitedOperation, number> = {
  reset: 30,
  draft: 30,
  execute: 40,
  verify: 60,
  repair: 30,
  receipt: 40,
};

export async function assertRateLimit(
  db: Db,
  owner: string,
  op: LimitedOperation,
): Promise<void> {
  const now = Date.now();
  const since = new Date(now - WINDOW_MS).toISOString();
  // Prune this workspace's expired entries so the table stays small.
  await db
    .delete(rateEvents)
    .where(
      and(eq(rateEvents.ownerEmail, owner), lt(rateEvents.createdAt, since)),
    );
  const recent = await db
    .select({ id: rateEvents.id })
    .from(rateEvents)
    .where(
      and(
        eq(rateEvents.ownerEmail, owner),
        eq(rateEvents.type, op),
        gte(rateEvents.createdAt, since),
      ),
    );
  if (recent.length >= RATE_LIMITS[op]) {
    throw new ContractError(
      `Too many ${op} requests. Wait a few minutes and try again.`,
      "rate_limited",
      429,
      { limit: RATE_LIMITS[op], windowMinutes: WINDOW_MS / 60_000 },
    );
  }
  await db.insert(rateEvents).values({
    id: newId("rl"),
    ownerEmail: owner,
    type: op,
    createdAt: new Date(now).toISOString(),
  });
}
