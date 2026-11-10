import { expect, test, type Page } from "@playwright/test";

/**
 * Keyboard-only walkthrough of the full loop (issue #3). No mouse input after
 * page load: every control is reached with Tab / Shift+Tab / arrow keys and
 * operated with Enter or Space. Each stop also checks that a visible focus
 * indicator is drawn. The number of Tab presses per step is logged, so a
 * regression in focus order shows up as a jump in the log.
 */

type Focused = {
  role: string;
  name: string;
  outline: string;
  inTcs: boolean;
};

async function focused(page: Page): Promise<Focused> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return { role: "", name: "", outline: "none", inTcs: false };
    }
    const style = getComputedStyle(el);
    const labelledBy = el.getAttribute("aria-labelledby");
    const name = (
      el.getAttribute("aria-label") ??
      (labelledBy
        ? document.getElementById(labelledBy)?.textContent
        : undefined) ??
      el.textContent ??
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
    return {
      role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
      name,
      outline:
        style.outlineStyle !== "none" && style.outlineWidth !== "0px"
          ? `${style.outlineStyle} ${style.outlineWidth}`
          : style.boxShadow !== "none"
            ? "box-shadow"
            : "none",
      inTcs: !!el.closest(".tcs"),
    };
  });
}

const presses: Record<string, number> = {};

/** Press Tab (or Shift+Tab) until the focused control matches. */
async function tabTo(
  page: Page,
  name: RegExp,
  opts: { role?: string; back?: boolean; max?: number } = {},
) {
  const { role = "button", back = false, max = 120 } = opts;
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
    const f = await focused(page);
    if (f.role === role && name.test(f.name)) {
      presses[`${role} ${name.source}`] = i;
      // Inside the Studio the custom ring must show; framework chrome uses
      // its own (also checked: anything but "none").
      expect(f.outline, `focus ring on "${f.name}"`).not.toBe("none");
      return f;
    }
  }
  throw new Error(
    `No ${role} matching ${name} within ${max} ${back ? "Shift+Tab" : "Tab"} presses`,
  );
}

async function press(page: Page, name: RegExp, key = "Enter") {
  await tabTo(page, name);
  await page.keyboard.press(key);
}

async function expectFocusOn(page: Page, name: RegExp) {
  await expect
    .poll(async () => (await focused(page)).name, { timeout: 30_000 })
    .toMatch(name);
  const f = await focused(page);
  expect(f.outline, `focus ring on "${f.name}"`).not.toBe("none");
}

const bigSeal = (page: Page) =>
  page.locator('.tcs-seal[data-size="lg"]').first();

test("the full loop works with the keyboard alone", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/studio");
  await expect(
    page.getByText(/Scenarios: replay a real mistake/),
  ).toBeVisible();

  // Replay Lab: pick a scenario and reset (Space activates buttons too).
  await press(page, /^Showcase \(demo\)/, " ");
  await tabTo(page, /Reset sandbox/, { back: true });
  await page.keyboard.press("Enter");
  await expect(page.getByText("Sandbox reset")).toBeVisible({
    timeout: 20_000,
  });
  await expectFocusOn(page, /Reset sandbox/);
  await expect(
    page.getByRole("button", { name: /^Draft contract/ }),
  ).toBeEnabled();

  // Composer → Draft contract (Shift+Tab: the composer is above the lab).
  await tabTo(page, /^Draft contract/, { back: true });
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/studio\/ctr_/);
  await expect(page.getByText(/Promise Canvas · 4 clauses/)).toBeVisible();

  // Human approval and execution. After each step the next step's button
  // takes focus, so Enter alone walks the loop (no Tab hunting).
  await press(page, /Approve all 4/);
  await expectFocusOn(page, /Execute contract/);
  await page.keyboard.press("Enter");
  await expect(bigSeal(page)).toHaveText(/FAILED/, { timeout: 30_000 });

  // Repair round.
  await expectFocusOn(page, /Propose repair/);
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Void 1 duplicate refund/).first()).toBeVisible({
    timeout: 20_000,
  });
  await expectFocusOn(page, /Approve all 2/);
  await page.keyboard.press("Enter");
  await expectFocusOn(page, /Execute contract/);
  await page.keyboard.press("Enter");
  await expect(
    page.locator('.tcs-seal[data-size="lg"][data-verdict="VERIFIED"]'),
  ).toBeVisible({ timeout: 30_000 });
  await expectFocusOn(page, /View proof receipt/);

  // The unverifiable-requests disclosure opens from the keyboard.
  await tabTo(page, /What this contract cannot prove/, { role: "summary" });
  await page.keyboard.press("Enter");
  await expect(
    page.locator("details", { hasText: "What this contract cannot prove" }),
  ).toHaveAttribute("open", "");

  // Inspector tabs: one Tab stop, arrows move selection AND focus.
  await tabTo(page, /^Timeline$/, { role: "tab" });
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Receipt" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect((await focused(page)).name).toBe("Receipt");
  await page.keyboard.press("End");
  expect((await focused(page)).name).toBe("Drills");
  await page.keyboard.press("Home");
  expect((await focused(page)).name).toBe("Timeline");
  await page.keyboard.press("ArrowLeft");
  expect((await focused(page)).name).toBe("Drills");
  await page.keyboard.press("ArrowLeft");
  expect((await focused(page)).name).toBe("Receipt");

  // Receipt: export (focus stays on the button while pending), check
  // integrity, try an edited copy.
  await press(page, /Export proof receipt/);
  await expectFocusOn(page, /Re-issue receipt/);
  await press(page, /Check integrity/);
  await expect(page.getByText(/Intact:/)).toBeVisible();
  await press(page, /Try an edited copy/);
  await expect(page.getByText(/Tampered:/)).toBeVisible();

  console.log("Tab presses per stop:", JSON.stringify(presses, null, 2));
});
