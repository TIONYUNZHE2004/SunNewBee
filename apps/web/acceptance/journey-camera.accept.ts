import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openScene, settle } from "./support/bookmarks";
import { askDemoJourney, hasJourneyHook, journey } from "./support/journey";
import { decodePng } from "./support/scene";

/**
 * AC-D8 (hero in frame) and AC-D9 (no clipping), D-T5 follow camera, on the §2 demo route: Elmina
 * seed, Stylised map, mock LLM, 1440 x 900 with the assistant open.
 * `ACCEPTANCE_BASE_URL=http://localhost:5182 pnpm --filter @tl/web acceptance -g "AC-D8|AC-D9"`.
 *
 * A full playback in Follow mode sampled at 10 Hz (wall clock) through `window.__journey`
 * (`state()` and the camera probe `camera()`, one evaluate per tick):
 * - AC-D8: in the follow phases (walks and holds) the hero's body box (walker included, ground ring
 *   excluded) lies inside the map area left of the panel with a 10 % margin in >= 98 % of samples;
 *   a ray from the camera to her chest hits no building mesh (grid pre-check, then a raycast of the
 *   drawn buildings, landmarks and archetype instances) in >= 95 %. At every hold, from a quarter
 *   of the way in, the event's element (crossing, ramp, bench, path, destination) projects inside
 *   the frame. No exclusions: where she stands inside a drawn building the planned route crosses
 *   (Harmoni 1 at the start, the Sales Gallery at ~831 m), the display-only cutaway
 *   (`journey/three/cutaway.ts`) stops drawing the building fragments between the camera and her,
 *   and the raycast ignores exactly those fragments (what is drawn is what is judged).
 * - AC-D9: in every sample (dive and pull-back included) the camera is >= 1.5 m from her body box
 *   and never inside a building (under a drawn roof inside a footprint).
 * Also recorded: event cards never cover her box (ruling), and scrub == play (seeking back to
 * sampled times gives the same camera within 1 cm).
 * Evidence: ACCEPTANCE_OUT (default: the journey-sim ledger folder `acceptance/D-T5`).
 */
const OUT =
  process.env.ACCEPTANCE_OUT ??
  "C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/journey-sim/acceptance/D-T5";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Probe {
  driven: boolean;
  cameraT: number | null;
  camera: [number, number, number];
  frame: { w: number; h: number };
  heroBox: Rect | null;
  heroInFrame: boolean;
  heroDistM: number | null;
  blocked: { chest: boolean; head: boolean; low: boolean };
  heroInFootprint: boolean;
  insideBuilding: boolean;
  gridRoofM: number;
  meshRoofM: number | null;
  element: { index: number; kind: string; x: number; y: number; inFrame: boolean } | null;
  heroOpaque?: { meshes: number; faults: string[] };
}
interface Sample {
  t: number;
  playing: boolean;
  phase: string;
  kind: string;
  phaseIndex: number;
  u: number;
  probe: Probe;
  card: Rect | null;
}

async function sample(page: Page): Promise<Sample | null> {
  return page.evaluate(() => {
    const j = (
      window as unknown as {
        __journey: { state(): unknown; camera(): unknown };
      }
    ).__journey;
    const s = j.state() as {
      t: number;
      playing: boolean;
      u: number;
      phaseIndex: number;
      phase: { kind: string; event?: { kind: string } };
    } | null;
    const probe = j.camera() as Probe | null;
    if (!s || !probe) return null;
    const el = document.querySelector('[data-testid="journey-card"]');
    const host = document.querySelector("canvas")?.getBoundingClientRect();
    const r = el?.getBoundingClientRect();
    return {
      t: s.t,
      playing: s.playing,
      phase: s.phase.kind,
      kind: s.phase.event?.kind ?? s.phase.kind,
      phaseIndex: s.phaseIndex,
      u: s.u,
      probe,
      card:
        r && host ? { x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height } : null,
    };
  });
}

/** Per-channel difference (0-255) that counts a pixel as changed (encoder / AA noise below it). */
const PIXEL_TOL = 24;

async function show(page: Page, part: "ribbon" | "heroColour", visible: boolean) {
  const ok = await page.evaluate(
    ([p, v]) =>
      (window as unknown as { __journey: { show(p: string, v: boolean): boolean } }).__journey.show(
        p as string,
        v as boolean,
      ),
    [part, visible] as const,
  );
  expect(ok, "__journey.show").toBe(true);
  await page.waitForTimeout(250);
}

/**
 * Her silhouette is opaque at a paused beat: her silhouette is the pixels that change when her
 * body is drawn flat magenta (geometry, depth and shadow kept); inside it, hiding the journey ribbon must
 * change (almost) nothing. The gate's see-through band was the ribbon's ghost painted over her.
 */
async function heroOpaqueAt(page: Page, box: Rect, file?: string) {
  const host = (await page.evaluate(() => {
    const r = document.querySelector("canvas")?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top } : { x: 0, y: 0 };
  })) as { x: number; y: number };
  const vp = page.viewportSize() as { width: number; height: number };
  const x = Math.max(0, Math.floor(host.x + box.x));
  const y = Math.max(0, Math.floor(host.y + box.y));
  const clip = {
    x,
    y,
    width: Math.max(1, Math.min(vp.width - x, Math.ceil(box.w))),
    height: Math.max(1, Math.min(vp.height - y, Math.ceil(box.h))),
  };
  const full = await page.screenshot({ clip });
  if (file) await page.screenshot({ path: file });
  await show(page, "heroColour", false);
  const noHero = await page.screenshot({ clip });
  await show(page, "heroColour", true);
  await show(page, "ribbon", false);
  const noRibbon = await page.screenshot({ clip });
  await show(page, "ribbon", true);
  const a = await decodePng(page, full);
  const b = await decodePng(page, noHero);
  const c = await decodePng(page, noRibbon);
  const diff = (u: Uint8ClampedArray | number[], v: Uint8ClampedArray | number[], k: number) =>
    Math.max(
      Math.abs((u[k] as number) - (v[k] as number)),
      Math.abs((u[k + 1] as number) - (v[k + 1] as number)),
      Math.abs((u[k + 2] as number) - (v[k + 2] as number)),
    );
  let her = 0;
  let through = 0;
  // her silhouette: flat magenta in the flat frame and not magenta in the normal one (moving
  // decorative people or cars between the shots are never magenta, so they never count)
  const magenta = (d: Uint8ClampedArray | number[], k: number) =>
    (d[k] as number) > 180 && (d[k + 1] as number) < 90 && (d[k + 2] as number) > 180;
  for (let k = 0; k < a.data.length; k += 4) {
    if (!magenta(b.data, k) || magenta(a.data, k) || diff(a.data, b.data, k) <= PIXEL_TOL) continue;
    her++;
    if (diff(a.data, c.data, k) > PIXEL_TOL) through++;
  }
  const share = her > 0 ? through / her : 0;
  // evidence of a see-through beat: the three crops
  if (share >= 0.03 && process.env.ACCEPTANCE_OUT) {
    const base = `${process.env.ACCEPTANCE_OUT}/d8-seethrough-${Date.now()}`;
    writeFileSync(`${base}-full.png`, full);
    writeFileSync(`${base}-nohero.png`, noHero);
    writeFileSync(`${base}-noribbon.png`, noRibbon);
  }
  return { her, through, share };
}

const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

test.describe("journey follow camera (D-T5)", () => {
  test.beforeEach(async ({ page }) => {
    await openScene(page, "day");
    await askDemoJourney(page);
    test.skip(
      !(await hasJourneyHook(page)),
      "window.__journey is installed in dev builds and the demo preset only",
    );
  });

  test("AC-D8 + AC-D9: hero in frame and not hidden, element at every hold, no clipping", async ({
    page,
  }) => {
    mkdirSync(OUT, { recursive: true });
    const { total, phases } = await journey.info(page);
    const holds = phases as { kind: string; t0: number; t1: number; event?: { kind: string } }[];
    // the city and its clearance grid in place before the run
    await journey.pause(page);
    await journey.setCam(page, "follow");
    await journey.seek(page, 0.01);
    await settle(page, 1500, 45_000);
    await journey.seek(page, 0);
    await journey.play(page);

    const samples: Sample[] = [];
    const shots: Record<string, string> = {};
    const t0 = Date.now();
    for (let k = 0; Date.now() - t0 < (total + 2) * 1000; k++) {
      const s = await sample(page);
      if (s) samples.push(s);
      if (s && !s.playing && samples.length > 10) break;
      const next = t0 + (k + 1) * 100;
      const wait = next - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
    }

    // AC-D8
    const follow = samples.filter((s) => s.phase === "walk" || s.phase === "event");
    const inFrame = follow.filter((s) => s.probe.heroInFrame);
    const hidden = follow.filter((s) => s.probe.blocked.chest);
    const hiddenRoute = hidden.filter((s) => s.probe.heroInFootprint);
    const notDriven = follow.filter((s) => !s.probe.driven);
    const holdRows = holds
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.kind === "event")
      .map(({ p, i }) => {
        const ss = samples.filter((s) => s.phaseIndex === i);
        const judged = ss.filter((s) => s.u >= 0.25);
        const out = judged.filter((s) => !s.probe.element?.inFrame);
        return {
          phaseIndex: i,
          kind: p.event?.kind,
          samples: ss.length,
          judged: judged.length,
          elementOut: out.map((s) => ({ t: s.t, u: s.u, el: s.probe.element })),
          elementInFrameShare: ss.length
            ? ss.filter((s) => s.probe.element?.inFrame).length / ss.length
            : 0,
        };
      });
    // cards never cover her (ruling); only samples where both are on screen
    const cardOver = samples.filter(
      (s) => s.card && s.probe.heroBox && overlap(s.card, s.probe.heroBox),
    );
    // AC-D9
    const near = samples.filter((s) => s.probe.heroDistM !== null && s.probe.heroDistM < 1.5);
    const inside = samples.filter((s) => s.probe.insideBuilding);
    const minDist = Math.min(...samples.map((s) => s.probe.heroDistM ?? Number.POSITIVE_INFINITY));

    // Evidence shots at three holds (paused), then scrub == play.
    await journey.pause(page);
    for (const kind of ["unknown", "rest", "arrive"]) {
      const i = holds.findIndex((p) => p.event?.kind === kind);
      if (i < 0) continue;
      const p = holds[i] as { t0: number; t1: number };
      await journey.seek(page, (p.t0 + p.t1) / 2);
      await settle(page, 800, 15_000);
      const f = `d5-${kind}.png`;
      await page.screenshot({ path: join(OUT, f) });
      shots[kind] = f;
    }
    // Her silhouette is opaque (gate: see-through hero): at every hold and walk mid-point, the
    // ribbon never shows through her. Evidence frames at the 608 m walk and the 836 m rest.
    const opaque: { phaseIndex: number; kind: string; m: number; her: number; share: number }[] =
      [];
    for (const [i, p] of holds.entries()) {
      if (p.kind !== "event" && p.kind !== "walk") continue;
      await journey.seek(page, (p.t0 + p.t1) / 2);
      await settle(page, 600, 15_000);
      const s = await sample(page);
      const st = (await page.evaluate(() =>
        (window as unknown as { __journey: { state(): { distance_m: number } } }).__journey.state(),
      )) as { distance_m: number };
      if (!s?.probe.heroBox) continue;
      const m = st.distance_m;
      const kind = p.event?.kind ?? p.kind;
      const file =
        (p.kind === "walk" && Math.abs(m - 608) < 60) || (kind === "rest" && Math.abs(m - 836) < 5)
          ? join(OUT, `d8-opaque-${kind}-${Math.round(m)}m.png`)
          : undefined;
      if (file) shots[`opaque-${kind}-${Math.round(m)}m`] = file;
      const r = await heroOpaqueAt(page, s.probe.heroBox, file);
      opaque.push({ phaseIndex: i, kind, m, her: r.her, share: r.share });
      console.log(
        `AC-D8 opaque: phase ${i} ${kind} at ${m.toFixed(0)} m: ${r.her} hero px, ${(r.share * 100).toFixed(2)}% changed by the ribbon`,
      );
    }
    const materialFaults = samples.flatMap((s) =>
      (s.probe.heroOpaque?.faults ?? []).map((f) => `${s.t.toFixed(1)}: ${f}`),
    );

    const scrub: { t: number; dM: number }[] = [];
    // the drawn camera's own t (the store may be a frame ahead of the last render)
    const picks = follow
      .filter((s) => s.probe.cameraT !== null && s.t > 2)
      .filter((_, i, a) => i % Math.ceil(a.length / 12) === 0);
    for (const s of picks) {
      await journey.seek(page, s.probe.cameraT as number);
      await page.waitForTimeout(150);
      const r = await sample(page);
      if (!r || r.probe.cameraT !== s.probe.cameraT) continue;
      const [a, b, c] = r.probe.camera;
      const [x, y, z] = s.probe.camera;
      scrub.push({ t: s.probe.cameraT as number, dM: Math.hypot(a - x, b - y, c - z) });
    }
    const scrubWorst = Math.max(0, ...scrub.map((r) => r.dM));

    const result = {
      total,
      samples: samples.length,
      followSamples: follow.length,
      acD8: {
        heroInFrameShare: inFrame.length / Math.max(1, follow.length),
        notHiddenShare: 1 - hidden.length / Math.max(1, follow.length),
        hidden: hidden.length,
        hiddenInsideRouteCrossedFootprint: hiddenRoute.length,
        hiddenByPhase: hidden.reduce<Record<string, { n: number; t0: number; t1: number }>>(
          (acc, s) => {
            const k = `${s.phaseIndex}:${s.kind}`;
            const r = acc[k] ?? { n: 0, t0: s.t, t1: s.t };
            acc[k] = { n: r.n + 1, t0: Math.min(r.t0, s.t), t1: Math.max(r.t1, s.t) };
            return acc;
          },
          {},
        ),
        hiddenOther: hidden
          .filter((s) => !s.probe.heroInFootprint)
          .map((s) => ({ t: s.t, kind: s.kind, camera: s.probe.camera })),
        outOfFrame: follow
          .filter((s) => !s.probe.heroInFrame)
          .map((s) => ({ t: s.t, kind: s.kind, box: s.probe.heroBox, frame: s.probe.frame })),
        holds: holdRows,
        notDriven: notDriven.length,
      },
      acD9: {
        minHeroDistM: minDist,
        within1_5m: near.map((s) => ({ t: s.t, d: s.probe.heroDistM })),
        insideBuilding: inside.map((s) => ({
          t: s.t,
          camera: s.probe.camera,
          gridRoofM: s.probe.gridRoofM,
          meshRoofM: s.probe.meshRoofM,
        })),
      },
      cardsCoverHero: cardOver.map((s) => ({
        t: s.t,
        kind: s.kind,
        card: s.card,
        hero: s.probe.heroBox,
      })),
      scrubEqualsPlay: { checked: scrub.length, worstM: scrubWorst },
      heroOpaque: { materialFaults: materialFaults.slice(0, 20), beats: opaque },
      shots,
    };
    writeFileSync(join(OUT, "ac-d8-d9.json"), JSON.stringify(result, null, 2));

    expect(follow.length).toBeGreaterThan(500);
    expect(result.acD8.heroInFrameShare).toBeGreaterThanOrEqual(0.98);
    expect(result.acD8.notHiddenShare).toBeGreaterThanOrEqual(0.95);
    for (const h of holdRows) {
      expect(h.judged, `hold ${h.phaseIndex} ${h.kind} sampled`).toBeGreaterThan(0);
      expect(h.elementOut, `hold ${h.phaseIndex} ${h.kind}`).toEqual([]);
    }
    expect(result.acD9.within1_5m).toEqual([]);
    expect(result.acD9.insideBuilding).toEqual([]);
    expect(result.cardsCoverHero).toEqual([]);
    expect(scrub.length).toBeGreaterThan(5);
    expect(scrubWorst).toBeLessThanOrEqual(0.01);
    // her silhouette is opaque: material state at every sample, pixels at every beat she shows
    expect(samples.every((s) => (s.probe.heroOpaque?.meshes ?? 0) > 0)).toBe(true);
    expect(materialFaults).toEqual([]);
    const seen = opaque.filter((o) => o.her >= 200);
    expect(seen.length).toBeGreaterThan(10);
    for (const o of seen)
      expect(o.share, `phase ${o.phaseIndex} ${o.kind} see-through share`).toBeLessThan(0.03);
  });
});
