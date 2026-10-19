import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  ACCEPTANCE_BOOKMARKS,
  BOOKMARK_NAMES,
  type BookmarkName,
  gotoBookmark,
  HOOK,
  SOFTWARE_GPU,
  STREET_CHECK,
  sceneGpu,
} from "./support/bookmarks";
import { captureFrameStats } from "./support/frames";
import {
  countColour,
  fractionBelow,
  greyShare,
  laplacianVariance,
  lumaHistogram,
} from "./support/pixels";
import { decodePng, mapArea, maskOf, pickGrid } from "./support/scene";

/**
 * Baseline (task A-T0): screenshots of the five evaluation bookmarks and their metrics, before any
 * Phase A change. Output: ACCEPTANCE_OUT, default `<main checkout>/.superpowers/sdd/journey-sim/
 * acceptance/baseline` (the main checkout is the parent of git's common dir, so a lane worktree
 * writes into the coordinator's ledger). AC-A19 judges fps on the reference laptop at the gate.
 */
function defaultOut(): string {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  return join(dirname(common), ".superpowers/sdd/journey-sim/acceptance/baseline");
}
const OUT = process.env.ACCEPTANCE_OUT ?? defaultOut();
const ORBIT_SECONDS = Number(process.env.ACCEPTANCE_ORBIT_SECONDS ?? 6);
/**
 * `styles.ts` EDGE_STYLES.unknown ("Not checked yet", #B7791F) as it lands on screen after the
 * renderer's output transform: measured (181, 117, 4). AC-A3/A18 reference.
 */
const STATUS_UNKNOWN_RENDERED = "#b57504";

test("baseline: five bookmarks, screenshots and metrics", async ({ page, browserName }) => {
  mkdirSync(OUT, { recursive: true });
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  const metrics: Record<string, unknown> = {};
  const reloads: string[] = [];
  let gpu: { vendor: string; renderer: string } | null = null;
  const capture = async (name: BookmarkName) => {
    const t0 = Date.now();
    const b = await gotoBookmark(page, name);
    const tSettled = Date.now();
    gpu = await sceneGpu(page);
    expect(gpu.renderer).not.toMatch(SOFTWARE_GPU);
    const png = await page.screenshot({ path: join(OUT, `${name}.png`) });
    const img = await decodePng(page, png);
    expect([img.width, img.height]).toEqual([1440, 900]);
    // Every whole-image metric is over the map area: the canvas less the UI drawn over it.
    const area = await mapArea(page, img.width, img.height);
    const mask = area.mask;

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
    const roadShare = road.total > 0 ? road.points.length / road.total : 0;
    const roadGrey = greyShare(
      img,
      STREET_CHECK.maxSat,
      { points: road.points },
      STREET_CHECK.maxLuma,
    );
    if (name === "street") {
      // The street bookmark must show the street: enough road, and that road not under canopies.
      expect(roadShare, "street: road share of the map").toBeGreaterThanOrEqual(
        STREET_CHECK.minRoadShare,
      );
      expect(roadGrey, "street: road pixels showing asphalt").toBeGreaterThanOrEqual(
        STREET_CHECK.minAsphalt,
      );
    }
    const bh = lumaHistogram(img, { points: building.points });
    const gh = lumaHistogram(img, { points: [...ground.points, ...road.points] });
    const all = lumaHistogram(img, { mask });
    const fps = await captureFrameStats(page, ORBIT_SECONDS);
    metrics[name] = {
      bookmark: b,
      poseAfterSet: pose,
      quality,
      mapArea: { pixels: area.pixels, canvas: area.canvas },
      samples: {
        step: building.step,
        total: building.total,
        building: building.points.length,
        ground: ground.points.length,
        road: road.points.length,
        sky: maskOf(grid, "sky").points.length,
      },
      road: { share: roadShare, asphaltShare: roadGrey },
      luma: {
        meanMap: all.mean,
        meanBuilding: bh.mean,
        meanGroundRoad: gh.mean,
        buildingBelow003: fractionBelow(
          lumaHistogram(img, { points: building.points, bins: 1000 }),
          0.03,
        ),
      },
      statusUnknownShare: countColour(img, STATUS_UNKNOWN_RENDERED, 12, { mask }) / area.pixels,
      sharpness: laplacianVariance(img, undefined, mask),
      orbit: fps,
      timingsMs: { settle: tSettled - t0, pickGrid: tPicked - tPick },
    };
  };
  for (const name of BOOKMARK_NAMES) {
    try {
      await capture(name);
    } catch (err) {
      // A dev-server reload (HMR after a file change in the worktree) destroys the page context:
      // retry the bookmark once, which reopens the scene.
      if (!String(err).includes("Execution context was destroyed")) throw err;
      reloads.push(name);
      await capture(name);
    }
  }

  writeFileSync(
    join(OUT, "metrics.json"),
    `${JSON.stringify(
      {
        task: "A-T0 baseline",
        capturedAt: new Date().toISOString(),
        baseURL: test.info().project.use.baseURL,
        browser: browserName,
        gpu,
        launchArgs: test.info().project.use.launchOptions?.args ?? [],
        viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
        ui: "assistant panel closed, camera tips dismissed; metrics over the map area only",
        bookmarks: ACCEPTANCE_BOOKMARKS,
        consoleErrors,
        reloads,
        metrics,
      },
      null,
      2,
    )}\n`,
  );
});
