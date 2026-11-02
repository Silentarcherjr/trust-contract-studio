import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 8099);
/**
 * Remote mode: E2E_BASE_URL points at a deployment (e.g. the protected Vercel
 * preview). No local server is started; a fresh account is created in
 * e2e/global-setup.ts; E2E_VERCEL_BYPASS (optional) passes Vercel Deployment
 * Protection. Secrets come from the environment and are never written to the
 * repository.
 */
const REMOTE = process.env.E2E_BASE_URL;
const BYPASS = process.env.E2E_VERCEL_BYPASS;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // one shared sandbox workspace
  timeout: REMOTE ? 150_000 : 90_000,
  retries: 0,
  reporter: [["list"]],
  ...(REMOTE ? { globalSetup: "./e2e/global-setup.ts" } : {}),
  use: {
    baseURL: REMOTE ?? `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    ...(REMOTE ? { storageState: "e2e/.auth/remote.json" } : {}),
    ...(BYPASS
      ? {
          extraHTTPHeaders: {
            "x-vercel-protection-bypass": BYPASS,
            "x-vercel-set-bypass-cookie": "true",
          },
        }
      : {}),
  },
  ...(REMOTE
    ? {}
    : {
        webServer: {
          command: "rm -rf data/e2e-pglite && pnpm exec agent-native dev",
          url: `http://127.0.0.1:${PORT}/studio`,
          timeout: 180_000,
          reuseExistingServer: false,
          env: {
            DEV_HOST: "127.0.0.1",
            AUTH_DISABLED: "true",
            DATABASE_URL: "pglite:./data/e2e-pglite",
            DEV_PORT: String(PORT),
          },
        },
      }),
});
