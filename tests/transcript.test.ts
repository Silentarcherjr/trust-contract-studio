/**
 * Auditing another agent's transcript: claims become clauses, the verifier
 * judges the providers, and the claims are displayed but never trusted.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import auditTranscriptAction from "../actions/audit-transcript.js";
import type { Db } from "../server/db/index.js";
import * as svc from "../server/domain/service.js";
import { extractClaims } from "../server/domain/transcript.js";
import { MCP_CONNECTOR_CATALOG } from "../server/lib/mcp-catalog.js";
import { DEMO_GOAL, approveAllPending, freshDb, human } from "./harness.js";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await freshDb()));
afterEach(async () => close());

const TRANSCRIPT = `Customer: Please cancel my plan, refund $100 and delete my data and any memories you have about me.
Agent: Let me look at your subscription.
Agent: Done: your subscription is cancelled and I've refunded $100.00 to your card.
Agent: Your personal data has been deleted, and all memories derived from it are gone.`;

describe("extractClaims", () => {
  it("finds the agent's completion claims, not the customer's request", () => {
    const claims = extractClaims(TRANSCRIPT);
    expect(claims.map((c) => c.kind)).toEqual([
      "cancel_subscription",
      "refund_charge",
      "erase_personal_data",
      "purge_derived_memories",
    ]);
    expect(claims.find((c) => c.kind === "refund_charge")!.amountCents).toBe(
      10_000,
    );
    expect(claims[0]!.claim).toMatch(/^Done: your subscription is cancelled/);
  });

  it("ignores a transcript where the agent claims nothing checkable", () => {
    expect(
      extractClaims("Agent: I looked into it and will get back to you."),
    ).toEqual([]);
  });

  it("works on a single final message without roles", () => {
    const claims = extractClaims(
      "Done — canceled your subscription, refunded $50, and wiped your personal data.",
    );
    expect(claims.map((c) => c.kind)).toEqual([
      "cancel_subscription",
      "refund_charge",
      "erase_personal_data",
    ]);
    expect(claims[1]!.amountCents).toBe(5000);
  });
});

describe("audit-transcript", () => {
  it("a 'Done' that the providers contradict is FAILED, without executing anything", async () => {
    // Nothing was done in this workspace: the agent's claims are all false.
    await svc.resetDemo(db, human(), { scenario: "clean" });
    const view = await svc.auditTranscript(db, human(), {
      transcript: TRANSCRIPT,
    });
    expect(view.contract.plannedBy).toBe("transcript");
    expect(view.contract.status).toBe("failed");
    expect(view.obligations.every((o) => o.approval === "not_required")).toBe(
      true,
    );
    expect(view.obligations.every((o) => o.verdict === "FAILED")).toBe(true);
    // The claims are shown, attributed to the external agent.
    expect(view.attempts.map((a) => a.provider)).toEqual(
      Array(4).fill("external agent"),
    );
  });

  it("a transcript whose claims are true is VERIFIED", async () => {
    // Do the work for real through a contract, then audit a truthful report.
    await svc.resetDemo(db, human(), { scenario: "clean" });
    let view = await svc.draftContract(db, human(), { goal: DEMO_GOAL });
    view = await approveAllPending(db, view);
    view = await svc.executeContract(db, human(), {
      contractId: view.contract.id,
    });
    expect(view.contract.status).toBe("verified");
    const audit = await svc.auditTranscript(db, human(), {
      transcript: TRANSCRIPT,
    });
    expect(audit.contract.status).toBe("verified");
  });

  it("refuses a transcript with nothing checkable", async () => {
    await svc.resetDemo(db, human(), { scenario: "clean" });
    await expect(
      svc.auditTranscript(db, human(), {
        transcript: "Agent: Thanks, I'll look into it tomorrow.",
      }),
    ).rejects.toMatchObject({ code: "no_verifiable_claims" });
  });

  it("is offered to the in-app agent and to external agents over MCP", () => {
    expect(auditTranscriptAction.agentTool).not.toBe(false);
    expect(MCP_CONNECTOR_CATALOG).toContain("audit-transcript");
  });
});
