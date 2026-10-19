import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { HOOK, openScene, settle } from "./support/bookmarks";
import { askDemoJourney, hasJourneyHook, journey } from "./support/journey";

/**
 * AC-D10 (hero behaviour, D-T6) on the §2 demo route: Elmina seed, Stylised map, mock LLM.
 * `ACCEPTANCE_BASE_URL=http://localhost:5181 pnpm --filter @tl/web acceptance -g AC-D10`.
 *
 * 1. Full playback sampled at 10 Hz through `window.__journey` (`state()` and the rendered
 *    `hero({ contacts: true })`, read in one evaluate): the clip matches the phase (walk phases and
 *    verified / covered / gap holds walk; unknown looks; rest walks to the bench, sits down, sits,
 *    stands up and walks back; arrive, dive and pull-back are idle), and her position is never
 *    inside an OSM building footprint (`/api/layers/buildings`). The camera is kept on her with the
 *    acceptance hook (the follow camera is D-T5), so the streamed ground is under her.
 * 2. Ground contact, paused at each beat (every phase midpoint plus each rest beat), once the
 *    streamed ground around her has settled: every foot and walker-leg tip (all six, every beat) is
 *    within 3 cm of the drawn ground band under it (footway, lawn, park), a ground sample exists for
 *    every beat and every contact has a band under it (nothing dropped silently), and no rest
 *    bench's seat corners lie inside a building footprint.
 * Evidence: ACCEPTANCE_OUT (default: the journey-sim ledger folder `acceptance/D-T6`).
 */
const OUT =
  process.env.ACCEPTANCE_OUT ??
  "C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/journey-sim/acceptance/D-T6";
const TOL_M = 0.03;

interface Contact {
  name: string;
  x: number;
  y: number;
  z: number;
  groundY: number;
  band: string | null;
  onFootway: boolean;
}
interface HeroReport {
  distance_m: number;
  x: number;
  y: number;
  z: number;
  lon: number;
  lat: number;
  clip: string;
  clipTime: number;
  walkRate: number;
  contacts?: Contact[];
}
interface StateReport {
  t: number;
  u: number;
  phase: {
    kind: string;
    t0: number;
    t1: number;
    m0: number;
    m1: number;
    event?: { kind: string; title: string };
  };
  phaseIndex: number;
}
interface Sample {
  t: number;
  phase: string;
  phaseIndex: number;
  u: number;
  clip: string;
  m: number;
  lon: number;
  lat: number;
  contacts?: Contact[];
  benches?: { eventIndex: number; corners: [number, number][] }[];
  cost?: {
    poses: number;
    meanMs: number;
    p95Ms: number;
    maxMs: number;
    rebuilds: number;
    lastRebuildMs: number;
    triangles: number;
  };
  groundKnown?: boolean;
}

type Ring = [number, number][];

async function sample(
  page: Page,
  contacts: boolean,
  follow = false,
): Promise<(Sample & { playing: boolean }) | null> {
  return page.evaluate(
    ({ c, follow, hook }) => {
      const j = (
        window as unknown as {
          __journey: { state(): unknown; hero(o?: unknown): unknown };
        }
      ).__journey;
      const s = j.state() as (StateReport & { playing: boolean }) | null;
      const h = j.hero({ contacts: c }) as HeroReport | null;
      if (!s || !h) return null;
      // a crude follow camera (the player's follow mode is D-T5) so the ground streams in under her
      if (follow)
        (window as unknown as Record<string, { setPose(p: unknown): void }>)[hook]?.setPose({
          lon: h.lon,
          lat: h.lat,
          rangeM: 60,
          pitchDeg: -38,
          headingDeg: 20,
        });
      const ev = s.phase.event;
      return {
        playing: s.playing,
        t: s.t,
        phase: ev ? ev.kind : s.phase.kind,
        phaseIndex: s.phaseIndex,
        u: s.u,
        clip: h.clip,
        m: h.distance_m,
        lon: h.lon,
        lat: h.lat,
        contacts: h.contacts,
        benches: (h as unknown as { benches?: Sample["benches"] }).benches,
        groundKnown: (h as unknown as { groundKnown?: boolean }).groundKnown,
        cost: (h as unknown as { cost?: Sample["cost"] }).cost,
      };
    },
    { c: contacts, follow, hook: HOOK },
  );
}

/** Evidence shot with the event card hidden (it is anchored above her and would cover her). */
async function shotWithoutCard(page: Page, path: string): Promise<void> {
  const style = await page.addStyleTag({
    content: '[data-testid="journey-card"]{visibility:hidden !important}',
  });
  await page.waitForTimeout(50);
  await page.screenshot({ path });
  await style.evaluate((el) => el.remove());
}

async function lookAt(page: Page, lon: number, lat: number, rangeM = 45): Promise<void> {
  await page.evaluate(
    ({ h, p }) => {
      (window as unknown as Record<string, { setPose(p: unknown): void }>)[h]?.setPose(p);
    },
    { h: HOOK, p: { lon, lat, rangeM, pitchDeg: -38, headingDeg: 20 } },
  );
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Outer ring minus holes, for Polygon and MultiPolygon features, with a bbox for a quick reject. */
function footprints(fc: {
  features: {
    properties?: Record<string, unknown>;
    geometry: { type: string; coordinates: unknown };
  }[];
}) {
  const out: { id: string; bbox: [number, number, number, number]; rings: Ring[] }[] = [];
  for (const f of fc.features) {
    const polys =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates as Ring[]]
        : f.geometry.type === "MultiPolygon"
          ? (f.geometry.coordinates as Ring[][])
          : [];
    for (const rings of polys) {
      const outer = rings[0];
      if (!outer) continue;
      let b: [number, number, number, number] = [180, 90, -180, -90];
      for (const [x, y] of outer)
        b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
      out.push({
        id: String(f.properties?.id ?? f.properties?.osm_id ?? out.length),
        bbox: b,
        rings,
      });
    }
  }
  return out;
}

/** The clip each phase allows (a rest hold runs its beats in order). */
const ALLOWED: Record<string, string[]> = {
  dive: ["idle"],
  walk: ["walk"],
  verified: ["walk"],
  covered: ["walk"],
  gap: ["walk"],
  unknown: ["look"],
  rest: ["walk", "sit_down", "sit_idle", "stand_up"],
  arrive: ["idle"],
  pull: ["idle"],
};

test.describe("journey hero (D-T6)", () => {
  test.beforeEach(async ({ page }) => {
    await openScene(page, "day");
    await askDemoJourney(page);
    test.skip(
      !(await hasJourneyHook(page)),
      "window.__journey is installed in dev builds and the demo preset only",
    );
  });

  test("AC-D10: clip per phase, feet and walker on the footway, never inside a building", async ({
    page,
  }) => {
    mkdirSync(OUT, { recursive: true });
    const { total } = await journey.info(page);
    const fc = await page.evaluate(
      async () => (await (await fetch("/api/layers/buildings")).json()).buildings,
    );
    const fps = footprints(fc);
    expect(fps.length).toBeGreaterThan(100);
    const insideBuilding = (lon: number, lat: number) =>
      fps.find(
        (f) =>
          lon >= f.bbox[0] &&
          lon <= f.bbox[2] &&
          lat >= f.bbox[1] &&
          lat <= f.bbox[3] &&
          inRing(lon, lat, f.rings[0] as Ring) &&
          !f.rings.slice(1).some((h) => inRing(lon, lat, h)),
      )?.id ?? null;

    // 1. Full playback at 10 Hz.
    await journey.pause(page);
    await journey.seek(page, 0);
    const first = await sample(page, false);
    if (first) await lookAt(page, first.lon, first.lat, 60);
    await settle(page, 1500, 30_000);
    await journey.play(page);
    const samples: Sample[] = [];
    const shots: Record<string, string> = {};
    const t0 = Date.now();
    // 10 Hz on the wall clock: each tick is one evaluate (state, hero and the camera move)
    for (let k = 0; Date.now() - t0 < (total + 1) * 1000; k++) {
      // contacts during playback too (all six, against a downward raycast of the drawn ground)
      const s = await sample(page, true, true);
      if (s) samples.push(s);
      if (s && !s.playing && samples.length > 10) break;
      const next = t0 + (k + 1) * 100;
      const wait = next - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
    }
    const wrong = samples.filter((s) => !(ALLOWED[s.phase] ?? []).includes(s.clip));
    const playErr = (c: Contact) => Math.abs(c.y - c.groundY);
    const playContacts = samples.flatMap((s) =>
      (s.contacts ?? []).map((c) => ({ t: s.t, phase: s.phase, clip: s.clip, c })),
    );
    const playWorstRow = playContacts.reduce<(typeof playContacts)[number] | null>(
      (w, r) => (!w || playErr(r.c) > playErr(w.c) ? r : w),
      null,
    );
    const playWorst = playWorstRow
      ? {
          t: playWorstRow.t,
          phase: playWorstRow.phase,
          clip: playWorstRow.clip,
          name: playWorstRow.c.name,
          y: playWorstRow.c.y,
          ground: playWorstRow.c.groundY,
          band: playWorstRow.c.band,
          errM: playErr(playWorstRow.c),
        }
      : null;
    const playOver = playContacts.filter((r) => playErr(r.c) > TOL_M).length;
    const heroCost = [...samples].reverse().find((s) => s.cost)?.cost ?? null;
    // A moving hold capped to 0 m would idle; none on the demo. The very end of a phase can read the
    // next phase's clip within one sample of the boundary (store t and pose are one update).
    const clipsSeen: Record<string, Record<string, number>> = {};
    for (const s of samples) {
      clipsSeen[s.phase] ??= {};
      (clipsSeen[s.phase] as Record<string, number>)[s.clip] =
        ((clipsSeen[s.phase] as Record<string, number>)[s.clip] ?? 0) + 1;
    }
    const restHolds = [
      ...new Set(samples.filter((s) => s.phase === "rest").map((s) => s.phaseIndex)),
    ];
    const restBeats = restHolds.map((i) => ({
      phaseIndex: i,
      clips: [...new Set(samples.filter((s) => s.phaseIndex === i).map((s) => s.clip))],
    }));
    // Outside a rest hold she stands exactly on the route polyline (heroDriver.test.ts), so an
    // intrusion there is the planned route's own geometry; in a rest hold it is the driver's offset.
    const inBuildings = samples
      .map((s) => ({ s, id: insideBuilding(s.lon, s.lat) }))
      .filter((r) => r.id !== null)
      .map((r) => ({
        t: r.s.t,
        phase: r.s.phase,
        m: r.s.m,
        lon: r.s.lon,
        lat: r.s.lat,
        building: r.id,
      }));

    // 2. Ground contact at every beat, paused, with the ground streamed in around her.
    const phases = (await journey.info(page)).phases as {
      kind: string;
      t0: number;
      t1: number;
      event?: { kind: string };
    }[];
    const beats: number[] = [];
    for (const p of phases) {
      if (p.event?.kind === "rest")
        for (const u of [0.08, 0.25, 0.5, 0.75, 0.92]) beats.push(p.t0 + (p.t1 - p.t0) * u);
      else beats.push((p.t0 + p.t1) / 2);
    }
    await journey.pause(page);
    const ground: {
      t: number;
      phase: string;
      clip: string;
      groundKnown: boolean;
      contacts: Contact[];
    }[] = [];
    const missing: number[] = [];
    let benches: Sample["benches"] = [];
    for (const t of beats) {
      await journey.seek(page, t);
      const s0 = await sample(page, false);
      if (!s0) {
        missing.push(t);
        continue;
      }
      await lookAt(page, s0.lon, s0.lat, 35);
      await settle(page, 1200, 20_000);
      const s = await sample(page, true);
      if (s?.contacts)
        ground.push({
          t,
          phase: s.phase,
          clip: s.clip,
          groundKnown: s.groundKnown !== false,
          contacts: s.contacts,
        });
      else missing.push(t);
      if (s?.benches?.length) benches = s.benches;
      // evidence shots after the start (the first metres run inside the Harmoni 1 footprint)
      if (s && !shots[s.clip] && t > 10) {
        await lookAt(page, s0.lon, s0.lat, 18);
        await settle(page, 800, 10_000);
        const f = `hero-${s.clip}.png`;
        await shotWithoutCard(page, join(OUT, f));
        shots[s.clip] = f;
      }
    }
    // Every contact is judged, on whatever drawn ground band lies under it; a contact with no band
    // under it (ground not streamed in, or bare base plane) is a failure, never silently dropped.
    const all = ground.flatMap((g) => g.contacts.map((c) => ({ ...g, c })));
    const err = (c: Contact) => Math.abs(c.y - c.groundY);
    const worst = all.reduce((w, r) => Math.max(w, err(r.c)), 0);
    const worstRow = all.reduce<(typeof all)[number] | null>(
      (w, r) => (!w || err(r.c) > err(w.c) ? r : w),
      null,
    );
    const worstContact = worstRow
      ? {
          t: worstRow.t,
          phase: worstRow.phase,
          clip: worstRow.clip,
          name: worstRow.c.name,
          y: worstRow.c.y,
          ground: worstRow.c.groundY,
          band: worstRow.c.band,
          errM: err(worstRow.c),
        }
      : null;
    const bad = all
      .filter((r) => err(r.c) > TOL_M)
      .map((r) => ({
        t: r.t,
        phase: r.phase,
        clip: r.clip,
        name: r.c.name,
        y: r.c.y,
        ground: r.c.groundY,
        band: r.c.band,
      }));
    const noBand = all
      .filter((r) => r.c.band === null)
      .map((r) => ({ t: r.t, phase: r.phase, name: r.c.name }));
    const bands: Record<string, number> = {};
    for (const r of all) bands[r.c.band ?? "none"] = (bands[r.c.band ?? "none"] ?? 0) + 1;
    const unknownGround = ground.filter((g) => !g.groundKnown).map((g) => g.t);
    const benchIntrusions = (benches ?? []).flatMap((b) =>
      b.corners
        .map(([lon, lat]) => ({
          eventIndex: b.eventIndex,
          lon,
          lat,
          building: insideBuilding(lon, lat),
        }))
        .filter((c) => c.building !== null),
    );

    const routeIntrusions = inBuildings.filter((r) => r.phase !== "rest");
    const driverIntrusions = inBuildings.filter((r) => r.phase === "rest");
    const result = {
      total,
      samples: samples.length,
      clipsByPhase: clipsSeen,
      wrongClips: wrong.map((s) => ({ t: s.t, phase: s.phase, u: s.u, clip: s.clip })),
      restBeats,
      inBuildings: {
        driver: driverIntrusions,
        route: routeIntrusions,
        routeBuildings: [...new Set(routeIntrusions.map((r) => r.building))],
      },
      benches: { checked: benches?.length ?? 0, cornersInBuildings: benchIntrusions },
      ground: {
        beats: beats.length,
        sampled: ground.length,
        missingBeats: missing,
        restGroundUnknownAt: unknownGround,
        contacts: all.length,
        byBand: bands,
        worstM: worst,
        worstContact,
        overTolerance: bad,
        noBand,
      },
      playbackGround: {
        samples: samples.filter((s) => s.contacts).length,
        contacts: playContacts.length,
        overTolerance: playOver,
        worstContact: playWorst,
      },
      heroCost,
      shots,
    };
    writeFileSync(join(OUT, "ac-d10.json"), `${JSON.stringify(result, null, 2)}\n`);
    console.log(
      `AC-D10: ${samples.length} samples; wrong clips ${wrong.length}; rest beats ${JSON.stringify(restBeats.map((r) => r.clips))}; ` +
        `in buildings: driver ${driverIntrusions.length}, route geometry ${routeIntrusions.length}; contacts ${all.length} ${JSON.stringify(bands)} worst ${(worst * 100).toFixed(1)} cm ${JSON.stringify(worstContact)}; benches in buildings ${benchIntrusions.length}; playback contacts ${playContacts.length} over ${playOver} worst ${JSON.stringify(playWorst)}; hero cost ${JSON.stringify(heroCost)}`,
    );

    expect(samples.length).toBeGreaterThan(total * 5);
    // phase boundaries: at most one sample per boundary may read the neighbour's clip
    expect(wrong.length).toBeLessThanOrEqual(2);
    for (const k of ["walk", "unknown", "rest", "arrive", "verified", "covered", "gap"])
      expect(clipsSeen[k], k).toBeTruthy();
    expect(Object.keys(clipsSeen.unknown ?? {})).toEqual(["look"]);
    expect(restBeats.length).toBe(3);
    for (const r of restBeats)
      for (const c of ["sit_down", "sit_idle", "stand_up"])
        expect(r.clips, `rest ${r.phaseIndex}`).toContain(c);
    expect(clipsSeen.arrive?.idle).toBeGreaterThan(0);
    // The driver never takes her into a building (rest walks, benches). Route-geometry intrusions
    // (the planned polyline itself crosses a footprint: Harmoni 1 start, Sales Gallery ~831 m) are
    // excluded by coordinator ruling (route data is not altered; D-T5's camera keeps her visible)
    // and recorded in the evidence.
    expect(driverIntrusions).toEqual([]);
    expect(benches?.length).toBe(3);
    expect(benchIntrusions).toEqual([]);
    // ground: a sample at every beat, every contact over a drawn band, all within 3 cm
    expect(missing).toEqual([]);
    expect(ground.length).toBe(beats.length);
    expect(unknownGround).toEqual([]);
    expect(noBand).toEqual([]);
    expect(all.length).toBe(beats.length * 6);
    expect(worst).toBeLessThanOrEqual(TOL_M);
    // and during playback at 10 Hz: every sample carries all six contacts, all within 3 cm
    expect(playContacts.length).toBe(samples.length * 6);
    expect(playOver).toBe(0);
  });
});
