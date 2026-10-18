import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { HOOK, openScene } from "./support/bookmarks";

/**
 * AC-A7 (task A-T6): real wheel events (deltaY 100, one notch) take the camera from max range to
 * street level in 15-25 notches, no notch changes the range by more than 20%, and one notch is
 * smoothed over >= 4 frames. "Street level" = within 20% of the range floor (the 20% cap makes the
 * exact floor take 26 notches: 9000 x 0.8^25 = 34 m). The pure maths is `three/zoom.test.ts`.
 * Output: ACCEPTANCE_OUT (default: the journey-sim ledger folder `acceptance/A-T6`).
 */
const OUT =
  process.env.ACCEPTANCE_OUT ??
  "C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/journey-sim/acceptance/A-T6";
const MIN = 30;
const MAX = 9000;
const STREET = MIN * 1.2;

type Api = { setPose(p: unknown): void; getPose(): { rangeM: number } };

test("AC-A7: proportional, smoothed wheel zoom", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await openScene(page, "day");
  await page.evaluate(
    ({ h, rangeM }) => {
      (window as unknown as Record<string, Api>)[h]?.setPose({
        lon: 101.5099,
        lat: 3.1813,
        rangeM,
        pitchDeg: -55,
        headingDeg: 0,
      });
    },
    { h: HOOK, rangeM: MAX },
  );
  const range = () =>
    page.evaluate(
      (h) => (window as unknown as Record<string, Api>)[h]?.getPose().rangeM ?? 0,
      HOOK,
    );
  // Let the pose settle and the clamp apply.
  await page.waitForTimeout(500);
  const start = await range();
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // Smoothing: one notch, range sampled every animation frame until it stops changing.
  const sampler = page.evaluate(
    (h) =>
      new Promise<number[]>((resolve) => {
        const get = () => (window as unknown as Record<string, Api>)[h]?.getPose().rangeM ?? 0;
        const out: number[] = [get()];
        let quiet = 0;
        let moved = false;
        const step = () => {
          const r = get();
          if (r !== out[0]) moved = true;
          quiet = moved && r === out[out.length - 1] ? quiet + 1 : 0;
          out.push(r);
          if (quiet >= 15 || out.length > 400) resolve(out);
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    HOOK,
  );
  await page.waitForTimeout(100);
  await page.mouse.wheel(0, -100);
  const frames: number[] = await sampler;
  const changing = frames.filter((r, i) => i > 0 && r !== frames[i - 1]).length;
  await page.waitForTimeout(300);

  // Notch count: one wheel notch at a time, each fully settled before the next.
  const ranges: number[] = [await range()];
  const afterSmoothNotch = ranges[0] as number;
  let notches = 1;
  let exactNotches = 0;
  let worst = Math.abs(afterSmoothNotch - start) / start;
  let reachedStreet = afterSmoothNotch <= STREET ? 1 : 0;
  for (let i = 0; i < 40 && !exactNotches; i++) {
    const before = (ranges[ranges.length - 1] as number) ?? start;
    await page.mouse.wheel(0, -100);
    let r = before;
    for (let k = 0; k < 40; k++) {
      await page.waitForTimeout(30);
      const now = await range();
      if (now === r && k > 6) break;
      r = now;
    }
    ranges.push(r);
    notches++;
    worst = Math.max(worst, Math.abs(r - before) / before);
    if (!reachedStreet && r <= STREET) reachedStreet = notches;
    if (r <= MIN + 0.01) exactNotches = notches;
  }

  const metrics = {
    task: "A-T6 AC-A7",
    capturedAt: new Date().toISOString(),
    startRangeM: start,
    minRangeM: MIN,
    streetThresholdM: STREET,
    notchesToStreet: reachedStreet,
    notchesToExactFloor: exactNotches,
    worstNotchChange: worst,
    framesChangingForOneNotch: changing,
    oneNotchRangeSeries: frames.slice(0, 20),
    rangesPerNotch: ranges,
    limits: { notches: [15, 25], maxNotchChange: 0.2, minSmoothFrames: 4 },
  };
  writeFileSync(join(OUT, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);

  expect(start).toBeGreaterThan(MAX * 0.99);
  expect(reachedStreet).toBeGreaterThanOrEqual(15);
  expect(reachedStreet).toBeLessThanOrEqual(25);
  expect(worst).toBeLessThanOrEqual(0.2 + 0.005);
  expect(changing).toBeGreaterThanOrEqual(4);
});
