import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import {
  SCENARIOS,
  SCENARIO_INFO,
  formatCents,
  type Scenario,
} from "@shared/domain";
import {
  IconFileText,
  IconMessageCircle,
  IconRefresh,
  IconSparkles,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { useDemoMode } from "@/lib/demo-mode";

import type { getWorkspace } from "../../../server/domain/service";
import { STATUS_LABEL, clock, shortId } from "./format";
import { Seal } from "./Seal";

type SeededWorkspace = Extract<
  Awaited<ReturnType<typeof getWorkspace>>,
  { seeded: true }
>;

const DEMO_GOAL =
  "Cancel my subscription, refund $100, and delete my personal data and associated memories.";

const STATUS_VERDICT: Record<
  string,
  "VERIFIED" | "FAILED" | "UNKNOWN" | undefined
> = {
  verified: "VERIFIED",
  failed: "FAILED",
  unknown: "UNKNOWN",
};

/** Module-level so it survives a remount of the Studio home after a reset. */
let lastResetAt = 0;

export function StudioHome() {
  // Reads ?demo=1 here too, so the flag survives the navigation to a contract.
  useDemoMode();
  const navigate = useNavigate();
  const [goal, setGoal] = useState(DEMO_GOAL);
  const workspace = useActionQuery("get-workspace", {});
  const contracts = useActionQuery("list-contracts", {});
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const active = (workspace.data?.scenario ?? "clean") as Scenario;
  const chosen = scenario ?? active;

  // On slower networks (e.g. the first vector-engine start in production) the
  // page re-renders while a reset settles and its data reloads, which can drop
  // keyboard focus to <body>. For 15 s after a reset, put focus back on the
  // Reset button whenever it lands on <body>; never move it from elsewhere.
  const resetButton = useRef<HTMLButtonElement>(null);
  const restoreResetFocus = () => {
    if (Date.now() - lastResetAt > 15_000) return;
    const active = document.activeElement;
    if (!active || active === document.body) resetButton.current?.focus();
  };
  useEffect(() => {
    const timer = window.setInterval(restoreResetFocus, 250);
    return () => window.clearInterval(timer);
  }, []);
  const reset = useActionMutation("reset-demo", {
    onMutate: () => {
      lastResetAt = Date.now();
    },
    onSettled: () => {
      restoreResetFocus();
    },
    onSuccess: (r) => {
      setScenario(null);
      toast.success(
        `Sandbox reset · ${SCENARIO_INFO[r.scenario as Scenario].title}`,
      );
    },
    onError: (e) =>
      toast.error(actionErrorMessage(e) ?? "Could not reset the sandbox."),
  });
  const draft = useActionMutation("draft-contract", {
    onSuccess: (view) => navigate(`/studio/${view.contract.id}`),
    onError: (e) =>
      toast.error(actionErrorMessage(e) ?? "Could not draft a contract."),
  });

  const seeded = workspace.data?.seeded === true;
  const ws = seeded ? (workspace.data as SeededWorkspace) : null;

  const askAgent = () =>
    sendToAgentChat({
      message: `Draft a trust contract for this request, then open it in the Studio: "${goal}"`,
      submit: true,
      openSidebar: true,
    } as Parameters<typeof sendToAgentChat>[0]);

  return (
    <div className="tcs-page space-y-8">
      <header className="max-w-3xl space-y-2">
        <p className="tcs-eyebrow">Trust Contract Studio</p>
        <h1 className="tcs-goal">
          Agents make promises. This is where they get checked.
        </h1>
        <p className="tcs-soft text-sm leading-relaxed">
          Turn a request into explicit obligations, approve the sensitive ones
          yourself, let the agent execute against sandboxed providers, and
          accept only what an independent verifier can observe.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Composer */}
        <section
          className="tcs-panel space-y-3 p-5"
          aria-labelledby="composer-heading"
        >
          <h2 id="composer-heading" className="tcs-eyebrow">
            New commitment · on behalf of{" "}
            {ws?.subject.displayName ?? "the demo customer"}
          </h2>
          <label htmlFor="goal" className="sr-only">
            What should the agent do?
          </label>
          <textarea
            id="goal"
            className="tcs-textarea"
            value={goal}
            maxLength={500}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.metaKey || e.ctrlKey) &&
                seeded &&
                goal.trim().length >= 3
              )
                draft.mutate({ goal: goal.trim() });
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="tcs-btn"
              data-variant="primary"
              disabled={!seeded || draft.isPending || goal.trim().length < 3}
              onClick={() => draft.mutate({ goal: goal.trim() })}
            >
              <IconFileText size={16} aria-hidden />{" "}
              {draft.isPending ? "Drafting…" : "Draft contract"}
            </button>
            <button
              type="button"
              className="tcs-btn"
              disabled={!seeded || goal.trim().length < 3}
              onClick={askAgent}
            >
              <IconMessageCircle size={16} aria-hidden /> Ask the agent to draft
              it
            </button>
            <span className="tcs-soft text-xs">⌘/Ctrl + Enter</span>
          </div>
          <p className="tcs-soft text-xs">
            Both buttons call the same{" "}
            <span className="tcs-mono">draft-contract</span> action — one from
            this screen, one through the agent.
          </p>
          {!seeded && !workspace.isLoading && (
            <div className="tcs-banner text-sm" data-tone="neutral">
              The sandbox is empty. Choose a scenario in the Replay Lab and
              reset it to begin.
            </div>
          )}
        </section>

        {/* Sandbox snapshot */}
        <section
          className="tcs-panel space-y-3 p-5"
          aria-labelledby="sandbox-heading"
        >
          <h2 id="sandbox-heading" className="tcs-eyebrow">
            Sandbox providers · synthetic data
          </h2>
          {ws ? (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="tcs-soft">Customer</dt>
                <dd className="font-medium">{ws.subject.displayName}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="tcs-soft">Subscription</dt>
                <dd>
                  {ws.subscription?.plan} ·{" "}
                  <span className="font-medium">{ws.subscription?.status}</span>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="tcs-soft">Charges</dt>
                <dd className="text-right">
                  {ws.charges.map((c) => (
                    <div key={c.id}>
                      {formatCents(c.amountCents)}{" "}
                      <span className="tcs-soft text-xs">
                        {c.description.replace("Studio Plus — ", "")}
                      </span>
                    </div>
                  ))}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="tcs-soft">Refunds</dt>
                <dd className="text-right">
                  {ws.refunds.length === 0
                    ? "none"
                    : ws.refunds.map((r) => (
                        <div key={r.id}>
                          {formatCents(r.amountCents)}{" "}
                          <span className="tcs-soft text-xs">{r.status}</span>
                        </div>
                      ))}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="tcs-soft">Memory records</dt>
                <dd>
                  {ws.lineage.filter((m) => m.state === "live").length} live ·{" "}
                  {ws.lineage.filter((m) => m.state === "deleted").length}{" "}
                  deleted ·{" "}
                  {ws.lineage.filter((m) => m.state === "unobservable").length}{" "}
                  unobservable
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="tcs-soft">Vector index</dt>
                <dd className="text-right">{ws.vectorEngine}</dd>
              </div>
            </dl>
          ) : (
            <p className="tcs-soft text-sm">
              {workspace.isLoading ? "Loading…" : "Not seeded yet."}
            </p>
          )}
        </section>
      </div>

      {/* Replay Lab */}
      <section className="space-y-3" aria-labelledby="lab-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="lab-heading" className="tcs-serif text-xl font-semibold">
              Adversarial Replay Lab
            </h2>
            <p className="tcs-soft text-sm">
              Each scenario injects one realistic fault inside the providers —
              never inside the verifier. Active:{" "}
              <strong>{SCENARIO_INFO[active].title}</strong>
            </p>
          </div>
          <button
            ref={resetButton}
            type="button"
            className="tcs-btn"
            data-variant="primary"
            // aria-disabled (not disabled) while pending keeps keyboard focus here.
            aria-disabled={reset.isPending || undefined}
            onClick={() => {
              if (reset.isPending) return;
              reset.mutate({ scenario: chosen });
            }}
          >
            <IconRefresh
              size={16}
              aria-hidden
              className={reset.isPending ? "tcs-live" : undefined}
            />{" "}
            Reset sandbox · {SCENARIO_INFO[chosen].title}
          </button>
        </div>
        <div
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
          role="group"
          aria-label="Scenarios"
        >
          {SCENARIOS.map((s) => (
            <button
              key={s}
              type="button"
              className="tcs-scenario"
              aria-pressed={chosen === s}
              onClick={() => setScenario(s)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  {SCENARIO_INFO[s].title}
                </span>
                {s === active && <span className="tcs-chip">active</span>}
              </div>
              <p className="tcs-soft mt-1 text-xs leading-snug">
                {SCENARIO_INFO[s].summary}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {[...new Set(Object.values(SCENARIO_INFO[s].expected))].map(
                  (v) => (
                    <Seal key={v} verdict={v} />
                  ),
                )}
              </div>
            </button>
          ))}
        </div>
        <p className="tcs-soft text-xs">
          Resetting wipes this workspace's contracts, evidence and receipts and
          reseeds the synthetic customer.
        </p>
      </section>

      {/* Recent contracts */}
      <section className="space-y-3" aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="tcs-serif text-xl font-semibold">
          Contracts
        </h2>
        {contracts.data && contracts.data.length > 0 ? (
          <ul className="divide-y tcs-rule rounded-xl border tcs-rule">
            {contracts.data.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/studio/${c.id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--tcs-paper-2))]"
                >
                  <span className="tcs-mono tcs-soft text-xs">
                    {shortId(c.id)}
                  </span>
                  <span className="tcs-serif min-w-0 flex-1 truncate">
                    {c.goal}
                  </span>
                  <span className="tcs-soft text-xs">
                    {SCENARIO_INFO[c.scenario as Scenario]?.title}
                  </span>
                  {STATUS_VERDICT[c.status] ? (
                    <Seal verdict={STATUS_VERDICT[c.status]} />
                  ) : (
                    <span className="tcs-chip">{STATUS_LABEL[c.status]}</span>
                  )}
                  <span className="tcs-soft text-xs">{clock(c.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tcs-soft flex items-center gap-2 text-sm">
            <IconSparkles size={15} aria-hidden /> No contracts yet. Draft one
            above.
          </p>
        )}
      </section>
    </div>
  );
}
