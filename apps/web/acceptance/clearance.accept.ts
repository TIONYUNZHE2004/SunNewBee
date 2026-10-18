import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { ACCEPTANCE_BOOKMARKS, BOOKMARK_NAMES, HOOK, openScene } from "./support/bookmarks";

/**
 * AC-A8 (task A-T7): after 300 random wheel, drag and rotate operations over the hero district, the
 * camera is never inside a building footprint below roof height + 2 m in any sampled frame (every
 * rendered frame, about 2,000). Real pointer input through Playwright's mouse (MapControls: wheel
 * dollies to the cursor, left drag pans, right drag rotates and tilts); a seeded RNG
 * (ACCEPTANCE_SEED) makes the run reproducible. Every rendered frame's camera is checked in the page
 * against the footprint lookup on the acceptance hook (`footprintTop`, the clearance grid built
 * from the drawn footprints and placed boxes). Output: ACCEPTANCE_OUT, default `<main checkout>/
 * .superpowers/sdd/journey-sim/acceptance/A-T7/metrics.json`.
 *
 * Run: `ACCEPTANCE_BASE_URL=http://localhost:<web port> pnpm --filter @tl/web acceptance -g AC-A8`.
 */
function defaultOut(): string {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  return join(dirname(common), ".superpowers/sdd/journey-sim/acceptance/A-T7");
}
const OUT = process.env.ACCEPTANCE_OUT ?? defaultOut();
const SEED = Number(process.env.ACCEPTANCE_SEED ?? 20261019);
const OPS = Number(process.env.ACCEPTANCE_OPS ?? 300);
/** Elmina City Centre / Urban Park (`three/bookmarks.ts` HERO_CENTRE). */
const HERO: [number, number] = [101.5095, 3.1805];
/** The hero district for this test: the target stays within this distance of HERO (else re-centred). */
const HERO_KEEP_M = 700;
const MAX_RANGE_M = 1500;

/** mulberry32: a small seeded PRNG in [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GeoPose {
  lon: number;
  lat: number;
  rangeM: number;
  pitchDeg: number;
  headingDeg: number;
}

const call = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    ({ h, fn, args }) => {
      const api = (
        window as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>
      )[h];
      if (!api) throw new Error(`${h} missing`);
      return api[fn]?.(...args) as T;
    },
    { h: HOOK, fn, args },
  );

const metresFromHero = (p: GeoPose) => {
  const kx = 111_320 * Math.cos((HERO[1] * Math.PI) / 180);
  return Math.hypot((p.lon - HERO[0]) * kx, (p.lat - HERO[1]) * 110_574);
};

const frames2 = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );

test("AC-A8: 300 random wheel / drag / rotate operations never put the camera inside a building", async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  const gpu = await openScene(page, "day");
  const scene = page.locator('[data-testid="three-scene"]');
  // The clearance grid takes the placed archetypes once the city assets are in.
  await expect
    .poll(async () => scene.getAttribute("data-assets"), { timeout: 90_000 })
    .toMatch(/ready|failed|off/);
  await expect
    .poll(async () => (await call<{ count: number } | null>(page, "clearance"))?.count ?? 0, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  const grid = await call<{ count: number; clearanceM: number; maxTopM: number }>(
    page,
    "clearance",
  );

  // Bookmarks under clearance: is any of the five evaluation poses changed by the lift?
  const bookmarks: Record<string, { lifted: boolean; dyM: number }> = {};
  for (const name of BOOKMARK_NAMES) {
    const b = ACCEPTANCE_BOOKMARKS[name];
    const want: GeoPose = {
      lon: b.centre[0],
      lat: b.centre[1],
      rangeM: b.rangeM,
      pitchDeg: b.pitchDeg,
      headingDeg: b.headingDeg,
    };
    await call(page, "setPose", want);
    const y0 = b.rangeM * Math.sin((-b.pitchDeg * Math.PI) / 180);
    await frames2(page);
    const [, y] = await call<[number, number, number]>(page, "cameraLocal");
    bookmarks[name] = { lifted: y - y0 > 0.01, dyM: Math.round((y - y0) * 100) / 100 };
  }

  const rand = rng(SEED);
  const pick = (lo: number, hi: number) => lo + (hi - lo) * rand();
  const heroPose = (): GeoPose => ({
    lon: HERO[0] + pick(-0.003, 0.003),
    lat: HERO[1] + pick(-0.003, 0.003),
    rangeM: pick(40, 300),
    pitchDeg: pick(-45, -8),
    headingDeg: pick(0, 360),
  });
  await call(page, "setPose", heroPose());
  await frames2(page);

  const canvas = page.locator('[data-testid="three-scene"] canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  /** A canvas point not under DOM chrome (controls, chips). */
  const point = async (): Promise<{ x: number; y: number }> => {
    for (let i = 0; i < 20; i++) {
      const x = box.x + pick(0.15, 0.85) * box.width;
      const y = box.y + pick(0.15, 0.85) * box.height;
      const free = await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y) ===
          document.querySelector('[data-testid="three-scene"] canvas'),
        { x, y },
      );
      if (free) return { x, y };
    }
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const drag = async (button: "left" | "right", dx: number, dy: number) => {
    const p = await point();
    await page.mouse.move(p.x, p.y);
    await page.mouse.down({ button });
    const steps = 4 + Math.floor(rand() * 5);
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(p.x + (dx * i) / steps, p.y + (dy * i) / steps);
      await page.waitForTimeout(16);
    }
    await page.mouse.up({ button });
  };

  const counts = { wheel: 0, drag: 0, rotate: 0, recentred: 0 };
  await call(page, "startCameraLog");
  const t0 = Date.now();
  for (let op = 0; op < OPS; op++) {
    const pose = await call<GeoPose>(page, "getPose");
    if (metresFromHero(pose) > HERO_KEEP_M || pose.rangeM > MAX_RANGE_M) {
      await call(page, "setPose", heroPose());
      counts.recentred++;
    }
    const r = rand();
    if (r < 0.45) {
      // Wheel: mostly zooming in (towards roofs), 1-4 notches at the cursor.
      counts.wheel++;
      const p = await point();
      await page.mouse.move(p.x, p.y);
      const n = 1 + Math.floor(rand() * 4);
      const sign = rand() < 0.7 ? -1 : 1;
      for (let i = 0; i < n; i++) {
        await page.mouse.wheel(0, sign * pick(100, 400));
        await page.waitForTimeout(16);
      }
    } else if (r < 0.7) {
      counts.drag++;
      await drag("left", pick(-260, 260), pick(-200, 200));
    } else {
      counts.rotate++;
      await drag("right", pick(-320, 320), pick(-160, 160));
    }
    await page.waitForTimeout(pick(20, 120));
  }
  // Let damping and any eased lift finish inside the log.
  await page.waitForTimeout(1500);
  const log = await call<{
    frames: number;
    overRoof: number;
    violations: number;
    worstDeficitM: number;
    minMarginM: number | null;
    minY: number;
    maxY: number;
    samples: number[][];
  }>(page, "stopCameraLog");
  const seconds = (Date.now() - t0) / 1000;

  const metrics = {
    criterion: "AC-A8",
    when: new Date().toISOString(),
    seed: SEED,
    operations: OPS,
    counts,
    seconds: Math.round(seconds * 10) / 10,
    gpu,
    grid,
    frames: log.frames,
    framesOverRoof: log.overRoof,
    violations: log.violations,
    worstDeficitM: log.worstDeficitM,
    minMarginOverRoofM: log.minMarginM,
    cameraYRangeM: [log.minY, log.maxY],
    violationSamples: log.samples,
    bookmarks,
    consoleErrors: consoleErrors.slice(0, 20),
    pass: log.violations === 0 && log.frames >= 1500 && log.overRoof > 0,
  };
  writeFileSync(join(OUT, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(
    `AC-A8: ${log.frames} frames (${log.overRoof} over a roof), ${log.violations} violations, ` +
      `min margin ${log.minMarginM?.toFixed(2)} m, ${OPS} ops in ${seconds.toFixed(1)} s -> ${OUT}`,
  );

  expect(log.frames, "about 2,000 sampled frames").toBeGreaterThanOrEqual(1500);
  expect(log.overRoof, "the run passed over roofs").toBeGreaterThan(0);
  expect(log.violations, JSON.stringify(log.samples)).toBe(0);
});
