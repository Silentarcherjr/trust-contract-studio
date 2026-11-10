import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { IconMessageCircle, IconRefresh, IconTool } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import type { ContractView } from "./types";

interface RepairPlanView {
  proposals: { kind: string; title: string; rationale: string }[];
  reverify: { obligationId: string; reason: string }[];
  needsHuman: { obligationId: string; reason: string }[];
}

export function RepairStudio({
  view,
  numberById,
}: {
  view: ContractView;
  numberById: Map<string, number>;
}) {
  const { contract } = view;
  const [plan, setPlan] = useState<RepairPlanView | null>(null);
  const propose = useActionMutation("propose-repair", {
    onSuccess: (res) => {
      setPlan(res.plan as RepairPlanView);
      // Bring the first proposed repair clause into view once it renders.
      window.setTimeout(() => {
        document
          .querySelector('[data-pending-decision="true"]')
          ?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "auto"
              : "smooth",
            block: "center",
          });
      }, 400);
    },
    onError: (e) =>
      toast.error(actionErrorMessage(e) ?? "Could not propose a repair."),
  });
  const verify = useActionMutation("verify-contract", {
    onSuccess: () => setPlan(null),
    onError: (e) =>
      toast.error(actionErrorMessage(e) ?? "Verification failed to run."),
  });

  const failing = view.obligations.filter(
    (o) => o.verdict === "FAILED" || o.verdict === "UNKNOWN",
  );
  if (contract.status !== "failed" && contract.status !== "unknown")
    return null;

  const tone = contract.status === "failed" ? "failed" : "unknown";
  const askAgent = () =>
    sendToAgentChat({
      message: `Explain why contract ${contract.id} is ${contract.status.toUpperCase()} using only the verifier's reasons, then propose a repair.`,
      submit: true,
      openSidebar: true,
    } as Parameters<typeof sendToAgentChat>[0]);

  return (
    <section
      className={`tcs-banner ${tone === "unknown" ? "tcs-hatch-unknown" : ""}`}
      data-tone={tone}
      aria-labelledby="repair-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="repair-heading" className="tcs-serif text-lg font-semibold">
            {contract.status === "failed"
              ? "The evidence contradicts the promise."
              : "The outcome could not be observed."}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="tcs-btn"
            data-size="sm"
            onClick={askAgent}
          >
            <IconMessageCircle size={14} aria-hidden /> Ask the agent
          </button>
          <button
            type="button"
            className="tcs-btn"
            data-size="sm"
            disabled={verify.isPending}
            onClick={() => verify.mutate({ contractId: contract.id })}
          >
            <IconRefresh
              size={14}
              aria-hidden
              className={verify.isPending ? "tcs-live" : undefined}
            />{" "}
            Re-verify
          </button>
          <button
            type="button"
            className="tcs-btn"
            data-variant="primary"
            data-size="sm"
            data-primary-action
            disabled={propose.isPending}
            onClick={() => propose.mutate({ contractId: contract.id })}
          >
            <IconTool size={14} aria-hidden /> Propose repair
          </button>
        </div>
      </div>
      {/* Claim ≠ reality: what the agent said, next to what the provider shows. */}
      <ul className="tcs-ledger mt-3" aria-label="Claims against evidence">
        {failing.map((o) => {
          const claim = [...view.attempts]
            .reverse()
            .find(
              (a) => a.obligationId === o.id && a.provider !== "studio",
            )?.claim;
          const source = [...view.evidence]
            .reverse()
            .find((e) => e.obligationId === o.id)?.source;
          return (
            <li key={o.id} className="tcs-ledger-row">
              <span className="tcs-mono tcs-ledger-num">
                §{numberById.get(o.id)}
              </span>
              <div className="tcs-ledger-said">
                <span className="tcs-ledger-label">Agent said</span>
                <span className="tcs-claim">
                  {claim ?? "No claim recorded"}
                </span>
              </div>
              <span className="tcs-ledger-neq" aria-label="but">
                ≠
              </span>
              <div className="tcs-ledger-shows">
                <span className="tcs-ledger-label">
                  {source ? `Provider shows · ${source}` : "Provider shows"}
                </span>
                <span>{o.reasons[0]?.message}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {plan && (
        <div className="mt-3 space-y-2 border-t pt-3 text-sm tcs-rule">
          {plan.proposals.length === 0 && plan.reverify.length > 0 && (
            <p>
              No side effect is needed — the problem was the observation itself.
              Re-verify to take a fresh reading.
            </p>
          )}
          {plan.reverify.map((r) => (
            <p key={r.obligationId} className="tcs-soft">
              §{numberById.get(r.obligationId)}: {r.reason}
            </p>
          ))}
          {plan.needsHuman.map((r) => (
            <p key={r.obligationId}>
              <strong>
                Needs your judgment · §{numberById.get(r.obligationId)}:
              </strong>{" "}
              {r.reason}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
