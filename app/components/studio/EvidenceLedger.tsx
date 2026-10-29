import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";

import { clock } from "./format";
import { Seal } from "./Seal";
import type { ContractView } from "./types";

export function EvidenceLedger({
  view,
  numberById,
}: {
  view: ContractView;
  numberById: Map<string, number>;
}) {
  const latestRound = Math.max(0, ...view.verifications.map((v) => v.round));
  const byVerification = new Map(view.verifications.map((v) => [v.id, v]));
  const items = [...view.evidence].sort((a, b) =>
    b.observedAt.localeCompare(a.observedAt),
  );
  if (!items.length) {
    return (
      <p className="tcs-soft text-sm">
        No evidence yet. The verifier collects it from providers after
        execution.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="tcs-soft text-xs">
        Read-only observations from the providers, never from the agent. Each is
        hashed when captured; a mismatch means it was edited afterwards.
      </p>
      <ul className="space-y-2">
        {items.map((e) => {
          const v = byVerification.get(e.verificationId);
          return (
            <li key={e.id} className="tcs-panel p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="tcs-mono text-xs">
                  §{numberById.get(e.obligationId) ?? "?"}
                </span>
                <span className="tcs-mono font-medium">{e.source}</span>
                {v && <Seal verdict={v.verdict} />}
                {v && v.round < latestRound && (
                  <span className="tcs-chip">round {v.round}</span>
                )}
                <span className="tcs-soft ml-auto text-xs">
                  {clock(e.observedAt)}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                {e.intact ? (
                  <span className="tcs-chip" data-tone="verified">
                    <IconCheck size={11} aria-hidden /> digest intact
                  </span>
                ) : (
                  <span className="tcs-chip" data-tone="failed">
                    <IconAlertTriangle size={11} aria-hidden /> digest mismatch
                    — tampered
                  </span>
                )}
                <span className="tcs-digest truncate">sha256 {e.digest}</span>
              </div>
              <details className="mt-1.5">
                <summary className="tcs-soft cursor-pointer text-xs">
                  Observed payload
                </summary>
                <pre
                  className="tcs-mono mt-1 max-h-64 overflow-auto rounded-md p-2 text-[11px] leading-relaxed"
                  style={{ background: "hsl(var(--tcs-paper))" }}
                >
                  {JSON.stringify(e.observed, null, 2)}
                </pre>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
