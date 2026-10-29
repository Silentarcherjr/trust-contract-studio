import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import {
  IconDownload,
  IconFileCertificate,
  IconShieldCheck,
  IconShieldX,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Seal } from "./Seal";
import type { ContractView } from "./types";

type Receipt = Record<string, unknown> & {
  overall: "VERIFIED" | "FAILED" | "UNKNOWN";
  summary: Record<string, number>;
  receiptId: string;
  issuedAt: string;
  limitations: string[];
  agentClaims: { recorded: number; usedAsEvidence: number };
  integrity: { digest: string; signature: string; algorithm: string };
};

export function ReceiptPanel({ view }: { view: ContractView }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [check, setCheck] = useState<{
    label: string;
    ok: boolean;
    message: string;
  } | null>(null);
  const exportReceipt = useActionMutation("export-receipt", {
    onSuccess: (r) => {
      setReceipt(r as unknown as Receipt);
      setCheck(null);
    },
    onError: (e) =>
      toast.error(actionErrorMessage(e) ?? "Could not export the receipt."),
  });
  const checkReceipt = useActionMutation("check-receipt", {
    skipActionQueryInvalidation: true,
  });
  const final = ["verified", "failed", "unknown"].includes(
    view.contract.status,
  );

  const runCheck = async (label: string, body: Record<string, unknown>) => {
    try {
      const res = await checkReceipt.mutateAsync({ receipt: body });
      setCheck({ label, ok: res.signatureValid, message: res.message });
    } catch (e) {
      toast.error(actionErrorMessage(e) ?? "Could not check the receipt.");
    }
  };

  const download = () => {
    if (!receipt) return;
    const blob = new Blob([JSON.stringify(receipt, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${receipt.receiptId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="tcs-btn"
          data-variant="primary"
          disabled={!final || exportReceipt.isPending}
          onClick={() => exportReceipt.mutate({ contractId: view.contract.id })}
        >
          <IconFileCertificate size={16} aria-hidden />{" "}
          {receipt ? "Re-issue receipt" : "Export proof receipt"}
        </button>
        {!final && (
          <span className="tcs-soft text-xs">
            Available after verification.
          </span>
        )}
      </div>

      {receipt && (
        <div className="tcs-panel space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="tcs-eyebrow">Proof receipt</div>
              <div className="tcs-mono text-sm">{receipt.receiptId}</div>
            </div>
            <Seal verdict={receipt.overall} size="lg" />
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {Object.entries(receipt.summary).map(([k, v]) => (
              <div key={k}>
                <dt className="tcs-eyebrow">{k.replace("_", " ")}</dt>
                <dd className="tcs-serif text-2xl">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm">
            {receipt.agentClaims.recorded} agent self-reports recorded ·{" "}
            <strong>{receipt.agentClaims.usedAsEvidence}</strong> used as
            evidence.
          </p>
          <div>
            <div className="tcs-eyebrow mb-1">Integrity</div>
            <p className="tcs-digest">digest {receipt.integrity.digest}</p>
            <p className="tcs-digest">hmac {receipt.integrity.signature}</p>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Limitations ({receipt.limitations.length})
            </summary>
            <ul className="tcs-soft mt-2 list-disc space-y-1 pl-5 text-xs">
              {receipt.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="tcs-btn"
              data-size="sm"
              onClick={download}
            >
              <IconDownload size={14} aria-hidden /> Download JSON
            </button>
            <button
              type="button"
              className="tcs-btn"
              data-size="sm"
              disabled={checkReceipt.isPending}
              onClick={() => runCheck("Original", receipt)}
            >
              <IconShieldCheck size={14} aria-hidden /> Check integrity
            </button>
            <button
              type="button"
              className="tcs-btn"
              data-size="sm"
              disabled={checkReceipt.isPending}
              onClick={() => {
                const { label, body } = editedCopy(receipt);
                void runCheck(label, body);
              }}
            >
              <IconShieldX size={14} aria-hidden /> Try an edited copy
            </button>
          </div>
          {check && (
            <p
              className="tcs-banner text-sm"
              data-tone={check.ok ? "verified" : "failed"}
              role="status"
            >
              <strong>{check.label}:</strong> {check.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** A realistic forgery: upgrade the verdict, or inflate a promise if already verified. */
function editedCopy(receipt: Receipt): {
  label: string;
  body: Record<string, unknown>;
} {
  const body = JSON.parse(JSON.stringify(receipt)) as Receipt & {
    obligations: { kind: string; params: Record<string, unknown> }[];
  };
  if (receipt.overall !== "VERIFIED") {
    body.overall = "VERIFIED";
    body.summary = {
      ...body.summary,
      VERIFIED:
        body.summary.VERIFIED! + body.summary.FAILED! + body.summary.UNKNOWN!,
      FAILED: 0,
      UNKNOWN: 0,
    };
    return { label: "Edited copy (verdict upgraded to VERIFIED)", body };
  }
  const refund = body.obligations.find((o) => o.kind === "refund_charge");
  if (refund) refund.params.amountCents = Number(refund.params.amountCents) * 2;
  else body.issuedAt = new Date(0).toISOString();
  return {
    label: refund
      ? "Edited copy (refund amount doubled)"
      : "Edited copy (issue date changed)",
    body,
  };
}
