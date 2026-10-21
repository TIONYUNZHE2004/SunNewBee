import { describe, expect, it } from "vitest";
import {
  BEAT_TOLERANCE_S,
  type BeatId,
  buildCompareTimeline,
  compareStateAt,
  FLIGHT_S,
  T_ARRIVE,
  T_END,
} from "./compareTimeline";
import { asCompareIntent, type CompareIntent } from "./compareTypes";
import elmina from "./fixtures/compare.elmina.json";
import { handCompare } from "./fixtures/compareHand";

/** Spec §5.4 rows as beat windows (the reasons card and overview run to the end). */
const TABLE: [BeatId, number, number][] = [
  ["intro", 0, 3],
  ["tag-kerb", 3, 5.5],
  ["tag-covered", 4.5, 7],
  ["greeting", 7, 10],
  ["tag-fastest", 10, 14],
  ["tag-incline", 10.3, 13.3],
  ["tag-unchecked", 13.6, 18],
  ["tag-stop", 16.7, 31],
  ["ticket-flight", 17.6, 19.4],
  ["ticket-toast", 19.4, 25],
  ["tag-rest", 19.5, 23],
  ["arrive", 29, 31.5],
  ["overview", 31.5, 45],
  ["reasons", 32, 45],
];

const ROUTE_TIED: BeatId[] = [
  "tag-kerb",
  "tag-covered",
  "tag-incline",
  "tag-unchecked",
  "tag-stop",
  "ticket-flight",
  "tag-rest",
];

/**
 * AC-N3 at unit level for any payload: beats, walkers, stop. `absent`: rows the payload has no
 * fact for (no beat at all); `offBaseline`: route-tied rows whose raw time is known to miss the
 * ±1.5 s window (coordinator ruling), checked for the clamp instead.
 */
function checkBeats(c: CompareIntent, opts: { absent?: BeatId[]; offBaseline?: BeatId[] } = {}) {
  const tl = buildCompareTimeline(c);
  const byId = new Map(tl.beats.map((b) => [b.id, b]));
  for (const [id, a] of TABLE) {
    const beat = byId.get(id);
    if (opts.absent?.includes(id)) {
      expect(beat, `${id} has no fact, so no beat`).toBeUndefined();
      continue;
    }
    expect(beat, id).toBeDefined();
    if (!beat) continue;
    if (opts.offBaseline?.includes(id)) {
      expect(Math.abs((beat.raw ?? a) - a), `${id} raw ${beat.raw}`).toBeGreaterThan(
        BEAT_TOLERANCE_S,
      );
      expect(Math.abs(beat.t0 - a), `${id} clamped`).toBeCloseTo(BEAT_TOLERANCE_S, 5);
    } else if (ROUTE_TIED.includes(id)) {
      // route-tied beats land within ±1.5 s of the table, from the route facts themselves (unclamped)
      expect(Math.abs((beat.raw ?? Number.NaN) - a), `${id} raw ${beat.raw}`).toBeLessThanOrEqual(
        BEAT_TOLERANCE_S,
      );
    }
    // visible at the midpoint of its own window, hidden 0.5 s outside it
    const mid = (beat.t0 + beat.t1) / 2;
    expect(compareStateAt(tl, mid).beats, `${id} @${mid}`).toContain(id);
    if (beat.t0 - 0.5 >= 0) expect(compareStateAt(tl, beat.t0 - 0.5).beats).not.toContain(id);
    if (beat.t1 + 0.5 <= T_END) expect(compareStateAt(tl, beat.t1 + 0.5).beats).not.toContain(id);
  }
  // the recommended walker arrives at 29.0 ± 0.2 s
  const recM = c.recommended?.distance_m ?? 0;
  expect(compareStateAt(tl, T_ARRIVE - 0.2).walkers.recommended).toBeLessThan(recM);
  expect(compareStateAt(tl, T_ARRIVE + 0.2).walkers.recommended).toBe(recM);
  // the fastest walker stops at stop.at_m ± 2 m and stays there
  const stopM = c.stop?.at_m ?? 0;
  for (const t of [30, 40, T_END])
    expect(Math.abs(compareStateAt(tl, t).walkers.fastest - stopM)).toBeLessThanOrEqual(2);
  return tl;
}

describe("buildCompareTimeline on the hand-built baseline payload", () => {
  const c = handCompare();
  const tl = buildCompareTimeline(c);

  it("speed puts the recommended walker at the start at 3 s and the end at 29 s", () => {
    expect(tl.speed).toBeCloseTo(520 / 26);
    expect(compareStateAt(tl, 3).walkers).toEqual({ fastest: 0, recommended: 0 });
    expect(compareStateAt(tl, 29).walkers.recommended).toBeCloseTo(520);
    expect(compareStateAt(tl, 1).walkers.recommended).toBe(0);
  });

  it("every §5.4 row lands on the baseline and shows at its midpoint (AC-N3)", () => {
    checkBeats(c);
    for (const id of ROUTE_TIED) {
      const b = tl.beats.find((x) => x.id === id);
      const row = TABLE.find((r) => r[0] === id);
      expect(b?.t0, id).toBeCloseTo(row?.[1] ?? Number.NaN, 5);
    }
  });

  it("the fastest walker stops at stop.at_m at 16.7 s; the counter turns 0 → 1 at 19.4 s", () => {
    expect(tl.stopAt).toBeCloseTo(16.7);
    expect(compareStateAt(tl, 16.6).fastestStopped).toBe(false);
    expect(compareStateAt(tl, 16.8).fastestStopped).toBe(true);
    expect(compareStateAt(tl, 20).walkers.fastest).toBe(274);
    expect(compareStateAt(tl, 19.3).counters.tickets).toBe(0);
    expect(compareStateAt(tl, 19.5).counters.tickets).toBe(1);
    expect(tl.beats.find((b) => b.id === "ticket-flight")).toMatchObject({ t0: 17.6 });
    const f = tl.beats.find((b) => b.id === "ticket-flight");
    expect((f?.t1 ?? 0) - (f?.t0 ?? 0)).toBeCloseTo(FLIGHT_S);
    expect(compareStateAt(tl, 18.5).flight).toBeCloseTo(0.5);
    expect(compareStateAt(tl, 20).flight).toBeNull();
  });

  it("split until 31.5 s, then one overview; reasons from 32 s to the end", () => {
    expect(compareStateAt(tl, 31.4)).toMatchObject({ camera: "split" });
    expect(compareStateAt(tl, 31.5)).toMatchObject({ camera: "overview" });
    expect(compareStateAt(tl, 31.4).beats).toContain("split");
    expect(compareStateAt(tl, 31.6).beats).not.toContain("split");
    expect(compareStateAt(tl, T_END).beats).toEqual(
      expect.arrayContaining(["reasons", "overview", "tickets-chip"]),
    );
  });

  it("reduced motion: same beats in the same order, camera cuts", () => {
    for (const t of [2, 12, 18, 30, 40]) {
      const a = compareStateAt(tl, t);
      const b = compareStateAt(tl, t, { reduced: true });
      expect(b.beats).toEqual(a.beats);
      expect(b.cut).toBe(true);
      expect(a.cut).toBe(false);
    }
  });

  it("beat ids are unique and ordered by start", () => {
    const ids = tl.beats.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    const starts = tl.beats.map((b) => b.t0);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});

describe("buildCompareTimeline edge cases", () => {
  it("clamps a route-tied beat to ±1.5 s of the baseline and keeps the raw time", () => {
    const c = handCompare();
    // seating at 500 m would be reached at 28 s; the rest tag still sits near 19.5 s
    const pois = c.pois.map((p) => (p.kind === "seating" ? { ...p, at_m: 500 } : p));
    const b = buildCompareTimeline({ ...c, pois }).beats.find((x) => x.id === "tag-rest");
    expect(b?.raw).toBeCloseTo(28);
    expect(b?.t0).toBeCloseTo(21);
    expect((b?.t1 ?? 0) - (b?.t0 ?? 0)).toBeCloseTo(3.5);
  });

  it("no ticket: no flight, chip or toast, and the counter stays 0 (AC-N5 null case)", () => {
    const tl = buildCompareTimeline(handCompare({ vr: null }));
    const ids = tl.beats.map((b) => b.id);
    expect(ids).not.toContain("ticket-flight");
    expect(ids).not.toContain("ticket-toast");
    expect(ids).not.toContain("tickets-chip");
    expect(ids).toContain("tag-unchecked"); // the stretch is still shown as not checked
    expect(compareStateAt(tl, 30).counters.tickets).toBe(0);
  });

  it("no stop point: the fastest walker walks to the end of its route", () => {
    const tl = buildCompareTimeline(handCompare({ stop: null }));
    expect(tl.stopAt).toBeNull();
    expect(tl.beats.map((b) => b.id)).not.toContain("tag-stop");
    expect(compareStateAt(tl, 40).walkers.fastest).toBe(400);
    expect(compareStateAt(tl, 40).fastestStopped).toBe(false);
  });

  it("a missing POI kind has no beat; nothing unchecked: no tag and no ticket", () => {
    const c = handCompare({ unchecked: [] });
    const tl = buildCompareTimeline({
      ...c,
      pois: c.pois.filter((p) => p.kind !== "covered_start"),
    });
    const ids = tl.beats.map((b) => b.id);
    expect(ids).not.toContain("tag-covered");
    expect(ids).not.toContain("tag-unchecked");
    expect(ids).not.toContain("ticket-flight");
  });

  it("a zero-length recommended route does not divide by zero", () => {
    const c = handCompare();
    const rec = c.recommended ? { ...c.recommended, distance_m: 0 } : null;
    const tl = buildCompareTimeline({ ...c, recommended: rec });
    expect(Number.isFinite(tl.speed)).toBe(true);
    expect(compareStateAt(tl, 20).walkers.recommended).toBe(0);
  });
});

// The recorded Elmina corridor fixture (task B6, lane be-nav): the real `route.compare` intent.
describe("recorded Elmina compare fixture (AC-N3, unit level)", () => {
  const c = asCompareIntent(elmina);
  it("reads as a playable compare", () => {
    expect(c).not.toBeNull();
    expect(c?.recommended?.coordinates.length).toBeGreaterThan(1);
  });
  it("every §5.4 beat lands within ±1.5 s of the baseline, except the rulings' rows", () => {
    if (!c) throw new Error("fixture unreadable");
    // R28: the first crossing (kerb) is at 29 % of the route, ~10.4 s; the clamp keeps its window.
    // R29: no OSM bench within 15 m, so no seating POI and no rest beat.
    const tl = checkBeats(c, { absent: ["tag-rest"], offBaseline: ["tag-kerb"] });
    const kerb = tl.beats.find((b) => b.id === "tag-kerb");
    expect(kerb?.raw).toBeCloseTo(10.4, 1);
    expect(kerb?.t0).toBeCloseTo(4.5, 5);
    // R30 / AC-N5: the ticket counter turns at 19.4 s on the corridor too
    expect(compareStateAt(tl, 19.3).counters.tickets).toBe(0);
    expect(compareStateAt(tl, 19.5).counters.tickets).toBe(1);
  });
});
