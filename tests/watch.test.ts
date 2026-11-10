/**
 * Watching kept promises: a VERIFIED contract is re-observed later; a change
 * at the provider breaks it and emits tcs.verdict.changed for automations.
 */
import { subscribe, unsubscribe } from "@agent-native/core/event-bus";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import lateRefundDrillAction from "../actions/late-refund-drill.js";
import type { Db } from "../server/db/index.js";
import * as svc from "../server/domain/service.js";
import { VERDICT_CHANGED } from "../server/lib/events.js";
import { MCP_CONNECTOR_CATALOG } from "../server/lib/mcp-catalog.js";
import { DEMO_GOAL, approveAllPending, freshDb, human } from "./harness.js";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await freshDb()));
afterEach(async () => close());

async function keptPromise() {
  await svc.resetDemo(db, human(), { scenario: "clean" });
  let view = await svc.draftContract(db, human(), { goal: DEMO_GOAL });
  view = await approveAllPending(db, view);
  view = await svc.executeContract(db, human(), {
    contractId: view.contract.id,
  });
  expect(view.contract.status).toBe("verified");
  return view;
}

describe("watching kept promises", () => {
  it("a late refund at the provider breaks a VERIFIED refund on the next re-check, and the change is emitted", async () => {
    const view = await keptPromise();
    const events: unknown[] = [];
    const sub = subscribe(VERDICT_CHANGED, (p) => {
      events.push(p);
    });
    try {
      // Nothing changed yet: the promise still holds.
      let check = await svc.recheckVerified(db, human());
      expect(check).toMatchObject({ checked: 1, broken: 0 });
      expect(events).toHaveLength(0);

      await svc.lateRefundDrill(db, human(), { contractId: view.contract.id });
      check = await svc.recheckVerified(db, human());
      expect(check).toMatchObject({ checked: 1, broken: 1 });
      expect(check.results[0]!.changed).toEqual([
        expect.objectContaining({ from: "VERIFIED", to: "FAILED" }),
      ]);
      expect(events).toEqual([
        expect.objectContaining({
          contractId: view.contract.id,
          from: "VERIFIED",
          to: "FAILED",
          reason: expect.stringMatching(/\$110\.00/),
        }),
      ]);
      // A broken contract is no longer "kept", so it is not re-checked again.
      expect(await svc.recheckVerified(db, human())).toMatchObject({
        checked: 0,
      });
    } finally {
      unsubscribe(sub);
    }
  });

  it("the drill is human-only; re-checking is offered to agents and automations", async () => {
    const view = await keptPromise();
    await expect(
      svc.lateRefundDrill(
        db,
        { ...human(), caller: "tool" },
        {
          contractId: view.contract.id,
        },
      ),
    ).rejects.toBeTruthy();
    expect(lateRefundDrillAction.agentTool).toBe(false);
    expect(lateRefundDrillAction.mcpTool).toBe(false);
    expect(MCP_CONNECTOR_CATALOG).toContain("recheck-verified");
    expect(MCP_CONNECTOR_CATALOG as readonly string[]).not.toContain(
      "late-refund-drill",
    );
  });
});
