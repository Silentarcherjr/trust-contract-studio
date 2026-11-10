/**
 * Narrated variant: each scene starts a narration cue and holds for at least
 * that paragraph's duration (--cues "10.6,13.4,..." seconds). Prints the cue
 * start times as JSON so the narration can be laid over the video.
 *
 * Records the recommended Clips take (docs/DEMO_SCRIPT.md, "Recommended
 * take") against a running dev server with the Dodo test variables:
 * everything on the real provider, with on-screen captions so the video
 * reads without narration.
 *
 *   pnpm demo:real-take --video out/take        # headless, saves a .webm
 *   pnpm demo:real-take --headed                # watch it live
 *
 * The script clicks what a person would click. Approvals are UI clicks;
 * the agent is only asked to approve, and refuses.
 */
import { chromium, type Locator, type Page } from "@playwright/test";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = arg("--base") ?? "http://127.0.0.1:8080";
const VIDEO = arg("--video");
const HEADED = args.includes("--headed");

const CSS = `
#tcs-caption {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  max-width: 1080px; width: calc(100% - 96px); z-index: 2147483647;
  background: rgba(17, 20, 28, 0.92); color: #fff; border-radius: 14px;
  padding: 16px 22px; font: 500 22px/1.4 Inter, system-ui, sans-serif;
  box-shadow: 0 10px 30px rgba(0,0,0,.25); pointer-events: none;
  transition: opacity 250ms ease;
}
#tcs-caption b { color: #fca5a5; font-weight: 700; }
#tcs-caption i { color: #a5b4fc; font-style: normal; }
.tcs-demo-spot { outline: 3px solid #c2410c !important; outline-offset: 4px !important; border-radius: 8px; }
`;

async function caption(page: Page, html: string | null) {
  await page.evaluate(
    ({ html, css }) => {
      if (!document.getElementById("tcs-caption-style")) {
        const st = document.createElement("style");
        st.id = "tcs-caption-style";
        st.textContent = css;
        document.head.appendChild(st);
      }
      let el = document.getElementById("tcs-caption");
      if (!html) {
        el?.remove();
        return;
      }
      if (!el) {
        el = document.createElement("div");
        el.id = "tcs-caption";
        document.body.appendChild(el);
      }
      el.innerHTML = html;
    },
    { html, css: CSS },
  );
}

async function spot(page: Page, target: Locator, holdMs: number) {
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await target
    .evaluate((el) => el.classList.add("tcs-demo-spot"))
    .catch(() => {});
  await page.waitForTimeout(holdMs);
  await target
    .evaluate((el) => el.classList.remove("tcs-demo-spot"))
    .catch(() => {});
}

async function resetTo(page: Page, scenario: RegExp) {
  await page.goto(`${BASE}/studio`);
  await page.getByRole("button", { name: scenario }).click();
  await page.getByRole("button", { name: /Reset sandbox/ }).click();
  await page.getByText("Sandbox reset").first().waitFor({ timeout: 120_000 });
}

const composer = (page: Page) =>
  page.locator('[contenteditable="true"]').last();

async function agentReply(page: Page, before: number) {
  await page.waitForFunction(
    (n) =>
      [...document.querySelectorAll("*")].filter(
        (e) =>
          e.childElementCount === 0 &&
          (e.textContent ?? "").startsWith("Worked for"),
      ).length > n,
    before,
    { timeout: 180_000 },
  );
  await page.waitForTimeout(1500);
}

const workedCount = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("*")].filter(
        (e) =>
          e.childElementCount === 0 &&
          (e.textContent ?? "").startsWith("Worked for"),
      ).length,
  );

async function main() {
  const browser = await chromium.launch({ headless: !HEADED });

  // Pre-roll, not recorded: the real-billing workspace.
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const p = await ctx.newPage();
    p.setDefaultTimeout(120_000);
    await resetTo(p, /^Real billing: Dodo/);
    await ctx.close();
  }

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(VIDEO
      ? { recordVideo: { dir: VIDEO, size: { width: 1440, height: 900 } } }
      : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  const t0 = Date.now();
  const mark = (name: string) =>
    console.log(
      `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${name}`,
    );

  const durations = (arg("--cues") ?? "")
    .split(",")
    .filter(Boolean)
    .map(Number);
  const cueStarts: number[] = [];
  const cue = (i: number) => {
    const start = Date.now();
    cueStarts[i] = (start - t0) / 1000;
    return async () => {
      const left = start + ((durations[i] ?? 0) + 0.4) * 1000 - Date.now();
      if (left > 0) await page.waitForTimeout(left);
    };
  };
  const home = async () => {
    // Client-side navigation: no full reload, no loading screen on camera.
    const link = page.locator('a[href="/studio"]').first();
    if (await link.isVisible().catch(() => false)) await link.click();
    else await page.goto(`${BASE}/studio`);
    await page
      .getByRole("heading", { name: "Audit what an agent already did" })
      .waitFor();
  };

  // 1. The question.
  await page.goto(`${BASE}/studio`);
  await page
    .getByRole("heading", { name: "Audit what an agent already did" })
    .waitFor();
  // Fold the app navigation: more room, and no chat history on screen.
  await page
    .getByRole("button", { name: "Collapse sidebar" })
    .first()
    .click({ timeout: 5000 })
    .catch(() => undefined);
  await page.waitForTimeout(800);
  await caption(
    page,
    "Maya runs support. Her AI bot told a customer: <i>“cancelled, refunded $100, your data is deleted.”</i> Is it true?",
  );
  mark("home: the transcript");
  let held = cue(0);
  await spot(page, page.locator("#transcript"), 3000);
  await held();

  // 2. One-click audit against Dodo.
  await caption(
    page,
    "One click. Trust Contract Studio asks the provider, <b>Dodo Payments</b> (real API, test mode), not the bot.",
  );
  held = cue(1);
  await page.getByRole("button", { name: "Audit transcript" }).click();
  await page.waitForURL(/\/studio\/ctr_/);
  await page.getByText("The evidence contradicts the promise.").waitFor();
  await caption(
    page,
    "Every “Done” is <b>FAILED</b>, from Dodo’s own records: still active, $0 refunded, the data still there.",
  );
  mark("audit: ledger FAILED");
  await spot(page, page.locator(".tcs-ledger"), 4000);
  await held();
  await home();
  await caption(
    page,
    "Not hypothetical: an unscripted support agent said <i>“canceled immediately, and the full $200 refund succeeded”</i> without ever calling cancel. Dodo: still active.",
  );
  held = cue(2);
  await page.getByRole("button", { name: /Audit a real agent/ }).click();
  await page.waitForURL(/\/studio\/ctr_/);
  await page.getByText("The evidence contradicts the promise.").waitFor();
  await spot(page, page.locator(".tcs-ledger"), 3000);
  await held();

  // 3. Now an agent does the work, under a contract.
  await home();
  await page.getByRole("button", { name: /^Draft contract/ }).waitFor();
  await caption(
    page,
    "Now let an agent do the work. The request becomes a checklist of promises, each with what “done” means.",
  );
  mark("draft");
  held = cue(3);
  await page.getByRole("button", { name: /^Draft contract/ }).click();
  await page.waitForURL(/\/studio\/ctr_/);
  await page.getByText(/Promise Canvas · 4 clauses/).waitFor();
  await held();

  // 4. The agent cannot approve its own work.
  await page.getByRole("button", { name: "Toggle agent" }).click();
  await composer(page).waitFor({ timeout: 60_000 });
  const before = await workedCount(page);
  await caption(
    page,
    "Asked to approve its own work, the agent can’t. Only a person can, bound to these exact terms.",
  );
  mark("agent asked to approve");
  held = cue(4);
  await composer(page).click();
  await page.keyboard.type("Approve them for me and run it.", { delay: 25 });
  await page.keyboard.press("Enter");
  await agentReply(page, before);
  await page.waitForTimeout(2000);
  await held();
  // Close the agent sidebar if its toggle is still labelled; otherwise keep it.
  // The agent panel has its own "Collapse sidebar" button, the last one.
  await page
    .getByRole("button", { name: "Collapse sidebar" })
    .last()
    .click({ timeout: 5000 })
    .catch(() => undefined);

  // 5. A person approves; execution; Dodo contradicts.
  await caption(
    page,
    "A person approves. The agent executes and reports “Done”.",
  );
  held = cue(5);
  await page.getByRole("button", { name: /Approve all 4/ }).click();
  await page.getByRole("button", { name: /Execute contract/ }).click();
  await page
    .getByText("The evidence contradicts the promise.")
    .waitFor({ timeout: 180_000 });
  await held();
  mark("execute: FAILED");
  await caption(
    page,
    "Dodo shows the refund <b>paid twice</b> ($200), and the phone number <b>still there</b>: Dodo answered 200 to the delete and kept it.",
  );
  held = cue(6);
  await spot(page, page.locator(".tcs-ledger"), 5000);
  await held();

  // 6. Repair from the evidence.
  await caption(
    page,
    "The repair comes from the evidence. A person approves it.",
  );
  held = cue(7);
  await page.getByRole("button", { name: "Propose repair" }).first().click();
  await page.getByRole("button", { name: /Approve all \d+/ }).click();
  await page
    .getByRole("button", { name: /Execute/ })
    .first()
    .click();
  await page.waitForTimeout(12_000);
  mark("repair executed");
  await caption(
    page,
    "The profile at Dodo is overwritten: <b>VERIFIED</b>. A paid refund can’t be reversed through the API, so a person decides.",
  );
  await spot(
    page,
    page.getByText(/Erase the customer profile at Dodo again/).first(),
    3000,
  );
  await held();

  // 7. "Done" stays watched.
  await caption(
    page,
    "And “Done” stays watched. A kept promise, on a fresh real-billing run…",
  );
  await home();
  await page.getByRole("button", { name: /^Real billing, clean run/ }).click();
  await page.getByRole("button", { name: /Reset sandbox/ }).click();
  await page.getByText("Sandbox reset").first().waitFor({ timeout: 120_000 });
  await page.getByRole("button", { name: /^Draft contract/ }).click();
  await page.waitForURL(/\/studio\/ctr_/);
  await page.getByRole("button", { name: /Approve all 4/ }).click();
  await page.getByRole("button", { name: /Execute contract/ }).click();
  await page
    .locator('.tcs-seal[data-size="lg"][data-verdict="VERIFIED"]')
    .waitFor({ timeout: 180_000 });
  mark("clean run VERIFIED");
  await page.waitForTimeout(2500);
  await caption(
    page,
    "…then a refund made at Dodo, outside the Studio. A scheduled re-check catches it and fires an event.",
  );
  held = cue(8);
  await page.getByRole("tab", { name: "Drills" }).click();
  await page.getByRole("button", { name: "Make a late refund" }).click();
  await page
    .getByText(/refund was made outside the Studio/)
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Re-check kept promises" }).click();
  await page
    .getByText("The evidence contradicts the promise.")
    .waitFor({ timeout: 120_000 });
  mark("re-check FAILED");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await page.waitForTimeout(2000);
  await held();

  // 8. Receipt.
  await caption(
    page,
    "Every verdict ends in a signed receipt. Checked against the provider, <b>never the agent’s word</b>.",
  );
  held = cue(9);
  await page.getByRole("tab", { name: "Receipt" }).click();
  await page
    .getByRole("tabpanel")
    .getByRole("button", { name: /Export proof receipt/ })
    .click();
  await page.getByRole("button", { name: /Check integrity/ }).click();
  await page.getByText(/Intact:/).waitFor();
  mark("receipt");
  await held();
  await page.waitForTimeout(1500);
  await caption(page, null);

  const video = page.video();
  await context.close();
  if (video) console.log(`Video: ${await video.path()}`);
  console.log(`Total: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(
    `CUES ${JSON.stringify(cueStarts.map((x) => Number(x.toFixed(2))))}`,
  );
  await browser.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
