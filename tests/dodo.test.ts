/**
 * The Dodo test-mode adapter maps provider state into the sandbox's
 * observation types, so the unchanged verifier can judge it. No network:
 * fetch is stubbed with recorded-shape responses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyObligation } from "../server/domain/verifier.js";
import {
  observeDodoRefunds,
  observeDodoSubscription,
} from "../server/providers/dodo.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function stub(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname + new URL(url).search;
      const hit = Object.entries(routes).find(([p]) => path.startsWith(p));
      return hit ? json(hit[1]) : json({ error: "not found" }, 404);
    }),
  );
}

const refund = (id: string, amount: number, status = "succeeded") => ({
  refund_id: id,
  amount,
  status,
  created_at: `2026-11-09T19:34:3${id.slice(-1)}Z`,
});
const payment = (refunds: unknown[]) => ({
  payment_id: "pay_1",
  status: "succeeded",
  total_amount: 10000,
  created_at: "2026-11-09T19:34:00Z",
  subscription_id: "sub_1",
  refunds,
});

beforeEach(() => {
  process.env.DODO_PAYMENTS_API_KEY = "dodo_test_placeholder";
});
afterEach(() => vi.unstubAllGlobals());

describe("Dodo test-mode adapter", () => {
  it("refuses a live-mode key", async () => {
    process.env.DODO_PAYMENTS_API_KEY = "dodo_live_x";
    stub({});
    const obs = await observeDodoRefunds("pay_1");
    expect(obs.ok).toBe(false);
  });

  it("a duplicate refund at the provider is FAILED over_refunded", async () => {
    stub({
      "/payments/pay_1": payment([refund("r1", 5000), refund("r2", 5000)]),
    });
    const refunds = await observeDodoRefunds("pay_1");
    const v = verifyObligation(
      "refund_charge",
      { chargeId: "pay_1", amountCents: 5000, customerId: "c" },
      { refunds },
    );
    expect(v.verdict).toBe("FAILED");
    expect(v.reasons[0]!.code).toBe("over_refunded");
  });

  it("failed refunds are not money returned, and a pending one is UNKNOWN", async () => {
    stub({
      "/payments/pay_1": payment([
        refund("r1", 5000),
        refund("r2", 5000, "failed"),
      ]),
    });
    let refunds = await observeDodoRefunds("pay_1");
    expect(
      verifyObligation(
        "refund_charge",
        { chargeId: "pay_1", amountCents: 5000, customerId: "c" },
        { refunds },
      ).verdict,
    ).toBe("VERIFIED");

    stub({ "/payments/pay_1": payment([refund("r1", 5000, "pending")]) });
    refunds = await observeDodoRefunds("pay_1");
    expect(
      verifyObligation(
        "refund_charge",
        { chargeId: "pay_1", amountCents: 5000, customerId: "c" },
        { refunds },
      ).verdict,
    ).toBe("UNKNOWN");
  });

  it('maps Dodo\'s "cancelled" to a VERIFIED cancellation', async () => {
    stub({
      "/subscriptions/sub_1": {
        subscription_id: "sub_1",
        status: "cancelled",
        cancelled_at: "2026-11-09T19:34:35Z",
        customer: { customer_id: "cus_1" },
      },
      "/payments?subscription_id=sub_1": { items: [{ payment_id: "pay_1" }] },
      "/payments/pay_1": payment([]),
    });
    const subscription = await observeDodoSubscription("sub_1");
    const v = verifyObligation(
      "cancel_subscription",
      { subscriptionId: "sub_1", customerId: "c" },
      { subscription },
    );
    expect(v.verdict).toBe("VERIFIED");
  });

  it("an active subscription is FAILED still_active", async () => {
    stub({
      "/subscriptions/sub_1": {
        subscription_id: "sub_1",
        status: "active",
        cancelled_at: null,
        customer: { customer_id: "cus_1" },
      },
    });
    const subscription = await observeDodoSubscription("sub_1");
    const v = verifyObligation(
      "cancel_subscription",
      { subscriptionId: "sub_1", customerId: "c" },
      { subscription },
    );
    expect(v.verdict).toBe("FAILED");
    expect(v.reasons[0]!.code).toBe("still_active");
  });
});
