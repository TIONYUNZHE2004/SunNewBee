import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { gotoBookmark, HOOK, openScene, settle } from "./support/bookmarks";
import { askDemoJourney, hasJourneyHook, journey } from "./support/journey";
import { type Box, laplacianVariance } from "./support/pixels";
import { decodePng, mapArea } from "./support/scene";

/**
 * AC-B4 and AC-B5 (task B-T5, tilt-shift depth of field). Output: ACCEPTANCE_OUT (default: the
 * journey-sim ledger folder `acceptance/B-T5`). The vitest halves: `three/tiltShift.test.ts`
 * (presets, aperture by distance, focus depth), `engine.create.test.ts` (effects by tier and
 * wish), `SettingsPopover.dom.test.tsx` (the FX toggle).
 *
 * AC-B4: in follow mode, at every beat of the §2 demo journey, the Laplacian variance of the hero
 * box (100x100 px around the focus point, hook `focusScreen`) is >= 3x that of the top band of the
 * frame (top 12% of the map area). In overview (the derived overview bookmark) a horizontal band
 * is in focus: the sharpest of 8 horizontal stripes is an interior one and >= 2x the sharper of
 * the top and bottom stripes.
 *
 * AC-B5: hook `effects()`: depth of field on at High with FX on; off under prefers-reduced-motion
 * (emulated), with the FX toggle off (the settings UI), at Medium and at Low; Low also has no AO.
 */
const OUT =
  process.env.ACCEPTANCE_OUT ??
  "C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/journey-sim/acceptance/B-T5";

const effects = (page: Page) =>
  page.evaluate(
    (h) =>
      (window as unknown as Record<string, { effects(): { dof: boolean; ao: boolean } }>)[
        h
      ]!.effects(),
    HOOK,
  );

const frames = (page: Page, n = 3) =>
  page.evaluate(
    (k) =>
      new Promise<void>((r) => {
        let i = 0;
        const f = () => (++i >= k ? r() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );

test("AC-B5: FX toggle, Medium, Low and reduced motion turn depth of field off; Low drops AO", async ({
  page,
}) => {
  mkdirSync(OUT, { recursive: true });
  const rows: Record<string, { dof: boolean; ao: boolean }> = {};
  await openScene(page, "day"); // High forced
  await frames(page);
  rows.high = await effects(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await frames(page);
  rows.highReducedMotion = await effects(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await frames(page);
  rows.highAgain = await effects(page);
  await page.getByRole("button", { name: "Map settings" }).click();
  await page
    .getByRole("radiogroup", { name: "Tilt-shift blur" })
    .getByRole("radio", { name: "Off" })
    .click();
  await frames(page);
  rows.highFxOff = await effects(page);
  for (const q of ["medium", "low"] as const) {
    await page.evaluate((v) => {
      localStorage.setItem("tl.quality", v);
      localStorage.setItem("tl.fx", "true");
    }, q);
    // openScene's init script would force High again: set the quality after it, then reload.
    await page.addInitScript((v) => localStorage.setItem("tl.quality", v), q);
    await page.reload();
    await page.waitForFunction((h) => h in window, HOOK, { timeout: 60_000 });
    await frames(page);
    rows[q] = await effects(page);
  }
  writeFileSync(
    join(OUT, "ac-b5.json"),
    `${JSON.stringify({ task: "B-T5 AC-B5", capturedAt: new Date().toISOString(), rows }, null, 2)}\n`,
  );
  expect(rows.high).toEqual({ dof: true, ao: true });
  expect(rows.highReducedMotion?.dof).toBe(false);
  expect(rows.highAgain?.dof).toBe(true);
  expect(rows.highFxOff?.dof).toBe(false);
  expect(rows.medium?.dof).toBe(false);
  expect(rows.low).toEqual({ dof: false, ao: false });
});

test("AC-B4: tilt-shift keeps the hero sharp vs the far field at every follow beat; overview focus band", async ({
  page,
}) => {
  test.setTimeout(30 * 60_000);
  mkdirSync(OUT, { recursive: true });
  // Overview band first (fresh day load, High, FX on).
  await gotoBookmark(page, "overview");
  const ovPng = await page.screenshot({ path: join(OUT, "overview.png") });
  const ov = await decodePng(page, ovPng);
  const ovArea = await mapArea(page, ov.width, ov.height, 8);
  const c = ovArea.canvas;
  const stripes: number[] = [];
  for (let i = 0; i < 8; i++) {
    const box: Box = { x: c.x, y: c.y + (c.h * i) / 8, w: c.w, h: c.h / 8 };
    stripes.push(laplacianVariance(ov, box, ovArea.mask));
  }
  const finite = stripes.map((v) => (Number.isFinite(v) ? v : 0));
  const sharpest = finite.indexOf(Math.max(...finite));
  const edge = Math.max(finite[0] as number, finite[7] as number);
  const band = {
    stripes: finite,
    sharpest,
    ratio: edge > 0 ? (finite[sharpest] as number) / edge : Number.POSITIVE_INFINITY,
  };

  // Follow beats.
  await askDemoJourney(page);
  test.skip(
    !(await hasJourneyHook(page)),
    "window.__journey is installed in dev builds and the demo preset only",
  );
  const { phases } = await journey.info(page);
  const beats = (phases as { kind: string; t0: number; t1: number }[]).filter((p) => p.t1 > p.t0);
  await journey.pause(page);
  await journey.setCam(page, "follow");
  const rows: { beat: string; hero: number; top: number; ratio: number }[] = [];
  for (const [i, p] of beats.entries()) {
    await journey.seek(page, (p.t0 + p.t1) / 2);
    await settle(page, 1500, 20_000);
    const img = await decodePng(page, await page.screenshot());
    const area = await mapArea(page, img.width, img.height, 8);
    const f = await page.evaluate(
      (h) =>
        (window as unknown as Record<string, { focusScreen(): { x: number; y: number } | null }>)[
          h
        ]!.focusScreen(),
      HOOK,
    );
    if (!f) continue;
    const r = area.canvas;
    const hero = laplacianVariance(
      img,
      { x: r.x + f.x - 50, y: r.y + f.y - 50, w: 100, h: 100 },
      area.mask,
    );
    const top = laplacianVariance(img, { x: r.x, y: r.y, w: r.w, h: r.h * 0.12 }, area.mask);
    rows.push({ beat: `${i}-${p.kind}`, hero, top, ratio: top > 0 ? hero / top : Infinity });
  }
  writeFileSync(
    join(OUT, "ac-b4.json"),
    `${JSON.stringify({ task: "B-T5 AC-B4", capturedAt: new Date().toISOString(), band, beats: rows }, null, 2)}\n`,
  );
  console.log(
    `AC-B4 overview band: sharpest stripe ${band.sharpest}, ratio ${band.ratio.toFixed(2)}; beats ${rows.length}, min ratio ${Math.min(...rows.map((r) => r.ratio)).toFixed(2)}`,
  );
  expect.soft(band.sharpest, "overview: the sharpest stripe is interior").toBeGreaterThan(0);
  expect.soft(band.sharpest, "overview: the sharpest stripe is interior").toBeLessThan(7);
  expect.soft(band.ratio, "overview: band vs edges").toBeGreaterThanOrEqual(2);
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect.soft(r.ratio, `beat ${r.beat}`).toBeGreaterThanOrEqual(3);
});
