import { formatCents } from "@shared/domain";

import { relativeSeconds, shortHash } from "./format";
import { Seal } from "./Seal";
import type { ContractView } from "./types";

type Actor = "agent" | "human" | "provider" | "verifier" | "system";

interface Row {
  key: string;
  at: string;
  actor: Actor;
  tone?: "failed" | "unknown" | undefined;
  title: React.ReactNode;
  detail?: React.ReactNode;
}

const AUDIT_TITLES: Record<string, string> = {
  "workspace.reset": "Sandbox reset",
  "contract.drafted": "Contract drafted",
  "obligation.updated": "Terms edited",
  "obligation.added": "Clause added",
  "obligation.removed": "Clause removed",
  "approval.approved": "Approved",
  "approval.rejected": "Rejected",
  "approval.refused_non_human": "Self-approval attempt refused",
  "execution.started": "Execution started",
  "execution.resumed": "Execution resumed",
  "execution.interrupted": "Worker interrupted",
  "execution.completed": "Execution finished",
  "verification.completed": "Verification complete",
  "repair.proposed": "Repair proposed",
  "receipt.exported": "Proof receipt exported",
  "lab.evidence_tampered": "Evidence forged (drill)",
  "lab.late_refund": "Late refund made outside the Studio (drill)",
};

function actorFor(caller: string, actor: string): Actor {
  if (actor === "verifier") return "verifier";
  if (actor === "worker") return "system";
  if (caller === "tool" || caller === "mcp" || caller === "a2a") return "agent";
  if (caller === "frontend" || caller === "cli") return "human";
  return "system";
}

const ACTOR_LABEL: Record<Actor, string> = {
  agent: "Agent",
  human: "You",
  provider: "Provider",
  verifier: "Verifier",
  system: "System",
};

/** External agents (MCP, A2A) are named as such, not as the in-app agent. */
function actorLabel(who: Actor, caller: string) {
  if (who === "agent" && caller === "mcp") return "External agent · MCP";
  if (who === "agent" && caller === "a2a") return "External agent · A2A";
  return ACTOR_LABEL[who];
}

export function ExecutionTheater({
  view,
  numberById,
}: {
  view: ContractView;
  numberById: Map<string, number>;
}) {
  const origin = view.contract.createdAt;
  const clause = (id: string) => `§${numberById.get(id) ?? "?"}`;
  const rows: Row[] = [];

  for (const a of view.audit) {
    if (a.type === "verification.completed") continue; // shown per obligation below
    const who = actorFor(a.caller, a.actor);
    const p = a.payload as Record<string, unknown>;
    let detail: React.ReactNode = null;
    if (a.type.startsWith("approval.") && typeof p.obligationId === "string") {
      detail = (
        <span>
          {clause(p.obligationId)} · terms{" "}
          <span className="tcs-mono">
            #{shortHash(String(p.paramsHash ?? ""), 8)}
          </span>
          {a.type === "approval.refused_non_human" &&
            ` · caller "${a.caller}" is not a person`}
        </span>
      );
    } else if (a.type === "contract.drafted") {
      detail = `${String(p.obligations)} obligations · planned by ${String(p.plannedBy)}`;
    } else if (a.type === "lab.late_refund") {
      detail = `${formatCents(Number(p.amountCents))} · refund ${String(p.refundId)} · the contract still reads VERIFIED until a fresh observation`;
    } else if (a.type === "repair.proposed") {
      detail = `${(p.proposals as unknown[]).length} repair clause(s) awaiting approval`;
    }
    rows.push({
      key: `audit-${a.seq}`,
      at: a.createdAt,
      actor: who,
      tone:
        a.type === "approval.refused_non_human" ||
        a.type === "lab.evidence_tampered" ||
        a.type === "lab.late_refund" ||
        a.type === "execution.interrupted"
          ? "failed"
          : undefined,
      title: (
        <>
          <strong className="font-semibold">{actorLabel(who, a.caller)}</strong>{" "}
          · {AUDIT_TITLES[a.type] ?? a.type}
        </>
      ),
      detail,
    });
  }

  for (const at of view.attempts) {
    if (at.provider === "studio") {
      rows.push({
        key: at.id,
        at: at.createdAt,
        actor: "system",
        tone: at.outcome === "unauthorized" ? "failed" : undefined,
        title: (
          <>
            <strong className="font-semibold">Gate</strong> ·{" "}
            {clause(at.obligationId)} {at.outcome}
          </>
        ),
        detail: at.claim,
      });
      continue;
    }
    const res = at.response as Record<string, unknown> | null;
    rows.push({
      key: at.id,
      at: at.createdAt,
      actor: "provider",
      tone:
        at.outcome === "timeout"
          ? "unknown"
          : at.outcome === "error"
            ? "failed"
            : undefined,
      title: (
        <>
          <strong className="font-semibold">{at.provider}</strong>
          <span className="tcs-mono"> {at.operation}</span> ·{" "}
          {clause(at.obligationId)} · attempt {at.attemptNo} ·{" "}
          <span className={at.outcome === "ok" ? "" : "font-semibold"}>
            {at.provider === "external agent"
              ? "not performed by the Studio"
              : at.outcome === "ok"
                ? "200 OK"
                : at.outcome}
          </span>
          {res &&
            typeof res.amountCents === "number" &&
            ` · ${formatCents(res.amountCents)}`}
        </>
      ),
      detail: (
        <span>
          <span className="tcs-claim">{at.claim}</span>
          <span className="tcs-soft"> — agent</span>
        </span>
      ),
    });
  }

  for (const v of view.verifications) {
    rows.push({
      key: v.id,
      at: v.checkedAt,
      actor: "verifier",
      tone:
        v.verdict === "FAILED"
          ? "failed"
          : v.verdict === "UNKNOWN"
            ? "unknown"
            : undefined,
      title: (
        <span className="inline-flex flex-wrap items-center gap-2">
          <strong className="font-semibold">Verifier</strong> ·{" "}
          {clause(v.obligationId)} <Seal verdict={v.verdict} />
        </span>
      ),
      detail: v.reasons[0]?.message,
    });
  }

  rows.sort((a, b) => a.at.localeCompare(b.at));
  const live =
    view.contract.status === "executing" ||
    view.contract.status === "verifying";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="tcs-soft text-xs">
          Every agent call, provider response, retry, human decision and verdict
          — in order.
        </p>
        {live && (
          <span className="tcs-chip tcs-live" data-tone="agent" role="status">
            ● live
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="tcs-soft text-sm">Nothing has happened yet.</p>
      ) : (
        <div className="tcs-timeline" role="list" aria-live="polite">
          <span className="tcs-tl-spine" aria-hidden />
          {rows.map((r) => (
            <div
              key={r.key}
              className="tcs-tl-row"
              data-actor={r.actor}
              data-tone={r.tone}
              role="listitem"
            >
              <span className="tcs-tl-time">
                {relativeSeconds(origin, r.at)}
              </span>
              <span className="tcs-tl-node" aria-hidden />
              <div className="tcs-tl-body">
                <div>{r.title}</div>
                {r.detail && (
                  <div className="tcs-soft mt-0.5 text-xs">{r.detail}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
