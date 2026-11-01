/**
 * Demo autopilot: plays the 90-second Clips storyboard (docs/DEMO_SCRIPT.md)
 * against a running dev server, on a fixed clock, so the recording has the
 * same pacing every take.
 *
 *   pnpm demo:autopilot                     # headed browser, for recording
 *   pnpm demo:autopilot --headless --video out/demo   # rehearsal + video
 *
 * Options:
 *   --base <url>     App origin (default http://127.0.0.1:8080)
 *   --headless       No visible window (rehearsal / CI)
 *   --video <dir>    Save a .webm of the run (Playwright recording)
 *   --no-spotlight   Do not ring the element being talked about
 *   --hold <s>       Seconds to keep the window open at the end (default 5)
 *
 * The run uses demo mode (?demo=1), so execution steps are paced for
 * narration. Pre-roll (sandbox reset) happens before the clock starts. Each
 * beat starts at its storyboard time; if a beat overruns, the log says so and
 * the exit code is 1, so a rehearsal fails loudly instead of drifting.
 *
 * Synthetic sandbox data only. The script clicks the same buttons a person
 * would; approvals are still human-surface clicks, never agent calls.
 */
import { chromium, type Locator, type Page } from "@playwright/test";

type Options = {
  base: string;
  headless: boolean;
  video: string | null;
  spotlight: boolean;
  holdS: number;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    base: "http://127.0.0.1:8080",
    headless: false,
    video: null,
    spotlight: true,
    holdS: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") opts.base = argv[++i] ?? opts.base;
    else if (a === "--headless") opts.headless = true;
    else if (a === "--video") opts.video = argv[++i] ?? "demo-video";
    else if (a === "--no-spotlight") opts.spotlight = false;
    else if (a === "--hold") opts.holdS = Number(argv[++i] ?? 5);
    else if (a === "--") continue;
    else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

type Beat = {
  at: number; // storyboard start, seconds
  until: number; // storyboard end, seconds
  name: string;
  run: (page: Page, ctx: BeatContext) => Promise<void>;
};

type BeatContext = {
  spot: (target: Locator, holdMs?: number) => Promise<void>;
  waitUntil: (second: number) => Promise<void>;
};

const bigSeal = (page: Page) =>
  page.locator('.tcs-seal[data-size="lg"]').first();
const clause = (page: Page, text: string) =>
  page.locator("article", { hasText: text }).first();

const BEATS: Beat[] = [
  {
    at: 0,
    until: 10,
    name: "Studio home: the request",
    run: async (page, { spot }) => {
      await spot(page.locator("textarea").first(), 6000);
    },
  },
  {
    at: 10,
    until: 20,
    name: "Draft contract → Promise Canvas",
    run: async (page, { spot }) => {
      await page.getByRole("button", { name: /^Draft contract/ }).click();
      await page.waitForURL(/\/studio\/ctr_/);
      await page.getByText(/Promise Canvas · 4 clauses/).waitFor();
      await spot(page.getByText(/What this contract cannot prove/), 3000);
    },
  },
  {
    at: 20,
    until: 30,
    name: "Terms hash, then Approve all 4",
    run: async (page, { spot, waitUntil }) => {
      await spot(
        clause(page, "Refund $100.00").getByText(/bound to these exact terms/),
        4000,
      );
      await waitUntil(26);
      await page.getByRole("button", { name: /Approve all 4/ }).click();
      await page.getByRole("button", { name: /Execute contract/ }).waitFor();
    },
  },
  {
    at: 30,
    until: 45,
    name: "Execute → Execution Theater → FAILED",
    run: async (page) => {
      await page.getByRole("button", { name: /Execute contract/ }).click();
      await page
        .locator('.tcs-seal[data-size="lg"][data-verdict="FAILED"]')
        .waitFor({ timeout: 30_000 });
    },
  },
  {
    at: 45,
    until: 60,
    name: "Triptych §2 and §4, Memory Lineage",
    run: async (page, { spot, waitUntil }) => {
      await spot(clause(page, "Refund $100.00"), 5000);
      await waitUntil(51);
      await spot(clause(page, "Purge memories"), 4000);
      await waitUntil(55);
      await spot(page.getByRole("heading", { name: "Memory Lineage" }), 3000);
    },
  },
  {
    at: 60,
    until: 75,
    name: "Propose repair → approve → execute → VERIFIED",
    run: async (page) => {
      await page.getByRole("button", { name: /Propose repair/ }).click();
      await page
        .getByText(/Void 1 duplicate refund/)
        .first()
        .waitFor({ timeout: 20_000 });
      await page.waitForTimeout(2500); // let the viewer read the repair clauses
      await page.getByRole("button", { name: /Approve all 2/ }).click();
      await page.getByRole("button", { name: /Execute contract/ }).click();
      await page
        .locator('.tcs-seal[data-size="lg"][data-verdict="VERIFIED"]')
        .waitFor({ timeout: 30_000 });
    },
  },
  {
    at: 75,
    until: 90,
    name: "Receipt: export, integrity, edited copy",
    run: async (page, { waitUntil }) => {
      await page.getByRole("tab", { name: "Receipt" }).click();
      await page
        .getByRole("tabpanel")
        .getByRole("button", { name: /Export proof receipt/ })
        .click();
      await page.getByRole("button", { name: /Check integrity/ }).click();
      await page.getByText(/Intact:/).waitFor();
      await waitUntil(83);
      await page.getByRole("button", { name: /Try an edited copy/ }).click();
      await page.getByText(/Tampered:/).waitFor();
    },
  },
];

const SPOTLIGHT_CSS = `
.tcs-demo-spot {
  outline: 3px solid #c2410c !important;
  outline-offset: 4px !important;
  border-radius: 6px;
  transition: outline-color 200ms ease;
}`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: opts.headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(opts.video
      ? { recordVideo: { dir: opts.video, size: { width: 1440, height: 900 } } }
      : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  // Pre-roll (not on the clock): demo mode on, Showcase scenario, clean sandbox.
  await page.goto(`${opts.base}/studio?demo=1`);
  await page.getByRole("button", { name: /^Showcase/ }).click();
  await page.getByRole("button", { name: /Reset sandbox/ }).click();
  await page.getByText("Sandbox reset").waitFor({ timeout: 30_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (opts.spotlight) await page.addStyleTag({ content: SPOTLIGHT_CSS });
  await page.waitForTimeout(1500); // let the reset toast fade

  const t0 = Date.now();
  const elapsed = () => (Date.now() - t0) / 1000;
  const waitUntil = async (second: number) => {
    const ms = second * 1000 - (Date.now() - t0);
    if (ms > 0) await page.waitForTimeout(ms);
  };
  const spot = async (target: Locator, holdMs = 2500) => {
    await target.scrollIntoViewIfNeeded();
    if (opts.spotlight) {
      await target.evaluate((el) => el.classList.add("tcs-demo-spot"));
    }
    await target.hover().catch(() => {});
    await page.waitForTimeout(holdMs);
    if (opts.spotlight) {
      // The element may have re-rendered; ignore if it is gone.
      await target
        .evaluate((el) => el.classList.remove("tcs-demo-spot"))
        .catch(() => {});
    }
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  let overruns = 0;
  console.log(
    "beat                                              planned        actual",
  );
  for (const beat of BEATS) {
    await waitUntil(beat.at);
    const start = elapsed();
    await beat.run(page, { spot, waitUntil });
    const end = elapsed();
    const over = end > beat.until + 0.25;
    if (over) overruns++;
    console.log(
      `${beat.name.padEnd(48)}  ${fmt(beat.at)}–${fmt(beat.until)}  ${fmt(start)}–${fmt(end)}${over ? "  ⚠ OVERRUN" : ""}`,
    );
  }
  await waitUntil(90);
  const sealText = (await bigSeal(page).textContent())?.trim();
  console.log(`\nFinal seal: ${sealText}. Total: ${fmt(elapsed())}.`);

  await page.waitForTimeout(opts.holdS * 1000);
  const video = page.video();
  await context.close();
  if (video) console.log(`Video: ${await video.path()}`);
  await browser.close();
  if (overruns > 0) {
    console.error(`${overruns} beat(s) overran their slot.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
