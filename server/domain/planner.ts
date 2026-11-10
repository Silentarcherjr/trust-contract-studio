/**
 * Goal → obligations.
 *
 * The in-app agent may author obligations itself (draft-contract accepts an
 * explicit list). When it does not — or when no LLM is configured — this
 * deterministic template planner turns the goal into obligations. Either way,
 * every obligation must be a catalog kind with a verifier, and any clause of
 * the goal that maps to no verifiable kind is surfaced, never silently dropped.
 */
import { and, asc, eq } from "drizzle-orm";

import {
  KIND_INFO,
  STORE_LABELS,
  formatCents,
  last,
  type ObligationDraft,
  type StoreName,
} from "../../shared/domain.js";
import type { Db } from "../db/index.js";
import { sbxCharges, sbxCustomers, sbxSubscriptions } from "../db/schema.js";
import { usesRealBilling } from "../sandbox/faults.js";
import { ContractError } from "./errors.js";

export interface PlannedObligation {
  kind: ObligationDraft["kind"];
  title: string;
  params: Record<string, unknown>;
  dependsOn: number[];
}

export interface Plan {
  obligations: PlannedObligation[];
  unmatchedClauses: string[];
  limitations: string[];
  /** The refund amount the request itself states, if any. */
  statedRefundCents: number | null;
}

export interface SubjectContext {
  customerId: string;
  displayName: string;
  /** Stores that hold the subject's personal data in this workspace. */
  personalDataStores: StoreName[];
  subscriptionId: string | null;
  charges: {
    id: string;
    amountCents: number;
    createdAt: string;
    description: string;
  }[];
}

/** The requester is the workspace's first customer (Ada Quinn in demo data). */
export async function loadSubject(
  db: Db,
  owner: string,
): Promise<SubjectContext> {
  const [customer] = await db
    .select()
    .from(sbxCustomers)
    .where(eq(sbxCustomers.ownerEmail, owner))
    .orderBy(asc(sbxCustomers.createdAt))
    .limit(1);
  if (!customer) {
    throw new ContractError(
      "The sandbox is empty. Reset the demo workspace first.",
      "sandbox_empty",
      409,
    );
  }
  const [sub] = await db
    .select()
    .from(sbxSubscriptions)
    .where(
      and(
        eq(sbxSubscriptions.ownerEmail, owner),
        eq(sbxSubscriptions.customerId, customer.id),
      ),
    );
  const charges = await db
    .select()
    .from(sbxCharges)
    .where(
      and(
        eq(sbxCharges.ownerEmail, owner),
        eq(sbxCharges.customerId, customer.id),
      ),
    )
    .orderBy(asc(sbxCharges.createdAt));
  return {
    customerId: customer.id,
    displayName: customer.displayName,
    // With real billing, the customer's profile at Dodo holds personal data too.
    personalDataStores: (await usesRealBilling(db, owner))
      ? ["profile_db", "billing_profile"]
      : ["profile_db"],
    subscriptionId: sub?.id ?? null,
    charges: charges.map((c) => ({
      id: c.id,
      amountCents: c.amountCents,
      createdAt: c.createdAt,
      description: c.description,
    })),
  };
}

const CLAUSE_SPLIT = /\s*(?:,|;|\band then\b|\bthen\b|\band\b|\balso\b)\s*/i;

const PATTERNS = {
  cancel:
    /\b(cancel|terminate|end|stop)\b.*\b(subscription|plan|membership|account)\b|\bunsubscribe\b/i,
  refund: /\b(refund|reimburse|money back|give back|return)\b/i,
  memories: /\b(memor(y|ies)|embedding|derived|inference|profile notes?)\b/i,
  personal:
    /\b(personal|my data|pii|information|details|delete my|erase|forget)\b/i,
};

export function parseAmountCents(text: string): number | null {
  const m = text.match(
    /\$\s?(\d{1,6}(?:[.,]\d{1,2})?)|(\d{1,6}(?:[.,]\d{1,2})?)\s?(?:usd|dollars?)/i,
  );
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? "0").replace(",", ".");
  return Math.round(parseFloat(raw) * 100);
}

export function planFromGoal(goal: string, subject: SubjectContext): Plan {
  const clauses = goal
    .split(CLAUSE_SPLIT)
    .map((c) => c.trim())
    .filter((c) => c.length > 2);
  const wants = {
    cancel: false,
    refund: false,
    personal: false,
    memories: false,
  };
  const unmatched: string[] = [];
  let amount: number | null = null;

  for (const clause of clauses) {
    let matched = false;
    if (PATTERNS.cancel.test(clause)) {
      wants.cancel = true;
      matched = true;
    }
    if (PATTERNS.refund.test(clause)) {
      wants.refund = true;
      matched = true;
      amount = parseAmountCents(clause) ?? amount;
    }
    if (PATTERNS.memories.test(clause)) {
      wants.memories = true;
      matched = true;
    }
    if (PATTERNS.personal.test(clause) && !/^memor/i.test(clause)) {
      wants.personal = true;
      matched = true;
    }
    if (!matched) unmatched.push(clause);
  }
  // "delete my personal data and associated memories" splits on "and";
  // a bare "associated memories" clause still counts as memories.
  const obligations: PlannedObligation[] = [];
  const limitations: string[] = [];
  const indexOf = (kind: PlannedObligation["kind"]) =>
    obligations.findIndex((o) => o.kind === kind);

  if (wants.cancel) {
    if (!subject.subscriptionId) {
      unmatched.push("cancel subscription (no subscription on file)");
    } else {
      obligations.push({
        kind: "cancel_subscription",
        title: `${KIND_INFO.cancel_subscription.label} for ${subject.displayName}`,
        params: {
          customerId: subject.customerId,
          subscriptionId: subject.subscriptionId,
        },
        dependsOn: [],
      });
    }
  }
  if (wants.refund) {
    const latest = last(subject.charges);
    if (!latest) {
      unmatched.push("refund (no charge on file)");
    } else {
      const amountCents = amount ?? latest.amountCents;
      if (amount === null) {
        limitations.push(
          `No refund amount was stated; the planner assumed the latest charge (${formatCents(latest.amountCents)}). Edit it on the canvas if that is wrong.`,
        );
      }
      obligations.push({
        kind: "refund_charge",
        title: `Refund ${formatCents(amountCents)} of “${latest.description}”`,
        params: {
          customerId: subject.customerId,
          chargeId: latest.id,
          amountCents,
        },
        dependsOn:
          indexOf("cancel_subscription") >= 0
            ? [indexOf("cancel_subscription")]
            : [],
      });
    }
  }
  if (wants.personal) {
    const deps = [
      indexOf("refund_charge"),
      indexOf("cancel_subscription"),
    ].filter((i) => i >= 0);
    obligations.push({
      kind: "erase_personal_data",
      title: `Erase ${subject.displayName}'s personal data`,
      params: {
        customerId: subject.customerId,
        stores: subject.personalDataStores,
      },
      dependsOn: deps.slice(0, 1),
    });
  }
  if (wants.memories || wants.personal) {
    const dep = indexOf("erase_personal_data");
    obligations.push({
      kind: "purge_derived_memories",
      title: "Purge memories derived from that data",
      params: {
        customerId: subject.customerId,
        stores: ["memory_store", "vector_index"] satisfies StoreName[],
      },
      dependsOn: dep >= 0 ? [dep] : [],
    });
    limitations.push(
      `${STORE_LABELS.analytics_export} holds a copy derived from this customer but exposes no read interface. Adding it to scope will make the result UNKNOWN, not VERIFIED.`,
    );
  }
  limitations.push(
    "Verification covers only the sandbox providers registered in this workspace. It is not evidence of erasure anywhere else, and not a legal compliance determination.",
  );
  return {
    obligations,
    unmatchedClauses: unmatched,
    limitations,
    statedRefundCents: wants.refund ? amount : null,
  };
}
