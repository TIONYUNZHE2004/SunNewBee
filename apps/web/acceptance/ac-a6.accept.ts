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
  // Long tasks from the first navigation on (fix round 1: the camera fit must not be one).
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: { start: number; ms: number }[] };
    w.__longTasks = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) w.__longTasks.push({ start: e.startTime, ms: e.duration });
      }).observe({ type: "longtask", buffered: true });
    } catch {
      /* longtask unsupported */
    }
  });
  const b = await gotoBookmark(page, "overview");
  await settle(page);
  const load = await page.evaluate((h) => {
    const w = window as unknown as {
      __longTasks: { start: number; ms: number }[];
    } & Record<string, { timeFitSyncMs?(): number | null }>;
    const fit = performance.getEntriesByName("tl:camera-fit")[0] as PerformanceMeasure | undefined;
    const lt = w.__longTasks ?? [];
    const during = fit
      ? lt.filter((t) => t.start < fit.startTime + fit.duration && t.start + t.ms > fit.startTime)
      : [];
    return {
      cameraFit: fit
        ? { startMs: fit.startTime, wallMs: fit.duration, detail: fit.detail ?? null }
        : null,
      fitSyncMs: w[h]?.timeFitSyncMs?.() ?? null,
      longTasks: lt.length,
      longestTaskMs: lt.reduce((m, t) => Math.max(m, t.ms), 0),
      longTasksDuringFit: during,
    };
  }, HOOK);
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
    load,
    overview: { panelClosed: closed, panelOpen: open },
    offSlab: live,
  };
  writeFileSync(join(OUT, "ac-a6.json"), `${JSON.stringify(report, null, 2)}\n`);

  expect(closed.corners).toBeGreaterThan(100);
  expect(closed.offScreen, "overview, panel closed: every slab corner on screen").toBe(0);
  expect(open.canvas[0], "the panel-open canvas is narrower").toBeLessThan(closed.canvas[0]);
  expect(open.offScreen, "overview, panel open: every slab corner on screen").toBe(0);
});

interface FlyFrame {
  lon: number;
  lat: number;
  rangeM: number;
  pitchDeg: number;
  headingDeg: number;
  x: number;
  z: number;
  inside: boolean | null;
  fov: number;
  t: number;
}

/** Flies with the rig (as a fly_to intent does) and records the base pose every animation frame. */
async function recordFlight(
  page: Page,
  from: Record<string, number>,
  to: Record<string, number>,
  ms: number,
): Promise<FlyFrame[]> {
  return page.evaluate(
    ({ h, from, to, ms }) =>
      new Promise<FlyFrame[]>((resolve) => {
        const api = (
          window as unknown as Record<
            string,
            Api & {
              flyTo(p: unknown, ms: number): void;
              insideOutline(x: number, z: number): boolean | null;
              fovDeg(): number;
            }
          >
        )[h]!;
        api.setPose(from);
        requestAnimationFrame(() => {
          api.flyTo(to, ms);
          const out: FlyFrame[] = [];
          const t0 = performance.now();
          const tick = () => {
            const p = api.getPose();
            const [x, z] = api.toLocal(p.lon, p.lat);
            out.push({
              ...p,
              x,
              z,
              inside: api.insideOutline(x, z),
              fov: api.fovDeg(),
              t: performance.now() - t0,
            });
            if (performance.now() - t0 < ms + 600) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        });
      }),
    { h: HOOK, from, to, ms },
  );
}

const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

function flightSteps(f: FlyFrame[]) {
  let target = 0;
  let heading = 0;
  let pitch = 0;
  let range = 0;
  let fov = 0;
  for (let i = 1; i < f.length; i++) {
    const a = f[i - 1]!;
    const b = f[i]!;
    target = Math.max(target, Math.hypot(b.x - a.x, b.z - a.z));
    heading = Math.max(heading, Math.abs(wrap(b.headingDeg - a.headingDeg)));
    pitch = Math.max(pitch, Math.abs(b.pitchDeg - a.pitchDeg));
    range = Math.max(range, Math.abs(Math.log(b.rangeM / a.rangeM)));
    fov = Math.max(fov, Math.abs(b.fov - a.fov));
  }
  return { frames: f.length, target, heading, pitch, rangeLog: range, fov };
}

test("AC-A6: long-route fly_to stays inside the outline and moves smoothly", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const b = await gotoBookmark(page, "overview");
  // Endpoints from the outline itself (no fixed coordinates): the overview target and the two
  // outline vertices farthest apart, pulled 300 m towards the overview target.
  const ends = await page.evaluate((h) => {
    const api = (window as unknown as Record<string, Api>)[h]!;
    const ring = (api.slabOutline() ?? [])[0] ?? [];
    let best: [Vertex, Vertex] | null = null;
    let d = -1;
    for (const p of ring)
      for (const q of ring) {
        const e = Math.hypot(p.lx - q.lx, p.lz - q.lz);
        if (e > d) {
          d = e;
          best = [p, q];
        }
      }
    return best ? best.map((v) => [v.lx, v.lz]) : null;
  }, HOOK);
  expect(ends, "an outline").not.toBeNull();
  const [o] = await page.evaluate(
    ({ h, lon, lat }) => [(window as unknown as Record<string, Api>)[h]!.toLocal(lon, lat)],
    { h: HOOK, lon: b.centre[0], lat: b.centre[1] },
  );
  const toward = (p: number[]): [number, number] => {
    const dx = (o as number[])[0]! - p[0]!;
    const dz = (o as number[])[1]! - p[1]!;
    const l = Math.hypot(dx, dz) || 1;
    return [p[0]! + (dx / l) * 300, p[1]! + (dz / l) * 300];
  };
  const lonLat = (xz: [number, number]) =>
    page.evaluate(
      ({ h, xz }) =>
        (window as unknown as Record<string, { toLonLat(x: number, z: number): [number, number] }>)[
          h
        ]!.toLonLat(xz[0], xz[1]),
      { h: HOOK, xz },
    );
  const a = await lonLat(toward(ends![0]!));
  const z = await lonLat(toward(ends![1]!));
  const pose = (ll: [number, number], rangeM: number, pitchDeg: number, headingDeg: number) => ({
    lon: ll[0],
    lat: ll[1],
    rangeM,
    pitchDeg,
    headingDeg,
  });
  const flights = {
    // End to end of the township at street-to-mid range (the tween crosses notches of the outline).
    endToEnd800: await recordFlight(page, pose(a, 800, -45, 0), pose(z, 800, -45, 180), 3000),
    // From street level at one end up to max range (through the long-range rules).
    streetToMax: await recordFlight(page, pose(a, 150, -20, 0), pose(z, 7900, -20, 90), 3000),
    // From max range down to a mid-range pose at the other end.
    maxToMid: await recordFlight(page, pose(a, 7900, -50, 300), pose(z, 600, -35, 120), 3000),
  };
  const summary = Object.fromEntries(
    Object.entries(flights).map(([k, f]) => [
      k,
      {
        ...flightSteps(f),
        outside: f.filter((r) => r.inside !== true).length,
        end: f[f.length - 1],
      },
    ]),
  );
  writeFileSync(
    join(OUT, "ac-a6-flights.json"),
    `${JSON.stringify({ task: "A-T5 fix round 1: long-route fly_to", ends: [a, z], summary }, null, 2)}\n`,
  );
  for (const [k, s] of Object.entries(summary)) {
    expect.soft(s.outside, `${k}: every frame's target inside the outline`).toBe(0);
    expect.soft(s.frames, `${k}: frames recorded`).toBeGreaterThan(60);
    // Smooth: no frame jumps (a 3 s flight over <= 8 km moves well under 600 m a frame).
    expect.soft(s.target, `${k}: target step per frame (m)`).toBeLessThan(600);
    expect.soft(s.heading, `${k}: heading step per frame (deg)`).toBeLessThan(10);
    expect.soft(s.pitch, `${k}: pitch step per frame (deg)`).toBeLessThan(5);
    expect.soft(s.rangeLog, `${k}: range step per frame (log)`).toBeLessThan(0.2);
    expect.soft(s.fov, `${k}: fov step per frame (deg)`).toBeLessThan(2);
  }
});
