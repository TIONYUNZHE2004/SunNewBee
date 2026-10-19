import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { gotoBookmark, HOOK, openScene, settle } from "./support/bookmarks";

/**
 * C-T4 hero runtime: H5 (ground contact), H6 (walker held), H7 (sitting), H11 (frame cost) on the
 * hero test scene (`__tlAcceptance.heroLab()`): a flat footway strip and a bench at the camera
 * target of the live Stylised scene (Elmina seed, High, 1440x900, mock LLM), with the rigged GLB
 * hero (walker variant, the demo profile) drawn at 1.55x.
 *
 * Sampling poses the hero through the same `Hero` calls the journey player makes (clip time set
 * from t, never accumulated), so each sample is the frame drawn at that time.
 * `ACCEPTANCE_BASE_URL=http://localhost:5181 pnpm --filter @tl/web acceptance -g "H5|H6|H7|H11"`.
 * Evidence: ACCEPTANCE_OUT (default: the journey-sim ledger folder `acceptance/C-T4`).
 */
function defaultOut(): string {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  return join(dirname(common), ".superpowers/sdd/journey-sim/acceptance/C-T4");
}
const OUT = process.env.ACCEPTANCE_OUT ?? defaultOut();
/** The demo pace (spec §2 / H5): about 1.16 m/s, true pace (not the 20x compressed walk). */
const PACE = 1.16;
const TOL_M = 0.03;
const SLIDE_M = 0.05;

interface Contact {
  name: string;
  x: number;
  y: number;
  z: number;
  airborne?: boolean;
}
interface LabSample {
  t: number;
  clip: string;
  contacts: Contact[];
  grips: [number, number] | null;
  hips: [number, number, number] | null;
  root: [number, number, number];
  propLocal: [number, number, number][];
  benchDepthM?: number;
}

async function lab<T>(page: Page, fn: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async ({ h, fn, args }) => {
      const api = (window as unknown as Record<string, { heroLab(): Record<string, unknown> }>)[h];
      if (!api) throw new Error(`${h} missing`);
      const l = api.heroLab();
      return (l[fn] as (...a: unknown[]) => unknown)(...args);
    },
    { h: HOOK, fn, args },
  ) as Promise<T>;
}

async function shot(page: Page, at: { x: number; y: number }, file: string) {
  await page.waitForTimeout(400);
  const w = 420;
  const h = 420;
  await page.screenshot({
    path: join(OUT, file),
    clip: {
      x: Math.max(0, Math.min(1440 - w, at.x - w / 2)),
      y: Math.max(0, Math.min(900 - h, at.y - h / 2)),
      width: w,
      height: h,
    },
  });
}

/** Per-step foot slide: within each stance (sole within 5 mm of the footway), max horizontal drift. */
function footSteps(samples: LabSample[], footY: number) {
  const steps: { foot: string; t0: number; t1: number; slideM: number }[] = [];
  const open: Record<string, { t0: number; x: number; z: number; slide: number } | undefined> = {};
  for (const s of samples)
    for (const c of s.contacts.filter((k) => k.name.startsWith("foot"))) {
      const st = open[c.name];
      if (c.y - footY < 0.005) {
        if (!st) open[c.name] = { t0: s.t, x: c.x, z: c.z, slide: 0 };
        else st.slide = Math.max(st.slide, Math.hypot(c.x - st.x, c.z - st.z));
      } else if (st) {
        steps.push({ foot: c.name, t0: st.t0, t1: s.t, slideM: st.slide });
        open[c.name] = undefined;
      }
    }
  return steps;
}

test.describe("C-T4 hero runtime (H5, H6, H7, H11)", () => {
  test.describe.configure({ mode: "serial" });
  let page: Page;
  let levels: { footwayY: number; seatY: number; scale: number };
  const results: Record<string, unknown> = {};

  test.beforeAll(async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    results.gpu = await openScene(page, "day");
    await gotoBookmark(page, "street");
    await settle(page, 1500, 45_000);
    const opened = await lab<{ model: string; variant: string }>(page, "open", {
      variant: "walker",
    });
    results.model = opened;
    levels = await lab(page, "levels");
    results.levels = levels;
    expect(opened.model, "the rigged GLB hero loaded (not the placeholder)").toBe("glb");
  });

  test.afterAll(async () => {
    writeFileSync(join(OUT, "c-t4.json"), `${JSON.stringify(results, null, 2)}\n`);
    await lab(page, "close").catch(() => {});
    await page.close();
  });

  test("H5 ground contact at the true demo pace: foot slide <= 5 cm per step, contacts within 3 cm", async () => {
    const report: Record<string, unknown> = {};
    for (const speed of [PACE, 0.8]) {
      const samples = await lab<LabSample[]>(page, "walk", speed, 10, 60);
      const steps = footSteps(samples, levels.footwayY);
      const contacts = samples.flatMap((s) => s.contacts.map((c) => ({ t: s.t, c })));
      const rel = (c: Contact) => c.y - levels.footwayY;
      const feet = contacts.filter((r) => r.c.name.startsWith("foot"));
      const legs = contacts.filter((r) => !r.c.name.startsWith("foot"));
      const r = {
        samples: samples.length,
        steps: steps.length,
        worstSlideM: Math.max(...steps.map((s) => s.slideM)),
        meanSlideM: steps.reduce((a, s) => a + s.slideM, 0) / steps.length,
        feetMaxAboveM: Math.max(...feet.map((x) => rel(x.c))),
        feetMaxBelowM: Math.max(...feet.map((x) => -rel(x.c))),
        legsMaxAbsM: Math.max(...legs.map((x) => Math.abs(rel(x.c)))),
        legContacts: legs.length,
        airborne: contacts.filter((x) => x.c.airborne).length,
      };
      report[`speed_${speed}`] = r;
      expect(r.steps, `${speed} m/s steps`).toBeGreaterThan(10);
      expect(r.worstSlideM, `${speed} m/s slide`).toBeLessThanOrEqual(SLIDE_M);
      expect(r.feetMaxAboveM, `${speed} m/s float`).toBeLessThanOrEqual(TOL_M);
      expect(r.feetMaxBelowM, `${speed} m/s sink`).toBeLessThanOrEqual(TOL_M);
      expect(r.legsMaxAbsM, `${speed} m/s walker legs`).toBeLessThanOrEqual(TOL_M);
      expect(r.legContacts).toBe(samples.length * 4);
      expect(r.airborne).toBe(0);
    }
    results.H5 = report;
    await shot(page, await lab(page, "show", "walk", 0.4, "side", "walk"), "h5-walk-side.png");
  });

  test("H6 walker held: palms on the grips <= 3 cm through walk, idle and look; walker beside her seated", async () => {
    const report: Record<string, unknown> = {};
    let worst = 0;
    const walking = await lab<LabSample[]>(page, "walk", PACE, 4, 30);
    const clipRuns: [string, LabSample[]][] = [["walk (true pace)", walking]];
    for (const [clip, secs] of [
      ["idle", 3],
      ["look", 3.6],
    ] as const)
      clipRuns.push([clip, await lab<LabSample[]>(page, "clip", clip, secs, 30)]);
    for (const [name, run] of clipRuns) {
      const w = Math.max(...run.map((s) => Math.max(...(s.grips ?? [1, 1]))));
      report[name] = { samples: run.length, worstGripM: w };
      worst = Math.max(worst, w);
    }
    expect(worst).toBeLessThanOrEqual(TOL_M);
    // sit_*: parked beside her (her right, -x, clear of the baju's hip half-width 0.236 m true)
    const seated = await lab<LabSample[]>(page, "clip", "sit_idle", 4, 4);
    const maxX = Math.max(...seated.flatMap((s) => s.propLocal.map((p) => p[0])));
    const zs = seated.flatMap((s) => s.propLocal.map((p) => p[2]));
    const legY = Math.max(...seated.flatMap((s) => s.propLocal.map((p) => Math.abs(p[1]))));
    report.sit_idle = {
      propMaxLocalX: maxX,
      propLocalZ: [Math.min(...zs), Math.max(...zs)],
      legsAbsY: legY,
    };
    expect(maxX).toBeLessThan(-0.236 * levels.scale);
    expect(legY).toBeLessThanOrEqual(TOL_M);
    results.H6 = { worstGripM: worst, ...report };
    await shot(page, await lab(page, "show", "walk", 0.2, "behind", "walk"), "h6-walk-behind.png");
    await shot(page, await lab(page, "show", "sit_idle", 1, "front", "bench"), "h6-sit-front.png");
  });

  test("H7 sitting: in sit_idle the hip is on the seat within 5 cm, no clipping through seat or back", async () => {
    const idle = await lab<LabSample[]>(page, "clip", "sit_idle", 4, 4, { bench: true });
    const hipErr = Math.max(...idle.map((s) => Math.abs((s.hips?.[1] ?? 99) - levels.seatY)));
    const depth = Math.max(...idle.map((s) => s.benchDepthM ?? 99));
    const trans: Record<string, number> = {};
    for (const clip of ["sit_down", "stand_up"])
      trans[clip] = Math.max(
        ...(await lab<LabSample[]>(page, "clip", clip, 1.5, 10, { bench: true })).map(
          (s) => s.benchDepthM ?? 99,
        ),
      );
    results.H7 = {
      seatY: levels.seatY,
      hipsY: idle.map((s) => s.hips?.[1]),
      worstHipErrM: hipErr,
      sitIdleWorstDepthM: depth,
      transitionsWorstDepthM: trans,
      note: "depth = deepest skinned LOD0 vertex inside the seat or backrest box (displayed m); 0.0155 = 1 cm true",
    };
    expect(hipErr).toBeLessThanOrEqual(0.05);
    expect(depth).toBeLessThanOrEqual(0.0155);
    await shot(page, await lab(page, "show", "sit_idle", 1, "side", "bench"), "h7-sit-side.png");
  });

  test("H8 H9 H10 captures for the C-T5 review (6 camera poses, 12 animation frames)", async () => {
    const dir = process.env.ACCEPTANCE_OUT_C_T5 ?? join(dirname(OUT), "C-T5");
    mkdirSync(dir, { recursive: true });
    // the follow pose (spec H8): 8.5 m back, 4.5 m to the side, 4.2 m up; 30 m / 80 m along it
    const fl = Math.hypot(8.5, 4.5, 4.2);
    const along = (d: number) => ({
      side: (4.5 * d) / fl,
      up: (4.2 * d) / fl,
      back: (8.5 * d) / fl,
    });
    const poses: [string, { side: number; up: number; back: number }][] = [
      ["pose-follow", { side: 4.5, up: 4.2, back: 8.5 }],
      ["pose-behind", { side: 0, up: 2.6, back: 7 }],
      ["pose-34front", { side: 3.4, up: 1.9, back: -3.4 }],
      ["pose-side", { side: 5.5, up: 1.6, back: 0 }],
      ["pose-30m", along(30)],
      ["pose-80m", along(80)],
    ];
    const near = { side: 3, up: 1.8, back: -3 }; // 3/4 front, about 4.2 m
    const frames: [
      string,
      string,
      number,
      "walk" | "bench",
      { side: number; up: number; back: number },
    ][] = [
      ["frame-01-walk-0.00", "walk", 0, "walk", near],
      ["frame-02-walk-0.22", "walk", 0.225, "walk", near],
      ["frame-03-walk-0.45", "walk", 0.45, "walk", near],
      ["frame-04-walk-0.67", "walk", 0.675, "walk", near],
      ["frame-05-walk-behind", "walk", 0.3, "walk", { side: 0.8, up: 2.2, back: 3.6 }],
      ["frame-06-idle", "idle", 1.5, "walk", near],
      ["frame-07-look-left", "look", 0.9, "walk", near],
      ["frame-08-look-right", "look", 2.0, "walk", near],
      ["frame-09-sit_down-mid", "sit_down", 0.75, "bench", near],
      ["frame-10-sit_idle-restframing", "sit_idle", 1, "bench", { side: 2.6, up: 1.5, back: -3.4 }],
      ["frame-11-sit_idle-side", "sit_idle", 2, "bench", { side: 3.8, up: 1.3, back: 0 }],
      ["frame-12-stand_up-mid", "stand_up", 0.75, "bench", near],
    ];
    const px: Record<string, { heroPx: number; fovDeg: number; canvas: [number, number] }> = {};
    const save = async (name: string, o: Record<string, unknown>) => {
      const r = await lab<{
        url: string;
        heroPx: number;
        fovDeg: number;
        canvas: [number, number];
      }>(page, "snap", o);
      writeFileSync(join(dir, `${name}.png`), Buffer.from(r.url.split(",")[1] as string, "base64"));
      px[name] = { heroPx: r.heroPx, fovDeg: r.fovDeg, canvas: r.canvas };
    };
    // the distance shots are native-resolution crops (her true on-screen size at 1440x900); the
    // close shots scale the whole 1440x900 frame to 720x450. Every shot uses the follow view's FOV.
    for (const [name, cam] of poses)
      await save(name, {
        clip: "walk",
        time: 0.3,
        at: "walk",
        cam,
        crop: name === "pose-30m" || name === "pose-80m",
      });
    for (const [name, clip, time, at, cam] of frames)
      await save(name, { clip, time, at, cam, lookY: clip.startsWith("sit") ? 1.0 : 1.3 });
    results.C_T5 = {
      dir,
      heroPixels: px,
      poses: poses.map(([n, c]) => ({ n, c })),
      frames: frames.map(([n, clip, time, at, cam]) => ({ n, clip, time, at, cam })),
    };
    // she must read at 80 m: about 40-60 px tall at 1440x900 with the follow FOV (H8)
    expect(px["pose-80m"]?.heroPx ?? 0).toBeGreaterThan(30);
  });

  test("H11 frame cost of the hero (skinning, FX on) <= 1.0 ms per frame", async () => {
    // a follow-camera-like view on her walking lane, she in LOD0 range
    await lab(page, "show", "walk", 0, "behind", "walk");
    await page.evaluate((h) => {
      const api = (
        window as unknown as Record<string, { getPose(): unknown; setPose(p: unknown): void }>
      )[h];
      if (!api) return;
      api.setPose({ ...(api.getPose() as object), rangeM: 32, pitchDeg: -28 });
    }, HOOK);
    await settle(page, 1500, 30_000);
    const measure = (s: number) =>
      page.evaluate(
        ({ h, s }) =>
          (
            window as unknown as Record<string, { measure(s: number, o: number): Promise<unknown> }>
          )[h]?.measure(s, 10),
        { h: HOOK, s },
      ) as Promise<{ medianFps: number; p95FrameMs: number; frames: number; perf: unknown }>;
    // 1. frameStats (display, rAF-paced), 10 s with and 10 s without, twice (A/B/A/B)
    const runs: { with: boolean; display: unknown; lod: number | null }[] = [];
    for (const withHero of [true, false, true, false]) {
      await lab(page, "setVisible", withHero);
      // she walks her lane at true pace with the camera at the follow pose on her path (D-T5's
      // 8.5 m back / 4.5 m side / 4.2 m up); without her the camera runs the same path
      await lab(page, "animate", true, PACE, { pose: withHero });
      const display = await measure(10);
      runs.push({ with: withHero, display, lod: await lab(page, "lod") });
      await lab(page, "animate", false);
    }
    // 2. uncapped headroom (renderNow + gl.finish; she is posed every frame), interleaved in short
    //    runs so GPU clock drift hits both sides alike
    const unc: { with: number[]; without: number[] } = { with: [], without: [] };
    for (let k = 0; k < 8; k++)
      for (const withHero of k % 2 ? [false, true] : [true, false]) {
        const r = await lab<{ medianMs: number }>(page, "uncapped", 150, withHero);
        unc[withHero ? "with" : "without"].push(r.medianMs);
      }
    await lab(page, "setVisible", true);
    const med = (xs: number[]) => {
      const t = [...xs].sort((a, b) => a - b);
      const m = t.length >> 1;
      return t.length % 2 ? (t[m] as number) : ((t[m - 1] as number) + (t[m] as number)) / 2;
    };
    const disp = (w: boolean) =>
      runs
        .filter((r) => r.with === w)
        .map((r) => 1000 / (r.display as { medianFps: number }).medianFps);
    const displayCost = med(disp(true)) - med(disp(false));
    const uncappedCost = med(unc.with) - med(unc.without);
    results.H11 = {
      runs,
      displayMedianFrameMs: { with: disp(true), without: disp(false) },
      uncappedMedianMs: unc,
      heroCostDisplayMs: displayCost,
      heroCostUncappedMs: uncappedCost,
      note: "display = frameStats over 10 s per run (rAF-paced, idle gaps dropped), median frame ms per run, median over the two runs per side; uncapped = renderNow + gl.finish with her posed every frame, 8 interleaved pairs x 150 frames, median of run medians; camera at the follow pose (8.5 m back, 4.5 m side, 4.2 m up) on her path in both sides, she in LOD0",
      lodDuringRuns: runs.map((r) => r.lod),
    };
    expect(runs.filter((r) => r.with).every((r) => r.lod === 0)).toBe(true);
    expect(displayCost).toBeLessThanOrEqual(1.0);
    expect(uncappedCost).toBeLessThanOrEqual(1.0);
  });
});
