import { useEffect, useState } from "react";

/**
 * Demo mode slows execution down so a screen recording can follow it.
 *
 * Turn on with `?demo=1` on any Studio URL, off with `?demo=0`. The choice is
 * kept in sessionStorage so it survives the navigation from the Studio home to
 * a contract. In demo mode `?pace=<ms>` overrides the step delay for tuning.
 * Pacing is cosmetic: the server clamps it (0–2000 ms) and nothing about
 * approvals, execution or verification changes.
 */

/** Delay between execution steps in normal use: snappy but still legible. */
export const NORMAL_PACE_MS = 650;
/**
 * Delay between steps in demo mode. Tuned for the 90-second Clips script: the
 * first Showcase execution lands in the 0:30–0:45 slot and the repair run
 * finishes inside 0:60–0:75 (measurements in docs/DEMO_SCRIPT.md).
 */
export const DEMO_PACE_MS = 1800;

const STORAGE_KEY = "tcs-demo-mode";

export type DemoMode = { enabled: boolean; paceMs: number };

function clampPace(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(2000, Math.round(n)));
}

/** Pure resolver, exported for tests. */
export function resolveDemoMode(
  search: string,
  stored: string | null,
): { mode: DemoMode; store: string | null } {
  const params = new URLSearchParams(search);
  const flag = params.get("demo");
  let store = stored;
  if (flag === "1" || flag === "true") {
    const pace = clampPace(params.get("pace"));
    store = JSON.stringify({ pace: pace ?? DEMO_PACE_MS });
  } else if (flag === "0" || flag === "false") {
    store = null;
  }
  if (store) {
    try {
      const parsed = JSON.parse(store) as { pace?: unknown };
      const pace = clampPace(String(parsed.pace ?? DEMO_PACE_MS));
      return {
        mode: { enabled: true, paceMs: pace ?? DEMO_PACE_MS },
        store,
      };
    } catch {
      return { mode: { enabled: false, paceMs: NORMAL_PACE_MS }, store: null };
    }
  }
  return { mode: { enabled: false, paceMs: NORMAL_PACE_MS }, store: null };
}

export function useDemoMode(): DemoMode {
  const [mode, setMode] = useState<DemoMode>({
    enabled: false,
    paceMs: NORMAL_PACE_MS,
  });
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable (privacy mode); fall back to the URL only.
    }
    const { mode: next, store } = resolveDemoMode(
      window.location.search,
      stored,
    );
    try {
      if (store) window.sessionStorage.setItem(STORAGE_KEY, store);
      else window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setMode(next);
  }, []);
  return mode;
}
