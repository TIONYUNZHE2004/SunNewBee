/**
 * The navigation compare playback timeline (spec §5.4), built from the route facts of a
 * `route.compare` payload. Pure: no store, no DOM.
 *
 * Speed is chosen so the recommended walker starts at 3 s and arrives at 29 s; the fastest walker
 * walks at the same speed and stops at the stop point. A route-tied beat (POI tags, stop, ticket)
 * starts when the walker reaches its point (3 + at_m / speed), clamped to ±1.5 s of the §5.4
 * baseline so the beats keep their order and never overlap the fixed ones; `raw` keeps the
 * unclamped time so a check can tell how far the data is from the baseline.
 */
import type { CompareIntent, PoiKind } from "./compareTypes";

export const T_START = 3;
export const T_ARRIVE = 29;
export const T_MERGE = 31.5;
export const T_REASONS = 32;
export const T_END = 45;
/** Route-tied beats land within this many seconds of the baseline (spec §5.4). */
export const BEAT_TOLERANCE_S = 1.5;
/** The ticket card's flight from the unchecked stretch to the Tickets chip (AC-N5). */
export const FLIGHT_S = 1.8;
/** The unchecked tag stays until this long after the ticket flight starts (until 18.0). */
const UNCHECKED_TAIL_S = 0.4;
/** …and at least this long (the baseline 13.6–18.0 window). */
const UNCHECKED_MIN_S = 4.4;
/** The ticket toast after the counter goes to 1 (19.4 → 25). */
const TOAST_S = 5.6;
/** The stop tag stays until 31 s (spec §5.4). */
const STOP_TAG_END = 31;
/** The greeting resident stands where the recommended walker is at mid-greeting (7–10 s). */
const GREETING_MID = 8.5;

export type BeatId =
  | "intro"
  | "split"
  | "tag-kerb"
  | "tag-covered"
  | "greeting"
  | "tag-fastest"
  | "tag-incline"
  | "tag-unchecked"
  | "tag-stop"
  | "ticket-flight"
  | "tickets-chip"
  | "ticket-toast"
  | "tag-rest"
  | "arrive"
  | "overview"
  | "reasons";

/** Which half of the split screen a beat belongs to ("full": the whole map). */
export type BeatSide = "L" | "R" | "full";

export interface Beat {
  id: BeatId;
  side: BeatSide;
  t0: number;
  t1: number;
  /** The §5.4 window. */
  baseline: [number, number];
  /** Route-tied beats: the unclamped start from the route facts; null for fixed beats. */
  raw: number | null;
  /** Route-tied beats: the metre on its route (recommended, or fastest for the stop). */
  at_m?: number;
  /**
   * Ticket flight: when the walker reaches `unchecked[0].start_m` (unfloored). `raw` is floored at
   * the 17.6 s baseline by construction (R32), so this is the route fact to check.
   */
  reach?: number;
  /** POI beats: index into `payload.pois`. */
  poi?: number;
}

export interface CompareTimeline {
  /** Metres per playback second (both walkers). */
  speed: number;
  total: number;
  recommendedM: number;
  /** Where the fastest walker ends: the stop point, or the end of the fastest route. */
  fastestEndM: number;
  /** When the fastest walker stops at the stop point; null without one. */
  stopAt: number | null;
  /** When the ticket flight starts (17.6 s, or when the walker reaches `unchecked[0].start_m` if later); null without a ticket. */
  flightAt: number | null;
  /** Recommended-route metre for the greeting resident (renderer placement). */
  greetingAtM: number;
  beats: Beat[];
}

export type CameraMode = "split" | "overview";

export interface CompareState {
  t: number;
  /** Visible beat ids, in timeline order. */
  beats: BeatId[];
  /** Walker distances along their routes, metres. */
  walkers: { fastest: number; recommended: number };
  fastestStopped: boolean;
  recommendedArrived: boolean;
  counters: { tickets: number };
  camera: CameraMode;
  /** Reduced motion: the renderer cuts between camera states instead of flying (AC-N9). */
  cut: boolean;
  /** Ticket flight progress in [0, 1] while it flies, else null. */
  flight: number | null;
}

const BASE: Record<BeatId, [number, number]> = {
  intro: [0, T_START],
  split: [0, T_MERGE],
  "tag-kerb": [3, 5.5],
  "tag-covered": [4.5, 7],
  greeting: [7, 10],
  "tag-fastest": [10, 14],
  "tag-incline": [10.3, 13.3],
  "tag-unchecked": [13.6, 18],
  "tag-stop": [16.7, STOP_TAG_END],
  "ticket-flight": [17.6, 19.4],
  "tickets-chip": [0, T_END],
  "ticket-toast": [19.4, 25],
  "tag-rest": [19.5, 23],
  arrive: [T_ARRIVE, T_MERGE],
  overview: [T_MERGE, T_END],
  reasons: [T_REASONS, T_END],
};

const POI_BEATS: [PoiKind, BeatId][] = [
  ["kerb", "tag-kerb"],
  ["covered_start", "tag-covered"],
  ["incline", "tag-incline"],
  ["seating", "tag-rest"],
];

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const near = (raw: number, base: number) =>
  clamp(raw, base - BEAT_TOLERANCE_S, base + BEAT_TOLERANCE_S);

export function buildCompareTimeline(c: CompareIntent): CompareTimeline {
  const recM = Math.max(0, c.recommended?.distance_m ?? 0);
  const fastM = Math.max(0, c.fastest?.distance_m ?? 0);
  const speed = recM > 0 ? recM / (T_ARRIVE - T_START) : 1;
  const at = (m: number) => T_START + m / speed;
  const beats: Beat[] = [];
  const fixed = (id: BeatId, side: BeatSide) => {
    const [t0, t1] = BASE[id];
    beats.push({ id, side, t0, t1, baseline: BASE[id], raw: null });
  };
  /** A route-tied beat: start from the route metre (clamped), the baseline's length. */
  const tied = (id: BeatId, side: BeatSide, m: number, extra: Partial<Beat> = {}) => {
    const [b0, b1] = BASE[id];
    const raw = at(m);
    const t0 = near(raw, b0);
    beats.push({ id, side, t0, t1: t0 + (b1 - b0), baseline: BASE[id], raw, at_m: m, ...extra });
  };

  fixed("intro", "full");
  fixed("split", "full");
  for (const [kind, id] of POI_BEATS) {
    const i = c.pois.findIndex((p) => p.kind === kind);
    const poi = c.pois[i];
    if (poi) tied(id, "R", poi.at_m, { poi: i });
  }
  fixed("greeting", "R");
  fixed("tag-fastest", "L");

  // the stop: the walker really stops at stop.at_m (physical), its tag clamps like the others
  const stopAt = c.stop ? at(c.stop.at_m) : null;
  if (c.stop && stopAt !== null) {
    const t0 = near(stopAt, BASE["tag-stop"][0]);
    beats.push({
      id: "tag-stop",
      side: "L",
      t0,
      t1: Math.max(t0, STOP_TAG_END),
      baseline: BASE["tag-stop"],
      raw: stopAt,
      at_m: c.stop.at_m,
    });
  }

  // the unchecked stretch and its ticket. The tag is tied to the walker reaching start_m (13.6 s
  // baseline). The card flies at its 17.6 s baseline, or later if the walker reaches the stretch
  // after that (never before the stretch is passed), so on any corridor the counter turns at 19.4 s
  // whenever the stretch comes first (AC-N5).
  const u = c.unchecked[0];
  let flightAt: number | null = null;
  if (u) {
    const reach = at(u.start_m);
    const tagAt = near(reach, BASE["tag-unchecked"][0]);
    const flightBase = BASE["ticket-flight"][0];
    const flightRaw = Math.max(flightBase, reach);
    const f = Math.max(tagAt, near(flightRaw, flightBase));
    beats.push({
      id: "tag-unchecked",
      side: "R",
      t0: tagAt,
      t1: Math.max(tagAt + UNCHECKED_MIN_S, f + UNCHECKED_TAIL_S),
      baseline: BASE["tag-unchecked"],
      raw: reach,
      at_m: u.start_m,
    });
    if (c.vr) {
      flightAt = f;
      beats.push({
        id: "ticket-flight",
        side: "full",
        t0: f,
        t1: f + FLIGHT_S,
        baseline: BASE["ticket-flight"],
        raw: flightRaw,
        reach,
        at_m: u.start_m,
      });
      beats.push({
        id: "ticket-toast",
        side: "full",
        t0: f + FLIGHT_S,
        t1: f + FLIGHT_S + TOAST_S,
        baseline: BASE["ticket-toast"],
        raw: flightRaw + FLIGHT_S,
      });
    }
  }
  if (c.vr && u) fixed("tickets-chip", "full");

  const arrival = c.pois.findIndex((p) => p.kind === "arrival");
  beats.push({
    id: "arrive",
    side: "R",
    t0: T_ARRIVE,
    t1: T_MERGE,
    baseline: BASE.arrive,
    raw: at(recM),
    at_m: recM,
    ...(arrival >= 0 ? { poi: arrival } : {}),
  });
  fixed("overview", "full");
  fixed("reasons", "full");
  beats.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);

  return {
    speed,
    total: T_END,
    recommendedM: recM,
    fastestEndM: c.stop ? Math.min(c.stop.at_m, fastM || c.stop.at_m) : fastM,
    stopAt,
    flightAt,
    greetingAtM: Math.min(recM, (GREETING_MID - T_START) * speed),
    beats,
  };
}

/** True while `b` is on screen at t; a window that runs to the end stays on at the end. */
export function beatVisible(b: Beat, t: number, total = T_END): boolean {
  return t >= b.t0 && (t < b.t1 || (b.t1 >= total && t <= total));
}

export function compareStateAt(
  tl: CompareTimeline,
  t: number,
  opts: { reduced?: boolean } = {},
): CompareState {
  const tt = clamp(Number.isFinite(t) ? t : 0, 0, tl.total);
  const walked = Math.max(0, (tt - T_START) * tl.speed);
  const recommended = Math.min(tl.recommendedM, walked);
  const fastest = Math.min(tl.fastestEndM, walked);
  const flight =
    tl.flightAt !== null && tt >= tl.flightAt && tt < tl.flightAt + FLIGHT_S
      ? (tt - tl.flightAt) / FLIGHT_S
      : null;
  return {
    t: tt,
    beats: tl.beats.filter((b) => beatVisible(b, tt, tl.total)).map((b) => b.id),
    walkers: { fastest, recommended },
    fastestStopped: tl.stopAt !== null && tt >= tl.stopAt,
    recommendedArrived: tt >= T_ARRIVE,
    counters: { tickets: tl.flightAt !== null && tt >= tl.flightAt + FLIGHT_S ? 1 : 0 },
    camera: tt >= T_MERGE ? "overview" : "split",
    cut: !!opts.reduced,
    flight,
  };
}
