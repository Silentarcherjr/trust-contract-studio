/**
 * Real-provider evaluation: Dodo Payments in TEST MODE.
 *
 * The outcome evaluation (512 combinations) checks the verifier against faults
 * we inject into our own sandbox. This one checks it against a real billing
 * API. Each run starts a fresh $200/month test subscription, then an executor
 * performs "cancel the subscription and refund $100" with one of six common
 * behaviours, and always reports "Done" for both:
 *
 *   correct              cancel now, refund $100 once
 *   lost_response_retry  the refund's response is lost and the call retried
 *                        (Dodo documents no idempotency key): two refunds
 *   partial_refund       refunds $50 (a unit or rounding mistake)
 *   wrong_charge         refunds $100 on another payment of the customer
 *   cancel_at_period_end schedules the cancel for the end of the period: the
 *                        API answers 200 but the subscription stays active
 *   no_op                the executor claims success without calling anything
 *
 * The verifier (unchanged, pure) judges Dodo through the observation adapter
 * (GET /subscriptions/{id}, GET /payments/{id}). An independent oracle reads
 * different endpoints (GET /refunds and GET /subscriptions list, filtered by
 * customer) and applies the written definition of done.
 *
 * Usage: pnpm eval:dodo [--reps 3]  (needs the Dodo test env vars, see .env.example)
 * Writes docs/eval/dodo-eval.{json,md}.
 */
import fs from "node:fs";
import path from "node:path";

import { verifyObligation } from "../../server/domain/verifier.js";
import {
  dodoEffects,
  listRefundsForCustomer,
  listSubscriptionsForCustomer,
  observeDodoRefunds,
  observeDodoSubscription,
} from "../../server/providers/dodo.js";

const args = process.argv.slice(2);
const REPS = Number(args[args.indexOf("--reps") + 1] || 3) || 3;
const need = (n: string) => {
  const v = process.env[n];
  if (!v) {
    console.error(`Set ${n}.`);
    process.exit(2);
  }
  return v;
};
const cfg = {
  productId: need("DODO_TEST_PRODUCT_ID"),
  customerId: need("DODO_TEST_CUSTOMER_ID"),
  paymentMethodId: need("DODO_TEST_PAYMENT_METHOD_ID"),
};
const PROMISED = 10_000;

const BEHAVIOURS = [
  "correct",
  "lost_response_retry",
  "partial_refund",
  "wrong_charge",
  "cancel_at_period_end",
  "no_op",
] as const;
type Behaviour = (typeof BEHAVIOURS)[number];

interface Clause {
  clause: "cancel_subscription" | "refund_charge";
  claim: string;
  truthKept: boolean;
  verdict: string;
  reason: string;
}

async function waitRefundsSettled(paymentId: string) {
  let obs = await observeDodoRefunds(paymentId);
  for (let i = 0; i < 10 && !obs.ok; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    obs = await observeDodoRefunds(paymentId);
  }
  return obs;
}

async function runOne(behaviour: Behaviour, rep: number) {
  const startedAt = new Date(Date.now() - 2000).toISOString();
  const { subscriptionId, paymentId } =
    await dodoEffects.startSubscription(cfg);
  const refund = (payment: string, cents: number, reason: string) =>
    dodoEffects.refund({
      paymentId: payment,
      productId: cfg.productId,
      amountCents: cents,
      reason,
    });
  const calls: string[] = [];
  let otherSub: string | null = null;

  // --- Executor (one behaviour) ---
  if (behaviour === "cancel_at_period_end") {
    await dodoEffects.scheduleCancelAtPeriodEnd(subscriptionId);
    calls.push(
      "PATCH /subscriptions/{id} cancel_at_next_billing_date=true → 200",
    );
  } else if (behaviour !== "no_op") {
    await dodoEffects.cancelSubscription(subscriptionId);
    calls.push("PATCH /subscriptions/{id} status=cancelled → 200");
  }
  if (behaviour === "correct" || behaviour === "cancel_at_period_end") {
    await refund(paymentId, PROMISED, "TCS eval: promised refund");
    calls.push("POST /refunds $100 → 200");
  } else if (behaviour === "lost_response_retry") {
    await refund(paymentId, PROMISED, "TCS eval: promised refund");
    await refund(paymentId, PROMISED, "TCS eval: retry after lost response");
    calls.push(
      "POST /refunds $100 → response lost",
      "POST /refunds $100 (retry) → 200",
    );
  } else if (behaviour === "partial_refund") {
    await refund(paymentId, PROMISED / 2, "TCS eval: partial refund");
    calls.push("POST /refunds $50 → 200");
  } else if (behaviour === "wrong_charge") {
    const other = await dodoEffects.startSubscription(cfg);
    otherSub = other.subscriptionId;
    await refund(
      other.paymentId,
      PROMISED,
      "TCS eval: refund on the wrong charge",
    );
    calls.push("POST /refunds $100 on another payment → 200");
  }
  const claims = {
    cancel_subscription: "Done — subscription cancelled.",
    refund_charge: "Done — refunded $100.00.",
  };

  // --- Verifier: the app's observation adapter + the pure verifier ---
  const refundsObs = await waitRefundsSettled(paymentId);
  const subObs = await observeDodoSubscription(subscriptionId);
  const vCancel = verifyObligation(
    "cancel_subscription",
    { subscriptionId, customerId: cfg.customerId },
    { subscription: subObs },
  );
  const vRefund = verifyObligation(
    "refund_charge",
    { chargeId: paymentId, amountCents: PROMISED, customerId: cfg.customerId },
    { refunds: refundsObs },
  );

  // --- Oracle: different endpoints, written definition of done ---
  const allRefunds = await listRefundsForCustomer(cfg.customerId, startedAt);
  const refunded = allRefunds
    .filter((r) => r.payment_id === paymentId && r.status === "succeeded")
    .reduce((s, r) => s + r.amount, 0);
  const subs = await listSubscriptionsForCustomer(cfg.customerId);
  const sub = subs.find((s) => s.subscription_id === subscriptionId);
  const truthCancel = sub?.status === "cancelled";
  const truthRefund = refunded === PROMISED;

  // Leave nothing renewing in the test account.
  for (const id of [subscriptionId, otherSub]) {
    if (id) await dodoEffects.cancelSubscription(id).catch(() => undefined);
  }

  const clauses: Clause[] = [
    {
      clause: "cancel_subscription",
      claim: claims.cancel_subscription,
      truthKept: truthCancel,
      verdict: vCancel.verdict,
      reason: vCancel.reasons[0]?.message ?? "",
    },
    {
      clause: "refund_charge",
      claim: claims.refund_charge,
      truthKept: truthRefund,
      verdict: vRefund.verdict,
      reason: vRefund.reasons[0]?.message ?? "",
    },
  ];
  console.log(
    `${behaviour.padEnd(21)} #${rep}  cancel ${vCancel.verdict.padEnd(8)} (truth ${truthCancel ? "kept" : "broken"})  refund ${vRefund.verdict.padEnd(8)} (truth ${truthRefund ? "kept" : "broken"})`,
  );
  return { behaviour, rep, subscriptionId, paymentId, calls, clauses };
}

async function main() {
  const started = new Date().toISOString();
  const runs: Awaited<ReturnType<typeof runOne>>[] = [];
  for (const b of BEHAVIOURS)
    for (let r = 1; r <= REPS; r++) runs.push(await runOne(b, r));
  const clauses = runs.flatMap((r) => r.clauses);
  const broken = clauses.filter((c) => !c.truthKept);
  const kept = clauses.filter((c) => c.truthKept);
  const summary = {
    runs: runs.length,
    clauses: clauses.length,
    broken: broken.length,
    kept: kept.length,
    agentSaidDoneOnBroken: broken.length,
    falseVerified: broken.filter((c) => c.verdict === "VERIFIED").length,
    caught: broken.filter((c) => c.verdict === "FAILED").length,
    unknownOnBroken: broken.filter((c) => c.verdict === "UNKNOWN").length,
    falseFailed: kept.filter((c) => c.verdict === "FAILED").length,
    verifiedKept: kept.filter((c) => c.verdict === "VERIFIED").length,
    unknownOnKept: kept.filter((c) => c.verdict === "UNKNOWN").length,
  };
  const per = BEHAVIOURS.map((b) => {
    const rs = runs.filter((r) => r.behaviour === b);
    const v = (k: Clause["clause"]) =>
      [
        ...new Set(
          rs.map((r) => r.clauses.find((c) => c.clause === k)!.verdict),
        ),
      ].join("/");
    const t = (k: Clause["clause"]) =>
      [
        ...new Set(
          rs.map((r) =>
            r.clauses.find((c) => c.clause === k)!.truthKept
              ? "kept"
              : "broken",
          ),
        ),
      ].join("/");
    const reason =
      rs[0]!.clauses.find((c) => c.verdict !== "VERIFIED")?.reason ?? "—";
    return `| \`${b}\` | ${rs.length} | ${t("cancel_subscription")} → **${v("cancel_subscription")}** | ${t("refund_charge")} → **${v("refund_charge")}** | ${reason} |`;
  });
  const md = `# Real-provider evaluation: Dodo Payments (test mode)

Generated by \`pnpm eval:dodo\` (\`scripts/eval/dodo-eval.ts\`) on ${started.slice(0, 10)}. Raw runs, with real Dodo ids, are in [\`dodo-eval.json\`](dodo-eval.json).

**Why this exists.** The [outcome evaluation](outcome-eval.md) checks the verifier against faults we inject into our own sandbox. This one checks it against a real billing API, Dodo Payments in test mode (real API, simulated money).

**Setup.**

- Each run starts a fresh $200/month test subscription.
- An executor then performs *"cancel the subscription and refund $100"* with one of six behaviours, and always reports "Done" for both.
- **The verifier** is the app's, unchanged. It reads Dodo through the observation adapter (\`GET /subscriptions/{id}\`, \`GET /payments/{id}\`).
- **The oracle** is independent. It reads **different endpoints** (\`GET /refunds\` and \`GET /subscriptions\` lists filtered by customer) and applies the written definition of done:
  - a cancelled subscription;
  - succeeded refunds on the promised payment that sum to exactly $100.

## Results (${summary.runs} runs, ${summary.clauses} promises, ${summary.broken} broken; the executor said "Done" on all of them)

| | Count |
| --- | --- |
| Broken promises the verifier accepted (false VERIFIED) | **${summary.falseVerified} of ${summary.broken}** |
| Broken promises caught (FAILED) | ${summary.caught} |
| Broken promises left UNKNOWN | ${summary.unknownOnBroken} |
| Kept promises flagged as broken (false FAILED) | **${summary.falseFailed} of ${summary.kept}** |
| Kept promises VERIFIED | ${summary.verifiedKept} |

| Executor behaviour | Runs | Cancel: truth → verdict | Refund: truth → verdict | Verifier's reason (first run) |
| --- | --- | --- | --- | --- |
${per.join("\n")}

## Limits

- **Billing only.** This covers Dodo test mode and billing only. Erasure and memory clauses are not covered.
- **Our own executor.** The six behaviours are written by us to reproduce common mistakes, but every outcome is real state at the provider.
- **Few runs.** There are ${REPS} repetitions per behaviour.
`;
  const out = path.resolve("docs/eval");
  fs.writeFileSync(
    path.join(out, "dodo-eval.json"),
    JSON.stringify({ started, summary, runs }, null, 1) + "\n",
  );
  fs.writeFileSync(path.join(out, "dodo-eval.md"), md);
  console.log(JSON.stringify(summary, null, 1));
  if (summary.falseVerified + summary.falseFailed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 100));
