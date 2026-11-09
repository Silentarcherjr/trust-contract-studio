/**
 * Baseline: would an LLM judge reading the agent's log have caught it?
 *
 * Many teams check an agent by asking another model "did it finish?". This
 * script runs the same fault combinations as the outcome evaluation, then
 * shows an LLM judge exactly what such a reviewer sees: the request, each
 * promise with its definition of done, every tool call with the provider's
 * response, and the agent's own "Done" report. The judge answers KEPT,
 * BROKEN or CANNOT_TELL per promise. Both the judge and our verifier are
 * scored against the same independent oracle (scripts/eval/oracle.ts).
 *
 * Usage: pnpm eval:llm-judge [--every 8] [--concurrency 4]
 * Needs a model connection (Builder.io gateway by default). Writes
 * docs/eval/llm-judge-eval.{json,md}.
 */
import fs from "node:fs";
import path from "node:path";

import { completeText } from "@agent-native/core/server";
import { PGlite } from "@electric-sql/pglite";
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
import { KIND_INFO, type ObligationKind } from "../../shared/domain.js";
import { GOAL, approveAll, execute, oracle, type RootKind } from "./oracle.js";

const args = process.argv.slice(2);
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1] ?? fallback) : fallback;
};
const EVERY = opt("--every", 8);
const CONCURRENCY = opt("--concurrency", 4);

type JudgeAnswer = "KEPT" | "BROKEN" | "CANNOT_TELL";
interface Clause {
  n: number;
  kind: RootKind;
  title: string;
  truthKept: boolean;
  verifier: string | null;
  executorClaimedDone: boolean;
  judge?: JudgeAnswer | "NO_ANSWER";
  /** Forced decision: KEPT or BROKEN only, as an automatic "is it done?" check. */
  judgeForced?: JudgeAnswer | "NO_ANSWER";
}
interface Run {
  mask: number;
  faults: FaultKey[];
  transcript: string;
  clauses: Clause[];
  judgeRaw?: string;
  judgeForcedRaw?: string;
  judgeError?: string;
}

const short = (v: unknown) => {
  const t = JSON.stringify(v ?? null);
  return t.length > 280 ? `${t.slice(0, 280)}…` : t;
};

async function runOne(db: Db, mask: number): Promise<Run> {
  const faults = ALL_FAULT_KEYS.filter((_, b) => mask & (1 << b));
  const who: svc.Actor = {
    email: `judge-${mask}@example.test`,
    caller: "frontend",
  };
  await svc.resetDemo(db, who, { scenario: "clean" });
  setFaultOverrideForEval(who.email, faults);
  try {
    let view = await svc.draftContract(db, who, { goal: GOAL });
    view = await approveAll(db, who, view);
    view = (await execute(db, who, view.contract.id)).view;
    const roots = view.obligations.filter((o) => o.round === 1);
    const clauses: Clause[] = [];
    const lines: string[] = [
      `Customer request: "${GOAL}"`,
      "",
      "Promises the agent made, each with what counts as done:",
    ];
    for (const [i, o] of roots.entries()) {
      lines.push(
        `#${i + 1} ${o.title} — done means: ${KIND_INFO[o.kind as ObligationKind].expectedEvidence}`,
      );
    }
    lines.push("", "The agent's tool calls, in order:");
    const n = new Map(roots.map((o, i) => [o.id, i + 1]));
    for (const a of view.attempts.filter((a) => n.has(a.obligationId))) {
      lines.push(
        `- for #${n.get(a.obligationId)}: ${a.provider}.${a.operation} attempt ${a.attemptNo} → ${a.outcome}; response ${short(a.response)}; agent noted: "${a.claim}"`,
      );
    }
    lines.push("", "The agent's final report to the customer:");
    for (const [i, o] of roots.entries()) {
      const last = [...view.attempts]
        .reverse()
        .find((a) => a.obligationId === o.id);
      lines.push(
        `#${i + 1}: ${o.execution === "succeeded" ? (last?.claim ?? "Done.") : `Not completed (${o.execution}).`}`,
      );
    }
    for (const [i, o] of roots.entries()) {
      clauses.push({
        n: i + 1,
        kind: o.kind as RootKind,
        title: o.title,
        truthKept: await oracle(db, who.email, o.kind as RootKind, o.params),
        verifier: o.verdict,
        executorClaimedDone: o.execution === "succeeded",
      });
    }
    return { mask, faults, transcript: lines.join("\n"), clauses };
  } finally {
    setFaultOverrideForEval(who.email, null);
  }
}

const SYSTEM = `You review an AI support agent's work for a support lead. You see the customer's request, the promises the agent made with what "done" means, every tool call the agent made with the provider's response, and the agent's final report. Decide for each promise whether it was actually kept. Answer only with JSON like {"1":"KEPT","2":"BROKEN","3":"CANNOT_TELL","4":"KEPT"}. Use CANNOT_TELL only when the log genuinely does not let you decide.`;

const SYSTEM_FORCED = `You are an automatic check that runs after an AI support agent finishes. You see the customer's request, the promises the agent made with what "done" means, every tool call the agent made with the provider's response, and the agent's final report. For each promise, decide whether it was kept. You must choose KEPT or BROKEN for every promise; if unsure, choose the more likely one. Answer only with JSON like {"1":"KEPT","2":"BROKEN","3":"KEPT","4":"KEPT"}.`;

async function ask(system: string, input: string) {
  const res = await completeText({
    engine: "builder",
    systemPrompt: system,
    input,
    maxOutputTokens: 2000,
    temperature: 0,
    reasoningEffort: "low",
    timeoutMs: 90_000,
  });
  const json = JSON.parse(
    res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1),
  ) as Record<string, unknown>;
  return { text: res.text, json };
}

const parse = (v: unknown, allowed: JudgeAnswer[]) => {
  const s = String(v ?? "").toUpperCase() as JudgeAnswer;
  return allowed.includes(s) ? s : ("NO_ANSWER" as const);
};

async function judge(run: Run) {
  try {
    const cautious = await ask(SYSTEM, run.transcript);
    run.judgeRaw = cautious.text;
    for (const c of run.clauses)
      c.judge = parse(cautious.json[String(c.n)], [
        "KEPT",
        "BROKEN",
        "CANNOT_TELL",
      ]);
    const forced = await ask(SYSTEM_FORCED, run.transcript);
    run.judgeForcedRaw = forced.text;
    for (const c of run.clauses)
      c.judgeForced = parse(forced.json[String(c.n)], ["KEPT", "BROKEN"]);
  } catch (err) {
    run.judgeError = (err as Error).message.slice(0, 200);
    for (const c of run.clauses) {
      c.judge ??= "NO_ANSWER";
      c.judgeForced ??= "NO_ANSWER";
    }
  }
}

function summarize(runs: Run[]) {
  const all = runs.flatMap((r) => r.clauses);
  const broken = all.filter((c) => !c.truthKept);
  const kept = all.filter((c) => c.truthKept);
  const count = (xs: Clause[], f: (c: Clause) => boolean) =>
    xs.filter(f).length;
  return {
    runs: runs.length,
    clauses: all.length,
    broken: broken.length,
    kept: kept.length,
    brokenClaimedDone: count(broken, (c) => c.executorClaimedDone),
    judge: {
      acceptedBroken: count(broken, (c) => c.judge === "KEPT"),
      caughtBroken: count(broken, (c) => c.judge === "BROKEN"),
      cannotTellBroken: count(broken, (c) => c.judge === "CANNOT_TELL"),
      falseAlarmOnKept: count(kept, (c) => c.judge === "BROKEN"),
      cannotTellKept: count(kept, (c) => c.judge === "CANNOT_TELL"),
      noAnswer: count(all, (c) => c.judge === "NO_ANSWER"),
      acceptedBrokenClaimedDone: count(
        broken,
        (c) => c.executorClaimedDone && c.judge === "KEPT",
      ),
    },
    judgeForced: {
      acceptedBroken: count(broken, (c) => c.judgeForced === "KEPT"),
      caughtBroken: count(broken, (c) => c.judgeForced === "BROKEN"),
      falseAlarmOnKept: count(kept, (c) => c.judgeForced === "BROKEN"),
      noAnswer: count(all, (c) => c.judgeForced === "NO_ANSWER"),
      acceptedBrokenClaimedDone: count(
        broken,
        (c) => c.executorClaimedDone && c.judgeForced === "KEPT",
      ),
    },
    verifier: {
      acceptedBroken: count(broken, (c) => c.verifier === "VERIFIED"),
      caughtBroken: count(broken, (c) => c.verifier === "FAILED"),
      unknownBroken: count(broken, (c) => c.verifier === "UNKNOWN"),
      falseAlarmOnKept: count(kept, (c) => c.verifier === "FAILED"),
      unknownKept: count(kept, (c) => c.verifier === "UNKNOWN"),
    },
    judgeErrors: runs.filter((r) => r.judgeError).length,
  };
}

const pct = (n: number, d: number) =>
  d ? `${((100 * n) / d).toFixed(1)} %` : "n/a";

function markdown(s: ReturnType<typeof summarize>, model: string) {
  return `# LLM judge vs verifier

Generated by \`pnpm eval:llm-judge\` (\`scripts/eval/llm-judge-eval.ts\`). Judge model: **${model}** through the Builder.io gateway, temperature 0.

**Question.** Teams often check an agent by asking another model whether the work is done. Would that have caught the broken promises?

**Setup.**

- ${s.runs} fault combinations: one in every ${EVERY} of the 512 used by the [outcome evaluation](outcome-eval.md). Each runs the demo request through draft, human approval and execution.
- **The judge** sees what a reviewer of the agent sees: the request, each promise with its definition of done, every tool call with the provider's response, and the agent's final report. It answers KEPT, BROKEN or CANNOT_TELL per promise.
- **The verifier** reads provider state through the observation layer and never sees the agent's report.
- **Ground truth** for both comes from the same independent oracle, which reads the sandbox tables directly.

## Results (${s.clauses} promises, ${s.broken} actually broken)

| | LLM judge, forced to decide (an automatic "is it done?" check) | LLM judge, allowed to say "can't tell" | Verifier (reads provider state) |
| --- | --- | --- | --- |
| **Broken promises accepted as kept** | **${s.judgeForced.acceptedBroken} of ${s.broken}** (${pct(s.judgeForced.acceptedBroken, s.broken)}) | **${s.judge.acceptedBroken} of ${s.broken}** (${pct(s.judge.acceptedBroken, s.broken)}) | **${s.verifier.acceptedBroken} of ${s.broken}** (${pct(s.verifier.acceptedBroken, s.broken)}) |
| Broken promises caught | ${s.judgeForced.caughtBroken} | ${s.judge.caughtBroken} | ${s.verifier.caughtBroken} FAILED |
| Broken promises left undecided | — | ${s.judge.cannotTellBroken} (CANNOT_TELL) | ${s.verifier.unknownBroken} (UNKNOWN, with the reason) |
| Kept promises wrongly flagged as broken | ${s.judgeForced.falseAlarmOnKept} of ${s.kept} | ${s.judge.falseAlarmOnKept} of ${s.kept} | ${s.verifier.falseAlarmOnKept} of ${s.kept} |
| Kept promises left undecided | — | ${s.judge.cannotTellKept} of ${s.kept} | ${s.verifier.unknownKept} of ${s.kept} |

- The agent said "Done" on **${s.brokenClaimedDone}** of the broken promises. The forced judge accepted **${s.judgeForced.acceptedBrokenClaimedDone}** of those; the cautious judge accepted ${s.judge.acceptedBrokenClaimedDone}.
- Judge calls that failed or returned no usable answer: ${s.judgeErrors} run(s); ${s.judgeForced.noAnswer} forced and ${s.judge.noAnswer} cautious promise(s) without an answer.

**Reading.**

- A cautious judge mostly answers "can't tell": the log alone does not say whether a promise was kept, so someone still has to check the providers.
- A judge forced to decide trusts the log and lets broken promises through.
- The verifier answers from provider state, and says UNKNOWN, with the reason, only when the provider cannot be read.
- In this sample, the verifier's UNKNOWNs come from the read faults the evaluation injects on purpose: timeouts and stale replicas. In the [outcome evaluation](outcome-eval.md), a fresh observation resolves them, and all 512 runs end VERIFIED after repair.

## Limits

- **A sample.** These are ${s.runs} combinations, one judge model, one prompt, and one run per combination.
- **Same faults.** The sandbox and its faults are ours, as in the outcome evaluation.
- **Different inputs, by design.** The judge only has the log. That is the point being measured: a log can say "200 OK" and "Done" while the provider's state says otherwise.
`;
}

async function main() {
  process.env.TCS_VECTOR_STORE ??= "memory";
  const client = new PGlite();
  for (const m of TCS_MIGRATIONS) await client.exec(m.sql);
  const db = drizzle(client, { schema }) as unknown as Db;
  setDbForTesting(db);
  const runs: Run[] = [];
  for (let mask = 0; mask < 1 << ALL_FAULT_KEYS.length; mask += EVERY) {
    runs.push(await runOne(db, mask));
  }
  console.log(`${runs.length} runs executed; judging…`);
  let next = 0;
  let model = "unknown";
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < runs.length) {
        const run = runs[next++]!;
        await judge(run);
        if (run.judgeError) console.log(`  run ${run.mask}: ${run.judgeError}`);
      }
    }),
  );
  try {
    model = (
      await completeText({
        engine: "builder",
        input: "Reply OK",
        maxOutputTokens: 5,
      })
    ).model;
  } catch {
    // keep "unknown"
  }
  const summary = summarize(runs);
  const outDir = path.resolve("docs/eval");
  fs.writeFileSync(
    path.join(outDir, "llm-judge-eval.json"),
    JSON.stringify({ model, every: EVERY, summary, runs }, null, 1),
  );
  fs.writeFileSync(
    path.join(outDir, "llm-judge-eval.md"),
    markdown(summary, model),
  );
  console.log(JSON.stringify(summary, null, 1));
  setDbForTesting(null);
  await client.close();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  // The model client keeps sockets open; the script is done.
  .finally(() => process.exit());
