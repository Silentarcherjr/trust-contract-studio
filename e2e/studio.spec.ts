import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function resetTo(page: Page, scenario: string) {
  await page.goto("/studio");
  await page.getByRole("button", { name: new RegExp(`^${scenario}`) }).click();
  await page.getByRole("button", { name: /Reset sandbox/ }).click();
  await expect(page.getByText("Sandbox reset")).toBeVisible({
    timeout: 20_000,
  });
}

async function draftDemo(page: Page) {
  await page.getByRole("button", { name: /^Draft contract/ }).click();
  await page.waitForURL(/\/studio\/ctr_/);
  await expect(page.getByText(/Promise Canvas · 4 clauses/)).toBeVisible();
}

const bigSeal = (page: Page) =>
  page.locator('.tcs-seal[data-size="lg"]').first();

test("duplicate refund: claimed success is contradicted, repaired, re-verified and receipted", async ({
  page,
}) => {
  await resetTo(page, "Duplicate refund");
  await draftDemo(page);
  await expect(page.getByText("4 clauses need your decision.")).toBeVisible();
  await page.getByRole("button", { name: /Approve all 4/ }).click();
  await page.getByRole("button", { name: /Execute contract/ }).click();
  await expect(bigSeal(page)).toHaveText(/FAILED/, { timeout: 30_000 });

  const refund = page.locator("article", { hasText: "Refund $100.00" }).first();
  await expect(refund.locator(".tcs-claim")).toHaveText(/refunded \$100\.00/);
  await expect(
    refund.getByText("Claim not supported by evidence"),
  ).toBeVisible();
  await expect(refund.getByText(/over by \$100\.00/)).toBeVisible();

  await page.getByRole("button", { name: /Propose repair/ }).click();
  await expect(page.getByText(/Void 1 duplicate refund/)).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: /Approve all 1/ }).click();
  await page.getByRole("button", { name: /Execute contract/ }).click();
  await expect(
    page.locator('.tcs-seal[data-size="lg"][data-verdict="VERIFIED"]'),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: "Receipt" }).click();
  await page
    .getByRole("tabpanel")
    .getByRole("button", { name: /Export proof receipt/ })
    .click();
  await page.getByRole("button", { name: /Check integrity/ }).click();
  await expect(page.getByText(/Intact:/)).toBeVisible();
  await page.getByRole("button", { name: /Try an edited copy/ }).click();
  await expect(page.getByText(/Tampered:/)).toBeVisible();
});

test("provider timeout yields UNKNOWN, and a fresh observation resolves it", async ({
  page,
}) => {
  await resetTo(page, "Provider timeout");
  await draftDemo(page);
  await page.getByRole("button", { name: /Approve all 4/ }).click();
  await page.getByRole("button", { name: /Execute contract/ }).click();
  await expect(bigSeal(page)).toHaveText(/UNKNOWN/, { timeout: 30_000 });
  await expect(
    page.getByText("The outcome could not be observed."),
  ).toBeVisible();
  await page.getByRole("button", { name: /Re-verify/ }).click();
  await expect(
    page.locator('.tcs-seal[data-size="lg"][data-verdict="VERIFIED"]'),
  ).toBeVisible({ timeout: 30_000 });
});

test("a human rejection is honored: the refund never runs and is reported as not pursued", async ({
  page,
}) => {
  await resetTo(page, "Clean run");
  await draftDemo(page);
  const refund = page.locator("article", { hasText: "Refund $100.00" }).first();
  await refund.getByRole("button", { name: "Reject" }).click();
  await expect(
    refund.locator(".tcs-chip", { hasText: /^Rejected/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Approve all 3/ }).click();
  await page.getByRole("button", { name: /Execute contract/ }).click();
  await expect(page.locator('.tcs-seal[data-size="lg"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(refund.getByText("Not pursued").first()).toBeVisible();
  await page.goto("/studio");
  await expect(page.getByText("Refunds").locator("..")).toContainText("none");
});

test("forged evidence is caught by the integrity check", async ({ page }) => {
  await resetTo(page, "Clean run");
  await draftDemo(page);
  await page.getByRole("button", { name: /Approve all 4/ }).click();
  await page.getByRole("button", { name: /Execute contract/ }).click();
  await expect(
    page.locator('.tcs-seal[data-size="lg"][data-verdict="VERIFIED"]'),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Lab" }).click();
  await page.getByRole("button", { name: /Forge latest evidence/ }).click();
  await page.getByRole("tab", { name: "Evidence" }).click();
  await expect(page.getByText(/digest mismatch — tampered/)).toBeVisible({
    timeout: 10_000,
  });
});

test("editing approved terms voids the approval", async ({ page }) => {
  await resetTo(page, "Clean run");
  await draftDemo(page);
  const refund = page.locator("article", { hasText: "Refund $100.00" }).first();
  await refund.getByRole("button", { name: "Approve" }).click();
  await expect(refund.getByText(/Approved ·/)).toBeVisible();
  await refund.getByRole("button", { name: /Edit terms/ }).click();
  await refund.getByLabel(/Refund amount/).fill("90");
  await refund.getByRole("button", { name: "Save terms" }).click();
  await expect(
    page
      .locator("article", { hasText: "$90.00 against charge" })
      .getByText("Needs your approval"),
  ).toBeVisible();
});

test("the studio has no horizontal overflow on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

async function expectNoA11yViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .include(".tcs")
    .analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`no WCAG 2.1 AA violations on the main screens (${colorScheme})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme });
    await context.addInitScript((s) => {
      try {
        localStorage.setItem("theme", s);
      } catch {}
    }, colorScheme);
    const page = await context.newPage();
    await resetTo(page, "Showcase");
    await expectNoA11yViolations(page);
    await draftDemo(page);
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: /Approve all 4/ }).click();
    await page.getByRole("button", { name: /Execute contract/ }).click();
    await expect(bigSeal(page)).toHaveText(/FAILED/, { timeout: 30_000 });
    await expectNoA11yViolations(page);
    for (const tab of ["Evidence", "Receipt", "Lab"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expectNoA11yViolations(page);
    }
    await context.close();
  });
}
