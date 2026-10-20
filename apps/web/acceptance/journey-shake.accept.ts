import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openScene, settle } from "./support/bookmarks";
import { askDemoJourney, hasJourneyHook, journey } from "./support/journey";
import { decodePng } from "./support/scene";

/**
 * Iteration 2 (owner's screen recording): a 30 fps "screen capture" of the journey camera over the
 * dive and the corner before the 888 m rest, for the phase-correlation jitter metric
 * (`.superpowers/sdd/journey-sim/acceptance/OWNER-VIDEO/shake.py`, folder mode). The camera is a
 * pure function of trip time (AC-D17), so the frames are taken paused, seeking t in 1/30 s steps:
 * what a 30 fps recording of the playback shows, without the recorder's own frame drops.
 * Also stills at the 638 m rest, the 762 m walk, the 836 m approach and the end of the pull-back.
 * `ACCEPTANCE_OUT=<dir> ACCEPTANCE_BASE_URL=http://localhost:5197 pnpm --filter @tl/web acceptance -g "journey shake"`.
 *
 * "wide stills" (owner ruling 20 Oct 2026, "Wider"): stills at 44 m (unknown hold), the 371 m,
 * 608 m and 762 m walks and the 638 m and 888 m rests, each with her drawn height as a share of
 * the map height: her silhouette is the pixels drawn flat magenta (`__journey.show("heroColour",
 * false)`), feet to head, walker included. On a walk she should fill about a quarter.
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

  test("wide stills: her height as a share of the map at 44 / 371 / 608 / 638 / 762 / 888 m", async ({
    page,
  }) => {
    await openScene(page, "day");
    await askDemoJourney(page);
    expect(await hasJourneyHook(page)).toBe(true);
    const { phases } = await journey.info(page);
    const ph = phases as (Phase & { m1: number })[];
    await journey.pause(page);
    await journey.setCam(page, "follow");
    await journey.seek(page, 0.01);
    await settle(page, 1500, 45_000);
    const clip = await mapClip(page);
    mkdirSync(OUT, { recursive: true });
    const holdAt = (kind: string, m: number) =>
      ph.find((p) => p.kind === "event" && p.event?.kind === kind && Math.abs(p.m0 - m) < 6);
    const mid = (p: Phase | undefined) => (p ? (p.t0 + p.t1) / 2 : null);
    const tAtM = (m: number) => {
      const w = ph.find((p) => p.kind === "walk" && p.m0 <= m && p.m1 >= m);
      return w ? w.t0 + ((m - w.m0) / (w.m1 - w.m0)) * (w.t1 - w.t0) : null;
    };
    const beats: [string, "walk" | "hold", number | null][] = [
      ["unknown44", "hold", mid(holdAt("unknown", 44))],
      ["walk371", "walk", tAtM(371)],
      ["walk608", "walk", tAtM(608)],
      ["rest638", "hold", mid(holdAt("rest", 638))],
      ["walk762", "walk", tAtM(762)],
      ["rest888", "hold", mid(holdAt("rest", 888))],
    ];
    const show = (v: boolean) =>
      page.evaluate(
        (vis) =>
          (
            window as unknown as { __journey: { show(p: string, v: boolean): boolean } }
          ).__journey.show("heroColour", vis),
        v,
      );
    const rows: Record<string, unknown>[] = [];
    for (const [name, kind, t] of beats) {
      expect(t, name).not.toBeNull();
      await journey.seek(page, t as number);
      await settle(page, 600, 15_000);
      await page.screenshot({ path: join(OUT, `wide-${name}.png`) });
      const probe = (await page.evaluate(() =>
        (
          window as unknown as {
            __journey: {
              camera(): {
                frame: { w: number; h: number };
                heroBox: { h: number } | null;
                heroDistM: number | null;
                camera: number[];
              } | null;
            };
          }
        ).__journey.camera(),
      )) as {
        frame: { w: number; h: number };
        heroBox: { h: number } | null;
        heroDistM: number | null;
      } | null;
      expect(await show(false), "__journey.show").toBe(true);
      await page.waitForTimeout(250);
      const img = await decodePng(page, await page.screenshot({ clip }));
      expect(await show(true)).toBe(true);
      let y0 = Number.POSITIVE_INFINITY;
      let y1 = -1;
      let n = 0;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const k = (y * img.width + x) * 4;
          const d = img.data;
          if ((d[k] as number) > 180 && (d[k + 1] as number) < 90 && (d[k + 2] as number) > 180) {
            n++;
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
          }
        }
      const frameH = probe?.frame.h ?? clip.height;
      const share = n > 0 ? (y1 - y0 + 1) / frameH : 0;
      rows.push({
        name,
        kind,
        t,
        heroPx: n,
        heroHeightPx: n > 0 ? y1 - y0 + 1 : 0,
        frameH,
        share: Math.round(share * 1000) / 1000,
        probeBoxShare: probe?.heroBox ? Math.round((probe.heroBox.h / frameH) * 1000) / 1000 : null,
        heroDistM: probe?.heroDistM ?? null,
      });
    }
    writeFileSync(join(OUT, "wide-stills.json"), JSON.stringify(rows, null, 1));
    // she is drawn at every beat; on a walk she fills about a quarter of the map height
    for (const r of rows) {
      expect(r.heroPx as number, `${r.name}: her silhouette`).toBeGreaterThan(200);
      if (r.kind === "walk") {
        expect(r.share as number, `${r.name}: share`).toBeGreaterThanOrEqual(0.18);
        expect(r.share as number, `${r.name}: share`).toBeLessThanOrEqual(0.32);
      }
    }
  });
});
