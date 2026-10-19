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
/** Extra operations with `prefers-reduced-motion: reduce` (the lift applies at once). */
const REDUCED_OPS = Number(process.env.ACCEPTANCE_REDUCED_OPS ?? 60);
/** The base height may not rise more than this over the long drag sequence (AC-A8 drift check). */
const DRIFT_TOL_M = 0.5;
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

const consoleErrors: string[] = [];
test.afterEach(({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus)
    console.log(`AC-A8 console (last 15): ${consoleErrors.slice(-15).join(" | ")}`);
});

const frames2 = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );

test("AC-A8: 300 random wheel / drag / rotate operations never put the camera inside a building", async ({
  page,
}) => {
  test.setTimeout(25 * 60_000);
  mkdirSync(OUT, { recursive: true });
  consoleErrors.length = 0;
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  // On a failure, afterEach prints the console (e.g. why the renderer fell back to the List view).

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
  const randomOps = async (n: number) => {
    for (let op = 0; op < n; op++) {
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
        const k = 1 + Math.floor(rand() * 4);
        const sign = rand() < 0.7 ? -1 : 1;
        for (let i = 0; i < k; i++) {
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
  };

  // The tallest footprint near the hero (a 1.2 km box at 10 m steps), for the flights.
  const heroLocal = await call<[number, number]>(page, "toLocal", HERO[0], HERO[1]);
  const tower = await page.evaluate(
    ({ h, c }) => {
      const api = (
        window as unknown as Record<string, Record<string, (...a: number[]) => unknown>>
      )[h];
      let best = { x: c[0], z: c[1], top: 0 };
      for (let x = c[0] - 600; x <= c[0] + 600; x += 10)
        for (let z = c[1] - 600; z <= c[1] + 600; z += 10) {
          const top = (api?.footprintTop?.(x, z) as number | null) ?? 0;
          if (top > best.top) best = { x, z, top };
        }
      return best;
    },
    { h: HOOK, c: heroLocal },
  );
  const towerLonLat = await call<[number, number]>(page, "toLonLat", tower.x, tower.z);
  /** Low flights straight across the tower (east-west), the camera path through it. */
  const flights = async (n: number) => {
    const dLon = 250 / (111_320 * Math.cos((HERO[1] * Math.PI) / 180));
    for (let i = 0; i < n; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const at = (side: number): GeoPose => ({
        lon: towerLonLat[0] + side * dLon,
        lat: towerLonLat[1],
        rangeM: 80,
        pitchDeg: -12,
        headingDeg: dir > 0 ? 90 : 270,
      });
      await call(page, "setPose", at(-dir));
      await frames2(page);
      await call(page, "flyTo", at(dir), 4000);
      await page.waitForTimeout(4600);
    }
  };

  type Log = {
    frames: number;
    overRoof: number;
    violations: number;
    worstDeficitM: number;
    minMarginM: number | null;
    minY: number;
    maxY: number;
    samples: number[][];
    maxDyM: number;
    maxLiftStepM: number;
    liftedFrames: number;
    ray: {
      checked: number;
      hits: number;
      violations: number;
      gridBelowMesh: number;
      worstGridBelowM: number;
      samples: number[][];
    };
  };
  const summary = (log: Log) => ({
    frames: log.frames,
    framesOverRoof: log.overRoof,
    violations: log.violations,
    worstDeficitM: log.worstDeficitM,
    minMarginOverRoofM: log.minMarginM,
    cameraYRangeM: [log.minY, log.maxY],
    maxDyPerFrameM: log.maxDyM,
    maxLiftStepPerFrameM: log.maxLiftStepM,
    liftedFrames: log.liftedFrames,
    meshRay: log.ray,
    violationSamples: log.samples,
  });

  // Independent check (b): drawn archetype / landmark instances against the grid, at hero-mid.
  await call(page, "setPose", {
    lon: HERO[0],
    lat: HERO[1],
    rangeM: 800,
    pitchDeg: -45,
    headingDeg: 0,
  });
  await page.waitForTimeout(3000);
  const audit = await call<{
    meshes: number;
    checked: number;
    fails: number;
    worstM: number;
    samples: unknown[];
  }>(page, "instanceAudit", 4000);
  await call(page, "setPose", heroPose());
  await frames2(page);

  await call(page, "startCameraLog");
  const t0 = Date.now();
  await randomOps(OPS);
  // Let damping and any eased lift finish inside the log.
  await page.waitForTimeout(1500);
  const log = await call<Log>(page, "stopCameraLog");
  const seconds = (Date.now() - t0) / 1000;

  // Flights straight through the tallest tower (programmatic flyTo), logged apart: a low flight
  // through a 130 m tower must climb about 115 m somewhere, so its lift steps are not the ops'.
  await call(page, "startCameraLog");
  await flights(2);
  await page.waitForTimeout(1000);
  const flown = await call<Log>(page, "stopCameraLog");

  // Drift check (review A-T7 r2): a long left-drag (pan) sequence while the camera is lifted over the
  // tower. MapControls runs update() inside its pointer handlers; the lift must never leak into the
  // base pose, so the base height (getPose: range x sin(-pitch); a ground-plane pan keeps it) must
  // not creep up.
  const baseY = (p: GeoPose) => p.rangeM * Math.sin((-p.pitchDeg * Math.PI) / 180);
  let drift: {
    startBaseYM: number;
    endBaseYM: number;
    driftM: number;
    drags: number;
    liftedSamples: number;
    maxLiftM: number;
  } | null = null;
  for (const heading of [0, 90, 180, 270]) {
    await call(page, "setPose", {
      lon: towerLonLat[0],
      lat: towerLonLat[1],
      rangeM: 50,
      pitchDeg: -70,
      headingDeg: heading,
    });
    await frames2(page);
    await page.waitForTimeout(300);
    if ((await call<number>(page, "liftM")) < 1) continue;
    const start = baseY(await call<GeoPose>(page, "getPose"));
    let liftedSamples = 0;
    let maxLiftM = 0;
    const DRAGS = 40;
    for (let i = 0; i < DRAGS; i++) {
      // Small pans back and forth: the camera stays around the tower.
      const dir = i % 2 === 0 ? 1 : -1;
      await drag("left", dir * pick(10, 40), dir * pick(-20, 20));
      const l = await call<number>(page, "liftM");
      if (l > 0) liftedSamples++;
      maxLiftM = Math.max(maxLiftM, l);
    }
    await page.waitForTimeout(1000);
    const end = baseY(await call<GeoPose>(page, "getPose"));
    drift = {
      startBaseYM: start,
      endBaseYM: end,
      driftM: end - start,
      drags: DRAGS,
      liftedSamples,
      maxLiftM,
    };
    break;
  }

  // Reduced motion: the lift applies at once; same invariant.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await call(page, "setPose", heroPose());
  await call(page, "startCameraLog");
  await randomOps(REDUCED_OPS);
  await flights(1);
  await page.waitForTimeout(1000);
  const reduced = await call<Log>(page, "stopCameraLog");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  const pass =
    log.violations === 0 &&
    flown.violations === 0 &&
    flown.ray.violations === 0 &&
    reduced.violations === 0 &&
    log.ray.violations === 0 &&
    reduced.ray.violations === 0 &&
    log.frames >= 1500 &&
    log.overRoof > 0 &&
    audit.fails === 0 &&
    audit.checked > 0 &&
    drift !== null &&
    drift.driftM <= DRIFT_TOL_M;
  const metrics = {
    criterion: "AC-A8",
    when: new Date().toISOString(),
    seed: SEED,
    operations: OPS,
    reducedMotionOperations: REDUCED_OPS,
    flights: { acrossTower: tower, main: 2, reducedMotion: 1, durationMs: 4000 },
    counts,
    seconds: Math.round(seconds * 10) / 10,
    gpu,
    grid,
    ...summary(log),
    flightsLog: summary(flown),
    reducedMotion: summary(reduced),
    instanceAudit: audit,
    dragDrift: drift,
    bookmarks,
    consoleErrors: consoleErrors.slice(0, 20),
    pass,
  };
  writeFileSync(join(OUT, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(
    `AC-A8: flights ${flown.frames} frames ${flown.violations} violations, max lift step ` +
      `${flown.maxLiftStepM.toFixed(2)} m; ` +
      `ops ${log.frames} frames (${log.overRoof} over a roof), ${log.violations} violations, ` +
      `ray ${log.ray.hits}/${log.ray.checked} hits ${log.ray.violations} violations ` +
      `${log.ray.gridBelowMesh} grid-below-mesh; reduced ${reduced.frames} frames ` +
      `${reduced.violations} violations; audit ${audit.checked} checked ${audit.fails} fails ` +
      `(worst ${audit.worstM.toFixed(3)} m); max dy ${log.maxDyM.toFixed(2)} m, max lift step ` +
      `${log.maxLiftStepM.toFixed(2)} m; ${seconds.toFixed(1)} s -> ${OUT}`,
  );

  expect(log.frames, "about 2,000 sampled frames").toBeGreaterThanOrEqual(1500);
  expect(log.overRoof, "the run passed over roofs").toBeGreaterThan(0);
  expect(log.violations, JSON.stringify(log.samples)).toBe(0);
  expect(flown.violations, JSON.stringify(flown.samples)).toBe(0);
  expect(flown.ray.violations, JSON.stringify(flown.ray.samples)).toBe(0);
  expect(reduced.violations, JSON.stringify(reduced.samples)).toBe(0);
  expect(log.ray.hits, "mesh rays hit roofs").toBeGreaterThan(0);
  expect(log.ray.violations, JSON.stringify(log.ray.samples)).toBe(0);
  expect(reduced.ray.violations, JSON.stringify(reduced.ray.samples)).toBe(0);
  expect(audit.checked).toBeGreaterThan(0);
  expect(drift, "a lifted pose over the tower for the drift check").not.toBeNull();
  expect(drift?.liftedSamples ?? 0, "the drags ran while lifted").toBeGreaterThan(0);
  expect(drift?.driftM ?? Number.POSITIVE_INFINITY, JSON.stringify(drift)).toBeLessThanOrEqual(
    DRIFT_TOL_M,
  );
  expect(audit.fails, JSON.stringify(audit.samples)).toBe(0);
});
