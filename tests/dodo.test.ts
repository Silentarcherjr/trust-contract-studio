/**
 * The Dodo test-mode adapter maps provider state into the sandbox's
 * observation types, so the unchanged verifier can judge it. No network:
 * fetch is stubbed with recorded-shape responses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as svc from "../server/domain/service.js";
import { verifyObligation } from "../server/domain/verifier.js";
import {
  observeDodoRefunds,
  observeDodoSubscription,
} from "../server/providers/dodo.js";
import { DEMO_GOAL, approveAllPending, freshDb, human } from "./harness.js";

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

describe("Real billing scenario (Dodo test mode, simulated in memory)", () => {
  const fakeDodo = () => {
    const sub = {
      subscription_id: "sub_real1",
      status: "active",
      cancelled_at: null as string | null,
      customer: { customer_id: "cus_t" },
    };
    const refunds: ReturnType<typeof refund>[] = [];
    const profile = {
      customer_id: "cus_prof1",
      name: "",
      email: "",
      phone_number: null as string | null,
    };
    const pay = () => ({
      payment_id: "pay_real1",
      status: "succeeded",
      total_amount: 20000,
      created_at: "2026-11-09T20:00:00Z",
      subscription_id: sub.subscription_id,
      refunds,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = new URL(url);
        const path = u.pathname;
        const method = init?.method ?? "GET";
        if (method === "POST" && path === "/checkouts")
          return json({ payment_id: "pay_real1" });
        if (method === "GET" && path === "/payments")
          return json({ items: [{ payment_id: "pay_real1" }] });
        if (method === "GET" && path === "/payments/pay_real1")
          return json(pay());
        if (path === "/subscriptions/sub_real1") {
          if (method === "PATCH") {
            sub.status = "cancelled";
            sub.cancelled_at = new Date().toISOString();
          }
          return json(sub);
        }
        // Customer profile, with Dodo's real behaviour: a null phone is ignored.
        if (method === "POST" && path === "/customers") {
          const body = JSON.parse(String(init?.body));
          Object.assign(profile, {
            name: body.name,
            email: body.email,
            phone_number: body.phone_number,
          });
          return json(profile);
        }
        if (path === "/customers/cus_prof1") {
          if (method === "PATCH") {
            const body = JSON.parse(String(init?.body));
            if (body.name) profile.name = body.name;
            if (body.email) profile.email = body.email;
            if (body.phone_number) profile.phone_number = body.phone_number;
          }
          return json(profile);
        }
        if (method === "POST" && path === "/refunds") {
          const body = JSON.parse(String(init?.body));
          const r = refund(`ref_${refunds.length + 1}`, body.items[0].amount);
          refunds.push(r);
          return json({ refund_id: r.refund_id, status: "succeeded" });
        }
        return json({ error: "not found" }, 404);
      }),
    );
    return { profile };
  };

  beforeEach(() => {
    process.env.DODO_TEST_PRODUCT_ID = "pdt_t";
    process.env.DODO_TEST_CUSTOMER_ID = "cus_t";
    process.env.DODO_TEST_PAYMENT_METHOD_ID = "pm_t";
  });
  afterEach(() => {
    delete process.env.DODO_TEST_PRODUCT_ID;
    delete process.env.DODO_TEST_CUSTOMER_ID;
    delete process.env.DODO_TEST_PAYMENT_METHOD_ID;
  });

  it("a retried refund pays twice at the provider; the verifier says FAILED and the repair needs a person", async () => {
    const { profile } = fakeDodo();
    const { db, close } = await freshDb();
    try {
      await svc.resetDemo(db, human(), { scenario: "real_billing" });
      let view = await svc.draftContract(db, human(), { goal: DEMO_GOAL });
      view = await approveAllPending(db, view);
      view = await svc.executeContract(db, human(), {
        contractId: view.contract.id,
      });
      const byKind = Object.fromEntries(
        view.obligations.map((o) => [o.kind, o.verdict]),
      );
      expect(byKind.cancel_subscription).toBe("VERIFIED");
      expect(byKind.refund_charge).toBe("FAILED");
      // The phone was "deleted" with null: Dodo kept it.
      expect(byKind.erase_personal_data).toBe("FAILED");
      const erase = view.verifications.find(
        (v) =>
          v.obligationId ===
          view.obligations.find((o) => o.kind === "erase_personal_data")!.id,
      )!;
      expect(erase.reasons[0]!.message).toMatch(/Phone number at Dodo/);
      expect(byKind.purge_derived_memories).toBe("VERIFIED");

      const { plan } = await svc.proposeRepair(db, human(), {
        contractId: view.contract.id,
      });
      expect(plan.proposals.some((p) => p.kind === "void_refunds")).toBe(false);
      expect(plan.needsHuman[0]!.reason).toMatch(/cannot reverse a refund/);
      // The erasure repair overwrites the phone, and Dodo then shows it gone.
      expect(plan.proposals.map((p) => p.kind)).toContain(
        "erase_personal_data",
      );
      view = await svc.getContractView(db, human().email, view.contract.id);
      view = await approveAllPending(db, view);
      view = await svc.executeContract(db, human(), {
        contractId: view.contract.id,
      });
      const repaired = view.obligations.filter(
        (o) => o.kind === "erase_personal_data",
      );
      expect(repaired[repaired.length - 1]!.verdict).toBe("VERIFIED");
      expect(profile.phone_number).toBe("+14155550000");
    } finally {
      await close();
    }
  }, 30_000);

  it("is refused with a clear message when the server has no Dodo configuration", async () => {
    delete process.env.DODO_TEST_PRODUCT_ID;
    const { db, close } = await freshDb();
    try {
      await expect(
        svc.resetDemo(db, human(), { scenario: "real_billing" }),
      ).rejects.toMatchObject({ code: "real_billing_unavailable" });
    } finally {
      await close();
    }
  });
});
