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

  expect(closed.corners, "slab corners projected (2 per outline vertex)").toBeGreaterThan(0);
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

/**
 * Flies with the rig (as a fly_to intent does) and returns the base pose of every engine frame
 * (hook `startPoseLog`: logged inside the engine's frame callback, so the samples are the frames
 * actually drawn, in order).
 */
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
              startPoseLog(): void;
              stopPoseLog(): FlyFrame[];
            }
          >
        )[h]!;
        api.setPose(from);
        requestAnimationFrame(() => {
          api.startPoseLog();
          api.flyTo(to, ms);
          setTimeout(() => resolve(api.stopPoseLog()), ms + 600);
        });
      }),
    { h: HOOK, from, to, ms },
  );
}

const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * Per-frame-pair steps, and rates per second of frame time over two samples (dt floored at 2/60 s). The flights are
 * time-based tweens, so a load hitch (a long frame while tiles stream in) makes a big per-frame
 * step at a normal rate; a snap is a big step in a short frame, i.e. a huge rate. The rates are
 * what is asserted; steps and the longest frame gap are reported.
 */
function flightSteps(f: FlyFrame[]) {
  const step = { target: 0, heading: 0, pitch: 0, rangeLog: 0, fov: 0 };
  const rate = { target: 0, heading: 0, pitch: 0, rangeLog: 0, fov: 0 };
  let maxGapMs = 0;
  for (let i = 1; i < f.length; i++) {
    maxGapMs = Math.max(maxGapMs, f[i]!.t - f[i - 1]!.t);
  }
  // Rates over a two-sample window: the recorder's rAF and the engine's tick can swap order around a
  // long frame, so one short recorder frame can hold a whole long engine step. The window i-2 -> i
  // spans that gap; a real snap is still a big move in a short window.
  for (let i = 2; i < f.length; i++) {
    const a = f[i - 2]!;
    const b = f[i]!;
    const dt = Math.max(b.t - a.t, 2000 / 60) / 1000;
    const d = {
      target: Math.hypot(b.x - a.x, b.z - a.z),
      heading: Math.abs(wrap(b.headingDeg - a.headingDeg)),
      pitch: Math.abs(b.pitchDeg - a.pitchDeg),
      rangeLog: Math.abs(Math.log(b.rangeM / a.rangeM)),
      fov: Math.abs(b.fov - a.fov),
    };
    for (const k of Object.keys(d) as (keyof typeof d)[]) {
      step[k] = Math.max(step[k], d[k]);
      rate[k] = Math.max(rate[k], d[k] / dt);
    }
  }
  return { frames: f.length, maxGapMs, step, ratePerS: rate };
}

/**
 * Rate bounds (per second): the 3 s flights cover <= ~7 km, 180 deg and 1.4 log-range at an eased
 * peak of 1.5x the mean; these leave >= 2x headroom over that. A one-frame snap of 300 m or 10 deg
 * in a 16 ms frame is 18 km/s or 600 deg/s.
 */
const RATE_MAX = { target: 8000, heading: 200, pitch: 60, rangeLog: 3, fov: 30 };

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
    // Smooth: no snap (rates per second of frame time; see flightSteps).
    for (const m of Object.keys(RATE_MAX) as (keyof typeof RATE_MAX)[])
      expect.soft(s.ratePerS[m], `${k}: ${m} rate per s`).toBeLessThan(RATE_MAX[m]);
  }
});

test("AC-A6: ?bookmark=township eases to the derived overview when the fit lands (no snap)", async ({
  page,
}) => {
  mkdirSync(OUT, { recursive: true });
  // Same storage as openScene (High, day, panel closed, tips dismissed), then a recorder that logs
  // the base pose every animation frame from load until 3 s after the camera fit lands.
  await page.addInitScript((h: string) => {
    try {
      localStorage.setItem("tl.quality", "high");
      localStorage.setItem("tl.theme", "day");
      localStorage.setItem("tl.panel.open", "false");
      localStorage.setItem("tl.camera.hint", "dismissed");
    } catch {
      /* ignore */
    }
    const w = window as unknown as {
      __rec: unknown[];
      __recDone: boolean;
      __fitAt: number | null;
    } & Record<string, unknown>;
    w.__rec = [];
    w.__recDone = false;
    w.__fitAt = null;
    let logging = false;
    // As soon as the hook exists, log every engine frame (startPoseLog); stop 3 s after the fit.
    const tick = () => {
      const api = w[h] as
        | {
            overviewPose(): unknown;
            startPoseLog(): void;
            stopPoseLog(): unknown[];
          }
        | undefined;
      if (api && !logging) {
        api.startPoseLog();
        logging = true;
      }
      if (api && w.__fitAt === null && api.overviewPose() !== null) w.__fitAt = performance.now();
      if (api && w.__fitAt !== null && performance.now() - w.__fitAt > 3000) {
        w.__rec = api.stopPoseLog();
        w.__recDone = true;
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, HOOK);
  await page.goto("/?acceptance=1&bookmark=township");
  await page.waitForFunction(() => (window as unknown as { __recDone: boolean }).__recDone, null, {
    timeout: 90_000,
  });
  const { rec, overview } = await page.evaluate((h) => {
    const w = window as unknown as { __rec: Record<string, number | boolean>[] } & Record<
      string,
      { overviewPose(): unknown }
    >;
    return { rec: w.__rec, overview: w[h]!.overviewPose() as Record<string, number> };
  }, HOOK);
  const frames = rec as unknown as (FlyFrame & { fitReady: boolean })[];
  // Steps around and after the landing (from the last pre-fit frame on).
  const first = frames.findIndex((f) => f.fitReady);
  const span = frames.slice(Math.max(0, first - 1));
  const steps = flightSteps(span);
  const end = frames[frames.length - 1]!;
  const before = frames[Math.max(0, first - 1)]!;
  writeFileSync(
    join(OUT, "ac-a6-township-landing.json"),
    `${JSON.stringify(
      {
        task: "A-T5 fix round 2: ?bookmark=township landing",
        framesRecorded: frames.length,
        framesAfterFit: span.length,
        preFitPose: before,
        overview,
        end,
        steps,
      },
      null,
      2,
    )}\n`,
  );
  expect(first, "the fit landed").toBeGreaterThan(0);
  // Eased, not snapped: per-frame steps stay small across the landing.
  for (const m of Object.keys(RATE_MAX) as (keyof typeof RATE_MAX)[])
    expect.soft(steps.ratePerS[m], `landing ${m} rate per s`).toBeLessThan(RATE_MAX[m]);
  // And it ends on the derived overview.
  expect.soft(Math.abs(end.lon - overview.lon!) * 111_000, "end lon (m)").toBeLessThan(5);
  expect.soft(Math.abs(end.lat - overview.lat!) * 111_000, "end lat (m)").toBeLessThan(5);
  expect.soft(Math.abs(end.pitchDeg - overview.pitchDeg!), "end pitch").toBeLessThan(0.1);
  expect
    .soft(Math.abs(wrap(end.headingDeg - overview.headingDeg!)), "end heading")
    .toBeLessThan(0.1);
  expect.soft(Math.abs(end.rangeM - overview.rangeM!), "end range").toBeLessThan(1);
});
