import {
  KIND_INFO,
  STORE_LABELS,
  formatCents,
  type ObligationKind,
  type StoreName,
} from "@shared/domain";

export function clock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function relativeSeconds(fromIso: string, toIso: string): string {
  const s = Math.max(0, (Date.parse(toIso) - Date.parse(fromIso)) / 1000);
  return s < 60 ? `+${s.toFixed(1)}s` : `+${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

export function shortId(id: string | null | undefined, n = 6): string {
  if (!id) return "—";
  const [prefix, rest] = id.split("_");
  return rest ? `${prefix}_${rest.slice(0, n)}` : id.slice(0, n + 4);
}

export function shortHash(h: string, n = 10): string {
  return `${h.slice(0, n)}…`;
}

/** Human-readable description of an obligation's parameters. */
export function describeParams(kind: ObligationKind, params: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const stores = (params.stores as StoreName[] | undefined)?.map((s) => STORE_LABELS[s] ?? s);
  switch (kind) {
    case "cancel_subscription":
      lines.push(`Subscription ${shortId(params.subscriptionId as string)}`);
      break;
    case "refund_charge":
      lines.push(`${formatCents(Number(params.amountCents))} against charge ${shortId(params.chargeId as string)}`);
      break;
    case "erase_personal_data":
    case "purge_derived_memories":
      if (stores) lines.push(`Scope: ${stores.join(", ")}`);
      break;
    case "void_refunds":
      lines.push(`Refunds ${(params.refundIds as string[]).map((r) => shortId(r)).join(", ")}`);
      break;
    case "delete_memories":
      lines.push(`${(params.memoryIds as string[]).length} record(s): ${(params.memoryIds as string[]).map((r) => shortId(r)).join(", ")}`);
      break;
  }
  return lines;
}

export const kindLabel = (k: ObligationKind) => KIND_INFO[k]?.label ?? k;

export const STATUS_LABEL: Record<string, string> = {
  awaiting_approval: "Awaiting your decision",
  ready: "Approved — ready to execute",
  executing: "Executing",
  interrupted: "Interrupted",
  verifying: "Verifying",
  verified: "Verified",
  failed: "Failed verification",
  unknown: "Could not be verified",
};
