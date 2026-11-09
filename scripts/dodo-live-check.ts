/**
 * Live provider check: the unchanged pure verifier judges REAL provider
 * state in Dodo Payments TEST MODE.
 *
 *   1. Start a fresh $100/month test subscription (saved test card, no browser).
 *   2. Contract: cancel it, and refund $50 of the first payment.
 *   3. Execute. In the default "lost-response" run, the first refund call's
 *      response is treated as lost (as after a gateway timeout) and the call
 *      is retried. Dodo documents no idempotency key, so the retry creates a
 *      second real refund. The executor reports "Done" for both clauses.
 *   4. Observe Dodo with GETs only, and run verifyObligation() on what Dodo
 *      reports. The agent's claims are never inputs.
 *
 * Usage (test-mode key in DODO_PAYMENTS_API_KEY; ids of a test customer with
 * a saved test card and a recurring test product):
 *   DODO_TEST_PRODUCT_ID=… DODO_TEST_CUSTOMER_ID=… DODO_TEST_PAYMENT_METHOD_ID=… \
 *     pnpm demo:dodo [--clean]
 * Writes docs/eval/dodo-live-run.{json,md}.
 */
import { writeFileSync } from "node:fs";

import { verifyObligation } from "../server/domain/verifier.js";
import {
  dodoEffects,
  observeDodoRefunds,
  observeDodoSubscription,
} from "../server/providers/dodo.js";

const CLEAN = process.argv.includes("--clean");
const need = (name: string) => {
  const v = process.env[name];
  if (!v) {
    console.error(`Set ${name}.`);
    process.exit(2);
  }
  return v;
};
const productId = need("DODO_TEST_PRODUCT_ID");
const customerId = need("DODO_TEST_CUSTOMER_ID");
const paymentMethodId = need("DODO_TEST_PAYMENT_METHOD_ID");
const REFUND_CENTS = 5000;

async function main() {
  const startedAt = new Date().toISOString();
  console.log("1. Starting a fresh test subscription…");
  const { subscriptionId, paymentId } = await dodoEffects.startSubscription({
    productId,
    customerId,
    paymentMethodId,
  });
  console.log(`   ${subscriptionId}, first payment ${paymentId} ($100.00)`);

  const claims: { clause: string; claim: string; calls: string[] }[] = [];

  console.log("2. Executing the contract…");
  await dodoEffects.cancelSubscription(subscriptionId);
  claims.push({
    clause: "cancel_subscription",
    claim: "Done, subscription cancelled.",
    calls: [`PATCH /subscriptions/${subscriptionId} → 200`],
  });

  const refundCalls: string[] = [];
  const first = await dodoEffects.refund({
    paymentId,
    productId,
    amountCents: REFUND_CENTS,
    reason: "Trust Contract Studio demo: promised refund",
  });
  if (CLEAN) {
    refundCalls.push(`POST /refunds → ${first.refund_id}`);
  } else {
    // The response is treated as lost, as if the gateway timed out, and the
    // call is retried. There is no documented idempotency key to send.
    refundCalls.push(
      `POST /refunds → response treated as lost (simulated gateway timeout)`,
    );
    const retry = await dodoEffects.refund({
      paymentId,
      productId,
      amountCents: REFUND_CENTS,
      reason: "Trust Contract Studio demo: retry after a lost response",
    });
    refundCalls.push(`POST /refunds (retry) → ${retry.refund_id}`);
  }
  claims.push({
    clause: "refund_charge",
    claim: "Done, refunded $50.00.",
    calls: refundCalls,
  });

  console.log("3. Observing Dodo (GET only) and verifying…");
  // Refunds can sit in "pending" briefly; observe until final or give up.
  let refunds = await observeDodoRefunds(paymentId);
  for (let i = 0; i < 10 && !refunds.ok; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    refunds = await observeDodoRefunds(paymentId);
  }
  const subscription = await observeDodoSubscription(subscriptionId);

  const results = [
    {
      clause: "cancel_subscription",
      terms: { subscriptionId },
      ...verifyObligation(
        "cancel_subscription",
        { subscriptionId, customerId },
        { subscription },
      ),
    },
    {
      clause: "refund_charge",
      terms: { chargeId: paymentId, amountCents: REFUND_CENTS },
      ...verifyObligation(
        "refund_charge",
        { chargeId: paymentId, amountCents: REFUND_CENTS, customerId },
        { refunds },
      ),
    },
  ];
  for (const r of results) {
    const claim = claims.find((c) => c.clause === r.clause)!.claim;
    console.log(`   ${r.verdict.padEnd(8)} ${r.clause}`);
    console.log(`            executor claimed: "${claim}"`);
    for (const reason of r.reasons)
      console.log(`            verifier: ${reason.message}`);
  }

  const run = {
    provider: "Dodo Payments, test mode (test.dodopayments.com)",
    mode: CLEAN ? "clean" : "lost-response",
    startedAt,
    finishedAt: new Date().toISOString(),
    subscriptionId,
    paymentId,
    claims,
    observations: { subscription, refunds },
    verdicts: results,
  };
  const file = CLEAN ? "dodo-live-run-clean" : "dodo-live-run";
  writeFileSync(`docs/eval/${file}.json`, JSON.stringify(run, null, 2) + "\n");
  console.log(`\nEvidence written to docs/eval/${file}.json`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
