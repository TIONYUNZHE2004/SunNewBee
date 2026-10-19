import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ACCEPTANCE_BOOKMARKS, gotoBookmark } from "./support/bookmarks";
import { fractionBelow, lumaHistogram } from "./support/pixels";
import { decodePng, maskOf, pickGrid } from "./support/scene";

/**
 * AC-A9 (task A-T8): at the link-house bookmark (`link-low`), < 0.5% of building pixels have
 * luminance < 0.03 (building pick mask, 12 px grid, Rec.709 on decoded sRGB). The vitest half
 * (no archetype colour / baked AO at black) is `assets/roleColours.test.ts`.
 * Output: ACCEPTANCE_OUT (default: the journey-sim ledger folder `acceptance/A-T8`).
 */
const OUT =
  process.env.ACCEPTANCE_OUT ??
  "C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/journey-sim/acceptance/A-T8";
const LIMIT = 0.005;

test("AC-A9: link-house bookmark has < 0.5% near-black building pixels", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await gotoBookmark(page, "link-low");
  const png = await page.screenshot({ path: join(OUT, "link-low.png") });
  const img = await decodePng(page, png);
  const building = maskOf(await pickGrid(page, 12), "building");
  const share = fractionBelow(lumaHistogram(img, { points: building.points, bins: 1000 }), 0.03);
  writeFileSync(
    join(OUT, "metrics.json"),
    `${JSON.stringify(
      {
        task: "A-T8 AC-A9",
        capturedAt: new Date().toISOString(),
        bookmark: ACCEPTANCE_BOOKMARKS["link-low"],
        buildingSamples: building.points.length,
        buildingBelow003: share,
        limit: LIMIT,
        pass: share < LIMIT,
      },
      null,
      2,
    )}\n`,
  );
  expect(building.points.length).toBeGreaterThan(200);
  expect(share).toBeLessThan(LIMIT);
});
