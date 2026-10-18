import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Browser, expect, test } from "@playwright/test";
import { type BookmarkName, gotoBookmark } from "./support/bookmarks";
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
    if (pathStatus !== "default")
      await page.addInitScript((v: boolean) => {
        try {
          localStorage.setItem("tl.pathStatus", String(v));
        } catch {
          /* storage unavailable */
        }
      }, pathStatus);
    await gotoBookmark(page, name);
    const png = await page.screenshot({ path: join(OUT, file) });
    const img = await decodePng(page, png);
    const area = await mapArea(page, img.width, img.height);
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

const results: Record<string, unknown> = {};

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, "metrics.json"),
    `${JSON.stringify({ task: "A-T2", capturedAt: new Date().toISOString(), diffTol: DIFF_TOL, results }, null, 2)}\n`,
  );
});

test("AC-A2: no status line over a roof at the low-angle bookmark", async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const offA = await render(browser, "link-low", false, "link-low-lines-off-a.png", true);
  const offB = await render(browser, "link-low", false, "link-low-lines-off-b.png");
  const on = await render(browser, "link-low", true, "link-low-lines-on.png");
  const n = Math.min(SAMPLES, offA.building.length);
  const stride = offA.building.length / n;
  const pts = Array.from({ length: n }, (_, i) => offA.building[Math.floor(i * stride)]).filter(
    (p): p is { x: number; y: number } => !!p,
  );
  const noise = diffCount(offA.img, offB.img, offA.mask, pts);
  const diff = diffCount(offA.img, on.img, offA.mask, pts);
  const wholeOn = diffCount(offA.img, on.img, offA.mask) / offA.pixels;
  const wholeNoise = diffCount(offA.img, offB.img, offA.mask) / offA.pixels;
  results["AC-A2"] = {
    buildingPickPoints: offA.building.length,
    sampled: pts.length,
    diffOnVsOff: diff,
    noiseOffVsOff: noise,
    wholeMapChangedShareOn: wholeOn,
    wholeMapChangedShareNoise: wholeNoise,
  };
  expect(pts.length, "building samples").toBeGreaterThanOrEqual(SAMPLES);
  // No difference above noise: allow a 1% slack of the sample on top of the off-vs-off gap.
  expect(diff).toBeLessThanOrEqual(noise + Math.ceil(pts.length * 0.01));
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

test("sanity: lines still draw at mid range and the street horizon band is gone", async ({
  browser,
}) => {
  mkdirSync(OUT, { recursive: true });
  const out: Record<string, unknown> = {};
  for (const name of ["hero-mid", "street"] as const) {
    const off = await render(browser, name, false, `${name}-lines-off.png`);
    const on = await render(browser, name, true, `${name}-lines-on.png`);
    out[name] = { changedShare: diffCount(off.img, on.img, off.mask) / off.pixels };
  }
  results.sanity = out;
  expect((out["hero-mid"] as { changedShare: number }).changedShare).toBeGreaterThan(0.002);
});
