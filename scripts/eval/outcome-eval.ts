/**
 * Outcome evaluation: every combination of the 8 injectable provider faults.
 *
 *   pnpm eval:outcomes            # writes docs/eval/outcome-eval.{json,md}
 *
 * For each of the 2^8 = 256 fault sets, one workspace runs the demo request
 * end to end: reset, draft, human approval, execution, verification, then the
 * same repair policy the agent follows (repair on FAILED, fresh observation on
 * UNKNOWN, resume when interrupted), up to 3 rounds.
 *
 * Ground truth comes from an ORACLE that reads the sandbox tables directly.
 * It shares no code with the verifier or with `server/sandbox/observe.ts`, is
 * never subject to injected observation faults (timeouts, stale replicas), and
 * implements each clause's "done means" from its written definition. That lets
 * us count what matters:
 *   - false VERIFIED: the verifier said VERIFIED while the promise was broken;
 *   - false FAILED: the verifier said FAILED while the promise was kept;
 *   - UNKNOWN, and why;
 *   - how often the executor's own "Done" claim was false.
 *
 * Deterministic (no LLM, no network). Synthetic data only.
 */
import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import { setDbForTesting, type Db } from "../../server/db/index.js";
import { TCS_MIGRATIONS } from "../../server/db/migrations.js";
import * as schema from "../../server/db/schema.js";
import * as svc from "../../server/domain/service.js";
import {
  ALL_FAULT_KEYS,
  setFaultOverrideForEval,
  type FaultKey,
} from "../../server/sandbox/faults.js";

const GOAL =
  "Cancel my subscription, refund $100, and delete my personal data and associated memories.";
const ROOT_KINDS = [
  "cancel_subscription",
  "refund_charge",
  "erase_personal_data",
  "purge_derived_memories",
] as const;
type RootKind = (typeof ROOT_KINDS)[number];
type Verdict = "VERIFIED" | "FAILED" | "UNKNOWN";

// ---------------------------------------------------------------------------
// Oracle: ground truth from raw sandbox tables (independent implementation)
// ---------------------------------------------------------------------------
async function oracle(
  db: Db,
  owner: string,
  kind: RootKind,
  params: Record<string, unknown>,
): Promise<boolean> {
  const { sbxSubscriptions, sbxCharges, sbxRefunds, sbxMemories } = schema;
  const liveRefundCents = async (chargeId: string) => {
    const rows = await db
      .select()
      .from(sbxRefunds)
      .where(
        and(
          eq(sbxRefunds.ownerEmail, owner),
          eq(sbxRefunds.chargeId, chargeId),
        ),
      );
    return rows
      .filter((r) => r.status !== "voided")
      .reduce((s, r) => s + r.amountCents, 0);
  };

  if (kind === "cancel_subscription") {
    // Done means: canceled, and no charge after cancellation that is not
    // fully refunded.
    const [sub] = await db
      .select()
      .from(sbxSubscriptions)
      .where(
        and(
          eq(sbxSubscriptions.ownerEmail, owner),
          eq(sbxSubscriptions.id, String(params.subscriptionId)),
        ),
      );
    if (!sub || sub.status !== "canceled" || !sub.canceledAt) return false;
    const charges = await db
      .select()
      .from(sbxCharges)
      .where(
        and(
          eq(sbxCharges.ownerEmail, owner),
          eq(sbxCharges.customerId, sub.customerId),
        ),
      );
    for (const c of charges.filter((x) => x.createdAt > sub.canceledAt!)) {
      if ((await liveRefundCents(c.id)) < c.amountCents) return false;
    }
    return true;
  }

  if (kind === "refund_charge") {
    // Done means: non-voided refunds sum to exactly the promised amount.
    return (
      (await liveRefundCents(String(params.chargeId))) ===
      Number(params.amountCents)
    );
  }

  const customerId = String(params.customerId);
  const stores = (params.stores as string[]) ?? [];
  const rows = await db
    .select()
    .from(sbxMemories)
    .where(
      and(
        eq(sbxMemories.ownerEmail, owner),
        eq(sbxMemories.customerId, customerId),
      ),
    );
  const live = (r: (typeof rows)[number]) => r.deletedAt === null;

  if (kind === "erase_personal_data") {
    // Done means: no live personal-data record in any in-scope store.
    return !rows.some(
      (r) => r.kind === "pii" && live(r) && stores.includes(r.store),
    );
  }

  // purge_derived_memories. Done means: no live in-scope memory descends from
  // the subject's personal data, and none contains one of its identifiers.
  const derived = new Set(
    rows.filter((r) => r.kind === "pii").map((r) => r.id),
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of rows) {
      if (!derived.has(r.id) && r.derivedFrom.some((d) => derived.has(d))) {
        derived.add(r.id);
        grew = true;
      }
    }
  }
  const identifiers = rows
    .filter((r) => r.kind === "pii")
    .map((r) => r.content.toLowerCase())
    .filter((v) => v.length >= 6);
  return !rows.some(
    (r) =>
      r.kind !== "pii" &&
      live(r) &&
      stores.includes(r.store) &&
      (derived.has(r.id) ||
        identifiers.some((id) => r.content.toLowerCase().includes(id))),
  );
}

// ---------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------
type ClauseResult = {
  kind: RootKind;
  truthRound1: boolean;
  verdictRound1: Verdict | null;
  unknownCauses: string[];
  executorClaimedDone: boolean;
  truthFinal: boolean;
  verdictFinal: Verdict | null;
};
type RunResult = {
  faults: FaultKey[];
  clauses: ClauseResult[];
  statusRound1: string;
  statusFinal: string;
  rounds: number;
  resumed: number;
  freshObservations: number;
};

async function approveAll(db: Db, who: svc.Actor, view: svc.ContractView) {
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

async function execute(db: Db, who: svc.Actor, contractId: string) {
  let resumed = 0;
  await svc.executeContract(db, who, { contractId });
  let view = await svc.getContractView(db, who.email, contractId);
  while (view.contract.status === "interrupted" && resumed < 3) {
    resumed++;
    await svc.executeContract(db, who, { contractId });
    view = await svc.getContractView(db, who.email, contractId);
  }
  return { view, resumed };
}

async function runOne(db: Db, faults: FaultKey[], i: number) {
  const who: svc.Actor = {
    email: `eval-${i}@example.test`,
    caller: "frontend",
  };
  await svc.resetDemo(db, who, { scenario: "clean" });
  setFaultOverrideForEval(who.email, faults);
  try {
    let view = await svc.draftContract(db, who, { goal: GOAL });
    view = await approveAll(db, who, view);
    const contractId = view.contract.id;
    const first = await execute(db, who, contractId);
    view = first.view;
    let resumed = first.resumed;

    const roots = view.obligations.filter((o) => o.round === 1);
    const round1 = new Map<
      string,
      Omit<ClauseResult, "truthFinal" | "verdictFinal">
    >();
    for (const o of roots) {
      round1.set(o.id, {
        kind: o.kind as RootKind,
        truthRound1: await oracle(db, who.email, o.kind as RootKind, o.params),
        verdictRound1: o.verdict as Verdict | null,
        unknownCauses:
          o.verdict === "UNKNOWN" ? o.reasons.map((r) => r.code) : [],
        executorClaimedDone: o.execution === "succeeded",
      });
    }
    const statusRound1 = view.contract.status;

    // The agent's repair policy: repair FAILED, re-observe UNKNOWN.
    let rounds = 1;
    let freshObservations = 0;
    while (
      (view.contract.status === "failed" ||
        view.contract.status === "unknown") &&
      rounds < 4
    ) {
      const hasFailed = view.obligations.some((o) => o.verdict === "FAILED");
      if (hasFailed) {
        await svc.proposeRepair(db, who, { contractId });
        view = await svc.getContractView(db, who.email, contractId);
        if (view.obligations.some((o) => o.approval === "pending")) {
          view = await approveAll(db, who, view);
          const next = await execute(db, who, contractId);
          view = next.view;
          resumed += next.resumed;
          rounds++;
          continue;
        }
      }
      await svc.verifyContract(db, who, { contractId });
      view = await svc.getContractView(db, who.email, contractId);
      freshObservations++;
      if (freshObservations > 2) break;
    }

    const clauses: ClauseResult[] = [];
    for (const o of view.obligations.filter((x) => x.round === 1)) {
      const r1 = round1.get(o.id)!;
      clauses.push({
        ...r1,
        truthFinal: await oracle(db, who.email, o.kind as RootKind, o.params),
        verdictFinal: o.verdict as Verdict | null,
      });
    }
    return {
      faults,
      clauses,
      statusRound1,
      statusFinal: view.contract.status,
      rounds,
      resumed,
      freshObservations,
    } satisfies RunResult;
  } finally {
    setFaultOverrideForEval(who.email, null);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function summarize(results: RunResult[]) {
  const clauses = results.flatMap((r) => r.clauses);
  const count = (pred: (c: ClauseResult) => boolean) =>
    clauses.filter(pred).length;
  const matrix = (stage: "Round1" | "Final") => {
    const out: Record<string, Record<string, number>> = {};
    for (const truth of ["kept", "broken"]) {
      out[truth] = {};
      for (const v of ["VERIFIED", "FAILED", "UNKNOWN", "none"]) {
        out[truth][v] = count(
          (c) =>
            (c[`truth${stage}`] ? "kept" : "broken") === truth &&
            (c[`verdict${stage}`] ?? "none") === v,
        );
      }
    }
    return out;
  };
  const unknownCauses: Record<string, number> = {};
  for (const c of clauses)
    for (const code of new Set(c.unknownCauses))
      unknownCauses[code] = (unknownCauses[code] ?? 0) + 1;
  const perFault = ALL_FAULT_KEYS.map((f) => {
    const runs = results.filter((r) => r.faults.includes(f));
    const cl = runs.flatMap((r) => r.clauses);
    return {
      fault: f,
      runs: runs.length,
      brokenRound1: cl.filter((c) => !c.truthRound1).length,
      falseDone: cl.filter((c) => c.executorClaimedDone && !c.truthRound1)
        .length,
      caught: cl.filter((c) => !c.truthRound1 && c.verdictRound1 !== "VERIFIED")
        .length,
      falseVerified: cl.filter(
        (c) => !c.truthRound1 && c.verdictRound1 === "VERIFIED",
      ).length,
    };
  });
  const finalStatus: Record<string, number> = {};
  for (const r of results)
    finalStatus[r.statusFinal] = (finalStatus[r.statusFinal] ?? 0) + 1;
  return {
    runs: results.length,
    clauses: clauses.length,
    round1: matrix("Round1"),
    final: matrix("Final"),
    executor: {
      claimedDone: count((c) => c.executorClaimedDone),
      claimedDoneButBroken: count(
        (c) => c.executorClaimedDone && !c.truthRound1,
      ),
      brokenRound1: count((c) => !c.truthRound1),
    },
    falseVerifiedRound1: count(
      (c) => !c.truthRound1 && c.verdictRound1 === "VERIFIED",
    ),
    falseVerifiedFinal: count(
      (c) => !c.truthFinal && c.verdictFinal === "VERIFIED",
    ),
    falseFailedRound1: count(
      (c) => c.truthRound1 && c.verdictRound1 === "FAILED",
    ),
    falseFailedFinal: count((c) => c.truthFinal && c.verdictFinal === "FAILED"),
    unknownCauses,
    perFault,
    finalStatus,
    repairRounds: {
      max: Math.max(...results.map((r) => r.rounds)),
      runsNeedingRepair: results.filter((r) => r.rounds > 1).length,
      runsResumed: results.filter((r) => r.resumed > 0).length,
      runsWithFreshObservation: results.filter((r) => r.freshObservations > 0)
        .length,
    },
  };
}

function pct(n: number, d: number) {
  return d ? `${((100 * n) / d).toFixed(1)} %` : "n/a";
}

function markdown(s: ReturnType<typeof summarize>, ms: number) {
  const row = (m: Record<string, number>) =>
    `${m.VERIFIED} | ${m.FAILED} | ${m.UNKNOWN} | ${m.none}`;
  return `# Outcome evaluation

Generated by \`pnpm eval:outcomes\` (\`scripts/eval/outcome-eval.ts\`). Deterministic: no LLM, no network, synthetic sandbox data. Runtime ${(ms / 1000).toFixed(1)} s.

**Setup.** All 2^8 = **${s.runs}** combinations of the 8 injectable provider faults. Each combination runs the demo request end to end: draft, human approval, execution, verification. The same repair policy the agent follows then runs for up to 3 rounds: repair on FAILED, fresh observation on UNKNOWN, resume when interrupted. That gives **${s.clauses} clause outcomes** (4 clauses per run).

**Ground truth.** An oracle reads the sandbox tables directly. It shares no code with the verifier or the observation layer, is never subject to injected observation faults (timeouts, stale replicas), and implements each clause's written "done means".

## Headline

| Metric | Result |
| --- | --- |
| **False VERIFIED** (verifier said VERIFIED, promise was broken) | **${s.falseVerifiedRound1}** of ${s.executor.brokenRound1} broken clauses after execution; **${s.falseVerifiedFinal}** after repair |
| False FAILED (verifier said FAILED, promise was kept) | ${s.falseFailedRound1} after execution; ${s.falseFailedFinal} after repair |
| Executor's own "Done" claims that were false | **${s.executor.claimedDoneButBroken}** of ${s.executor.claimedDone} "Done" claims (${pct(s.executor.claimedDoneButBroken, s.executor.claimedDone)}) |
| Broken promises after the first execution | ${s.executor.brokenRound1} of ${s.clauses} clauses (${pct(s.executor.brokenRound1, s.clauses)}) |
| Runs that needed a repair round | ${s.repairRounds.runsNeedingRepair} of ${s.runs} |
| Runs resumed after a worker crash | ${s.repairRounds.runsResumed} |
| Runs that needed a fresh observation for UNKNOWN | ${s.repairRounds.runsWithFreshObservation} |
| Final contract status | ${Object.entries(s.finalStatus)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ")} |

## Verdict vs truth, after the first execution

| Truth \\ Verdict | VERIFIED | FAILED | UNKNOWN | no verdict |
| --- | --- | --- | --- | --- |
| Promise kept | ${row(s.round1.kept!)} |
| Promise broken | ${row(s.round1.broken!)} |

## Verdict vs truth, after the repair policy

| Truth \\ Verdict | VERIFIED | FAILED | UNKNOWN | no verdict |
| --- | --- | --- | --- | --- |
| Promise kept | ${row(s.final.kept!)} |
| Promise broken | ${row(s.final.broken!)} |

## Why UNKNOWN (first execution, clause count per reason code)

| Reason code | Clauses |
| --- | --- |
${
  Object.entries(s.unknownCauses)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `| \`${k}\` | ${v} |`)
    .join("\n") || "| (none) | 0 |"
}

## Per fault (runs where the fault was active, first execution)

| Fault | Runs | Broken clauses | Executor said "Done" but broken | Caught (not VERIFIED) | False VERIFIED |
| --- | --- | --- | --- | --- | --- |
${s.perFault
  .map(
    (f) =>
      `| \`${f.fault}\` | ${f.runs} | ${f.brokenRound1} | ${f.falseDone} | ${f.caught} | ${f.falseVerified} |`,
  )
  .join("\n")}

## Bug found by this evaluation (fixed)

The first run of this evaluation (2026-11-01) ended with 248 of 256 contracts VERIFIED, not 256. In the 8 runs that combined \`billing.cancel_noop\`, \`billing.renewal_after_cancel\`, \`billing.observe_timeout\` and \`memory.skip_vector_index\`, this happened:

1. The original cancel and its retry both saw the same late renewal charge.
2. The repair planner proposed "refund the late charge" once per failing obligation, so the same charge was refunded twice.
3. The verifier caught the over-refund ($200 against a $100 promise), and one more round voided it, but our own repair loop had created a duplicate refund.

The fix: \`dedupeProposals\` in \`server/domain/repair.ts\` keeps one proposal per real-world effect, and a unit test covers the case. The second run gave 256 of 256 VERIFIED.

## What this does and does not show

- The providers and faults are our own sandbox. This measures the verifier against an independent oracle under every combination of the faults we model. It does not measure faults we did not model.
- The executor's "Done" claims come from provider responses (a 200 OK, a lost response retried). They stand in for what an agent would report from its own tool calls.
- The live LLM agent's reporting is measured separately; see \`docs/LIVE_AGENT_RUN.md\` and the agent evaluation.
`;
}

async function main() {
  const client = new PGlite();
  for (const m of TCS_MIGRATIONS) await client.exec(m.sql);
  const db = drizzle(client, { schema }) as unknown as Db;
  setDbForTesting(db);
  const started = Date.now();
  const results: RunResult[] = [];
  for (let mask = 0; mask < 1 << ALL_FAULT_KEYS.length; mask++) {
    const faults = ALL_FAULT_KEYS.filter((_, b) => mask & (1 << b));
    results.push(await runOne(db, faults, mask));
    if (mask % 32 === 31) console.log(`… ${mask + 1} / 256 runs`);
  }
  const ms = Date.now() - started;
  const summary = summarize(results);
  const outDir = path.resolve("docs/eval");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "outcome-eval.json"),
    JSON.stringify({ summary, results }, null, 1),
  );
  fs.writeFileSync(path.join(outDir, "outcome-eval.md"), markdown(summary, ms));
  console.log(JSON.stringify({ ...summary, perFault: undefined }, null, 1));
  setDbForTesting(null);
  await client.close();
  const problems = [
    summary.falseVerifiedRound1 + summary.falseVerifiedFinal > 0 &&
      "false VERIFIED",
    summary.falseFailedRound1 + summary.falseFailedFinal > 0 && "false FAILED",
    (summary.finalStatus.verified ?? 0) !== summary.runs &&
      "not every run converged to VERIFIED",
  ].filter(Boolean);
  if (problems.length) {
    console.error(`Outcome evaluation failed: ${problems.join(", ")}.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
