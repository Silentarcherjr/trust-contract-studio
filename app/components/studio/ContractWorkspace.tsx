import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { SCENARIO_INFO, type Verdict } from "@shared/domain";
import {
  IconArrowLeft,
  IconBolt,
  IconChecks,
  IconFlask,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { ClauseCard } from "./ClauseCard";
import { EvidenceLedger } from "./EvidenceLedger";
import { ExecutionTheater } from "./ExecutionTheater";
import { STATUS_LABEL, shortId } from "./format";
import { LifecycleRail } from "./LifecycleRail";
import { MemoryLineage } from "./MemoryLineage";
import { ReceiptPanel } from "./ReceiptPanel";
import { RepairStudio } from "./RepairStudio";
import { Seal } from "./Seal";
import type { ContractView } from "./types";

const TABS = [
  { id: "theater", label: "Theater" },
  { id: "evidence", label: "Evidence" },
  { id: "receipt", label: "Receipt" },
  { id: "lab", label: "Lab" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function ContractWorkspace({ contractId }: { contractId: string }) {
  const [tab, setTab] = useState<TabId>("theater");
  const [running, setRunning] = useState(false);
  const query = useActionQuery(
    "get-contract",
    { contractId },
    {
      refetchInterval: (q) => {
        const status = q.state.data?.contract.status;
        return running || status === "executing" || status === "verifying"
          ? 450
          : false;
      },
    },
  );
  const workspace = useActionQuery("get-workspace", {});
  const execute = useActionMutation("execute-contract", {
    onMutate: () => setRunning(true),
    onSettled: () => setRunning(false),
    onError: (e) =>
      toast.error(actionErrorMessage(e) ?? "Execution could not start."),
  });
  const decide = useActionMutation("decide-approval");
  const [approvingAll, setApprovingAll] = useState(false);

  const view = query.data as ContractView | undefined;
  const numberById = useMemo(
    () => new Map((view?.obligations ?? []).map((o, i) => [o.id, i + 1])),
    [view],
  );

  if (query.isLoading) return <WorkspaceSkeleton />;
  if (query.error || !view) {
    return (
      <div className="tcs-page">
        <div className="tcs-banner" data-tone="failed" role="alert">
          <p className="font-medium">
            {actionErrorMessage(query.error) ??
              "This contract could not be loaded."}
          </p>
          <Link to="/studio" className="mt-2 inline-block text-sm underline">
            Back to the Studio
          </Link>
        </div>
      </div>
    );
  }

  const { contract } = view;
  const editable =
    contract.status === "awaiting_approval" || contract.status === "ready";
  const pending = view.obligations.filter(
    (o) => o.approval === "pending" && o.execution !== "succeeded",
  );
  const final =
    contract.status === "verified" ||
    contract.status === "failed" ||
    contract.status === "unknown";
  const overall: Verdict | null = final
    ? contract.status === "verified"
      ? "VERIFIED"
      : contract.status === "failed"
        ? "FAILED"
        : "UNKNOWN"
    : null;
  const hasReceipt = view.audit.some((a) => a.type === "receipt.exported");
  const residualIds = new Set(
    view.obligations
      .filter(
        (o) =>
          o.verdict === "FAILED" &&
          (o.kind === "purge_derived_memories" ||
            o.kind === "erase_personal_data"),
      )
      .flatMap((o) => o.reasons.flatMap((r) => r.refs ?? [])),
  );

  const approveAll = async () => {
    setApprovingAll(true);
    try {
      for (const o of pending) {
        await decide.mutateAsync({
          contractId: contract.id,
          obligationId: o.id,
          decision: "approved",
          paramsHash: o.paramsHash,
        });
      }
    } catch (e) {
      toast.error(actionErrorMessage(e) ?? "Could not record approvals.");
    } finally {
      setApprovingAll(false);
    }
  };

  return (
    <div className="tcs-page space-y-6">
      {/* Header */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            to="/studio"
            className="tcs-soft inline-flex items-center gap-1 text-xs hover:underline"
          >
            <IconArrowLeft size={13} aria-hidden /> Studio
          </Link>
          <span className="tcs-eyebrow">
            Trust contract {shortId(contract.id)} · planned by{" "}
            {contract.plannedBy} · scenario:{" "}
            {SCENARIO_INFO[contract.scenario].title}
          </span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <blockquote className="tcs-goal max-w-3xl">
            “{contract.goal}”
          </blockquote>
          {overall ? (
            <Seal verdict={overall} size="lg" />
          ) : (
            <span className="tcs-chip">{STATUS_LABEL[contract.status]}</span>
          )}
        </div>
        <LifecycleRail
          status={contract.status}
          round={contract.round}
          hasReceipt={hasReceipt}
        />
      </header>

      {/* Primary action for the current state */}
      <PrimaryAction
        view={view}
        pendingCount={pending.length}
        approvingAll={approvingAll}
        executing={running || contract.status === "executing"}
        onApproveAll={approveAll}
        onExecute={() =>
          execute.mutate({ contractId: contract.id, paceMs: 650 })
        }
        onShowReceipt={() => setTab("receipt")}
      />

      <RepairStudio view={view} numberById={numberById} />

      {(contract.unmatchedClauses.length > 0 ||
        contract.limitations.length > 0) && (
        <details className="tcs-panel px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">
            What this contract cannot prove
            {contract.unmatchedClauses.length > 0 && (
              <span className="tcs-chip ml-2" data-tone="unknown">
                {contract.unmatchedClauses.length} unverifiable request
                {contract.unmatchedClauses.length === 1 ? "" : "s"}
              </span>
            )}
          </summary>
          {contract.unmatchedClauses.length > 0 && (
            <p className="mt-2">
              Not turned into obligations (no verifier exists):{" "}
              {contract.unmatchedClauses.map((c) => `“${c}”`).join(", ")}
            </p>
          )}
          <ul className="tcs-soft mt-2 list-disc space-y-1 pl-5">
            {contract.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
        {/* Promise Canvas */}
        <section aria-labelledby="canvas-heading" className="min-w-0 space-y-3">
          <h2 id="canvas-heading" className="tcs-eyebrow">
            Promise Canvas · {view.obligations.length} clauses
          </h2>
          {view.obligations.length === 0 ? (
            <p className="tcs-soft text-sm">This contract has no clauses.</p>
          ) : (
            <ol className="space-y-3">
              {view.obligations.map((o, i) => (
                <li key={o.id}>
                  <ClauseCard
                    contract={contract}
                    obligation={o}
                    number={i + 1}
                    numberById={numberById}
                    attempts={view.attempts.filter(
                      (a) => a.obligationId === o.id,
                    )}
                    evidence={view.evidence.filter(
                      (e) =>
                        e.verificationId === lastVerificationId(view, o.id),
                    )}
                    editable={editable}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Inspector */}
        <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start">
          <div className="tcs-panel overflow-hidden">
            <div
              className="tcs-tabs px-2"
              role="tablist"
              aria-label="Contract inspector"
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={tab === t.id ? 0 : -1}
                  className="tcs-tab"
                  onClick={() => setTab(t.id)}
                  onKeyDown={(e) => {
                    const i = TABS.findIndex((x) => x.id === tab);
                    if (e.key === "ArrowRight")
                      setTab(TABS[(i + 1) % TABS.length]!.id);
                    if (e.key === "ArrowLeft")
                      setTab(TABS[(i - 1 + TABS.length) % TABS.length]!.id);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div
              className="max-h-[calc(100vh-10rem)] overflow-y-auto p-4"
              role="tabpanel"
              tabIndex={0}
              id={`panel-${tab}`}
              aria-labelledby={`tab-${tab}`}
            >
              {tab === "theater" && (
                <ExecutionTheater view={view} numberById={numberById} />
              )}
              {tab === "evidence" && (
                <EvidenceLedger view={view} numberById={numberById} />
              )}
              {tab === "receipt" && <ReceiptPanel view={view} />}
              {tab === "lab" && <ReplayLabPanel view={view} />}
            </div>
          </div>
        </aside>
      </div>

      <section
        aria-labelledby="lineage-heading"
        className="tcs-panel space-y-3 p-5"
      >
        <div>
          <h2 id="lineage-heading" className="tcs-serif text-xl font-semibold">
            Memory Lineage
          </h2>
          <p className="tcs-soft text-sm">
            Every known record about{" "}
            {workspace.data && "subject" in workspace.data
              ? workspace.data.subject?.displayName
              : "the customer"}
            , and what was derived from it. Residual copies are flagged from the
            verifier's findings, not the agent's report.
          </p>
        </div>
        {workspace.data &&
        "lineage" in workspace.data &&
        workspace.data.lineage ? (
          <MemoryLineage
            nodes={workspace.data.lineage}
            residualIds={residualIds}
          />
        ) : (
          <p className="tcs-soft text-sm">Loading lineage…</p>
        )}
      </section>
    </div>
  );
}

function lastVerificationId(
  view: ContractView,
  obligationId: string,
): string | undefined {
  let id: string | undefined;
  for (const v of view.verifications)
    if (v.obligationId === obligationId) id = v.id;
  return id;
}

function PrimaryAction({
  view,
  pendingCount,
  approvingAll,
  executing,
  onApproveAll,
  onExecute,
  onShowReceipt,
}: {
  view: ContractView;
  pendingCount: number;
  approvingAll: boolean;
  executing: boolean;
  onApproveAll: () => void;
  onExecute: () => void;
  onShowReceipt: () => void;
}) {
  const s = view.contract.status;
  if (executing || s === "executing" || s === "verifying") {
    return (
      <div
        className="tcs-banner flex items-center gap-3"
        data-tone="neutral"
        role="status"
      >
        <IconBolt size={18} className="tcs-live" aria-hidden />
        <p className="text-sm">
          <strong>
            {s === "verifying" ? "Verifying" : "Executing"} against sandbox
            providers.
          </strong>{" "}
          Follow each call in the Execution Theater.
        </p>
      </div>
    );
  }
  if (s === "awaiting_approval") {
    return (
      <div
        className="tcs-banner flex flex-wrap items-center justify-between gap-3"
        data-tone="neutral"
      >
        <p className="text-sm">
          <strong>
            {view.contract.round > 1
              ? `Repair round ${view.contract.round}: ${pendingCount} repair clause${pendingCount === 1 ? "" : "s"} need your decision.`
              : `${pendingCount} clause${pendingCount === 1 ? "" : "s"} need your decision.`}
          </strong>{" "}
          Review the terms below. Nothing runs until you approve, and the agent
          cannot approve on your behalf.
        </p>
        <button
          type="button"
          className="tcs-btn"
          data-variant="primary"
          disabled={approvingAll || pendingCount === 0}
          onClick={onApproveAll}
        >
          <IconChecks size={16} aria-hidden /> Approve all {pendingCount}
        </button>
      </div>
    );
  }
  if (s === "ready" || s === "interrupted") {
    return (
      <div
        className="tcs-banner flex flex-wrap items-center justify-between gap-3"
        data-tone="neutral"
      >
        <p className="text-sm">
          {s === "interrupted" ? (
            <>
              <strong>The worker stopped mid-run.</strong> Resuming skips every
              side effect that already completed.
            </>
          ) : (
            <>
              <strong>Every decision is recorded.</strong> Execution runs only
              the clauses you approved, then the verifier checks the outcome
              independently.
            </>
          )}
        </p>
        <button
          type="button"
          className="tcs-btn"
          data-variant="primary"
          onClick={onExecute}
        >
          <IconPlayerPlay size={16} aria-hidden />{" "}
          {s === "interrupted" ? "Resume execution" : "Execute contract"}
        </button>
      </div>
    );
  }
  if (s === "verified") {
    return (
      <div
        className="tcs-banner flex flex-wrap items-center justify-between gap-3"
        data-tone="verified"
      >
        <p className="text-sm">
          <strong>
            Every pursued clause is VERIFIED by provider observations,
          </strong>{" "}
          not by the agent's word.
        </p>
        <button type="button" className="tcs-btn" onClick={onShowReceipt}>
          View proof receipt
        </button>
      </div>
    );
  }
  return null;
}

function ReplayLabPanel({ view }: { view: ContractView }) {
  const tamper = useActionMutation("tamper-evidence", {
    onError: (e) => toast.error(actionErrorMessage(e) ?? "Drill failed."),
  });
  const info = SCENARIO_INFO[view.contract.scenario];
  const firstRound = new Map<string, Verdict>();
  for (const v of view.verifications) {
    const o = view.obligations.find((x) => x.id === v.obligationId);
    if (o && o.round === 1 && !firstRound.has(o.kind))
      firstRound.set(o.kind, v.verdict);
  }
  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="tcs-eyebrow mb-1">Active scenario</div>
        <p className="tcs-serif text-lg">{info.title}</p>
        <p className="tcs-soft">{info.summary}</p>
      </div>
      <table className="w-full text-left text-xs">
        <caption className="tcs-eyebrow mb-1 text-left">
          Expected vs first verification
        </caption>
        <thead>
          <tr className="tcs-soft">
            <th className="py-1 font-medium">Clause</th>
            <th className="py-1 font-medium">Expected</th>
            <th className="py-1 font-medium">Observed</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(info.expected).map(([kind, expected]) => {
            const got = firstRound.get(kind);
            return (
              <tr key={kind} className="border-t tcs-rule">
                <td className="py-1.5">{kind.replace(/_/g, " ")}</td>
                <td className="py-1.5">
                  <Seal verdict={expected} />
                </td>
                <td className="py-1.5">
                  {got ? (
                    <Seal verdict={got} />
                  ) : (
                    <span className="tcs-soft">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="tcs-panel p-3">
        <div className="flex items-center gap-2 font-medium">
          <IconFlask size={15} aria-hidden /> Evidence-forgery drill
        </div>
        <p className="tcs-soft mt-1 text-xs">
          Rewrites the latest stored observation to look like success, without
          updating its digest. The evidence ledger and any receipt must catch
          it.
        </p>
        <button
          type="button"
          className="tcs-btn mt-2"
          data-variant="reject"
          data-size="sm"
          disabled={tamper.isPending || view.evidence.length === 0}
          onClick={() => tamper.mutate({ contractId: view.contract.id })}
        >
          Forge latest evidence
        </button>
      </div>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div
      className="tcs-page space-y-4"
      aria-busy="true"
      aria-label="Loading contract"
    >
      <div className="h-4 w-64 animate-pulse rounded bg-[hsl(var(--tcs-rule))]" />
      <div className="h-10 w-3/4 animate-pulse rounded bg-[hsl(var(--tcs-rule))]" />
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-xl bg-[hsl(var(--tcs-paper-2))]"
        />
      ))}
    </div>
  );
}
