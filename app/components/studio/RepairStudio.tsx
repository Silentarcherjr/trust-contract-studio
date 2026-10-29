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
    onSuccess: (res) => setPlan(res.plan as RepairPlanView),
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
  const pendingRepairs = view.obligations.filter(
    (o) => o.repairOf && o.approval === "pending",
  );

  if (contract.status === "awaiting_approval" && pendingRepairs.length) {
    return (
      <div className="tcs-banner" data-tone="neutral" role="status">
        <p className="text-sm">
          <strong>Repair round {contract.round}.</strong>{" "}
          {pendingRepairs.length} repair clause
          {pendingRepairs.length === 1 ? "" : "s"} below wait for your decision.
          Nothing runs until you approve.
        </p>
      </div>
    );
  }
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
          <ul className="mt-1 space-y-0.5 text-sm">
            {failing.map((o) => (
              <li key={o.id}>
                <span className="tcs-mono text-xs">
                  §{numberById.get(o.id)}
                </span>{" "}
                {o.reasons[0]?.message}
              </li>
            ))}
          </ul>
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
            disabled={propose.isPending}
            onClick={() => propose.mutate({ contractId: contract.id })}
          >
            <IconTool size={14} aria-hidden /> Propose repair
          </button>
        </div>
      </div>
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
