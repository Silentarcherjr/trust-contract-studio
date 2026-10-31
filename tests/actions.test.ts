/**
 * Integration tests at the action layer: the exact defineAction() objects the
 * framework mounts for the UI (caller "frontend") and hands to the agent as
 * tools (caller "tool").
 */
import type { ActionRunContext } from "@agent-native/core/action";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import decideApproval from "../actions/decide-approval.js";
import draftContract from "../actions/draft-contract.js";
import executeContract from "../actions/execute-contract.js";
import getContract from "../actions/get-contract.js";
import resetDemo from "../actions/reset-demo.js";
import tamperEvidence from "../actions/tamper-evidence.js";
import type { Db } from "../server/db/index.js";
import * as svc from "../server/domain/service.js";
import { DEMO_GOAL, approveAllPending, freshDb, human } from "./harness.js";

const ctx = (
  caller: ActionRunContext["caller"],
  userEmail = "alex@example.test",
) => ({ caller, userEmail, orgId: null }) as ActionRunContext;

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await freshDb()));
afterEach(async () => close());

describe("one action, two callers", () => {
  it("the UI and the agent invoke the same draft-contract action and see the same state", async () => {
    await resetDemo.run({ scenario: "clean" }, ctx("frontend"));
    const fromAgent = await draftContract.run({ goal: DEMO_GOAL }, ctx("tool"));
    const fromUi = await getContract.run(
      { contractId: fromAgent.contract.id },
      ctx("frontend"),
    );
    expect(fromUi.contract.id).toBe(fromAgent.contract.id);
    expect(fromUi.obligations.map((o) => o.id)).toEqual(
      fromAgent.obligations.map((o) => o.id),
    );
    // Same code path regardless of caller: planner output is identical.
    const fromUiDraft = await draftContract.run(
      { goal: DEMO_GOAL },
      ctx("frontend"),
    );
    expect(fromUiDraft.obligations.map((o) => [o.kind, o.params])).toEqual(
      fromAgent.obligations.map((o) => [o.kind, o.params]),
    );
    // The audit trail records which surface acted.
    const callers = fromUi.audit.map((a) => a.caller);
    expect(callers).toContain("tool");
  });

  it("an agent-authored plan is accepted only for verifiable kinds and is attributed to the agent", async () => {
    await resetDemo.run({ scenario: "clean" }, ctx("frontend"));
    const view = await draftContract.run(
      {
        goal: "Refund my last charge",
        obligations: [
          {
            kind: "refund_charge",
            params: { amountCents: 5000 },
            dependsOn: [],
          },
        ],
      },
      ctx("tool"),
    );
    expect(view.contract.plannedBy).toBe("agent");
    expect(view.obligations[0]!.params.amountCents).toBe(5000);
  });

  it("the agent can execute only after a person approved, and the execute action is shared", async () => {
    await resetDemo.run({ scenario: "clean" }, ctx("frontend"));
    let view = await draftContract.run({ goal: DEMO_GOAL }, ctx("tool"));
    await expect(
      executeContract.run({ contractId: view.contract.id }, ctx("tool")),
    ).rejects.toMatchObject({ errorCode: "approval_pending" });
    view = await approveAllPending(db, view);
    view = await executeContract.run(
      { contractId: view.contract.id },
      ctx("tool"),
    );
    expect(view.contract.status).toBe("verified");
  });
});

describe("authorization", () => {
  it("the agent cannot approve its own obligations, even by calling the action directly", async () => {
    await resetDemo.run({ scenario: "clean" }, ctx("frontend"));
    const view = await draftContract.run({ goal: DEMO_GOAL }, ctx("tool"));
    const ob = view.obligations[0]!;
    for (const caller of [
      "tool",
      "mcp",
      "a2a",
      "http",
      "automation",
    ] as const) {
      await expect(
        decideApproval.run(
          {
            contractId: view.contract.id,
            obligationId: ob.id,
            decision: "approved",
            paramsHash: ob.paramsHash,
          },
          ctx(caller),
        ),
      ).rejects.toMatchObject({ errorCode: "human_required" });
    }
    const after = await getContract.run(
      { contractId: view.contract.id },
      ctx("frontend"),
    );
    expect(after.obligations[0]!.approval).toBe("pending");
    expect(
      after.audit.filter((a) => a.type === "approval.refused_non_human"),
    ).toHaveLength(5);
  });

  it("decide-approval and the tamper drill are hidden from every agent surface", () => {
    expect(decideApproval.agentTool).toBe(false);
    expect(decideApproval.mcpTool).toBe(false);
    expect(tamperEvidence.agentTool).toBe(false);
  });

  it("an approval is bound to the exact parameters the person reviewed", async () => {
    await svc.resetDemo(db, human(), { scenario: "clean" });
    let view = await svc.draftContract(db, human(), { goal: DEMO_GOAL });
    const refund = view.obligations.find((o) => o.kind === "refund_charge")!;
    const reviewedHash = refund.paramsHash;
    view = await svc.decideApproval(db, human(), {
      contractId: view.contract.id,
      obligationId: refund.id,
      decision: "approved",
      paramsHash: reviewedHash,
    });
    // Someone changes the amount after approval: the approval is voided.
    view = await svc.updateObligation(db, human(), {
      contractId: view.contract.id,
      obligationId: refund.id,
      params: { amountCents: 9000 },
    });
    const edited = view.obligations.find((o) => o.id === refund.id)!;
    expect(edited.approval).toBe("pending");
    // Replaying the old decision against the new parameters is refused.
    await expect(
      svc.decideApproval(db, human(), {
        contractId: view.contract.id,
        obligationId: refund.id,
        decision: "approved",
        paramsHash: reviewedHash,
      }),
    ).rejects.toMatchObject({ code: "stale_approval" });
  });

  it("a rejected obligation is never executed and is reported as not pursued", async () => {
    await svc.resetDemo(db, human(), { scenario: "clean" });
    let view = await svc.draftContract(db, human(), { goal: DEMO_GOAL });
    for (const o of view.obligations) {
      view = await svc.decideApproval(db, human(), {
        contractId: view.contract.id,
        obligationId: o.id,
        decision: o.kind === "refund_charge" ? "rejected" : "approved",
        paramsHash: o.paramsHash,
      });
    }
    view = await svc.executeContract(db, human(), {
      contractId: view.contract.id,
    });
    const refund = view.obligations.find((o) => o.kind === "refund_charge")!;
    expect(refund.execution).toBe("skipped");
    expect(view.attempts.some((a) => a.operation === "refunds.create")).toBe(
      false,
    );
    const ws = await svc.getWorkspace(db, human().email);
    if (!ws.seeded) throw new Error("not seeded");
    expect(ws.refunds).toHaveLength(0);
    const receipt = await svc.exportReceipt(db, human(), {
      contractId: view.contract.id,
    });
    expect(
      receipt.obligations.find((o) => o.kind === "refund_charge")!.verdict,
    ).toBe("NOT_PURSUED");
  });

  it("refuses unauthenticated calls", async () => {
    await expect(
      getContract.run({ contractId: "ctr_x" }, {
        caller: "http",
        orgId: null,
      } as ActionRunContext),
    ).rejects.toMatchObject({ errorCode: "unauthenticated" });
  });

  it("does not leak contracts across workspaces", async () => {
    await resetDemo.run(
      { scenario: "clean" },
      ctx("frontend", "alex@example.test"),
    );
    await resetDemo.run(
      { scenario: "clean" },
      ctx("frontend", "mallory@example.test"),
    );
    const alexView = await draftContract.run(
      { goal: DEMO_GOAL },
      ctx("frontend", "alex@example.test"),
    );
    await expect(
      getContract.run(
        { contractId: alexView.contract.id },
        ctx("frontend", "mallory@example.test"),
      ),
    ).rejects.toMatchObject({ errorCode: "not_found" });
    await expect(
      executeContract.run(
        { contractId: alexView.contract.id },
        ctx("frontend", "mallory@example.test"),
      ),
    ).rejects.toMatchObject({ errorCode: "not_found" });
  });

  it("rejects obligations that target another customer's records", async () => {
    await svc.resetDemo(db, human(), { scenario: "clean" });
    const ws = await svc.getWorkspace(db, human().email);
    if (!ws.seeded) throw new Error("not seeded");
    await expect(
      svc.draftContract(db, human(), {
        goal: "Erase Ben",
        obligations: [
          {
            kind: "erase_personal_data",
            params: { customerId: ws.bystanders[0]!.id },
            dependsOn: [],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_params" });
  });
});

describe("state machine & concurrency", () => {
  it("rejects stale edits with a version conflict", async () => {
    await svc.resetDemo(db, human(), { scenario: "clean" });
    const view = await svc.draftContract(db, human(), { goal: DEMO_GOAL });
    const v = view.contract.version;
    await svc.updateObligation(db, human(), {
      contractId: view.contract.id,
      obligationId: view.obligations[0]!.id,
      expectedVersion: v,
      title: "Cancel Studio Plus",
    });
    await expect(
      svc.updateObligation(db, human(), {
        contractId: view.contract.id,
        obligationId: view.obligations[0]!.id,
        expectedVersion: v,
        title: "Another title",
      }),
    ).rejects.toMatchObject({ code: "version_conflict" });
  });

  it("refuses to execute twice concurrently", async () => {
    await svc.resetDemo(db, human(), { scenario: "clean" });
    let view = await svc.draftContract(db, human(), { goal: DEMO_GOAL });
    view = await approveAllPending(db, view);
    const results = await Promise.allSettled([
      svc.executeContract(db, human(), { contractId: view.contract.id }),
      svc.executeContract(db, human(), { contractId: view.contract.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const ws = await svc.getWorkspace(db, human().email);
    if (!ws.seeded) throw new Error("not seeded");
    expect(ws.refunds).toHaveLength(1);
  });

  it("refuses edits once execution has started", async () => {
    await svc.resetDemo(db, human(), { scenario: "clean" });
    let view = await svc.draftContract(db, human(), { goal: DEMO_GOAL });
    view = await approveAllPending(db, view);
    view = await svc.executeContract(db, human(), {
      contractId: view.contract.id,
    });
    await expect(
      svc.updateObligation(db, human(), {
        contractId: view.contract.id,
        obligationId: view.obligations[1]!.id,
        params: { amountCents: 1 },
      }),
    ).rejects.toMatchObject({ code: "not_editable" });
  });
});

describe("replay and reset", () => {
  it("reset returns the workspace to a clean, reproducible state", async () => {
    let first = await svc.resetDemo(db, human(), {
      scenario: "duplicate_refund",
    });
    let view = await svc.draftContract(db, human(), { goal: DEMO_GOAL });
    view = await approveAllPending(db, view);
    const run1 = await svc.executeContract(db, human(), {
      contractId: view.contract.id,
    });
    first = await svc.resetDemo(db, human(), { scenario: "duplicate_refund" });
    expect(await svc.listContracts(db, human().email)).toHaveLength(0);
    let again = await svc.draftContract(db, human(), { goal: DEMO_GOAL });
    again = await approveAllPending(db, again);
    const run2 = await svc.executeContract(db, human(), {
      contractId: again.contract.id,
    });
    const shape = (v: svc.ContractView) =>
      v.obligations.map((o) => [
        o.kind,
        o.execution,
        o.verdict,
        o.reasons.map((r) => r.code),
      ]);
    expect(shape(run2)).toEqual(shape(run1));
    expect(first.scenario).toBe("duplicate_refund");
    const chain = await svc.verifyAuditChain(db, human().email);
    expect(chain.intact).toBe(true);
  });
});

describe("receipts", () => {
  it("exports a receipt whose integrity check passes, and detects edits", async () => {
    await svc.resetDemo(db, human(), { scenario: "clean" });
    let view = await svc.draftContract(db, human(), { goal: DEMO_GOAL });
    view = await approveAllPending(db, view);
    view = await svc.executeContract(db, human(), {
      contractId: view.contract.id,
    });
    const receipt = await svc.exportReceipt(db, human(), {
      contractId: view.contract.id,
    });
    expect(receipt.overall).toBe("VERIFIED");
    expect(receipt.agentClaims.usedAsEvidence).toBe(0);
    expect(svc.checkReceipt(receipt).signatureValid).toBe(true);
    const forged = JSON.parse(JSON.stringify(receipt));
    forged.summary.FAILED = 0;
    forged.obligations[1]!.verdict = "VERIFIED";
    forged.overall = "VERIFIED";
    forged.obligations[0]!.title = "Cancel (edited)";
    expect(svc.checkReceipt(forged).digestMatches).toBe(false);
  });

  it("the audit chain detects a rewritten event", async () => {
    await svc.resetDemo(db, human(), { scenario: "clean" });
    await svc.draftContract(db, human(), { goal: DEMO_GOAL });
    const { auditEvents } = await import("../server/db/schema.js");
    const { eq } = await import("drizzle-orm");
    await db
      .update(auditEvents)
      .set({ actor: "someone-else" })
      .where(eq(auditEvents.seq, 2));
    const chain = await svc.verifyAuditChain(db, human().email);
    expect(chain.intact).toBe(false);
    expect(chain.brokenAtSeq).toBe(2);
  });
});

describe("rate limiting", () => {
  it("caps drafts per workspace, survives a demo reset, and is per-workspace", async () => {
    const { RATE_LIMITS } = await import("../server/domain/rate-limit.js");
    const saved = { ...RATE_LIMITS };
    RATE_LIMITS.draft = 3;
    try {
      await svc.resetDemo(db, human(), { scenario: "clean" });
      for (let i = 0; i < 3; i++)
        await svc.draftContract(db, human(), { goal: DEMO_GOAL });
      await expect(
        svc.draftContract(db, human(), { goal: DEMO_GOAL }),
      ).rejects.toMatchObject({ code: "rate_limited", status: 429 });
      await svc.resetDemo(db, human(), { scenario: "clean" });
      await expect(
        svc.draftContract(db, human(), { goal: DEMO_GOAL }),
      ).rejects.toMatchObject({ code: "rate_limited" });
      const other = human("other@example.test");
      await svc.resetDemo(db, other, { scenario: "clean" });
      await expect(
        svc.draftContract(db, other, { goal: DEMO_GOAL }),
      ).resolves.toBeTruthy();
    } finally {
      Object.assign(RATE_LIMITS, saved);
    }
  });
});
