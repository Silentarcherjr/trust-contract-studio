/**
 * Dodo Payments (TEST MODE ONLY) as a real billing provider.
 *
 * Two parts, kept apart on purpose:
 * - Effects (`dodoEffects`): what an executor does, such as cancel a
 *   subscription or create a refund.
 * - Observations (`observeDodo*`): read-only GETs that return the same
 *   Observation types as the sandbox (server/sandbox/observe.ts), so the
 *   unchanged pure verifier can judge real provider state.
 *
 * The key comes from DODO_PAYMENTS_API_KEY and must be a test-mode key: the
 * base URL is fixed to test.dodopayments.com, and nothing here can reach
 * live mode. No personal data is returned: ids, amounts, statuses, times.
 */
import type {
  Observation,
  RefundObservation,
  SubscriptionObservation,
} from "../sandbox/observe.js";

export const DODO_TEST_BASE = "https://test.dodopayments.com";

function key() {
  const k = process.env.DODO_PAYMENTS_API_KEY;
  if (!k) throw new Error("Set DODO_PAYMENTS_API_KEY to a Dodo test-mode key.");
  if (k.startsWith("dodo_live_"))
    throw new Error(
      "Refusing a live-mode key: this adapter is test mode only.",
    );
  return k;
}

async function call<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${DODO_TEST_BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key()}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : null,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new DodoError(res.status, `${method} ${path}: ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export class DodoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// --- Provider shapes (only the fields we read) ------------------------------

interface DodoSubscription {
  subscription_id: string;
  status: string;
  cancelled_at: string | null;
  customer: { customer_id: string };
  metadata?: Record<string, string>;
}

interface DodoRefundItem {
  refund_id: string;
  amount: number | null;
  status: "succeeded" | "failed" | "pending" | "review";
  created_at: string;
}

interface DodoPayment {
  payment_id: string;
  status: string;
  total_amount: number;
  created_at: string;
  subscription_id: string | null;
  refunds: DodoRefundItem[];
}

// --- Effects (executor side) --------------------------------------------------

export const dodoEffects = {
  /** New subscription paid with a saved test card, without a browser. */
  async startSubscription(input: {
    productId: string;
    customerId: string;
    paymentMethodId: string;
  }) {
    const out = await call<{ payment_id: string }>("POST", "/checkouts", {
      product_cart: [{ product_id: input.productId, quantity: 1 }],
      customer: { customer_id: input.customerId },
      billing_address: {
        country: "US",
        state: "CA",
        city: "San Francisco",
        street: "1 Demo St",
        zipcode: "94105",
      },
      payment_method_id: input.paymentMethodId,
      confirm: true,
      metadata: { app: "trust-contract-studio" },
    });
    // The payment settles asynchronously; wait until it is final.
    for (let i = 0; i < 20; i++) {
      const p = await call<DodoPayment>("GET", `/payments/${out.payment_id}`);
      if (p.status === "succeeded" && p.subscription_id)
        return { paymentId: p.payment_id, subscriptionId: p.subscription_id };
      if (p.status === "failed" || p.status === "cancelled")
        throw new Error(`Test payment ${p.payment_id} ended "${p.status}".`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(`Test payment ${out.payment_id} did not settle in time.`);
  },

  cancelSubscription(subscriptionId: string) {
    return call<DodoSubscription>("PATCH", `/subscriptions/${subscriptionId}`, {
      status: "cancelled",
      cancel_reason: "cancelled_by_merchant",
    });
  },

  /** Partial refund of one product line. Dodo documents no idempotency key. */
  refund(input: {
    paymentId: string;
    productId: string;
    amountCents: number;
    reason: string;
  }) {
    return call<{ refund_id: string; status: string }>("POST", "/refunds", {
      payment_id: input.paymentId,
      reason: input.reason,
      currency: "USD",
      items: [
        {
          item_id: input.productId,
          amount: input.amountCents,
          tax_inclusive: true,
        },
      ],
      metadata: { app: "trust-contract-studio" },
    });
  },
};

// --- Observations (verifier side; GETs only) ----------------------------------

const now = () => new Date().toISOString();

/** Same shape as the sandbox's observeSubscription. */
export async function observeDodoSubscription(
  subscriptionId: string,
): Promise<Observation<SubscriptionObservation>> {
  const source = "dodo.subscriptions.get (test mode)";
  try {
    const sub = await call<DodoSubscription>(
      "GET",
      `/subscriptions/${subscriptionId}`,
    );
    let chargesAfterCancel: SubscriptionObservation["chargesAfterCancel"] = [];
    if (sub.cancelled_at) {
      const list = await call<{ items: { payment_id: string }[] }>(
        "GET",
        `/payments?subscription_id=${encodeURIComponent(subscriptionId)}&page_size=100`,
      );
      for (const item of list.items) {
        const p = await call<DodoPayment>(
          "GET",
          `/payments/${item.payment_id}`,
        );
        if (p.status !== "succeeded" || p.created_at <= sub.cancelled_at)
          continue;
        chargesAfterCancel.push({
          id: p.payment_id,
          amountCents: p.total_amount,
          createdAt: p.created_at,
          refundedCents: p.refunds
            .filter((r) => r.status === "succeeded")
            .reduce((s, r) => s + (r.amount ?? 0), 0),
        });
      }
    }
    return {
      source,
      ok: true,
      observedAt: now(),
      data: {
        subscription: {
          id: sub.subscription_id,
          // The verifier's vocabulary is the sandbox's: "canceled".
          status: sub.status === "cancelled" ? "canceled" : sub.status,
          canceledAt: sub.cancelled_at,
        },
        chargesAfterCancel,
      },
    };
  } catch (err) {
    if (err instanceof DodoError && err.status === 404)
      return {
        source,
        ok: true,
        observedAt: now(),
        data: { subscription: null, chargesAfterCancel: [] },
      };
    return {
      source,
      ok: false,
      observedAt: now(),
      error: "timeout",
      detail: `Dodo read failed: ${(err as Error).message.slice(0, 160)}`,
    };
  }
}

/**
 * Same shape as the sandbox's observeRefunds. Only succeeded refunds count
 * as money returned. A refund still pending or in review makes the
 * observation unusable, so the verifier answers UNKNOWN instead of guessing.
 */
export async function observeDodoRefunds(
  paymentId: string,
): Promise<Observation<RefundObservation>> {
  const source = "dodo.payments.get (test mode)";
  try {
    const p = await call<DodoPayment>("GET", `/payments/${paymentId}`);
    const open = p.refunds.filter(
      (r) => r.status === "pending" || r.status === "review",
    );
    if (open.length) {
      return {
        source,
        ok: false,
        observedAt: now(),
        error: "unobservable",
        detail: `${open.length} refund(s) still ${open.map((r) => r.status).join("/")} at Dodo`,
      };
    }
    return {
      source,
      ok: true,
      observedAt: now(),
      data: {
        charge: { id: p.payment_id, amountCents: p.total_amount },
        refunds: p.refunds
          .filter((r) => r.status === "succeeded")
          .map((r) => ({
            id: r.refund_id,
            amountCents: r.amount ?? 0,
            status: r.status,
            createdAt: r.created_at,
          }))
          .sort(
            (a, b) =>
              a.createdAt.localeCompare(b.createdAt) ||
              a.id.localeCompare(b.id),
          ),
      },
    };
  } catch (err) {
    if (err instanceof DodoError && err.status === 404)
      return {
        source,
        ok: true,
        observedAt: now(),
        data: { charge: null, refunds: [] },
      };
    return {
      source,
      ok: false,
      observedAt: now(),
      error: "timeout",
      detail: `Dodo read failed: ${(err as Error).message.slice(0, 160)}`,
    };
  }
}
