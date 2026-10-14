import { defineConfig, devices } from "@playwright/test";

// Deterministic hero smoke: tiny fixture world, mock LLM, no map keys (=> List view).
// Process env overrides the repo-root .env, so empty keys really force the list view.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Delete the e2e DB first so each run starts with an empty verification queue.
    command: "rm -f .data/e2e.db* && pnpm dev",
    cwd: "../..",
    url: "http://localhost:5173",
    // Locally, an already-running server on :5173 is reused (it must use the e2e env, see below);
    // CI always starts a fresh one.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      LLM_PROVIDER: "mock",
      TL_DATA_DIR: "packages/spatial/tests/fixtures/tiny",
      DATABASE_URL: "sqlite:///./.data/e2e.db",
      STAFF_TOKEN: "e2e-token",
      GOOGLE_MAPS_API_KEY: "",
      CESIUM_ION_ACCESS_TOKEN: "",
      MAPBOX_ACCESS_TOKEN: "",
    },
  },
});
