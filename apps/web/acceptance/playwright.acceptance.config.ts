import { defineConfig, devices } from "@playwright/test";

/**
 * Acceptance harness for the resident-journey work (spec §3 bookmarks, §9): visual and performance
 * criteria against a running dev server on the Elmina seed, Stylised (Three.js) map, mock LLM.
 * No webServer: start one yourself (e.g. `LLM_PROVIDER=mock pnpm dev`) and point
 * ACCEPTANCE_BASE_URL at it. Real GPU (headed-equivalent flags), 1440×900 at DPR 1.
 *
 * Specs are `*.accept.ts`, so neither the e2e config (`e2e/`) nor vitest (`*.test.ts`) picks them up.
 * Run: `pnpm --filter @tl/web acceptance -g baseline`.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.accept.ts",
  timeout: 10 * 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../test-results/acceptance",
  use: {
    baseURL: process.env.ACCEPTANCE_BASE_URL ?? "http://localhost:5173",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        // Hardware WebGL in headless Chromium (ANGLE on the real GPU, not SwiftShader).
        launchOptions: { args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] },
      },
    },
  ],
});
