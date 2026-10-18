import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ACCEPTANCE_BOOKMARKS, BOOKMARK_NAMES, gotoBookmark, HOOK } from "./support/bookmarks";
import { captureFrameStats } from "./support/frames";
import { countColour, fractionBelow, laplacianVariance, lumaHistogram } from "./support/pixels";
import { decodePng, maskOf, pickGrid } from "./support/scene";

/**
 * Baseline (task A-T0): screenshots of the five evaluation bookmarks and their metrics, before any
 * Phase A change. Output: ACCEPTANCE_OUT (default: the journey-sim ledger folder `acceptance/baseline`).
 * fps is informational (the GPU may be shared); AC-A19 judges it on the reference laptop at the gate.
 */
const OUT =
  process.env.ACCEPTANCE_OUT ??
  "C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/journey-sim/acceptance/baseline";
const ORBIT_SECONDS = Number(process.env.ACCEPTANCE_ORBIT_SECONDS ?? 6);
/**
 * `styles.ts` EDGE_STYLES.unknown ("Not checked yet", #B7791F) as it lands on screen after the
 * renderer's output transform: measured (181, 117, 4) in this baseline. AC-A3/A18 reference.
 */
const STATUS_UNKNOWN_RENDERED = "#b57504";

test("baseline: five bookmarks, screenshots and metrics", async ({ page, browserName }) => {
  mkdirSync(OUT, { recursive: true });
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  const metrics: Record<string, unknown> = {};
  for (const name of BOOKMARK_NAMES) {
    const t0 = Date.now();
    const b = await gotoBookmark(page, name);
    const tSettled = Date.now();
    const png = await page.screenshot({ path: join(OUT, `${name}.png`) });
    const img = await decodePng(page, png);
    expect([img.width, img.height]).toEqual([1440, 900]);

    const pose = await page.evaluate(
      (h) => (window as unknown as Record<string, { getPose(): unknown }>)[h]?.getPose(),
      HOOK,
    );
    const quality = await page.evaluate(() => localStorage.getItem("tl.quality"));
    const tPick = Date.now();
    const grid = await pickGrid(page, 12);
    const tPicked = Date.now();
    const building = maskOf(grid, "building");
    const ground = maskOf(grid, "ground");
    const road = maskOf(grid, "road");
    const bh = lumaHistogram(img, { points: building.points });
    const gh = lumaHistogram(img, { points: [...ground.points, ...road.points] });
    const all = lumaHistogram(img);
    const fps = await captureFrameStats(page, ORBIT_SECONDS);
    metrics[name] = {
      bookmark: b,
      poseAfterSet: pose,
      quality,
      samples: {
        step: building.step,
        total: building.total,
        building: building.points.length,
        ground: ground.points.length,
        road: road.points.length,
        sky: maskOf(grid, "sky").points.length,
      },
      luma: {
        meanAll: all.mean,
        meanBuilding: bh.mean,
        meanGroundRoad: gh.mean,
        buildingBelow003: fractionBelow(
          lumaHistogram(img, { points: building.points, bins: 1000 }),
          0.03,
        ),
      },
      statusUnknownShare: countColour(img, STATUS_UNKNOWN_RENDERED, 12) / (img.width * img.height),
      sharpness: laplacianVariance(img, { x: 0, y: 0, w: img.width, h: img.height }),
      orbit: fps,
      timingsMs: { settle: tSettled - t0, pickGrid: tPicked - tPick },
    };
  }

  writeFileSync(
    join(OUT, "metrics.json"),
    `${JSON.stringify(
      {
        task: "A-T0 baseline",
        capturedAt: new Date().toISOString(),
        baseURL: test.info().project.use.baseURL,
        browser: browserName,
        viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
        bookmarks: ACCEPTANCE_BOOKMARKS,
        consoleErrors,
        metrics,
      },
      null,
      2,
    )}\n`,
  );
});
