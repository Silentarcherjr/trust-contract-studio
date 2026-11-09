/**
 * "Verified Done" seal: a compact, read-only projection of a contract view
 * that the agent chat renders next to the agent's own words.
 *
 * For every clause it puts what the executor CLAIMED beside what the
 * independent verifier OBSERVED. Claims are only displayed here; they are
 * never passed to the verifier and never change a verdict. The seal is built
 * from an existing `getContractView` result, so it reads data and writes none.
 */
import type { Db } from "../db/index.js";
import { getContractView, type ContractView } from "../domain/service.js";

export const VERIFIED_DONE_RENDERER = "tcs.verified-done";

export type SealVerdict = "VERIFIED" | "FAILED" | "UNKNOWN";

export interface VerifiedDoneClause {
  /** Clause number as shown in the Studio (§n). */
  n: number;
  title: string;
  kind: string;
  /** The executor's latest claim for this clause, or null if nothing ran. */
  claim: string | null;
  /** True when an attempt reported success ("Done"). Display only. */
  claimedDone: boolean;
  /** Latest verifier verdict, or null when not verified yet / not pursued. */
  verdict: SealVerdict | null;
  /** First reason the verifier gave, or null. */
  reason: string | null;
  /** Observation source(s) behind the latest verdict, if any. */
  source: string | null;
  /** False when a person rejected the clause. */
  pursued: boolean;
}

export interface VerifiedDoneSeal {
  kind: typeof VERIFIED_DONE_RENDERER;
  contractId: string;
  goal: string;
  status: string;
  round: number;
  counts: { verified: number; failed: number; unknown: number; open: number };
  clauses: VerifiedDoneClause[];
  /** App-relative link to the contract workspace. */
  link: string;
}

const MAX_TEXT = 220;

function clip(text: string | null | undefined, max = MAX_TEXT): string | null {
  if (text == null) return null;
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function isVerdict(v: unknown): v is SealVerdict {
  return v === "VERIFIED" || v === "FAILED" || v === "UNKNOWN";
}

/** Pure: project a contract view into the seal payload. */
export function buildVerifiedDoneSeal(view: ContractView): VerifiedDoneSeal {
  const counts = { verified: 0, failed: 0, unknown: 0, open: 0 };
  const clauses = view.obligations.map((o, i): VerifiedDoneClause => {
    const attempts = view.attempts.filter((a) => a.obligationId === o.id);
    const lastAttempt = attempts[attempts.length - 1];
    const claimedDone = attempts.some(
      (a) => a.outcome === "ok" && a.provider !== "studio",
    );
    const pursued = o.approval !== "rejected";
    const verdict = pursued && isVerdict(o.verdict) ? o.verdict : null;
    const ver = view.verifications.filter((v) => v.obligationId === o.id);
    const latest = ver[ver.length - 1];
    const sources = latest
      ? [
          ...new Set(
            view.evidence
              .filter((e) => e.verificationId === latest.id)
              .map((e) => e.source),
          ),
        ]
      : [];
    if (pursued) {
      if (verdict === "VERIFIED") counts.verified++;
      else if (verdict === "FAILED") counts.failed++;
      else if (verdict === "UNKNOWN") counts.unknown++;
      else counts.open++;
    }
    return {
      n: i + 1,
      title: clip(o.title, 120) ?? "",
      kind: o.kind,
      claim: clip(lastAttempt?.claim),
      claimedDone,
      verdict,
      reason: verdict ? clip(o.reasons[0]?.message) : null,
      source: sources.length ? sources.join(", ") : null,
      pursued,
    };
  });
  return {
    kind: VERIFIED_DONE_RENDERER,
    contractId: view.contract.id,
    goal: clip(view.contract.goal, 160) ?? "",
    status: view.contract.status,
    round: view.contract.round,
    counts,
    clauses,
    link: `/studio/${encodeURIComponent(view.contract.id)}`,
  };
}

/** Read the contract (owner-scoped) and build its seal. */
export async function loadVerifiedDoneSeal(
  db: Db,
  owner: string,
  contractId: string,
): Promise<VerifiedDoneSeal> {
  return buildVerifiedDoneSeal(await getContractView(db, owner, contractId));
}

function looksLikeContractView(value: unknown): value is ContractView {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Partial<ContractView>;
  return (
    !!v.contract &&
    typeof v.contract.id === "string" &&
    Array.isArray(v.obligations) &&
    Array.isArray(v.attempts) &&
    Array.isArray(v.verifications) &&
    Array.isArray(v.evidence)
  );
}

/**
 * `chatUI` config shared by the actions that return a contract view. The seal
 * only appears once something has been attempted or verified; drafts and
 * pending approvals stay ordinary tool calls. The action's own result (what
 * the agent and other callers read) is unchanged — only the chat widget gets
 * the compact projection.
 */
export const verifiedDoneChatUI = {
  renderer: VERIFIED_DONE_RENDERER,
  title: "Verified Done",
  description: "What the agent claimed next to what the verifier observed.",
  when: (_args: Record<string, unknown>, result: unknown) =>
    looksLikeContractView(result) &&
    result.obligations.length > 0 &&
    (result.attempts.length > 0 || result.verifications.length > 0),
  projectResult: (_args: Record<string, unknown>, result: unknown) =>
    looksLikeContractView(result) ? buildVerifiedDoneSeal(result) : null,
};
