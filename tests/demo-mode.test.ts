import { describe, expect, it } from "vitest";

import { DEMO_PACE_MS, NORMAL_PACE_MS, resolveDemoMode } from "@/lib/demo-mode";

describe("demo mode", () => {
  it("is off by default", () => {
    expect(resolveDemoMode("", null).mode).toEqual({
      enabled: false,
      paceMs: NORMAL_PACE_MS,
    });
  });

  it("turns on with ?demo=1 and persists the choice", () => {
    const on = resolveDemoMode("?demo=1", null);
    expect(on.mode).toEqual({ enabled: true, paceMs: DEMO_PACE_MS });
    // A later page without the flag keeps demo mode from storage.
    expect(resolveDemoMode("", on.store).mode.enabled).toBe(true);
  });

  it("accepts a pace override, clamped to the server's 0–2000 ms", () => {
    expect(resolveDemoMode("?demo=1&pace=1200", null).mode.paceMs).toBe(1200);
    expect(resolveDemoMode("?demo=1&pace=99999", null).mode.paceMs).toBe(2000);
    expect(resolveDemoMode("?demo=1&pace=-5", null).mode.paceMs).toBe(0);
    expect(resolveDemoMode("?demo=1&pace=abc", null).mode.paceMs).toBe(
      DEMO_PACE_MS,
    );
  });

  it("ignores ?pace without demo mode", () => {
    expect(resolveDemoMode("?pace=2000", null).mode.paceMs).toBe(
      NORMAL_PACE_MS,
    );
  });

  it("turns off with ?demo=0 and clears storage", () => {
    const on = resolveDemoMode("?demo=1", null);
    const off = resolveDemoMode("?demo=0", on.store);
    expect(off.mode.enabled).toBe(false);
    expect(off.store).toBeNull();
  });

  it("treats corrupt storage as off", () => {
    expect(resolveDemoMode("", "{not json").mode.enabled).toBe(false);
  });
});
