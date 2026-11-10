/**
 * Turns an agent transcript into the promises it says it kept.
 *
 * Deterministic and model-free: it looks for completion statements ("Done:
 * cancelled, refunded $100, your data deleted") and maps each to an
 * obligation kind the verifier can check. The claim text is kept only for
 * display next to the verdict; it never reaches the verifier.
 */
import type { PrimaryKind } from "../../shared/domain.js";
import { parseAmountCents } from "./planner.js";

export interface TranscriptClaim {
  kind: PrimaryKind;
  /** The agent's own sentence, trimmed. */
  claim: string;
  /** Only for refunds: the amount the agent says it refunded. */
  amountCents: number | null;
}

const ROLE_LINE = /^\s*\[?(agent|assistant|bot|support|ai)\]?\s*[:>-]/i;
const OTHER_ROLE_LINE = /^\s*\[?(customer|user|human|client)\]?\s*[:>-]/i;

const DONE_PATTERNS: Record<PrimaryKind, RegExp> = {
  cancel_subscription:
    /\b(cancel(?:l?ed)?|terminated|ended|stopped)\b[^.]{0,60}\b(subscription|plan|membership)\b|\b(subscription|plan|membership)\b[^.]{0,60}\b(cancel(?:l?ed)?|terminated|ended|stopped)\b|\bunsubscribed\b/i,
  refund_charge:
    /\b(refunded|reimbursed)\b|\b(issued|processed|sent|made|completed)\b[^.]{0,40}\brefund\b|\brefund\b[^.]{0,40}\b(has been|have been|was|is)\s+(issued|processed|completed|sent|made)\b/i,
  purge_derived_memories:
    /\b(memor(?:y|ies)|embeddings?)\b[^.]{0,60}\b(deleted|erased|removed|purged|wiped|gone|forgotten)\b|\b(deleted|erased|removed|purged|wiped|forgot)\b[^.]{0,60}\b(memor(?:y|ies)|embeddings?)\b/i,
  erase_personal_data:
    /\b(personal data|personal information|your data|your details|pii|your profile)\b[^.]{0,60}\b(deleted|erased|removed|purged|wiped|gone)\b|\b(deleted|erased|removed|purged|wiped)\b[^.]{0,60}\b(personal data|personal information|your data|your details|pii|your profile)\b/i,
};

/** Order the verifier's dependency chain expects. */
const ORDER: PrimaryKind[] = [
  "cancel_subscription",
  "refund_charge",
  "erase_personal_data",
  "purge_derived_memories",
];

function agentText(transcript: string): string {
  const lines = transcript.split(/\r?\n/);
  const hasRoles = lines.some((l) => ROLE_LINE.test(l));
  if (!hasRoles) return transcript;
  // Keep agent turns (and their continuation lines); drop the customer's.
  const kept: string[] = [];
  let inAgent = false;
  for (const line of lines) {
    if (ROLE_LINE.test(line)) inAgent = true;
    else if (OTHER_ROLE_LINE.test(line)) inAgent = false;
    if (inAgent) kept.push(line.replace(ROLE_LINE, ""));
  }
  return kept.join("\n");
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

/**
 * A sentence is cut into clauses, so "I cancelled your plan, but I couldn't
 * issue the refund" claims the cancellation and not the refund.
 */
function clauses(sentence: string): string[] {
  return sentence
    .split(
      /\s*(?:[,;:—–]|\s-\s|\bbut\b|\bso\b|\bhowever\b|\balthough\b|\bthough\b)\s*/i,
    )
    .map((c) => c.trim())
    .filter((c) => c.length > 2);
}

/** Negated or hedged clauses are not completion claims. */
const NOT_A_CLAIM =
  /\b(not|never|no longer|unable|cannot|can['’]t|couldn['’]t|haven['’]t|hasn['’]t|hadn['’]t|didn['’]t|won['’]t|wasn['’]t|weren['’]t|isn['’]t|aren['’]t|don['’]t|doesn['’]t|without|if|once|until|will|i['’]ll|going to|would|should|let me|please)\b/i;

/**
 * The completion claims in a transcript, one per kind, using the agent's last
 * statement about each (later statements supersede earlier ones).
 */
export function extractClaims(transcript: string): TranscriptClaim[] {
  const said = sentences(agentText(transcript));
  const out: TranscriptClaim[] = [];
  for (const kind of ORDER) {
    let found: { sentence: string; clause: string } | null = null;
    for (const sentence of said)
      for (const clause of clauses(sentence))
        if (DONE_PATTERNS[kind].test(clause) && !NOT_A_CLAIM.test(clause))
          found = { sentence, clause };
    if (!found) continue;
    const { sentence, clause } = found;
    out.push({
      kind,
      claim: sentence.length > 240 ? `${sentence.slice(0, 237)}…` : sentence,
      amountCents: kind === "refund_charge" ? parseAmountCents(clause) : null,
    });
  }
  return out;
}
