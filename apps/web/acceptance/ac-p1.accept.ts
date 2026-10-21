import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { HOOK, openScene } from "./support/bookmarks";
import { askDemoJourney, journey } from "./support/journey";

/**
 * AC-P1 (demo polish B8): the compare split screen at Medium has a median frame at most 1.3x the
 * single-view journey playback's median, and a p95 of at most 33 ms (headless, same machine, same
 * seed). Both runs ask the §2 demo question (mock LLM, Elmina seed, Stylised, Medium, assistant
 * panel open) so the layout and the streamed city are the same:
 * - baseline: today's journey playback (follow camera), `__tlAcceptance.measure(10, 0)` from 1.5 s;
 * - split: a `route.compare` payload loaded through the compare store (dev build: the app's own
 *   module), its routes on the demo journey's polyline (recommended) and the same polyline reversed
 *   (fastest), so the two halves look at different streets; it loads paused at 3.5 s, settles 3 s
 *   (hero models, greeter kit, programs), then plays and is measured over t = 4-14 s (split).
 * Each run also times uncapped frames (`measureUncapped`, renderNow + gl.finish): headless Chromium
 * paces rAF near 60 Hz, so the display-paced median saturates at ~16.7 ms.
 * Run against a dev server (`LLM_PROVIDER=mock pnpm dev`):
 * `pnpm --filter @tl/web acceptance -g "AC-P1"`. Output: ACCEPTANCE_OUT, default
 * `<main checkout>/.superpowers/sdd/2026-10-21-demo-polish/acceptance/B8`.
 */
function defaultOut(): string {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  return join(dirname(common), ".superpowers/sdd/2026-10-21-demo-polish/acceptance/B8");
}
const OUT = process.env.ACCEPTANCE_OUT ?? defaultOut();
const SECONDS = Number(process.env.ACCEPTANCE_P1_SECONDS ?? 10);

interface Summary {
  frames: number;
  medianFps: number;
  meanFps: number;
  p95FrameMs: number;
}
interface Uncapped {
  [k: string]: unknown;
}

async function mediumDemo(page: Page): Promise<string | null> {
  await openScene(page, "day");
  // init scripts run in order on every navigation: this one (after openScene's) wins
  await page.addInitScript(() => {
    try {
      localStorage.setItem("tl.quality", "medium");
    } catch {
      /* the quality check below fails */
    }
  });
  await askDemoJourney(page);
  return page.evaluate(() => localStorage.getItem("tl.quality"));
}

const measure = (page: Page, s: number) =>
  page.evaluate(
    ({ h, s }) =>
      (window as unknown as Record<string, { measure(s: number, o: number): Promise<Summary> }>)[
        h
      ]?.measure(s, 0),
    { h: HOOK, s },
  ) as Promise<Summary & { perf: unknown }>;

const uncapped = (page: Page, n: number) =>
  page.evaluate(
    ({ h, n }) =>
      (window as unknown as Record<string, { measureUncapped(n: number, o: number): Uncapped }>)[
        h
      ]?.measureUncapped(n, 0),
    { h: HOOK, n },
  );

const medianMs = (s: Summary) => (s.medianFps > 0 ? 1000 / s.medianFps : Number.POSITIVE_INFINITY);

test("AC-P1 baseline: single-view journey playback at Medium", async ({ page }) => {
  test.setTimeout(6 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const quality = await mediumDemo(page);
  expect(quality).toBe("medium");
  await journey.setCam(page, "follow");
  await journey.seek(page, 0);
  await journey.play(page);
  await page.waitForTimeout(1500);
  const display = await measure(page, SECONDS);
  const headroom = await uncapped(page, 120);
  const result = {
    task: "demo polish B8 AC-P1 baseline",
    capturedAt: new Date().toISOString(),
    quality,
    seconds: SECONDS,
    display,
    medianMs: medianMs(display),
    headroom,
  };
  writeFileSync(join(OUT, "ac-p1-baseline.json"), `${JSON.stringify(result, null, 2)}\n`);
  await page.screenshot({ path: join(OUT, "ac-p1-baseline.png") });
  console.log(
    `[AC-P1 baseline] median ${medianMs(display).toFixed(2)} ms, p95 ${display.p95FrameMs.toFixed(2)} ms, frames ${display.frames}; uncapped ${JSON.stringify(headroom)}`,
  );
  expect(display.frames).toBeGreaterThan(0);
});

test("AC-P1 split: compare split screen at Medium", async ({ page }) => {
  test.setTimeout(6 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const quality = await mediumDemo(page);
  expect(quality).toBe("medium");
  // a compare payload on the demo route (dev build: the app's own store module)
  const loaded = await page.evaluate(async () => {
    const plan = (window as unknown as { __journey?: { plan: { polyline: number[][] } | null } })
      .__journey?.plan;
    if (!plan) return "no journey plan";
    const store = await import(/* @vite-ignore */ "/src/features/journey/compareStore.ts");
    const fx = await import(/* @vite-ignore */ "/src/features/journey/fixtures/compareHand.ts");
    const coords = plan.polyline.map((c) => [c[0], c[1]]);
    const c = fx.handCompare();
    c.recommended = { ...c.recommended, geometry: { type: "LineString", coordinates: coords } };
    c.fastest = {
      ...c.fastest,
      geometry: { type: "LineString", coordinates: [...coords].reverse() },
    };
    store.useCompare.getState().load(c);
    store.useCompare.getState().seek(3.5);
    return "ok";
  });
  expect(loaded).toBe("ok");
  // paused at 3.5 s while the two hero models, the greeter kit and their programs load (the
  // baseline journey has been on screen since the answer landed), then play
  await page.waitForTimeout(3000);
  await page.evaluate(async () => {
    const store = await import(/* @vite-ignore */ "/src/features/journey/compareStore.ts");
    store.useCompare.getState().play();
  });
  await page.waitForTimeout(500);
  const state0 = await page.evaluate(() =>
    (window as unknown as { __tl?: { demo?: { state(): unknown } } }).__tl?.demo?.state(),
  );
  const display = await measure(page, SECONDS);
  const headroom = await uncapped(page, 120);
  const baselineFile = join(OUT, "ac-p1-baseline.json");
  const baseline = existsSync(baselineFile)
    ? (JSON.parse(readFileSync(baselineFile, "utf8")) as { medianMs: number; headroom: Uncapped })
    : null;
  const ratio = baseline ? medianMs(display) / baseline.medianMs : null;
  const result = {
    task: "demo polish B8 AC-P1 split",
    capturedAt: new Date().toISOString(),
    quality,
    seconds: SECONDS,
    state0,
    display,
    medianMs: medianMs(display),
    headroom,
    baseline: baseline ? { medianMs: baseline.medianMs, headroom: baseline.headroom } : null,
    ratio,
    pass: ratio !== null && ratio <= 1.3 && display.p95FrameMs <= 33,
  };
  writeFileSync(join(OUT, "ac-p1-split.json"), `${JSON.stringify(result, null, 2)}\n`);
  await page.screenshot({ path: join(OUT, "ac-p1-split.png") });
  console.log(
    `[AC-P1 split] median ${medianMs(display).toFixed(2)} ms (x${ratio?.toFixed(3)} of baseline), p95 ${display.p95FrameMs.toFixed(2)} ms, frames ${display.frames}; uncapped ${JSON.stringify(headroom)}`,
  );
  expect(display.frames).toBeGreaterThan(0);
  expect(display.p95FrameMs).toBeLessThanOrEqual(33);
  expect(ratio).not.toBeNull();
  expect(ratio as number).toBeLessThanOrEqual(1.3);
});
