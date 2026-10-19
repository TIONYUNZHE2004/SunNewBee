import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * AC-A16 (demo preset) and AC-A17 (no console error, no 404) against the running dev server on the
 * Elmina seed. Writes result.json to ACCEPTANCE_OUT (default: the ledger folder `acceptance/A-T13`).
 */
const OUT =
  process.env.ACCEPTANCE_OUT ??
  "C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/journey-sim/acceptance/A-T13";
const SCENE = '[data-testid="three-scene"]';
const results: Record<string, unknown> = {};

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "result.json"), `${JSON.stringify(results, null, 2)}\n`);
});

async function seedStorage(page: Page) {
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem("tl.quality", "low");
        localStorage.setItem("tl.pathStatus", "true");
        localStorage.setItem("tl.theme", "night");
        localStorage.setItem("tl.camera.hint", "dismissed");
      }
    } catch {
      /* storage unavailable */
    }
  });
}

test("AC-A16: ?demo=1 renders at High with tl.quality=low stored; a normal load keeps Low", async ({
  page,
}) => {
  await seedStorage(page);
  await page.goto("/?demo=1&acceptance=1");
  const scene = page.locator(SCENE);
  await scene.waitFor({ state: "visible", timeout: 60_000 });
  await expect(scene).toHaveAttribute("data-tier", "high");
  const demo = await page.evaluate(() => ({
    quality: localStorage.getItem("tl.quality"),
    pathStatus: localStorage.getItem("tl.pathStatus"),
    theme: document.documentElement.dataset.theme,
    storedTheme: localStorage.getItem("tl.theme"),
  }));
  expect(demo.quality).toBe("low");
  expect(demo.pathStatus).toBe("true");
  expect(demo.storedTheme).toBe("night");
  expect(demo.theme).toBe("day");

  await page.goto("/?acceptance=1");
  await scene.waitFor({ state: "visible", timeout: 60_000 });
  await expect(scene).toHaveAttribute("data-tier", "low");
  const normal = await page.evaluate(() => ({
    quality: localStorage.getItem("tl.quality"),
    theme: document.documentElement.dataset.theme,
  }));
  expect(normal).toEqual({ quality: "low", theme: "night" });
  results["AC-A16"] = { demo, normal, demoTier: "high", normalTier: "low" };
});

test("AC-A17: / and /tickets log no console error and no 404", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() === 404) problems.push(`404: ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    // Aborted navigations are not failures; WebGL/font hosts are out of scope.
    if (new URL(r.url()).origin === new URL(page.url() || "http://x").origin)
      problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`);
  });
  await page.goto("/");
  await page.locator(SCENE).waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  await page.goto("/tickets");
  await page.waitForLoadState("networkidle");
  results["AC-A17"] = { problems };
  expect(problems).toEqual([]);
  const href = await page.locator('link[rel="icon"]').getAttribute("href");
  expect(href).toBe("/favicon.svg");
});
