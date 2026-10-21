import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { HOOK, openScene } from "./support/bookmarks";
import { askDemoJourney, journey } from "./support/journey";

/**
 * AC-P1 (demo polish B8): the compare split screen at Medium has a median frame at most 1.3x the
 * single-view journey playback's median, and a p95 of at most 33 ms (headless, same machine, same
 * seed). One run, one page, so the verdict never rests on a stale baseline file: the §2 demo
 * question (mock LLM, Elmina seed, Stylised, Medium, assistant panel open), then
 * - baseline: today's journey playback (follow camera), `__tlAcceptance.measure(10, 0)` from 1.5 s;
 * - split: on the same page, a `route.compare` payload loaded through the compare store (dev build:
 *   the app's own module; loading it ends the journey), its routes on the demo journey's polyline
 *   (recommended) and the same polyline reversed (fastest), so the two halves look at different
 *   streets; it loads paused at 3.5 s, settles 3 s (hero models, greeter kit, programs), then plays
 *   and is measured over t = 4-14 s (split).
 * Each part also times uncapped frames (`measureUncapped`, renderNow + gl.finish). Run against a dev
 * server (`LLM_PROVIDER=mock pnpm dev`): `pnpm --filter @tl/web acceptance -g "AC-P1"`. Output:
 * ACCEPTANCE_OUT, default `<main checkout>/.superpowers/sdd/2026-10-21-demo-polish/acceptance/B8`.
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
      (window as unknown as Record<string, { measureUncapped(n: number, o: number): unknown }>)[
        h
      ]?.measureUncapped(n, 0),
    { h: HOOK, n },
  );

const medianMs = (s: Summary) => (s.medianFps > 0 ? 1000 / s.medianFps : Number.POSITIVE_INFINITY);

test("AC-P1: compare split screen against the single-view journey at Medium (one run)", async ({
  page,
}) => {
  test.setTimeout(8 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const quality = await mediumDemo(page);
  expect(quality).toBe("medium");

  // baseline: the journey playback
  await journey.setCam(page, "follow");
  await journey.seek(page, 0);
  await journey.play(page);
  await page.waitForTimeout(1500);
  const base = await measure(page, SECONDS);
  const baseHeadroom = await uncapped(page, 120);
  await page.screenshot({ path: join(OUT, "ac-p1-baseline.png") });

  // split: a compare on the demo route, same page
  const loaded = await page.evaluate(
    async ({ storeUrl, fxUrl }) => {
      const plan = (window as unknown as { __journey?: { plan: { polyline: number[][] } | null } })
        .__journey?.plan;
      if (!plan) return "no journey plan";
      const store = await import(/* @vite-ignore */ storeUrl);
      const fx = await import(/* @vite-ignore */ fxUrl);
      const coords = plan.polyline.map((c) => [c[0], c[1]]);
      const c = fx.handCompare();
      c.recommended = { ...c.recommended, coordinates: coords };
      c.fastest = { ...c.fastest, coordinates: [...coords].reverse() };
      store.useCompare.getState().load(c);
      store.useCompare.getState().seek(3.5);
      return "ok";
    },
    {
      storeUrl: "/src/features/journey/compareStore.ts",
      fxUrl: "/src/features/journey/fixtures/compareHand.ts",
    },
  );
  expect(loaded).toBe("ok");
  // paused at 3.5 s while the two hero models, the greeter kit and their programs load (the
  // journey had been on screen since the answer landed), then play
  await page.waitForTimeout(3000);
  await page.evaluate(async () => {
    const store = await import(/* @vite-ignore */ "/src/features/journey/compareStore.ts");
    store.useCompare.getState().play();
  });
  await page.waitForTimeout(500);
  const state0 = await page.evaluate(() =>
    (window as unknown as { __tl?: { demo?: { state(): unknown } } }).__tl?.demo?.state(),
  );
  const split = await measure(page, SECONDS);
  const splitHeadroom = await uncapped(page, 120);
  await page.screenshot({ path: join(OUT, "ac-p1-split.png") });

  const ratio = medianMs(split) / medianMs(base);
  const result = {
    task: "demo polish B8 AC-P1 (baseline and split from one run)",
    capturedAt: new Date().toISOString(),
    quality,
    seconds: SECONDS,
    baseline: { display: base, medianMs: medianMs(base), headroom: baseHeadroom },
    split: { display: split, medianMs: medianMs(split), headroom: splitHeadroom, state0 },
    ratio,
    pass: ratio <= 1.3 && split.p95FrameMs <= 33,
  };
  writeFileSync(join(OUT, "ac-p1.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `[AC-P1] baseline median ${medianMs(base).toFixed(2)} ms p95 ${base.p95FrameMs.toFixed(2)} ms; ` +
      `split median ${medianMs(split).toFixed(2)} ms (x${ratio.toFixed(3)}) p95 ${split.p95FrameMs.toFixed(2)} ms; ` +
      `uncapped ${JSON.stringify(baseHeadroom)} -> ${JSON.stringify(splitHeadroom)}`,
  );
  expect(base.frames).toBeGreaterThan(0);
  expect(split.frames).toBeGreaterThan(0);
  expect(split.p95FrameMs).toBeLessThanOrEqual(33);
  expect(ratio).toBeLessThanOrEqual(1.3);
});
