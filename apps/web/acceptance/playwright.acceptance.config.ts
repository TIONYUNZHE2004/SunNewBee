import { defineConfig, devices } from "@playwright/test";

/**
 * Acceptance harness for the resident-journey work (spec §3 bookmarks, §9): visual and performance
 * criteria against a running dev server on the Elmina seed, Stylised (Three.js) map, mock LLM.
 * No webServer: start one yourself (e.g. `LLM_PROVIDER=mock pnpm dev`) and point
 * ACCEPTANCE_BASE_URL at it. 1440×900 at DPR 1.
 *
 * GPU: ANGLE on Direct3D 11, high-performance adapter. On the reference laptop (hybrid graphics)
 * this gives "ANGLE (NVIDIA, NVIDIA GeForce RTX 2050 ... Direct3D11 ...)"; `openScene` records the
 * renderer and refuses software rasterisers. Vsync and the frame-rate limit are off, but headless
 * Chromium still paces rAF at about 60 Hz (BeginFrame), so the display-paced fps tops out near 60;
 * `captureFrameStats` also times uncapped frames (renderNow + gl.finish) for the headroom.
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
        launchOptions: {
          args: [
            "--use-angle=d3d11",
            "--force_high_performance_gpu",
            "--enable-gpu",
            "--ignore-gpu-blocklist",
            "--disable-gpu-vsync",
            "--disable-frame-rate-limit",
          ],
        },
      },
    },
  ],
});
