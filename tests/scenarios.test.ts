import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Db } from "../server/db/index.js";
import * as svc from "../server/domain/service.js";
import { liveVectorIds } from "../server/sandbox/vector-index.js";
import {
  REAL_BILLING_SCENARIOS,
  SCENARIO_INFO,
  type Scenario,
} from "../shared/domain.js";
import {
  DEMO_GOAL,
  approveAllPending,
  draftAndApprove,
  freshDb,
  human,
  verdictsByKind,
} from "./harness.js";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await freshDb()));
afterEach(async () => close());

describe("planning", () => {
  it("turns the demo goal into four testable obligations with a dependency chain", async () => {
    await svc.resetDemo(db, human(), { scenario: "clean" });
    const view = await svc.draftContract(db, human(), { goal: DEMO_GOAL });
    expect(view.obligations.map((o) => o.kind)).toEqual([
      "cancel_subscription",
      "refund_charge",
      "erase_personal_data",
      "purge_derived_memories",
    ]);
    expect(view.obligations[1]!.params.amountCents).toBe(10000);
    expect(view.obligations[1]!.dependsOn).toEqual([view.obligations[0]!.id]);
    expect(view.obligations.every((o) => o.approval === "pending")).toBe(true);
    expect(view.contract.status).toBe("awaiting_approval");
    expect(view.contract.unmatchedClauses).toEqual([]);
  });

  it("surfaces clauses it cannot verify instead of dropping them", async () => {
    await svc.resetDemo(db, human(), { scenario: "clean" });
    const view = await svc.draftContract(db, human(), {
      goal: "Refund $100 and send me a handwritten apology",
    });
    expect(view.obligations.map((o) => o.kind)).toEqual(["refund_charge"]);
    expect(view.contract.unmatchedClauses.join(" ")).toMatch(/apology/);
  });

  it("refuses goals with nothing verifiable", async () => {
    await svc.resetDemo(db, human(), { scenario: "clean" });
    await expect(
      svc.draftContract(db, human(), { goal: "Make me happy" }),
    ).rejects.toMatchObject({ code: "no_verifiable_obligations" });
  });
});

describe("scenario: clean run", () => {
  it("verifies every obligation from independent observations", async () => {
    const approved = await draftAndApprove(db, "clean");
    expect(approved.contract.status).toBe("ready");
    const view = await svc.executeContract(db, human(), {
      contractId: approved.contract.id,
    });
    expect(view.contract.status).toBe("verified");
    expect(verdictsByKind(view)).toEqual(SCENARIO_INFO.clean.expected);
    expect(view.evidence.length).toBeGreaterThan(0);
    expect(view.evidence.every((e) => e.intact)).toBe(true);
    // Evidence never carries personal data content.
    expect(JSON.stringify(view.evidence)).not.toMatch(
      /ada\.quinn@example\.test|555-0142|Lantern Row/,
    );
  });

  it("does not over-delete a bystander's data", async () => {
    const approved = await draftAndApprove(db, "clean");
    await svc.executeContract(db, human(), {
      contractId: approved.contract.id,
    });
    const ws = await svc.getWorkspace(db, human().email);
    if (!ws.seeded) throw new Error("not seeded");
    const { sbxMemories } = await import("../server/db/schema.js");
    const { eq } = await import("drizzle-orm");
    const ben = await db
      .select()
      .from(sbxMemories)
      .where(eq(sbxMemories.customerId, ws.bystanders[0]!.id));
    expect(ben.every((m) => m.deletedAt === null)).toBe(true);
  });
});

describe("scenario: duplicate refund", () => {
  it("catches the over-refund the agent never noticed, then repairs it", async () => {
    const approved = await draftAndApprove(db, "duplicate_refund");
    let view = await svc.executeContract(db, human(), {
      contractId: approved.contract.id,
    });
    const refund = view.obligations.find((o) => o.kind === "refund_charge")!;
    expect(refund.execution).toBe("succeeded"); // the executor believes it worked
    expect(refund.verdict).toBe("FAILED");
    expect(refund.reasons[0]!.code).toBe("over_refunded");
    expect(view.contract.status).toBe("failed");
    const claims = view.attempts
      .filter((a) => a.obligationId === refund.id)
      .map((a) => a.outcome);
    expect(claims).toEqual(["timeout", "ok"]);

    const { plan, view: proposed } = await svc.proposeRepair(db, human(), {
      contractId: view.contract.id,
    });
    expect(plan.proposals.map((p) => p.kind)).toEqual(["void_refunds"]);
    expect(proposed.contract.status).toBe("awaiting_approval");
    view = await approveAllPending(db, proposed);
    view = await svc.executeContract(db, human(), {
      contractId: view.contract.id,
    });
    expect(view.contract.status).toBe("verified");
    expect(view.obligations.find((o) => o.id === refund.id)!.verdict).toBe(
      "VERIFIED",
    );
  });

  it("without the fault, the lost response is retried idempotently (one refund)", async () => {
    const approved = await draftAndApprove(db, "provider_timeout");
    const view = await svc.executeContract(db, human(), {
      contractId: approved.contract.id,
    });
    const ws = await svc.getWorkspace(db, human().email);
    if (!ws.seeded) throw new Error("not seeded");
    expect(ws.refunds.filter((r) => r.status === "succeeded")).toHaveLength(1);
    const refund = view.obligations.find((o) => o.kind === "refund_charge")!;
    expect(
      view.attempts
        .filter((a) => a.obligationId === refund.id)
        .map((a) => a.outcome),
    ).toEqual(["timeout", "ok"]);
  });
});

describe("scenario: incomplete deletion", () => {
  it("detects residual derived memories through lineage and repairs them", async () => {
    const approved = await draftAndApprove(db, "incomplete_deletion");
    let view = await svc.executeContract(db, human(), {
      contractId: approved.contract.id,
    });
    const purge = view.obligations.find(
      (o) => o.kind === "purge_derived_memories",
    )!;
    expect(purge.execution).toBe("succeeded");
    expect(purge.verdict).toBe("FAILED");
    expect(purge.reasons[0]!.code).toBe("residual_lineage");
    expect(purge.reasons[0]!.refs).toHaveLength(2);

    const { view: proposed } = await svc.proposeRepair(db, human(), {
      contractId: view.contract.id,
    });
    view = await approveAllPending(db, proposed);
    view = await svc.executeContract(db, human(), {
      contractId: view.contract.id,
    });
    expect(view.contract.status).toBe("verified");
  });
});

describe("scenario: provider timeout", () => {
  it("reports UNKNOWN — never VERIFIED — when billing cannot be observed", async () => {
    const approved = await draftAndApprove(db, "provider_timeout");
    let view = await svc.executeContract(db, human(), {
      contractId: approved.contract.id,
    });
    expect(verdictsByKind(view)).toMatchObject(
      SCENARIO_INFO.provider_timeout.expected,
    );
    expect(view.contract.status).toBe("unknown");
    const { plan } = await svc.proposeRepair(db, human(), {
      contractId: view.contract.id,
    });
    expect(plan.proposals).toHaveLength(0);
    expect(plan.reverify.length).toBe(2);
    view = await svc.verifyContract(db, human(), {
      contractId: view.contract.id,
    });
    expect(view.contract.status).toBe("verified");
  });

  it("treats stale reads as UNKNOWN", async () => {
    const approved = await draftAndApprove(db, "stale_read");
    const view = await svc.executeContract(db, human(), {
      contractId: approved.contract.id,
    });
    expect(verdictsByKind(view)).toMatchObject(
      SCENARIO_INFO.stale_read.expected,
    );
  });
});

describe("scenario: contradictory and false evidence", () => {
  it("fails a cancellation the agent claimed but the provider never applied", async () => {
    const approved = await draftAndApprove(db, "silent_failure");
    const view = await svc.executeContract(db, human(), {
      contractId: approved.contract.id,
    });
    const cancel = view.obligations.find(
      (o) => o.kind === "cancel_subscription",
    )!;
    const claim = view.attempts.find(
      (a) => a.obligationId === cancel.id && a.outcome === "ok",
    )!.claim;
    expect(claim).toMatch(/canceled/);
    expect(cancel.verdict).toBe("FAILED");
    expect(cancel.reasons[0]!.code).toBe("still_active");
  });

  it("fails a cancellation contradicted by a later charge, and repairs it with a refund", async () => {
    const approved = await draftAndApprove(db, "contradictory_evidence");
    let view = await svc.executeContract(db, human(), {
      contractId: approved.contract.id,
    });
    const cancel = view.obligations.find(
      (o) => o.kind === "cancel_subscription",
    )!;
    expect(cancel.verdict).toBe("FAILED");
    expect(cancel.reasons[0]!.code).toBe("charge_after_cancel");
    const { plan, view: proposed } = await svc.proposeRepair(db, human(), {
      contractId: view.contract.id,
    });
    expect(plan.proposals.map((p) => p.kind)).toEqual(["refund_charge"]);
    view = await approveAllPending(db, proposed);
    view = await svc.executeContract(db, human(), {
      contractId: view.contract.id,
    });
    expect(view.contract.status).toBe("verified");
  });

  it("detects tampered evidence and refuses to certify it in the receipt", async () => {
    const approved = await draftAndApprove(db, "clean");
    let view = await svc.executeContract(db, human(), {
      contractId: approved.contract.id,
    });
    view = await svc.tamperEvidence(db, human(), {
      contractId: view.contract.id,
    });
    expect(view.evidence.some((e) => !e.intact)).toBe(true);
    const receipt = await svc.exportReceipt(db, human(), {
      contractId: view.contract.id,
    });
    expect(receipt.overall).toBe("UNKNOWN");
    expect(JSON.stringify(receipt.obligations)).toMatch(
      /evidence_integrity_failed/,
    );
  });
});

describe("scenario: interrupted execution", () => {
  it("resumes without repeating completed side effects", async () => {
    const approved = await draftAndApprove(db, "interrupted");
    let view = await svc.executeContract(db, human(), {
      contractId: approved.contract.id,
    });
    expect(view.contract.status).toBe("interrupted");
    expect(
      view.obligations.filter((o) => o.execution === "succeeded"),
    ).toHaveLength(1);
    view = await svc.executeContract(db, human(), {
      contractId: view.contract.id,
    });
    expect(view.contract.status).toBe("verified");
    const cancelAttempts = view.attempts.filter(
      (a) => a.operation === "subscriptions.cancel",
    );
    expect(cancelAttempts).toHaveLength(1);
  });
});

describe("expected outcomes table matches reality for every scenario", () => {
  // The real-billing scenario needs Dodo; tests/dodo.test.ts covers it.
  const scenarios = (Object.keys(SCENARIO_INFO) as Scenario[]).filter(
    (s) => !REAL_BILLING_SCENARIOS.includes(s),
  );
  for (const scenario of scenarios) {
    it(scenario, async () => {
      const approved = await draftAndApprove(db, scenario);
      let view = await svc.executeContract(db, human(), {
        contractId: approved.contract.id,
      });
      if (view.contract.status === "interrupted") {
        view = await svc.executeContract(db, human(), {
          contractId: view.contract.id,
        });
      }
      expect(verdictsByKind(view)).toMatchObject(
        SCENARIO_INFO[scenario].expected,
      );
    });
  }
});

describe("scenario: showcase (demo)", () => {
  it("catches both silent failures and repairs them in a single round", async () => {
    const approved = await draftAndApprove(db, "showcase");
    let view = await svc.executeContract(db, human(), {
      contractId: approved.contract.id,
    });
    expect(verdictsByKind(view)).toEqual(SCENARIO_INFO.showcase.expected);
    const { plan, view: proposed } = await svc.proposeRepair(db, human(), {
      contractId: view.contract.id,
    });
    expect(plan.proposals.map((p) => p.kind).sort()).toEqual([
      "delete_memories",
      "void_refunds",
    ]);
    // The purge failed on lineage residue AND on a disguised copy that only
    // the pgvector similarity search found; one repair deletes all three.
    const purge = view.obligations.find(
      (o) => o.kind === "purge_derived_memories",
    )!;
    expect(purge.reasons.map((r) => r.code).sort()).toEqual([
      "near_duplicate_vector",
      "residual_lineage",
    ]);
    const del = plan.proposals.find((p) => p.kind === "delete_memories")!;
    expect(del.params.memoryIds).toHaveLength(3);
    expect(del.title).toBe("Delete 3 residual record(s)");
    view = await approveAllPending(db, proposed);
    view = await svc.executeContract(db, human(), {
      contractId: view.contract.id,
    });
    expect(view.contract.status).toBe("verified");
    expect(view.contract.round).toBe(2);
  });
});

describe("scenario: disguised copy (pgvector)", () => {
  it("finds a reformatted copy only by vector similarity, deletes it physically and re-verifies", async () => {
    const approved = await draftAndApprove(db, "disguised_copy");
    let view = await svc.executeContract(db, human(), {
      contractId: approved.contract.id,
    });
    const purge = view.obligations.find(
      (o) => o.kind === "purge_derived_memories",
    )!;
    expect(purge.verdict).toBe("FAILED");
    // Exact text matching did not see it; only the nearest-neighbour search did.
    expect(purge.reasons.map((r) => r.code)).toEqual(["near_duplicate_vector"]);
    const copyId = purge.reasons[0]!.refs![0]!;
    expect(await liveVectorIds(human().email)).toContain(copyId);

    const { plan, view: proposed } = await svc.proposeRepair(db, human(), {
      contractId: view.contract.id,
    });
    expect(plan.proposals).toMatchObject([
      { kind: "delete_memories", params: { memoryIds: [copyId] } },
    ]);
    view = await approveAllPending(db, proposed);
    view = await svc.executeContract(db, human(), {
      contractId: view.contract.id,
    });
    expect(view.contract.status).toBe("verified");
    // Physically gone from the vector engine, not just flagged.
    expect(await liveVectorIds(human().email)).not.toContain(copyId);
  });
});
