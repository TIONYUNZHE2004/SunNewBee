import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openScene, settle } from "./support/bookmarks";
import { askDemoJourney, hasJourneyHook, journey } from "./support/journey";

/**
 * Iteration 2 (owner's screen recording): a 30 fps "screen capture" of the journey camera over the
 * dive and the corner before the 888 m rest, for the phase-correlation jitter metric
 * (`.superpowers/sdd/journey-sim/acceptance/OWNER-VIDEO/shake.py`, folder mode). The camera is a
 * pure function of trip time (AC-D17), so the frames are taken paused, seeking t in 1/30 s steps:
 * what a 30 fps recording of the playback shows, without the recorder's own frame drops.
 * Also stills at the 638 m rest, the 762 m walk, the 836 m approach and the end of the pull-back.
 * `ACCEPTANCE_OUT=<dir> ACCEPTANCE_BASE_URL=http://localhost:5197 pnpm --filter @tl/web acceptance -g "journey shake"`.
 */
const OUT =
  process.env.ACCEPTANCE_OUT ??
  "C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/journey-sim/acceptance/ITER2-shake";
const FPS = 30;

interface Phase {
  kind: string;
  t0: number;
  t1: number;
  m0: number;
  event?: { kind: string };
}

async function frames(page: Page) {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

async function mapClip(page: Page) {
  const r = await page.evaluate(() => {
    const c = document.querySelector("canvas")?.getBoundingClientRect();
    return c ? { x: c.left, y: c.top, width: c.width, height: c.height } : null;
  });
  expect(r, "map canvas").not.toBeNull();
  return r as { x: number; y: number; width: number; height: number };
}

async function camera(page: Page) {
  return page.evaluate(() => {
    const j = (window as unknown as { __journey: { camera(): { camera: number[] } | null } })
      .__journey;
    return j.camera()?.camera ?? null;
  });
}

test.describe("journey shake (iteration 2)", () => {
  test("30 fps frames over the dive and the 888 m corner, stills at 638 / 762 / 836 m and the end", async ({
    page,
  }) => {
    await openScene(page, "day");
    await askDemoJourney(page);
    expect(await hasJourneyHook(page)).toBe(true);
    const { total, phases } = await journey.info(page);
    const ph = phases as Phase[];
    await journey.pause(page);
    await journey.setCam(page, "follow");
    await journey.seek(page, 0.01);
    await settle(page, 1500, 45_000);
    const clip = await mapClip(page);
    // the drawn-building grid, for offline checks of the camera against what is drawn
    mkdirSync(OUT, { recursive: true });
    const grid = await page.evaluate(() =>
      (window as unknown as { __journey: { grid(): unknown } }).__journey.grid(),
    );
    writeFileSync(join(OUT, "grid.json"), JSON.stringify(grid));
    if (process.env.SHAKE_GRID_ONLY === "1") return;
    const restAt = (m: number) =>
      ph.find((p) => p.kind === "event" && p.event?.kind === "rest" && Math.abs(p.m0 - m) < 6);
    const r888 = restAt(888);
    const r638 = restAt(638);
    expect(r888, "rest at 888 m").toBeTruthy();
    const tAtM = (m: number) => {
      const w = ph.find(
        (p) => p.kind === "walk" && p.m0 <= m && (p as Phase & { m1: number }).m1 >= m,
      ) as (Phase & { m1: number }) | undefined;
      return w ? w.t0 + ((m - w.m0) / (w.m1 - w.m0)) * (w.t1 - w.t0) : null;
    };
    const windows: [string, number, number][] = [
      ["dive", 0, 4.5],
      ["corner888", (r888 as Phase).t0 - 3, (r888 as Phase).t0 + 2],
    ];
    const poses: Record<string, (number[] | null)[]> = {};
    for (const [name, a, b] of windows) {
      const dir = join(OUT, name);
      mkdirSync(dir, { recursive: true });
      poses[name] = [];
      const n = Math.round((b - a) * FPS);
      for (let i = 0; i <= n; i++) {
        await journey.seek(page, a + i / FPS);
        await frames(page);
        await page.screenshot({ path: join(dir, `${String(i).padStart(4, "0")}.png`), clip });
        poses[name]?.push(await camera(page));
      }
    }
    const stills: [string, number | null][] = [
      ["rest638", r638 ? (r638.t0 + r638.t1) / 2 : null],
      ["walk762", tAtM(762)],
      ["approach836", tAtM(830)],
      // just before the end: at the end the player hands the camera back to the orbit rig
      ["pullEnd", total - 0.02],
    ];
    for (const [name, t] of stills) {
      if (t === null) continue;
      await journey.seek(page, t);
      await settle(page, 600, 15_000);
      await page.screenshot({ path: join(OUT, `still-${name}.png`) });
    }
    writeFileSync(join(OUT, "poses.json"), JSON.stringify({ windows, stills, poses }, null, 1));
  });
});
