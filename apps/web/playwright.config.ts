import { defineConfig, devices } from "@playwright/test";

// Deterministic hero smoke: tiny fixture world, mock LLM, no map keys (=> List view).
// Process env overrides the repo-root .env, so empty keys really force the list view.
// Dedicated ports, so a developer's own server on :5173/:8000 (other world, other env) is never reused.
const WEB_PORT = 5273;
const API_PORT = 8100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Delete the e2e DB first so each run starts with an empty verification queue.
    // Node, not `rm`: Playwright runs this through cmd.exe on Windows.
    command:
      "node -e \"for(const s of ['','-wal','-shm'])require('fs').rmSync('.data/e2e.db'+s,{force:true})\" && pnpm dev",
    cwd: "../..",
    // Wait for the API through the Vite proxy, so both servers are up before the first test.
    url: `http://localhost:${WEB_PORT}/api/site`,
    // Always a fresh server: the suite mutates its DB (deleted on start), so reusing a leftover
    // server would run against stale state. A leftover on WEB_PORT fails loudly instead.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      WEB_PORT: String(WEB_PORT),
      API_PORT: String(API_PORT),
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
