/**
 * Integrity primitives.
 *
 * Honest scope: SHA-256 digests make tampering with stored evidence
 * detectable when it is re-checked; HMAC signatures let this server confirm a
 * receipt it issued has not been edited. Neither is a public-key signature,
 * a timestamping service, or proof of immutability.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortDeep(v);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Non-finite numbers cannot be canonicalized");
  }
  return value;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function digestOf(value: unknown): string {
  return sha256(canonicalJson(value));
}

let devKey: string | null = null;

/**
 * Receipt signing key. Production must set RECEIPT_SIGNING_KEY; local dev
 * falls back to a per-process random key (receipts then only verify until
 * restart, which the receipt's limitations section states).
 */
export function receiptKey(): { key: string; ephemeral: boolean } {
  const configured = process.env.RECEIPT_SIGNING_KEY;
  if (configured && configured.length >= 32) {
    return { key: configured, ephemeral: false };
  }
  devKey ??= randomBytes(32).toString("hex");
  return { key: devKey, ephemeral: true };
}

export function hmac(text: string, key: string): string {
  return createHmac("sha256", key).update(text, "utf8").digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
