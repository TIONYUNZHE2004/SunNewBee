import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { ACCEPTANCE_BOOKMARKS, gotoBookmark, HOOK, settle } from "./support/bookmarks";

/**
 * AC-L4 (demo polish A1): in the running app (Stylised, Elmina seed, Medium quality, hero district)
 * the decorative agents make no mid-edge U-turn over 60 s: `__tlAcceptance.uturns()` counts heading
 * reversals above 150 deg within 2 s away from a real dead end, and reports 0, with at least 40
 * vehicles and 60 people drawn. Run against a dev server on the Elmina seed with the mock LLM
 * (`LLM_PROVIDER=mock pnpm dev`): `pnpm --filter @tl/web acceptance -g "AC-L4"`.
 * Output: ACCEPTANCE_OUT, default `<main checkout>/.superpowers/sdd/2026-10-21-demo-polish/acceptance/A1`.
 */
function defaultOut(): string {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  return join(dirname(common), ".superpowers/sdd/2026-10-21-demo-polish/acceptance/A1");
}
const OUT = process.env.ACCEPTANCE_OUT ?? defaultOut();
const SECONDS = Number(process.env.ACCEPTANCE_UTURN_SECONDS ?? 60);

interface UturnReport {
  on: boolean;
  reversals: number;
  seconds: number;
  ticks: number;
  vehicles: { min: number; median: number };
  people: { min: number; median: number };
  agents: number;
  examples: string[];
}

test("AC-L4: no mid-edge U-turns over 60 s at Medium in the hero district", async ({ page }) => {
  test.setTimeout(6 * 60_000);
  mkdirSync(OUT, { recursive: true });
  // Load once (the harness forces High), then switch to Medium for the run.
  await gotoBookmark(page, "hero-mid");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("tl.quality", "medium");
    } catch {
      /* storage unavailable: the quality check below fails */
    }
  });
  await page.reload();
  await page.waitForFunction((h) => h in window, HOOK, { timeout: 60_000 });
  const quality = await page.evaluate(() => localStorage.getItem("tl.quality"));
  expect(quality).toBe("medium");
  // The hero district at the `hero-mid` bookmark (800 m): enough streets in view for 40 vehicles
  // (at 320 m only ~29 were drawn, first run 22 Oct).
  const b = ACCEPTANCE_BOOKMARKS["hero-mid"];
  const pose = {
    lon: b.centre[0],
    lat: b.centre[1],
    rangeM: b.rangeM,
    pitchDeg: b.pitchDeg,
    headingDeg: b.headingDeg,
  };
  await page.evaluate(
    ({ h, p }) => {
      (window as unknown as Record<string, { setPose(p: unknown): void }>)[h]?.setPose(p);
    },
    { h: HOOK, p: pose },
  );
  await settle(page);
  await page.evaluate((h) => {
    (window as unknown as Record<string, { uturns(start?: boolean): unknown }>)[h]?.uturns(true);
  }, HOOK);
  // A still camera: `measure` forces every frame so the motion layer ticks for the whole window.
  const frames = await page.evaluate(
    ({ h, s }) =>
      (window as unknown as Record<string, { measure(s: number, o: number): Promise<unknown> }>)[
        h
      ]?.measure(s, 0),
    { h: HOOK, s: SECONDS },
  );
  const report = (await page.evaluate(
    (h) => (window as unknown as Record<string, { uturns(): unknown }>)[h]?.uturns(),
    HOOK,
  )) as UturnReport;
  const result = {
    task: "demo polish A1 AC-L4",
    capturedAt: new Date().toISOString(),
    quality,
    pose,
    seconds: SECONDS,
    report,
    frames,
    pass:
      report.reversals === 0 &&
      report.seconds >= SECONDS * 0.9 &&
      report.vehicles.median >= 40 &&
      report.people.median >= 60,
  };
  writeFileSync(join(OUT, "uturns.json"), `${JSON.stringify(result, null, 2)}\n`);
  await page.screenshot({ path: join(OUT, "uturns-hero.png") });
  console.log(
    `[AC-L4] reversals ${report.reversals} over ${report.seconds.toFixed(1)} s; ` +
      `vehicles drawn min/median ${report.vehicles.min}/${report.vehicles.median}, ` +
      `people ${report.people.min}/${report.people.median}, agents sampled ${report.agents}`,
  );
  expect(report.seconds).toBeGreaterThanOrEqual(SECONDS * 0.9);
  expect(report.reversals, report.examples.join("\n")).toBe(0);
  expect(report.vehicles.median).toBeGreaterThanOrEqual(40);
  expect(report.people.median).toBeGreaterThanOrEqual(60);
});
