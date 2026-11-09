/**
 * "Verified Done" seal rendered inside the agent chat transcript.
 *
 * Execute/verify actions declare `chatUI.renderer = "tcs.verified-done"` and
 * project their contract view into a compact seal (server/lib/verified-done).
 * Each clause shows what the executor said beside what the verifier checked,
 * so a "Done" the evidence contradicts is visible right where the agent speaks.
 */
import { registerActionChatRenderer } from "@agent-native/toolkit/app/chat";
import type { ToolRendererProps } from "@agent-native/toolkit/app/chat";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconFingerprint,
  IconRobot,
} from "@tabler/icons-react";
import { Link } from "react-router";

import type {
  VerifiedDoneClause,
  VerifiedDoneSeal,
} from "../../../server/lib/verified-done";
import { kindLabel, STATUS_LABEL } from "./format";
import { Seal } from "./Seal";

export const VERIFIED_DONE_RENDERER_ID = "tcs.verified-done";

function asSeal(value: unknown): VerifiedDoneSeal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Partial<VerifiedDoneSeal>;
  if (typeof v.contractId !== "string" || !Array.isArray(v.clauses)) {
    return null;
  }
  return v as VerifiedDoneSeal;
}

function statusTone(status: string) {
  if (status === "verified") return "verified";
  if (status === "failed") return "failed";
  if (status === "unknown") return "unknown";
  return undefined;
}

function ClauseRow({ clause: c }: { clause: VerifiedDoneClause }) {
  const contradicted =
    c.claimedDone && (c.verdict === "FAILED" || c.verdict === "UNKNOWN");
  return (
    <li className="tcs-vd-clause" data-verdict={c.verdict ?? undefined}>
      <div className="tcs-vd-clause-head">
        <span className="tcs-vd-num" aria-hidden>
          §{c.n}
        </span>
        <span className="tcs-vd-title">
          <span className="sr-only">Clause {c.n}: </span>
          {c.title}
        </span>
        <span className="tcs-chip">
          {kindLabel(c.kind as Parameters<typeof kindLabel>[0])}
        </span>
      </div>
      <dl className="tcs-vd-pair">
        <div className="tcs-vd-side" data-side="says">
          <dt className="tcs-col-label">
            <IconRobot size={12} aria-hidden /> Agent says
          </dt>
          <dd>
            {c.claim ? (
              <p className="tcs-claim">{c.claim}</p>
            ) : (
              <p className="tcs-soft text-sm">Nothing attempted.</p>
            )}
          </dd>
        </div>
        <div className="tcs-vd-side" data-side="checked">
          <dt className="tcs-col-label">
            <IconFingerprint size={12} aria-hidden /> Verifier checked
          </dt>
          <dd>
            <Seal verdict={c.pursued ? c.verdict : "NOT_PURSUED"} />
            {contradicted && (
              <div
                className="tcs-mismatch mt-1.5"
                data-tone={c.verdict === "UNKNOWN" ? "unknown" : undefined}
              >
                <IconAlertTriangle size={12} aria-hidden />
                {c.verdict === "FAILED"
                  ? "Claim contradicted by evidence"
                  : "Claim not confirmed by evidence"}
              </div>
            )}
            {c.reason && <p className="tcs-vd-reason">{c.reason}</p>}
            {c.source && (
              <p className="tcs-digest tcs-soft mt-1">observed: {c.source}</p>
            )}
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function VerifiedDoneCard({ seal }: { seal: VerifiedDoneSeal }) {
  const { counts } = seal;
  const tally = [
    counts.verified && `${counts.verified} verified`,
    counts.failed && `${counts.failed} failed`,
    counts.unknown && `${counts.unknown} unknown`,
    counts.open && `${counts.open} not verified yet`,
  ]
    .filter(Boolean)
    .join(" · ");
  const headingId = `tcs-vd-${seal.contractId}`;
  return (
    <section
      className="tcs-vd"
      aria-labelledby={headingId}
      data-status={seal.status}
    >
      <header className="tcs-vd-header">
        <div className="min-w-0 flex-1">
          <div className="tcs-eyebrow">Verified Done · seal</div>
          <h3 id={headingId} className="tcs-vd-goal">
            {seal.goal}
          </h3>
          {tally && <p className="tcs-soft mt-1 text-xs">{tally}</p>}
        </div>
        <span className="tcs-chip" data-tone={statusTone(seal.status)}>
          {STATUS_LABEL[seal.status] ?? seal.status}
        </span>
      </header>
      <ol className="tcs-vd-list">
        {seal.clauses.map((c) => (
          <ClauseRow key={c.n} clause={c} />
        ))}
      </ol>
      <footer className="tcs-vd-footer">
        <p className="tcs-soft text-[11px] italic">
          Claims are shown for comparison and are never used as evidence.
        </p>
        <Link to={seal.link} className="tcs-vd-link">
          Open contract <IconArrowRight size={12} aria-hidden />
        </Link>
      </footer>
    </section>
  );
}

function VerifiedDoneRenderer({ context }: ToolRendererProps) {
  const seal = asSeal(context.resultJson);
  if (!seal) return null;
  return <VerifiedDoneCard seal={seal} />;
}

let registered = false;
/** Register the seal renderer once (idempotent; safe under HMR). */
export function registerVerifiedDoneRenderer() {
  if (registered) return;
  registered = true;
  registerActionChatRenderer({
    id: VERIFIED_DONE_RENDERER_ID,
    renderer: VERIFIED_DONE_RENDERER_ID,
    Component: VerifiedDoneRenderer,
  });
}
