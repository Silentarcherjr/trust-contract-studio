import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import {
  ALL_STORES,
  OBSERVABLE_STORES,
  STORE_LABELS,
  formatCents,
  last,
  type StoreName,
} from "@shared/domain";
import {
  IconAlertTriangle,
  IconCheck,
  IconFingerprint,
  IconPencil,
  IconRobot,
  IconScale,
  IconTrash,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { describeParams, kindLabel, shortHash, shortId, clock } from "./format";
import { Seal } from "./Seal";
import type {
  AttemptView,
  ContractView,
  EvidenceView,
  ObligationView,
} from "./types";

interface ClauseCardProps {
  contract: ContractView["contract"];
  obligation: ObligationView;
  number: number;
  numberById: Map<string, number>;
  attempts: AttemptView[];
  evidence: EvidenceView[];
  editable: boolean;
}

const toastError = (fallback: string) => (error: unknown) =>
  toast.error(actionErrorMessage(error) ?? fallback);

export function ClauseCard({
  contract,
  obligation: o,
  number,
  numberById,
  attempts,
  evidence,
  editable,
}: ClauseCardProps) {
  const [editing, setEditing] = useState(false);
  const decide = useActionMutation("decide-approval", {
    onError: toastError("Could not record your decision."),
  });
  const update = useActionMutation("update-obligation", {
    onError: toastError("Could not save the change."),
  });

  const realAttempts = attempts.filter(
    (a) => a.outcome !== "skipped" && a.provider !== "studio",
  );
  const lastAttempt = last(attempts);
  const claimedOk = realAttempts.some((a) => a.outcome === "ok");
  const contradicted =
    claimedOk && (o.verdict === "FAILED" || o.verdict === "UNKNOWN");
  const decisionOpen =
    editable && o.requiresApproval && o.approval === "pending";
  const verdict = o.approval === "rejected" ? "NOT_PURSUED" : o.verdict;

  return (
    <article
      className="tcs-clause"
      data-verdict={o.verdict ?? undefined}
      data-repair={o.repairOf ? "true" : undefined}
      data-pending-decision={decisionOpen ? "true" : undefined}
      aria-labelledby={`clause-${o.id}`}
    >
      <header className="flex flex-wrap items-start gap-3 px-4 pt-4 pb-3">
        <span className="tcs-clause-num" aria-hidden>
          §{number}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`clause-${o.id}`} className="tcs-clause-title">
            {o.title}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="tcs-chip">{kindLabel(o.kind)}</span>
            {o.repairOf && (
              <span className="tcs-chip" data-tone="human">
                Repair of §{numberById.get(o.repairOf) ?? "?"}
              </span>
            )}
            {o.dependsOn.length > 0 && (
              <span className="tcs-chip">
                after{" "}
                {o.dependsOn
                  .map((d) => `§${numberById.get(d) ?? "?"}`)
                  .join(", ")}
              </span>
            )}
            <ApprovalChip obligation={o} />
          </div>
        </div>
        <Seal verdict={verdict} />
      </header>

      <div className="tcs-triptych">
        {/* PROMISED */}
        <section className="tcs-col" data-col="promised" aria-label="Promised">
          <div className="tcs-col-label">
            <IconScale size={12} aria-hidden /> Promised
          </div>
          {editing ? (
            <ParamEditor
              obligation={o}
              pending={update.isPending}
              onCancel={() => setEditing(false)}
              onSave={(params) =>
                update.mutate(
                  {
                    contractId: contract.id,
                    obligationId: o.id,
                    expectedVersion: contract.version,
                    params,
                  },
                  { onSuccess: () => setEditing(false) },
                )
              }
            />
          ) : (
            <>
              <ul className="space-y-0.5 text-sm">
                {describeParams(o.kind, o.params).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="tcs-soft mt-2 text-xs leading-relaxed">
                <span className="font-medium">Done means: </span>
                {o.expectedEvidence}
              </p>
              {editable && o.execution !== "succeeded" && (
                <div className="mt-3 flex gap-2">
                  {(o.kind === "refund_charge" ||
                    o.kind === "erase_personal_data" ||
                    o.kind === "purge_derived_memories") && (
                    <button
                      type="button"
                      className="tcs-btn"
                      data-size="sm"
                      onClick={() => setEditing(true)}
                    >
                      <IconPencil size={14} aria-hidden /> Edit terms
                    </button>
                  )}
                  <button
                    type="button"
                    className="tcs-btn"
                    data-size="sm"
                    disabled={update.isPending}
                    onClick={() =>
                      update.mutate({
                        contractId: contract.id,
                        obligationId: o.id,
                        expectedVersion: contract.version,
                        remove: true,
                      })
                    }
                    aria-label={`Remove clause ${number}`}
                  >
                    <IconTrash size={14} aria-hidden />
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* CLAIMED */}
        <section
          className="tcs-col"
          data-col="claimed"
          aria-label="Claimed by the agent"
        >
          <div className="tcs-col-label">
            <IconRobot size={12} aria-hidden /> Agent claims
          </div>
          {lastAttempt ? (
            <>
              <p className="tcs-claim">{lastAttempt.claim}</p>
              <div className="tcs-soft mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {realAttempts.length > 0 && (
                  <span>
                    {realAttempts.length} call
                    {realAttempts.length === 1 ? "" : "s"}
                    {realAttempts.some((a) => a.outcome === "timeout") &&
                      " · retried after timeout"}
                  </span>
                )}
                {realAttempts[0] && (
                  <span className="tcs-mono">
                    key {shortHash(realAttempts[0].idempotencyKey, 14)}
                  </span>
                )}
              </div>
              <p className="tcs-soft mt-2 text-[11px] italic">
                Recorded for comparison. Never used as evidence.
              </p>
            </>
          ) : (
            <p className="tcs-soft text-sm">Nothing attempted yet.</p>
          )}
        </section>

        {/* OBSERVED */}
        <section
          className="tcs-col"
          data-col="observed"
          data-verdict={o.verdict ?? undefined}
          aria-label="Observed by the verifier"
        >
          <div className="tcs-col-label">
            <IconFingerprint size={12} aria-hidden /> Independently observed
          </div>
          {o.verdict ? (
            <>
              {contradicted && (
                <div className="tcs-mismatch mb-1.5">
                  <IconAlertTriangle size={12} aria-hidden /> Claim not
                  supported by evidence
                </div>
              )}
              <ul className="space-y-1.5 text-sm leading-snug">
                {o.reasons.map((r, i) => (
                  <li key={`${r.code}-${i}`}>
                    <span className="tcs-mono tcs-soft text-[10px] uppercase tracking-wide">
                      {r.code.replace(/_/g, " ")}
                    </span>
                    <div>{r.message}</div>
                  </li>
                ))}
              </ul>
              <ul className="mt-2 space-y-0.5">
                {evidence.map((e) => (
                  <li
                    key={e.id}
                    className="tcs-digest flex items-center gap-1.5"
                  >
                    {e.intact ? (
                      <IconCheck
                        size={11}
                        className="shrink-0"
                        aria-label="digest intact"
                      />
                    ) : (
                      <IconAlertTriangle
                        size={11}
                        className="shrink-0 text-[hsl(var(--tcs-failed))]"
                        aria-label="digest mismatch"
                      />
                    )}
                    <span className="truncate">
                      {e.source} · {shortHash(e.digest, 12)} ·{" "}
                      {clock(e.observedAt)}
                    </span>
                  </li>
                ))}
              </ul>
              {!o.evidenceIntact && (
                <p className="mt-2 text-xs font-medium text-[hsl(var(--tcs-failed))]">
                  Stored evidence no longer matches its digest. Re-run
                  verification.
                </p>
              )}
            </>
          ) : (
            <p className="tcs-soft text-sm">
              {o.approval === "rejected"
                ? "Not pursued — you rejected this clause."
                : "No observation yet. The verifier runs after execution."}
            </p>
          )}
        </section>
      </div>

      {decisionOpen && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 tcs-rule">
          <p className="tcs-soft text-xs">
            Your decision is bound to these exact terms{" "}
            <span className="tcs-mono">#{shortHash(o.paramsHash, 8)}</span>.
            Editing them later voids it.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="tcs-btn"
              data-variant="reject"
              data-size="sm"
              disabled={decide.isPending}
              onClick={() =>
                decide.mutate({
                  contractId: contract.id,
                  obligationId: o.id,
                  decision: "rejected",
                  paramsHash: o.paramsHash,
                })
              }
            >
              <IconX size={14} aria-hidden /> Reject
            </button>
            <button
              type="button"
              className="tcs-btn"
              data-variant="approve"
              data-size="sm"
              disabled={decide.isPending}
              onClick={() =>
                decide.mutate({
                  contractId: contract.id,
                  obligationId: o.id,
                  decision: "approved",
                  paramsHash: o.paramsHash,
                })
              }
            >
              <IconCheck size={14} aria-hidden /> Approve
            </button>
          </div>
        </footer>
      )}
    </article>
  );
}

function ApprovalChip({ obligation: o }: { obligation: ObligationView }) {
  if (!o.requiresApproval) return null;
  if (o.approval === "pending") {
    return (
      <span className="tcs-chip" data-tone="unknown">
        Needs your approval
      </span>
    );
  }
  const d = o.lastDecision;
  return (
    <span
      className="tcs-chip"
      data-tone={o.approval === "approved" ? "verified" : "failed"}
      title={
        d
          ? `${d.decidedBy} via ${d.caller} at ${clock(d.createdAt)}`
          : undefined
      }
    >
      <IconUser size={11} aria-hidden />
      {o.approval === "approved" ? "Approved" : "Rejected"}
      {d && ` · ${clock(d.createdAt)}`}
    </span>
  );
}

function ParamEditor({
  obligation: o,
  pending,
  onCancel,
  onSave,
}: {
  obligation: ObligationView;
  pending: boolean;
  onCancel: () => void;
  onSave: (params: Record<string, unknown>) => void;
}) {
  const [amount, setAmount] = useState(() =>
    (Number(o.params.amountCents ?? 0) / 100).toFixed(2),
  );
  const [stores, setStores] = useState<StoreName[]>(
    () => (o.params.stores as StoreName[]) ?? [],
  );
  const isRefund = o.kind === "refund_charge";
  const cents = Math.round(parseFloat(amount) * 100);
  const valid = isRefund
    ? Number.isFinite(cents) && cents > 0
    : stores.length > 0;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(isRefund ? { amountCents: cents } : { stores });
      }}
    >
      {isRefund ? (
        <label className="block text-sm">
          <span className="tcs-soft mb-1 block text-xs">
            Refund amount (USD)
          </span>
          <input
            className="tcs-input tcs-mono"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-describedby={`amount-hint-${o.id}`}
          />
          <span
            id={`amount-hint-${o.id}`}
            className="tcs-soft mt-1 block text-[11px]"
          >
            Currently {formatCents(Number(o.params.amountCents))}. Cannot exceed
            the original charge.
          </span>
        </label>
      ) : (
        <fieldset className="space-y-1.5">
          <legend className="tcs-soft mb-1 text-xs">Stores in scope</legend>
          {ALL_STORES.map((s) => {
            const observable = (
              OBSERVABLE_STORES as readonly string[]
            ).includes(s);
            return (
              <label key={s} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={stores.includes(s)}
                  onChange={(e) =>
                    setStores((cur) =>
                      e.target.checked
                        ? [...cur, s]
                        : cur.filter((x) => x !== s),
                    )
                  }
                />
                <span>
                  {STORE_LABELS[s]}
                  {!observable && (
                    <span className="tcs-soft block text-[11px]">
                      No read interface — will be reported UNKNOWN.
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className="tcs-btn"
          data-variant="primary"
          data-size="sm"
          disabled={!valid || pending}
        >
          Save terms
        </button>
        <button
          type="button"
          className="tcs-btn"
          data-size="sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      <p className="tcs-soft text-[11px]">
        Saving changes the terms hash, so any earlier approval no longer
        applies.
      </p>
      <span className="sr-only">{shortId(o.id)}</span>
    </form>
  );
}
