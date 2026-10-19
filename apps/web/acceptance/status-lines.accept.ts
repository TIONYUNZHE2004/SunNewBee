import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Browser, expect, test } from "@playwright/test";
import { type BookmarkName, gotoBookmark, HOOK } from "./support/bookmarks";
import { countColour, type RGBAImage } from "./support/pixels";
import { decodePng, mapArea, maskOf, pickGrid } from "./support/scene";

/**
 * Status lines (task A-T2): AC-A2 (no line over a roof), AC-A3 (overview, lines on: line pixels < 5%
 * of the map area), AC-A18 (overview, defaults: status-line pixels < 1%). A "line pixel" is a map
 * pixel that differs from the lines-off render of the same bookmark by more than DIFF_TOL in any
 * channel; the lines-off render is taken twice, and the gap between those two is the noise floor
 * (animated water, traffic). Output: ACCEPTANCE_OUT, default the A-T2 folder of the journey-sim ledger.
 */
function defaultOut(): string {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  return join(dirname(common), ".superpowers/sdd/journey-sim/acceptance/A-T2");
}
const OUT = process.env.ACCEPTANCE_OUT ?? defaultOut();
const DIFF_TOL = 24;
const UNKNOWN_RENDERED = "#b57504"; // EDGE_STYLES.unknown as rendered (see baseline.accept.ts)
const SAMPLES = 300;

interface Shot {
  img: RGBAImage;
  mask: Uint8Array;
  pixels: number;
  building: { x: number; y: number }[];
}

async function render(
  browser: Browser,
  name: BookmarkName,
  pathStatus: boolean | "default",
  file: string,
  withPick = false,
): Promise<Shot> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    // Motion off: traffic and pedestrians stand still, so two renders differ only by what is tested.
    await page.addInitScript(
      ({ v }: { v: boolean | "default" }) => {
        try {
          localStorage.setItem("tl.motion", "false");
          if (v !== "default") localStorage.setItem("tl.pathStatus", String(v));
        } catch {
          /* storage unavailable */
        }
      },
      { v: pathStatus },
    );
    await gotoBookmark(page, name);
    // Streaming (trees, cars, building detail) can still land after settle: shoot until two shots
    // 2 s apart agree on all but 0.3% of the map, so on/off renders compare the same scene.
    let png = await page.screenshot();
    let img = await decodePng(page, png);
    const area = await mapArea(page, img.width, img.height);
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(2000);
      png = await page.screenshot();
      const next = await decodePng(page, png);
      const moved = diffCount(img, next, area.mask) / area.pixels;
      img = next;
      if (moved < 0.003) break;
    }
    writeFileSync(join(OUT, file), png);
    const building = withPick ? maskOf(await pickGrid(page, 8), "building").points : [];
    return { img, mask: area.mask, pixels: area.pixels, building };
  } finally {
    await ctx.close();
  }
}

/** Map pixels whose channels differ by more than DIFF_TOL, optionally only at `points`. */
function diffCount(
  a: RGBAImage,
  b: RGBAImage,
  mask: Uint8Array,
  points?: { x: number; y: number }[],
): number {
  let n = 0;
  const differs = (o: number) =>
    Math.abs((a.data[o] as number) - (b.data[o] as number)) > DIFF_TOL ||
    Math.abs((a.data[o + 1] as number) - (b.data[o + 1] as number)) > DIFF_TOL ||
    Math.abs((a.data[o + 2] as number) - (b.data[o + 2] as number)) > DIFF_TOL;
  if (points) {
    for (const p of points) {
      const o = (Math.round(p.y) * a.width + Math.round(p.x)) * 4;
      if (differs(o)) n++;
    }
    return n;
  }
  for (let i = 0; i < mask.length; i++) if (mask[i] && differs(i * 4)) n++;
  return n;
}

/** The points whose pixel differs between the two images by more than DIFF_TOL. */
function diffPoints(
  a: RGBAImage,
  b: RGBAImage,
  points: { x: number; y: number }[],
): { x: number; y: number }[] {
  return points.filter((p) => {
    const o = (Math.round(p.y) * a.width + Math.round(p.x)) * 4;
    return [0, 1, 2].some(
      (k) => Math.abs((a.data[o + k] as number) - (b.data[o + k] as number)) > DIFF_TOL,
    );
  });
}

const results: Record<string, unknown> = {};

/** A failed test restarts the worker, so results are merged into metrics.json after each test. */
test.afterEach(() => {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, "metrics.json");
  let prev: Record<string, unknown> = {};
  try {
    prev =
      (JSON.parse(readFileSync(file, "utf8")) as { results?: Record<string, unknown> }).results ??
      {};
  } catch {
    /* first run */
  }
  writeFileSync(
    file,
    `${JSON.stringify({ task: "A-T2", capturedAt: new Date().toISOString(), diffTol: DIFF_TOL, results: { ...prev, ...results } }, null, 2)}
`,
  );
});

test("AC-A2: no status line over a roof at the low-angle bookmark", async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const offA = await render(browser, "link-low", false, "link-low-lines-off-a.png", true);
  const offB = await render(browser, "link-low", false, "link-low-lines-off-b.png");
  const on = await render(browser, "link-low", true, "link-low-lines-on.png");
  // Every building-pick point of the step-8 grid (about 6,400), not a sample.
  const pts = offA.building;
  const diffPts = diffPoints(offA.img, on.img, pts);
  const noisePts = diffPoints(offA.img, offB.img, pts);
  results["AC-A2"] = {
    buildingPickPoints: pts.length,
    diffOnVsOff: diffPts.length,
    noiseOffVsOff: noisePts.length,
    diffPoints: diffPts.slice(0, 60),
    noisePoints: noisePts.slice(0, 60),
    wholeMapChangedShareOn: diffCount(offA.img, on.img, offA.mask) / offA.pixels,
    wholeMapChangedShareNoise: diffCount(offA.img, offB.img, offA.mask) / offA.pixels,
  };
  expect(pts.length, "building samples").toBeGreaterThanOrEqual(1000);
  expect(diffPts.length).toBeLessThanOrEqual(noisePts.length);
});

test("AC-A3: overview with lines on, line pixels < 5% of the map area", async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const off = await render(browser, "overview", false, "overview-lines-off.png");
  const off2 = await render(browser, "overview", false, "overview-lines-off-b.png");
  const on = await render(browser, "overview", true, "overview-lines-on.png");
  const share = diffCount(off.img, on.img, off.mask) / off.pixels;
  const noise = diffCount(off.img, off2.img, off.mask) / off.pixels;
  const colour = countColour(on.img, UNKNOWN_RENDERED, 12, { mask: on.mask }) / on.pixels;
  results["AC-A3"] = { linePixelShare: share, noiseShare: noise, unknownColourShare: colour };
  expect(share).toBeLessThan(0.05);
});

test("AC-A18: overview with defaults, status-line pixels < 1% of the map area", async ({
  browser,
}) => {
  mkdirSync(OUT, { recursive: true });
  const def = await render(browser, "overview", "default", "overview-defaults.png");
  const colour = countColour(def.img, UNKNOWN_RENDERED, 12, { mask: def.mask }) / def.pixels;
  results["AC-A18"] = { unknownColourShare: colour };
  expect(colour).toBeLessThan(0.01);
});

test("sanity: lines draw at mid range; night-mid pair; amber fidelity", async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const out: Record<string, unknown> = {};
  for (const name of ["hero-mid", "street", "night-mid"] as const) {
    const off = await render(browser, name, false, `${name}-lines-off.png`);
    const on = await render(browser, name, true, `${name}-lines-on.png`);
    out[name] = { changedShare: diffCount(off.img, on.img, off.mask) / off.pixels };
    if (name === "hero-mid") {
      // Is the amber "Not checked yet" line still amber after main-pass AO and tone mapping?
      // Changed pixels that are amber-ish (r > g > b, r - b > 80) and their median colour.
      const amber: number[][] = [];
      for (let i = 0; i < off.mask.length; i++) {
        if (!off.mask[i]) continue;
        const o = i * 4;
        const px = [0, 1, 2].map((k) => on.img.data[o + k] as number);
        const changed = [0, 1, 2].some(
          (k) => Math.abs((px[k] as number) - (off.img.data[o + k] as number)) > DIFF_TOL,
        );
        const [r, g, b] = px as [number, number, number];
        if (changed && r > g && g > b && r - b > 80) amber.push(px);
      }
      const med = (k: number) =>
        amber.map((c) => c[k] as number).sort((x, y) => x - y)[amber.length >> 1];
      out.amber = {
        pixels: amber.length,
        medianRgb: amber.length ? [med(0), med(1), med(2)] : null,
        reference: "#b57504 = (181,117,4), the overlay-pass rendering measured in A-T0",
      };
    }
  }
  results.sanity = out;
  expect((out["hero-mid"] as { changedShare: number }).changedShare).toBeGreaterThan(0.002);
});

/**
 * Route highlight (order 13) depth-tested vs forced always on top, status off. Route pixels are
 * pixels that differ from the route-off render and sit within 45 of the median colour of the
 * on-top route. The route comes from POST /api/routes (Parking to Shelter, 900 m past Urban Park).
 */
test("route highlight: visible share when depth-tested vs always on top", async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const out: Record<string, unknown> = {};
  type Hook = {
    setPose(p: unknown): void;
    getPose(): unknown;
    linesOnTop(o: number, on: boolean): number;
  };
  for (const name of ["link-low", "hero-mid", "street"] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await gotoBookmark(page, name);
      // Applying a route may fly the camera; every shot restores the bookmark pose first.
      const pose = await page.evaluate(
        (h) => (window as unknown as Record<string, Hook>)[h]?.getPose(),
        HOOK,
      );
      const shot = async (file: string) => {
        await page.evaluate(
          ({ h, p }) => (window as unknown as Record<string, Hook>)[h]?.setPose(p),
          { h: HOOK, p: pose },
        );
        await page.waitForTimeout(1200);
        return decodePng(page, await page.screenshot({ path: join(OUT, file) }));
      };
      const off = await shot(`route-${name}-off.png`);
      const area = await mapArea(page, off.width, off.height);
      const ok = await page.evaluate(async () => {
        const r = await fetch("/api/routes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            from: "osm-way-1318133038",
            to: "osm-way-1286251730",
            profile: "default",
          }),
        });
        const geometry = (await r.json()).routes?.[0]?.geometry;
        if (!geometry) return false;
        const path = "/src/features/scene/sceneStore.ts";
        const mod = await import(/* @vite-ignore */ path);
        mod.useScene
          .getState()
          .applyIntent({ kind: "route.highlight", route_id: "acc-route", geojson: geometry });
        return true;
      });
      expect(ok, "route fetched and applied").toBe(true);
      await page.waitForTimeout(2500);
      const tested = await shot(`route-${name}-depth.png`);
      const n = await page.evaluate(
        (h) => (window as unknown as Record<string, Hook>)[h]?.linesOnTop(13, true),
        HOOK,
      );
      expect(n, "route batches").toBeGreaterThan(0);
      const top = await shot(`route-${name}-ontop.png`);
      const cols: number[][] = [];
      for (let i = 0; i < area.mask.length; i++) {
        if (!area.mask[i]) continue;
        const o = i * 4;
        const big = [0, 1, 2].some(
          (k) => Math.abs((top.data[o + k] as number) - (off.data[o + k] as number)) > 80,
        );
        if (big) cols.push([0, 1, 2].map((k) => top.data[o + k] as number));
      }
      const m = [0, 1, 2].map(
        (k) => cols.map((c) => c[k] as number).sort((x, y) => x - y)[cols.length >> 1] as number,
      );
      const count = (img: RGBAImage) => {
        let c = 0;
        for (let i = 0; i < area.mask.length; i++) {
          if (!area.mask[i]) continue;
          const o = i * 4;
          const changed = [0, 1, 2].some(
            (k) => Math.abs((img.data[o + k] as number) - (off.data[o + k] as number)) > DIFF_TOL,
          );
          const close = [0, 1, 2].every(
            (k) => Math.abs((img.data[o + k] as number) - (m[k] as number)) <= 45,
          );
          if (changed && close) c++;
        }
        return c;
      };
      const nTop = count(top);
      const nTested = count(tested);
      out[name] = {
        routeColourRgb: m,
        onTopPixels: nTop,
        depthTestedPixels: nTested,
        visibleShare: nTop ? nTested / nTop : null,
      };
    } finally {
      await ctx.close();
    }
  }
  results.route = out;
});
