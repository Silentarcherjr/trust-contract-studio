import type { ContractStatus } from "@shared/domain";

const STEPS = [
  { key: "drafted", label: "Drafted" },
  { key: "decided", label: "Decided" },
  { key: "executed", label: "Executed" },
  { key: "checked", label: "Independently checked" },
  { key: "receipt", label: "Receipt" },
] as const;

function stepIndex(status: ContractStatus, hasReceipt: boolean): number {
  switch (status) {
    case "awaiting_approval":
      return 1;
    case "ready":
      return 2;
    case "executing":
    case "interrupted":
      return 2;
    case "verifying":
      return 3;
    case "verified":
    case "failed":
    case "unknown":
      return hasReceipt ? 5 : 4;
  }
}

export function LifecycleRail({
  status,
  round,
  hasReceipt,
}: {
  status: ContractStatus;
  round: number;
  hasReceipt: boolean;
}) {
  const current = stepIndex(status, hasReceipt);
  return (
    <ol className="tcs-rail" aria-label="Contract lifecycle">
      {STEPS.map((s, i) => (
        <li key={s.key} className="flex items-center">
          {i > 0 && <span className="tcs-rail-line" aria-hidden />}
          <span
            className="tcs-rail-step"
            data-state={
              i < current ? "done" : i === current ? "current" : "todo"
            }
            aria-current={i === current ? "step" : undefined}
          >
            <span className="tcs-rail-dot" aria-hidden />
            {s.label}
          </span>
        </li>
      ))}
      {round > 1 && (
        <li className="flex items-center">
          <span className="tcs-rail-line" aria-hidden />
          <span className="tcs-chip" data-tone="human">
            Repair round {round}
          </span>
        </li>
      )}
    </ol>
  );
}
