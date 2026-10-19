import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { gotoBookmark, HOOK, settle } from "./support/bookmarks";

/**
 * AC-A6 (task A-T5), live half: the camera is bound to the Elmina slab. The vitest half is
 * `src/features/scene/three/cameraRig.test.ts` (1,000 random poses: target inside the outline; at
 * max range every slab corner projects inside the viewport, full and panel-open canvas).
 *
 * Here, in the running app (Stylised, 1440x900):
 * 1. the overview bookmark (max range) with the assistant panel closed and open: every slab
 *    outline vertex and every soil-section foot projects inside the canvas, in front of the camera;
 * 2. poses far off the slab (targets 3-6 km outside, ranges past the maximum) set through the rig
 *    end with the target inside the outline, and at max range the whole slab is in view.
 * Output: ACCEPTANCE_OUT (default: the journey-sim ledger folder `acceptance/A-T5`).
 */
const OUT =
  process.env.ACCEPTANCE_OUT ??
  "C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/journey-sim/acceptance/A-T5";

interface Vertex {
  x: number;
  y: number;
  lx: number;
  lz: number;
  inFront: boolean;
  foot: { x: number; y: number };
}

interface Api {
  size(): [number, number];
  slabOutline(): Vertex[][] | null;
  setPose(p: unknown): void;
  getPose(): { lon: number; lat: number; rangeM: number; pitchDeg: number; headingDeg: number };
  toLocal(lon: number, lat: number): [number, number];
  insideOutline?(x: number, z: number): boolean;
  fovDeg?(): number;
}

async function frameReport(page: Page) {
  return page.evaluate((h) => {
    const api = (window as unknown as Record<string, Api>)[h]!;
    const [w, hh] = api.size();
    const rings = api.slabOutline() ?? [];
    let total = 0;
    let off = 0;
    let worst = 0;
    const offList: { lx: number; lz: number; what: string; x: number; y: number }[] = [];
    for (const ring of rings)
      for (const v of ring)
        for (const [what, p] of [
          ["top", { x: v.x, y: v.y }],
          ["foot", v.foot],
        ] as const) {
          total++;
          const nx = Math.abs(p.x / w - 0.5) * 2;
          const ny = Math.abs(p.y / hh - 0.5) * 2;
          worst = Math.max(worst, nx, ny);
          if (!v.inFront || nx > 1 || ny > 1) {
            off++;
            if (offList.length < 10) offList.push({ lx: v.lx, lz: v.lz, what, x: p.x, y: p.y });
          }
        }
    return {
      canvas: [w, hh] as [number, number],
      corners: total,
      offScreen: off,
      worstNdc: worst,
      offList,
      pose: api.getPose(),
      fovDeg: api.fovDeg?.() ?? null,
    };
  }, HOOK);
}

test("AC-A6: the whole slab is in view at max range; the target stays inside the outline", async ({
  page,
}) => {
  mkdirSync(OUT, { recursive: true });
  const b = await gotoBookmark(page, "overview");
  await settle(page);
  const closed = await frameReport(page);
  await page.screenshot({ path: join(OUT, "overview-panel-closed.png") });

  // Off-slab poses through the rig (panel closed).
  const offSlab = [
    { dLon: 0.06, dLat: 0, rangeM: 20000, pitchDeg: -10, headingDeg: 90 },
    { dLon: -0.05, dLat: 0.04, rangeM: 9000, pitchDeg: -89, headingDeg: 200 },
    { dLon: 0, dLat: -0.05, rangeM: 7900, pitchDeg: -30, headingDeg: 45 },
    { dLon: 0.03, dLat: 0.03, rangeM: 800, pitchDeg: -45, headingDeg: 0 },
  ];
  const live: unknown[] = [];
  for (const o of offSlab) {
    await page.evaluate(({ h, p }) => (window as unknown as Record<string, Api>)[h]!.setPose(p), {
      h: HOOK,
      p: {
        lon: b.centre[0] + o.dLon,
        lat: b.centre[1] + o.dLat,
        rangeM: o.rangeM,
        pitchDeg: o.pitchDeg,
        headingDeg: o.headingDeg,
      },
    });
    await page.waitForTimeout(400);
    const r = await frameReport(page);
    const inside = await page.evaluate(
      ({ h, lon, lat }) => {
        const api = (window as unknown as Record<string, Api>)[h]!;
        const [x, z] = api.toLocal(lon, lat);
        return api.insideOutline?.(x, z) ?? null;
      },
      { h: HOOK, lon: r.pose.lon, lat: r.pose.lat },
    );
    live.push({ asked: o, got: r.pose, targetInside: inside, ...r });
    expect.soft(inside, `target inside the outline for ${JSON.stringify(o)}`).toBe(true);
    if (r.pose.rangeM >= 7899)
      expect.soft(r.offScreen, `max range: all corners on screen ${JSON.stringify(o)}`).toBe(0);
  }

  // The panel-open canvas: reload with the assistant docked beside the map.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("tl.panel.open", "true");
    } catch {
      /* ignore */
    }
  });
  await page.reload();
  await page.waitForFunction((h) => h in window, HOOK, { timeout: 60_000 });
  await page.evaluate(({ h, p }) => (window as unknown as Record<string, Api>)[h]!.setPose(p), {
    h: HOOK,
    p: {
      lon: b.centre[0],
      lat: b.centre[1],
      rangeM: b.rangeM,
      pitchDeg: b.pitchDeg,
      headingDeg: b.headingDeg,
    },
  });
  await settle(page);
  const open = await frameReport(page);
  await page.screenshot({ path: join(OUT, "overview-panel-open.png") });

  const report = {
    task: "A-T5 AC-A6 (live half)",
    capturedAt: new Date().toISOString(),
    bookmark: b,
    overview: { panelClosed: closed, panelOpen: open },
    offSlab: live,
  };
  writeFileSync(join(OUT, "ac-a6.json"), `${JSON.stringify(report, null, 2)}\n`);

  expect(closed.corners).toBeGreaterThan(100);
  expect(closed.offScreen, "overview, panel closed: every slab corner on screen").toBe(0);
  expect(open.canvas[0], "the panel-open canvas is narrower").toBeLessThan(closed.canvas[0]);
  expect(open.offScreen, "overview, panel open: every slab corner on screen").toBe(0);
});
