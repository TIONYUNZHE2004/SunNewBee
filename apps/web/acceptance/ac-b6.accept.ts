import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  ACCEPTANCE_BOOKMARKS,
  type BookmarkName,
  gotoBookmark,
  HOOK,
  openScene,
  settle,
  type Theme,
} from "./support/bookmarks";
import { askDemoJourney, hasJourneyHook, journey } from "./support/journey";
import { extremeShares } from "./support/pixels";
import { decodePng, mapArea } from "./support/scene";

/**
 * AC-B6 (task B-T4): "At every beat and at the day, dusk and night bookmarks, < 0.5% of pixels have
 * luminance < 0.03 and < 0.5% are clipped white." Pixels = the map area of a 1440x900 capture
 * (`mapArea`: the canvas less DOM chrome, so panels, cards and labels never count). Clipped white =
 * every channel >= 254 (`extremeShares`).
 *
 * Captures:
 * - the Phase A bookmarks at their own mood (overview, hero-mid, street, link-low by day;
 *   night-mid at night) plus `dusk-mid` (the hero-mid pose in the Dusk mood);
 * - every beat of the §2 demo journey (the midpoint of each timeline phase, follow camera, Day),
 *   through the player hook `window.__journey` (dev builds and the demo preset; skipped without it).
 * The vitest half is `three/lighting.test.ts` (light arithmetic for the darkest albedos, roads,
 * night ground, day white) and `support/pixels.test.ts` (the measure).
 * Output: ACCEPTANCE_OUT (default: the journey-sim ledger folder `acceptance/B-T4`), `ac-b6*.json`.
 */
const OUT =
  process.env.ACCEPTANCE_OUT ??
  "C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/journey-sim/acceptance/B-T4";
const LIMIT = 0.005;

interface Shot {
  name: string;
  theme: Theme;
  dark: number;
  clipped: number;
  pixels: number;
}

async function measure(
  page: Page,
  name: string,
  theme: Theme,
  png = false,
  areaStep = 4,
): Promise<Shot> {
  const buf = await page.screenshot(png ? { path: join(OUT, `ac-b6-${name}.png`) } : {});
  const img = await decodePng(page, buf);
  const area = await mapArea(page, img.width, img.height, areaStep);
  const s = extremeShares(img, { mask: area.mask });
  return { name, theme, dark: s.dark, clipped: s.clipped, pixels: s.count };
}

const write = (file: string, shots: Shot[], extra: Record<string, unknown> = {}) =>
  writeFileSync(
    join(OUT, file),
    `${JSON.stringify(
      {
        task: "B-T4 AC-B6",
        capturedAt: new Date().toISOString(),
        limit: LIMIT,
        ...extra,
        shots,
        pass: shots.every((s) => s.dark < LIMIT && s.clipped < LIMIT),
      },
      null,
      2,
    )}\n`,
  );

const failures = (shots: Shot[]) =>
  shots
    .filter((s) => s.dark >= LIMIT || s.clipped >= LIMIT)
    .map(
      (s) =>
        `${s.name}: dark ${(s.dark * 100).toFixed(2)}%, clipped ${(s.clipped * 100).toFixed(2)}%`,
    );

test("AC-B6: bookmarks in the day, dusk and night moods have < 0.5% near-black and < 0.5% clipped pixels", async ({
  page,
}) => {
  mkdirSync(OUT, { recursive: true });
  const shots: Shot[] = [];
  const day: BookmarkName[] = ["overview", "hero-mid", "street", "link-low"];
  for (const name of day) {
    await gotoBookmark(page, name);
    shots.push(await measure(page, name, "day", true));
  }
  // Dusk: the hero-mid pose in the Dusk mood.
  await openScene(page, "dusk");
  const h = ACCEPTANCE_BOOKMARKS["hero-mid"];
  await page.evaluate(
    ({ hook, p }) =>
      (window as unknown as Record<string, { setPose(p: unknown): void }>)[hook]?.setPose(p),
    {
      hook: HOOK,
      p: {
        lon: h.centre[0],
        lat: h.centre[1],
        rangeM: h.rangeM,
        pitchDeg: h.pitchDeg,
        headingDeg: h.headingDeg,
      },
    },
  );
  await settle(page);
  shots.push(await measure(page, "dusk-mid", "dusk", true));
  await gotoBookmark(page, "night-mid");
  shots.push(await measure(page, "night-mid", "night", true));
  write("ac-b6.json", shots);
  for (const s of shots)
    console.log(
      `AC-B6 ${s.name} (${s.theme}): dark ${(s.dark * 100).toFixed(3)}%, clipped ${(s.clipped * 100).toFixed(3)}%`,
    );
  expect(failures(shots)).toEqual([]);
});

test("AC-B6: every beat of the demo journey has < 0.5% near-black and < 0.5% clipped pixels", async ({
  page,
}) => {
  test.setTimeout(30 * 60_000);
  mkdirSync(OUT, { recursive: true });
  await openScene(page, "day");
  await askDemoJourney(page);
  test.skip(
    !(await hasJourneyHook(page)),
    "window.__journey is installed in dev builds and the demo preset only",
  );
  const { phases } = await journey.info(page);
  const beats = (phases as { kind: string; t0: number; t1: number }[]).filter((p) => p.t1 > p.t0);
  expect(beats.length).toBeGreaterThan(0);
  await journey.pause(page);
  await journey.setCam(page, "follow");
  const shots: Shot[] = [];
  for (const [i, p] of beats.entries()) {
    await journey.seek(page, (p.t0 + p.t1) / 2);
    await settle(page, 1500, 20_000);
    // Coarser map-area probe (8 px): the first B-T4 run timed out inside mapArea during the journey.
    // ACCEPTANCE_BEAT_PNG=1 keeps each beat's capture (diagnosis).
    const png = process.env.ACCEPTANCE_BEAT_PNG === "1";
    shots.push(await measure(page, `beat-${i}-${p.kind}`, "day", png, 8));
  }
  write("ac-b6-beats.json", shots, { beats: beats.length });
  console.log(`AC-B6 beats: ${shots.length} captured, failing: ${failures(shots).length}`);
  expect(failures(shots)).toEqual([]);
});
