import { randomBytes } from "node:crypto";
import fs from "node:fs";

import { chromium, type FullConfig } from "@playwright/test";

/**
 * Remote mode only: create a fresh synthetic account on the deployment and
 * save its session, so every run starts in a new, empty workspace.
 */
export default async function globalSetup(config: FullConfig) {
  const use = config.projects[0]!.use;
  const browser = await chromium.launch();
  const context = await browser.newContext({
    extraHTTPHeaders: use.extraHTTPHeaders,
  });
  const page = await context.newPage();
  await page.goto(`${use.baseURL}/studio`);
  await page.waitForURL(/sign-in/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Create account" }).first().click();
  const email = `e2e-${Date.now()}@example.test`;
  const password = randomBytes(12).toString("hex");
  await page.locator("input[type=email]:visible").fill(email);
  const passwords = page.locator("input[type=password]:visible");
  await passwords.nth(0).fill(password);
  await passwords.nth(1).fill(password);
  await page.locator("button[type=submit]:visible").click();
  await page.waitForURL(/\/studio/, { timeout: 60_000 });
  fs.mkdirSync("e2e/.auth", { recursive: true });
  await context.storageState({ path: "e2e/.auth/remote.json" });
  await browser.close();
}
