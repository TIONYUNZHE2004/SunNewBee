import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openScene, settle } from "./support/bookmarks";
import { askDemoJourney, hasJourneyHook, journey } from "./support/journey";

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
 *   the frame. Hidden samples where she stands inside a footprint the planned route itself crosses
 *   (Harmoni 1 at the start, the Sales Gallery at ~831 m) are counted within the 5 % budget and
 *   reported (coordinator ruling: route data is not altered).
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
  });
});
