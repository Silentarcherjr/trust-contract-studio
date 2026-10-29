import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 8099);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // one shared sandbox workspace
  timeout: 90_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
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
});
