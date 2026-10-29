/**
 * Test harness: a fresh in-memory PostgreSQL (PGlite) per test with the same
 * migrations the app runs at startup.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import type { Scenario } from "../shared/domain.js";
import { setDbForTesting, type Db } from "../server/db/index.js";
import { TCS_MIGRATIONS } from "../server/db/migrations.js";
import * as schema from "../server/db/schema.js";
import * as svc from "../server/domain/service.js";

export const DEMO_GOAL =
  "Cancel my subscription, refund $100, and delete my personal data and associated memories.";

export async function freshDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  for (const m of TCS_MIGRATIONS) await client.exec(m.sql);
  const db = drizzle(client, { schema }) as unknown as Db;
  setDbForTesting(db);
  return {
    db,
    close: async () => {
      setDbForTesting(null);
      await client.close();
    },
  };
}

export const human = (email = "alex@example.test"): svc.Actor => ({ email, caller: "frontend" });
export const agent = (email = "alex@example.test"): svc.Actor => ({ email, caller: "tool" });

/** Reset, draft the demo goal, and approve every pending obligation as a human. */
export async function draftAndApprove(db: Db, scenario: Scenario, who = human()) {
  await svc.resetDemo(db, who, { scenario });
  let view = await svc.draftContract(db, who, { goal: DEMO_GOAL });
  view = await approveAllPending(db, view, who);
  return view;
}

export async function approveAllPending(db: Db, view: svc.ContractView, who = human()) {
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

export function verdictsByKind(view: svc.ContractView) {
  const out: Record<string, string | null> = {};
  for (const o of view.obligations.filter((x) => x.round === 1)) out[o.kind] = o.verdict;
  return out;
}
