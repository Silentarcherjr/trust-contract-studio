import { ALL_STORES, type StoreName } from "@shared/domain";

const COLUMN_LABELS: Record<StoreName, string> = {
  profile_db: "Profile database",
  memory_store: "Agent memory",
  vector_index: "Vector index",
  analytics_export: "Analytics export",
};

export interface LineageNode {
  id: string;
  store: string;
  kind: string;
  label: string;
  derivedFrom: string[];
  state: string; // live | deleted | unobservable
}

const NODE_W = 172;
const NODE_H = 36;
const COL_GAP = 52;
const ROW_GAP = 14;
const TOP = 30;

type DisplayState = "live" | "deleted" | "residual" | "unobservable";

export function MemoryLineage({
  nodes,
  residualIds,
}: {
  nodes: LineageNode[];
  residualIds: Set<string>;
}) {
  const columns = ALL_STORES.map((store) =>
    nodes.filter((n) => n.store === store),
  );
  const pos = new Map<string, { x: number; y: number }>();
  columns.forEach((col, ci) => {
    // Order each column by its parents' rows so edges stay mostly horizontal.
    const sorted = [...col].sort(
      (a, b) => parentRow(a) - parentRow(b) || a.label.localeCompare(b.label),
    );
    sorted.forEach((n, ri) =>
      pos.set(n.id, {
        x: ci * (NODE_W + COL_GAP),
        y: TOP + ri * (NODE_H + ROW_GAP),
      }),
    );
  });
  function parentRow(n: LineageNode): number {
    const p = n.derivedFrom.map((id) => pos.get(id)?.y ?? 0);
    return p.length ? Math.min(...p) : -1;
  }

  const width = ALL_STORES.length * NODE_W + (ALL_STORES.length - 1) * COL_GAP;
  const rows = Math.max(1, ...columns.map((c) => c.length));
  const height = TOP + rows * (NODE_H + ROW_GAP);

  const stateOf = (n: LineageNode): DisplayState =>
    n.state === "unobservable"
      ? "unobservable"
      : n.state === "deleted"
        ? "deleted"
        : residualIds.has(n.id)
          ? "residual"
          : "live";

  const counts = {
    live: nodes.filter((n) => stateOf(n) === "live" && n.kind !== "pii").length,
    residual: nodes.filter((n) => stateOf(n) === "residual").length,
    deleted: nodes.filter((n) => stateOf(n) === "deleted").length,
    unobservable: nodes.filter((n) => stateOf(n) === "unobservable").length,
  };

  if (!nodes.length)
    return (
      <p className="tcs-soft text-sm">No memory records for this customer.</p>
    );

  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <svg
          viewBox={`-2 0 ${width + 4} ${height}`}
          style={{ minWidth: 640, width: "100%", height: "auto" }}
          role="img"
          aria-label={`Memory lineage: ${counts.deleted} deleted, ${counts.residual} residual, ${counts.unobservable} unobservable`}
        >
          <defs>
            <pattern
              id="tcs-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="hsl(var(--tcs-unknown-bg))" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke="hsl(var(--tcs-unknown) / 0.35)"
                strokeWidth="2"
              />
            </pattern>
          </defs>
          {ALL_STORES.map((store, ci) => (
            <text
              key={store}
              className="tcs-lineage-col-label"
              x={ci * (NODE_W + COL_GAP)}
              y={14}
            >
              {COLUMN_LABELS[store as StoreName]}
            </text>
          ))}
          {nodes.flatMap((n) =>
            n.derivedFrom.map((parentId) => {
              const a = pos.get(parentId);
              const b = pos.get(n.id);
              if (!a || !b) return null;
              const x1 = a.x + NODE_W;
              const y1 = a.y + NODE_H / 2;
              const x2 = b.x;
              const y2 = b.y + NODE_H / 2;
              const mid = (x1 + x2) / 2;
              return (
                <path
                  key={`${parentId}-${n.id}`}
                  className="tcs-lineage-edge"
                  data-state={
                    stateOf(n) === "residual" ? "residual" : undefined
                  }
                  d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                />
              );
            }),
          )}
          {nodes.map((n) => {
            const p = pos.get(n.id)!;
            const s = stateOf(n);
            return (
              <g
                key={n.id}
                className="tcs-lineage-node"
                data-state={s}
                transform={`translate(${p.x} ${p.y})`}
              >
                <title>{`${n.label} — ${s}${n.kind === "pii" ? " (personal data)" : ""}`}</title>
                <rect width={NODE_W} height={NODE_H} rx={8} />
                <text x={10} y={15} style={{ fontWeight: 600 }}>
                  {truncate(n.label, 24)}
                </text>
                <text x={10} y={28} style={{ fontSize: 9.5, opacity: 0.7 }}>
                  {n.kind === "pii" ? "personal data" : n.kind} ·{" "}
                  {s === "unobservable" ? "state unknown" : s}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="tcs-soft mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <li>
          <span className="tcs-chip" data-tone="failed">
            {counts.residual} residual
          </span>
        </li>
        <li>
          <span className="tcs-chip">{counts.deleted} deleted</span>
        </li>
        <li>
          <span className="tcs-chip tcs-hatch-unknown" data-tone="unknown">
            {counts.unobservable} unobservable
          </span>
        </li>
        <li className="self-center">
          Coverage: {ALL_STORES.length - 1} of {ALL_STORES.length} stores have a
          read interface. Deletion in the analytics export cannot be confirmed
          from here.
        </li>
      </ul>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
