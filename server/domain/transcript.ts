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
    /\b(refunded|reimbursed)\b|\b(issued|processed|sent|made|completed)\b[^.]{0,40}\brefund\b|\brefund\b[^.]{0,40}\b(issued|processed|completed|sent|succeeded|went through)\b/i,
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

/** The customer's turns, when the transcript has roles. */
function customerText(transcript: string): string {
  const kept: string[] = [];
  let inCustomer = false;
  for (const line of transcript.split(/\r?\n/)) {
    if (OTHER_ROLE_LINE.test(line)) inCustomer = true;
    else if (ROLE_LINE.test(line)) inCustomer = false;
    if (inCustomer) kept.push(line.replace(OTHER_ROLE_LINE, ""));
  }
  return kept.join("\n");
}

/** What the customer asked for, by kind, with any refund amount. */
const ASKED: Record<PrimaryKind, RegExp> = {
  cancel_subscription:
    /\b(cancel|unsubscribe|stop my (?:subscription|plan))\b/i,
  refund_charge: /\b(refund|money back|reimburse)\b/i,
  erase_personal_data:
    /\b(delete|erase|remove|wipe)\b[^.]{0,40}\b(data|info(?:rmation)?|details|profile|name|email|phone)\b/i,
  purge_derived_memories: /\bmemor(?:y|ies)\b/i,
};

/** A reply that says only that it is done, with nothing specific. */
const BARE_DONE =
  /^\W*(done|all done|all set|completed|finished|taken care of|that['’]s done|it['’]s done)\W*$/i;

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
  /\b(not|never|no longer|unable|cannot|can['’]t|couldn['’]t|haven['’]t|hasn['’]t|hadn['’]t|didn['’]t|won['’]t|wasn['’]t|weren['’]t|isn['’]t|aren['’]t|don['’]t|doesn['’]t|without|if|once|until|will|i['’]ll|going to|would|should|let me|please|set to|scheduled|at the end of|end of the (?:billing )?period)\b/i;

/**
 * The completion claims in a transcript, one per kind, using the agent's last
 * statement about each (later statements supersede earlier ones).
 */
export function extractClaims(transcript: string): TranscriptClaim[] {
  const said = sentences(agentText(transcript));
  // A bare "Done" claims everything the customer asked for.
  const bare = said.find((s) => BARE_DONE.test(s));
  const asked = customerText(transcript);
  if (bare && asked && said.every((s) => BARE_DONE.test(s)))
    return ORDER.filter((k) => ASKED[k].test(asked)).map((kind) => ({
      kind,
      claim: bare,
      amountCents:
        kind === "refund_charge"
          ? parseAmountCents(asked.slice(asked.search(ASKED[kind])))
          : null,
    }));
  const out: TranscriptClaim[] = [];
  for (const kind of ORDER) {
    let found: { sentence: string; clause: string } | null = null;
    for (const sentence of said)
      for (const raw of clauses(sentence)) {
        // "$200.00" would end a [^.] match early; use a decimal comma.
        const clause = raw.replace(/(\d)\.(\d)/g, "$1,$2");
        if (DONE_PATTERNS[kind].test(clause) && !NOT_A_CLAIM.test(clause))
          found = { sentence, clause };
      }
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

/** Provider ids a transcript names (Dodo formats), if any. */
export function extractReferences(transcript: string) {
  const one = (re: RegExp) => transcript.match(re)?.[0];
  return {
    subscriptionId: one(/\bsub_[A-Za-z0-9]{5,}\b/),
    paymentId: one(/\bpay_[A-Za-z0-9]{5,}\b/),
    customerId: one(/\bcus_[A-Za-z0-9]{5,}\b/),
  };
}
