import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { ACCEPTANCE_BOOKMARKS, gotoBookmark, HOOK } from "./support/bookmarks";
import {
  deltaE,
  luminance,
  maskCount,
  type Point,
  parseHex,
  type RGBAImage,
} from "./support/pixels";
import { decodePng, mapArea, maskOf, type PickGrid, pickGrid } from "./support/scene";

/**
 * AC-A13 and AC-A14 (task A-T11). Output: ACCEPTANCE_OUT (default: the journey-sim ledger folder
 * `acceptance/A-T11`). The vitest halves are `mood.test.ts` (fog on, sky gradient has two colours,
 * night multiplier, the overview slab-edge fog bound) and `ground/bands.test.ts` (night grade).
 *
 * AC-A13: at the overview bookmark the top 10% of GROUND pixels (pick mask `ground`: roads,
 * buildings and sky are left out; sorted by screen row, so the far ground) are within CIE76 ΔE 15
 * of the live fog colour. At most 1% may miss (sampling noise: a pick cell on a lot edge). The
 * colour of a sample is the 5x5 median. The data-overlay scene (access lines, flood tint) is hidden
 * for this capture (hook `setOverlaysVisible`): those lines are unfogged by design and their fade
 * is A-T2's, so the measure is the ground surface itself.
 *
 * AC-A14: mean luminance of ground+road pixels (pick-masked, the samples both captures agree on)
 * at `night-mid` is <= 35% of the day value at the same pose (`hero-mid`); and lamp pools are
 * visible: of the lamps on screen (not under UI), >= 40% have a pixel of luminance >= 0.2 within
 * 5 px of the lamp, and there are at least 30 of them.
 */
const OUT =
  process.env.ACCEPTANCE_OUT ??
  "C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/journey-sim/acceptance/A-T11";

const LIT_LUMA = 0.2;

const px = (img: RGBAImage, x: number, y: number): [number, number, number] => {
  const o = (y * img.width + x) * 4;
  return [img.data[o] as number, img.data[o + 1] as number, img.data[o + 2] as number];
};

/**
 * Per-channel median of the 5x5 block at (x, y): thin overlay lines (the 1-2 px access lines are
 * data, drawn over the ground and not fogged) drop out, the fogged surface under them stays.
 */
const median5 = (img: RGBAImage, x: number, y: number): [number, number, number] => {
  const ch: number[][] = [[], [], []];
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const xx = Math.min(img.width - 1, Math.max(0, x + dx));
      const yy = Math.min(img.height - 1, Math.max(0, y + dy));
      const c = px(img, xx, yy);
      for (let i = 0; i < 3; i++) (ch[i] as number[]).push(c[i] as number);
    }
  const m = (a: number[]) => a.sort((p, q) => p - q)[12] as number;
  return [m(ch[0] as number[]), m(ch[1] as number[]), m(ch[2] as number[])];
};

const groundOnly = (g: PickGrid): Point[] => maskOf(g, "ground").points;

const groundRoad = (g: PickGrid): Point[] => [
  ...maskOf(g, "ground").points,
  ...maskOf(g, "road").points,
];

/**
 * `settle` can return before props (trees, lamps) arrive after a theme reload. Polls once a second
 * until the lamp count and the road vertex count are non-zero and unchanged across two reads.
 */
async function waitStable(page: Page, needLamps: boolean): Promise<void> {
  const read = () =>
    page.evaluate((h) => {
      const api = (
        window as unknown as Record<string, { lampPoints(): unknown[]; roadVertices(): number }>
      )[h];
      return `${api?.lampPoints().length ?? 0}|${api?.roadVertices() ?? 0}`;
    }, HOOK);
  let last = "";
  let same = 0;
  for (let i = 0; i < 90 && same < 2; i++) {
    await page.waitForTimeout(1000);
    const now = await read();
    const [lamps, roads] = now.split("|").map(Number) as [number, number];
    same = now === last && roads > 0 && (!needLamps || lamps > 0) ? same + 1 : 0;
    last = now;
  }
  if (same < 2) throw new Error(`scene did not stabilise: ${last}`);
}

async function fogOf(page: Page) {
  return page.evaluate((h) => {
    const api = (window as unknown as Record<string, { fog(): unknown }>)[h];
    return api.fog() as { color: string; near: number; far: number; background: string } | null;
  }, HOOK);
}

test("AC-A13: the far ground of the overview blends to the fog colour", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await gotoBookmark(page, "overview");
  await waitStable(page, false);
  // The access lines and flood tint are data overlays (unfogged by design; their fade is A-T2's):
  // measure the ground surface under them.
  await page.evaluate((h) => {
    (window as unknown as Record<string, { setOverlaysVisible(v: boolean): void }>)[
      h
    ]?.setOverlaysVisible(false);
  }, HOOK);
  await page.waitForTimeout(1500);
  const png = await page.screenshot({ path: join(OUT, "overview.png") });
  const img = await decodePng(page, png);
  const fog = await fogOf(page);
  expect(fog, "fog is on").not.toBeNull();
  const fogRgb = parseHex(fog?.color ?? "#000000");
  const pts = groundOnly(await pickGrid(page, 12)).sort((a, b) => a.y - b.y);
  const top = pts.slice(0, Math.max(1, Math.floor(pts.length * 0.1)));
  const de = top.map((p) => deltaE(median5(img, p.x, p.y), fogRgb)).sort((a, b) => a - b);
  const within = de.filter((d) => d <= 15).length / de.length;
  const q = (f: number) => de[Math.min(de.length - 1, Math.floor(f * de.length))] as number;
  const sky = await page.evaluate(
    () => document.querySelector('[data-testid="three-scene"]')?.getAttribute("data-theme") ?? null,
  );
  const m = {
    task: "A-T11 AC-A13",
    capturedAt: new Date().toISOString(),
    bookmark: ACCEPTANCE_BOOKMARKS.overview,
    fog,
    groundSamples: pts.length,
    topSamples: top.length,
    topRows: [top[0]?.y, top[top.length - 1]?.y],
    deltaE: { median: q(0.5), p90: q(0.9), max: de[de.length - 1], withinShare: within },
    limit: { deltaE: 15, share: 0.99 },
    pass: within >= 0.99,
    misses: top
      .map((p) => ({
        x: p.x,
        y: p.y,
        rgb: median5(img, p.x, p.y),
        de: deltaE(median5(img, p.x, p.y), fogRgb),
      }))
      .filter((r) => r.de > 15),
    sceneTheme: sky,
  };
  writeFileSync(join(OUT, "ac-a13.json"), `${JSON.stringify(m, null, 2)}\n`);
  expect(top.length).toBeGreaterThan(20);
  expect(within).toBeGreaterThanOrEqual(0.99);
});

test("AC-A14: night ground and road are <= 35% of day, lamp pools visible", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await gotoBookmark(page, "hero-mid");
  await waitStable(page, true);
  const dayPng = await page.screenshot({ path: join(OUT, "hero-mid-day.png") });
  const dayImg = await decodePng(page, dayPng);
  const dayGrid = await pickGrid(page, 12);
  const dayPts = groundRoad(dayGrid);
  const area = await mapArea(page, dayImg.width, dayImg.height);

  await gotoBookmark(page, "night-mid");
  await waitStable(page, true);
  const nightPng = await page.screenshot({ path: join(OUT, "night-mid.png") });
  const nightImg = await decodePng(page, nightPng);
  const nightGrid = await pickGrid(page, 12);
  const nightSet = new Set(groundRoad(nightGrid).map((p) => `${p.x},${p.y}`));
  const shared = dayPts.filter((p) => nightSet.has(`${p.x},${p.y}`));
  const mean = (img: RGBAImage, pts: Point[]) =>
    pts.reduce((s, p) => s + luminance(...px(img, p.x, p.y)), 0) / pts.length;
  const dayMean = mean(dayImg, shared);
  const nightMean = mean(nightImg, shared);
  const ratio = nightMean / dayMean;

  const lamps = await page.evaluate((h) => {
    const api = (window as unknown as Record<string, { lampPoints(): Point[] }>)[h];
    return api.lampPoints();
  }, HOOK);
  const rect = area.canvas;
  const onScreen = lamps
    .map((l) => ({ x: Math.round(rect.x + l.x), y: Math.round(rect.y + l.y) }))
    .filter(
      (p) =>
        p.x >= 5 &&
        p.y >= 5 &&
        p.x < nightImg.width - 5 &&
        p.y < nightImg.height - 5 &&
        area.mask[p.y * nightImg.width + p.x] === 1,
    );
  const thr = LIT_LUMA;
  const lampMax = onScreen.map((p) => {
    let best = 0;
    for (let dy = -5; dy <= 5; dy++)
      for (let dx = -5; dx <= 5; dx++)
        best = Math.max(best, luminance(...px(nightImg, p.x + dx, p.y + dy)));
    return best;
  });
  const lit = onScreen.filter((_, i) => (lampMax[i] as number) >= thr);
  const sorted = [...lampMax].sort((a, b) => a - b);
  const pct = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  const litShare = onScreen.length ? lit.length / onScreen.length : 0;
  const m = {
    task: "A-T11 AC-A14",
    capturedAt: new Date().toISOString(),
    sharedSamples: shared.length,
    daySamples: dayPts.length,
    mapAreaPixels: maskCount(area.mask),
    dayMeanLuma: dayMean,
    nightMeanLuma: nightMean,
    ratio,
    limit: { ratio: 0.35, litShare: 0.4, minLamps: 30 },
    lampMaxLuma: { p10: pct(0.1), p50: pct(0.5), p90: pct(0.9) },
    lamps: {
      total: lamps.length,
      onScreen: onScreen.length,
      lit: lit.length,
      litShare,
      litThreshold: thr,
    },
    pass: ratio <= 0.35 && litShare >= 0.4 && onScreen.length >= 30,
  };
  writeFileSync(join(OUT, "ac-a14.json"), `${JSON.stringify(m, null, 2)}\n`);
  expect(shared.length).toBeGreaterThan(200);
  expect(ratio).toBeLessThanOrEqual(0.35);
  expect(onScreen.length).toBeGreaterThanOrEqual(30);
  expect(litShare).toBeGreaterThanOrEqual(0.4);
});
