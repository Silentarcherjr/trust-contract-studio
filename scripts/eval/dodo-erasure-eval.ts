/**
 * Real-provider evaluation of erasure: the customer's profile at Dodo
 * Payments (test mode).
 *
 * Each run creates a fresh test customer holding synthetic personal data
 * (name, email, phone), then an executor performs "delete my personal data"
 * with one of four behaviours and always reports "Done":
 *
 *   correct      overwrites name, email and phone
 *   null_phone   overwrites name and email, "deletes" the phone with null
 *                (Dodo answers 200 and keeps the number)
 *   name_only    overwrites the name only
 *   no_op        claims success without calling anything
 *
 * The verifier (unchanged, pure) judges through the observation adapter
 * (GET /customers/{id}: are the fields overwritten?). An independent oracle
 * reads the customers list endpoint and applies the written definition of
 * done: none of the original values is still on the customer.
 *
 * Usage: pnpm eval:dodo-erasure [--reps 3]
 * Writes docs/eval/dodo-erasure-eval.{json,md}.
 */
import fs from "node:fs";
import path from "node:path";

import { verifyObligation } from "../../server/domain/verifier.js";
import {
  dodoProfileEffects,
  findCustomerInList,
  observeDodoProfile,
} from "../../server/providers/dodo.js";
import type {
  Observation,
  MemoryObservation,
} from "../../server/sandbox/observe.js";

const args = process.argv.slice(2);
const REPS = Number(args[args.indexOf("--reps") + 1] || 3) || 3;
const BEHAVIOURS = ["correct", "null_phone", "name_only", "no_op"] as const;
type Behaviour = (typeof BEHAVIOURS)[number];

/** The adapter's answer, in the verifier's observation shape. */
async function observe(
  customerId: string,
): Promise<Observation<MemoryObservation>> {
  const p = await observeDodoProfile(customerId);
  const observedAt = new Date().toISOString();
  if (!p.ok)
    return {
      source: p.source,
      ok: false,
      observedAt,
      error: "timeout",
      detail: p.detail,
    };
  return {
    source: p.source,
    ok: true,
    observedAt,
    data: {
      stale: false,
      replicaLagMs: 0,
      observableStores: ["billing_profile"],
      vectorEngine: "n/a",
      nearDuplicates: [],
      records: p.fields.map((f) => ({
        id: `dodo:${customerId}:${f.field}`,
        store: "billing_profile" as const,
        kind: "pii",
        label: f.label,
        derivedFrom: [],
        deleted: !f.live,
        containsSubjectIdentifier: false,
      })),
    },
  };
}

async function runOne(behaviour: Behaviour, rep: number) {
  const customerId = await dodoProfileEffects.create();
  const before = await findCustomerInList(customerId);
  if (!before)
    throw new Error(`Customer ${customerId} not in the list endpoint.`);
  const original = {
    name: before.name,
    email: before.email,
    phone: before.phone_number,
  };
  const calls: string[] = [];
  if (behaviour === "correct") {
    await dodoProfileEffects.erase(customerId);
    calls.push("PATCH /customers/{id} name, email, phone overwritten → 200");
  } else if (behaviour === "null_phone") {
    await dodoProfileEffects.erase(customerId, { naive: true });
    calls.push(
      "PATCH /customers/{id} name, email overwritten, phone_number=null → 200",
    );
  } else if (behaviour === "name_only") {
    await dodoProfileEffects.eraseNameOnly(customerId);
    calls.push("PATCH /customers/{id} name overwritten → 200");
  }
  const claim = "Done — your personal data has been deleted.";

  const v = verifyObligation(
    "erase_personal_data",
    { customerId, stores: ["billing_profile"] },
    { memories: await observe(customerId) },
  );

  const after = await findCustomerInList(customerId);
  const left = after
    ? [
        after.name === original.name && "name",
        after.email === original.email && "email",
        after.phone_number === original.phone && "phone",
      ].filter(Boolean)
    : [];
  const truthKept = after !== null && left.length === 0;

  console.log(
    `${behaviour.padEnd(11)} #${rep}  verdict ${v.verdict.padEnd(8)} truth ${truthKept ? "kept" : `broken (${left.join(", ")} still there)`}`,
  );
  return {
    behaviour,
    rep,
    customerId,
    calls,
    claim,
    truthKept,
    stillThere: left,
    verdict: v.verdict,
    reason: v.reasons[0]?.message ?? "",
  };
}

async function main() {
  const started = new Date().toISOString();
  const runs: Awaited<ReturnType<typeof runOne>>[] = [];
  for (const b of BEHAVIOURS)
    for (let r = 1; r <= REPS; r++) runs.push(await runOne(b, r));
  const broken = runs.filter((r) => !r.truthKept);
  const kept = runs.filter((r) => r.truthKept);
  const summary = {
    runs: runs.length,
    broken: broken.length,
    kept: kept.length,
    falseVerified: broken.filter((r) => r.verdict === "VERIFIED").length,
    caught: broken.filter((r) => r.verdict === "FAILED").length,
    unknownOnBroken: broken.filter((r) => r.verdict === "UNKNOWN").length,
    falseFailed: kept.filter((r) => r.verdict === "FAILED").length,
    verifiedKept: kept.filter((r) => r.verdict === "VERIFIED").length,
  };
  const per = BEHAVIOURS.map((b) => {
    const rs = runs.filter((r) => r.behaviour === b);
    const uniq = (xs: string[]) => [...new Set(xs)].join("/");
    return `| \`${b}\` | ${rs.length} | ${uniq(rs.map((r) => (r.truthKept ? "kept" : "broken")))} | **${uniq(rs.map((r) => r.verdict))}** | ${rs[0]!.reason} |`;
  });
  const md = `# Real-provider evaluation: erasure at Dodo Payments (test mode)

Generated by \`pnpm eval:dodo-erasure\` (\`scripts/eval/dodo-erasure-eval.ts\`) on ${started.slice(0, 10)}. Raw runs, with the test customer ids, are in [\`dodo-erasure-eval.json\`](dodo-erasure-eval.json).

**Setup.**

- Each run creates a fresh test customer at Dodo with synthetic personal data (name, email, phone), tagged with the app.
- An executor performs *"delete my personal data"* with one of four behaviours, and always reports "Done".
- **The verifier** is the app's, unchanged. It reads \`GET /customers/{id}\` through the observation adapter, which asks whether each field has been overwritten.
- **The oracle** is independent. It reads the **customers list endpoint** and applies the written definition of done: none of the original values is still on the customer.

**What Dodo does.** Dodo has no way to clear a phone number: \`phone_number: null\` is answered 200 and ignored, and \`""\` is rejected. Erasure therefore means overwriting.

## Results (${summary.runs} runs, ${summary.broken} broken; the executor said "Done" on all of them)

| | Count |
| --- | --- |
| Broken erasures the verifier accepted (false VERIFIED) | **${summary.falseVerified} of ${summary.broken}** |
| Broken erasures caught (FAILED) | ${summary.caught} |
| Broken erasures left UNKNOWN | ${summary.unknownOnBroken} |
| Real erasures flagged as broken (false FAILED) | **${summary.falseFailed} of ${summary.kept}** |
| Real erasures VERIFIED | ${summary.verifiedKept} |

| Executor behaviour | Runs | Truth | Verdict | Verifier's reason (first run) |
| --- | --- | --- | --- | --- |
${per.join("\n")}

## Limits

- **Our own executor.** The four behaviours are ours, written to reproduce common mistakes. Every outcome is real state at Dodo.
- **One store.** This covers the customer's profile at Dodo. Memories and the vector index are covered by the [outcome evaluation](outcome-eval.md).
- **Few runs.** There are ${REPS} repetitions per behaviour.
`;
  const out = path.resolve("docs/eval");
  fs.writeFileSync(
    path.join(out, "dodo-erasure-eval.json"),
    JSON.stringify({ started, summary, runs }, null, 1) + "\n",
  );
  fs.writeFileSync(path.join(out, "dodo-erasure-eval.md"), md);
  console.log(JSON.stringify(summary, null, 1));
  if (summary.falseVerified + summary.falseFailed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 100));
