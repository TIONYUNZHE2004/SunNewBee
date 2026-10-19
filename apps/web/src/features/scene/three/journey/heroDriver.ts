/**
 * Hero driver for the resident-journey player (spec 2026-10-19 §6.4, D-T6, AC-D10).
 *
 * Pure state machine: for a screen time `t` on a journey `Timeline` it says where the hero stands,
 * which way she faces and which clip plays at which clip time. It never reads the scene, the clock
 * or earlier calls, so the result is the same whether `t` was reached by playing or by seeking
 * (scrub-safe). The renderer (`Hero.play` / `Hero.setPose`) only shows what this returns; nothing
 * here invents an event, a distance or a time: those come from the timeline (D-T4).
 *
 * Clip vocabulary (spec §5 C1 H1): walk, idle, sit_down, sit_idle, stand_up, look.
 * - walk phases: `walk`, cycle rate tied to the pace;
 * - verified / covered / gap holds: a slow `walk` (the timeline moves her at her pace);
 * - unknown holds: stop and `look`;
 * - rest holds: walk to the bench-front stand point, step round to face away from the bench,
 *   `sit_down` (<= 1.5 s), `sit_idle`, `stand_up` (<= 1.5 s) with the root fixed (the clips carry
 *   the hips onto the seat), walk back;
 * - arrive, the dive and the pull-back: `idle`.
 * Where the clip changes at a beat boundary, the first HERO_FADE_S carry a crossfade (`fade`).
 *
 * Yaw follows the route tangent (model front +z, yaw = atan2(dx, dz), as `motion/agents.ts`),
 * smoothed with the motion layer's `smoothYaw` folded over a fixed window of earlier times, so the
 * smoothing is deterministic too.
 */

import type { Phase, Timeline } from "../../../journey/timeline";
import { slerpAngle, smoothYaw } from "../motion/agents";

export type HeroClip = "walk" | "idle" | "sit_down" | "sit_idle" | "stand_up" | "look";

export interface HeroSeat {
  /** Where her root stands when seated (local metres, xz). */
  x: number;
  z: number;
}

export interface HeroPathHelpers {
  /** [x, z] on the route at plan metres `m` (`RoutePath.pointAt`). */
  pointAt(m: number): [number, number];
  /** The seat for plan event `i` (a rest), or null: the side offset (`seatFor` without a place) is used. */
  seatOf?(eventIndex: number): HeroSeat | null;
}

/** The clip being faded out at a beat boundary where the clip changes. */
export interface HeroFade {
  prevClip: HeroClip;
  /** The outgoing clip's time, run on from the boundary at its own rate. */
  prevTime: number;
  /** Weight of the incoming clip: 0 at the boundary, 1 after HERO_FADE_S. */
  blend: number;
}

export interface HeroState {
  /** The route metre she belongs to (her own position during a rest is off the route, at the bench). */
  distance_m: number;
  x: number;
  z: number;
  yaw: number;
  clip: HeroClip;
  /** Seconds into the clip (loops: unbounded, the player wraps them). Already scaled by `walkRate`. */
  clipTime: number;
  /** Walk-cycle speed factor (1 = the clip's natural cadence at the reference pace); 0 when not walking. */
  walkRate: number;
  /** Set during the first HERO_FADE_S of a beat whose clip differs from the previous beat's. */
  fade?: HeroFade;
  /** During a rest hold: the plan event index and how far she is from the route toward the seat (0..1). */
  rest?: { eventIndex: number; offRoute: number };
}

/** The pace the walk clip's natural cadence matches (the demo's older_adult_rest pace, 1.1667 m/s). */
export const HERO_REF_PACE_MPS = 7 / 6;
/**
 * Walk phases run 20x compressed (§6.4), so on screen she covers about 23 m/s. A cycle at 20x would
 * be a blur; the cycle runs at the pace's rate times this factor instead (a brisk, readable step).
 * Foot slide in compressed walks is inherent to the time compression; H5 is measured at the demo pace.
 */
export const WALK_PHASE_RATE = 1.6;
/** Seat distance from the route point when the bench place is unknown or not usable (m). */
export const SEAT_OFFSET_M = 1.9;
/** A bench place nearer the route point than this (m) says nothing about the side (coordinate noise). */
export const SEAT_SIDE_MIN_M = 0.5;
/** A bench place this far from the route point (m) is used as the seat itself. */
export const SEAT_PLACE_RANGE_M: readonly [number, number] = [1.2, 6];
/** Rest choreography durations (screen seconds) for a full-length (4.2 s) hold. */
export const REST_TIMING = {
  approachS: 0.55,
  /** Stepping round to face away from the bench, before sit_down (the clips assume she does). */
  turnS: 0.6,
  sitDownS: 0.85,
  standUpS: 0.85,
  backS: 0.6,
  /** Sitting still for at least this share of the hold when it is compressed. */
  minIdleS: 0.4,
} as const;
/** Crossfade length (s) at a beat boundary where the clip changes. */
export const HERO_FADE_S = 0.2;
/** Yaw smoothing window and step (s): smoothYaw folded over [t - window, t]. */
export const YAW_WINDOW_S = 1;
const YAW_STEP_S = 1 / 30;

export interface RestSchedule {
  approach: [number, number];
  turn: [number, number];
  sitDown: [number, number];
  sitIdle: [number, number];
  standUp: [number, number];
  back: [number, number];
}

/** Rest-hold beats in seconds from the hold start; compressed proportionally when the hold is short. */
export function restSchedule(holdS: number): RestSchedule {
  const r = REST_TIMING;
  const moving = r.approachS + r.turnS + r.sitDownS + r.standUpS + r.backS;
  const k = holdS >= moving + r.minIdleS ? 1 : Math.max(0, holdS / (moving + r.minIdleS));
  const a = r.approachS * k;
  const tu = r.turnS * k;
  const sd = r.sitDownS * k;
  const su = r.standUpS * k;
  const b = r.backS * k;
  const idle = Math.max(0, holdS - a - tu - sd - su - b);
  const s0 = a + tu;
  const s1 = s0 + sd;
  const s2 = s1 + idle;
  const s3 = s2 + su;
  return {
    approach: [0, a],
    turn: [a, s0],
    sitDown: [s0, s1],
    sitIdle: [s1, s2],
    standUp: [s2, s3],
    back: [s3, holdS],
  };
}

const ease = (u: number) => {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
};
const lerp2 = (a: { x: number; z: number }, b: { x: number; z: number }, u: number) => ({
  x: a.x + (b.x - a.x) * u,
  z: a.z + (b.z - a.z) * u,
});
const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);

/** Route tangent yaw at `m` (central difference, widened where the polyline is degenerate). */
export function tangentYaw(pointAt: HeroPathHelpers["pointAt"], m: number): number {
  for (const h of [0.75, 3, 10]) {
    const a = pointAt(m - h);
    const b = pointAt(m + h);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6) return yawOf(b[0] - a[0], b[1] - a[1]);
  }
  return 0;
}

/**
 * The seat for a rest at plan metre `at_m`. The bench fact is the rest point; the seat is a display
 * approximation of where the bench stands:
 * - the bench place itself when it lies 1.2-6 m from the route point;
 * - else SEAT_OFFSET_M off the route on the bench place's side, when the place is at least
 *   SEAT_SIDE_MIN_M off the route (nearer, its side is coordinate noise);
 * - else on the side with more `clearance` (e.g. metres to the nearest building footprint); the
 *   left on a tie or without a clearance function.
 */
export function seatFor(
  pointAt: HeroPathHelpers["pointAt"],
  at_m: number,
  place: [number, number] | null,
  clearance?: (x: number, z: number) => number,
): HeroSeat {
  const [px, pz] = pointAt(at_m);
  const d = place ? Math.hypot(place[0] - px, place[1] - pz) : 0;
  if (place && d >= (SEAT_PLACE_RANGE_M[0] as number) && d <= (SEAT_PLACE_RANGE_M[1] as number))
    return { x: place[0], z: place[1] };
  const y = tangentYaw(pointAt, at_m);
  // tangent (sin y, cos y); left normal (cos y, -sin y)
  const nx = Math.cos(y);
  const nz = -Math.sin(y);
  const at = (side: number) => ({
    x: px + side * nx * SEAT_OFFSET_M,
    z: pz + side * nz * SEAT_OFFSET_M,
  });
  let side = 1;
  if (place && d >= SEAT_SIDE_MIN_M) {
    if ((place[0] - px) * nx + (place[1] - pz) * nz < 0) side = -1;
  } else if (clearance) {
    const l = at(1);
    const r = at(-1);
    if (clearance(r.x, r.z) > clearance(l.x, l.z) + 1e-6) side = -1;
  }
  return at(side);
}

/** Rest choreography geometry for one rest hold. */
interface RestGeom {
  sch: RestSchedule;
  route: { x: number; z: number };
  seat: HeroSeat;
  face: number;
  toBench: number;
  rateIn: number;
  rateOut: number;
}

/** Walk-cycle rate while stepping round in place before sitting. */
const TURN_RATE = 1;

function restGeom(p: Phase, helpers: HeroPathHelpers): RestGeom {
  const sch = restSchedule(p.t1 - p.t0);
  const [rx, rz] = helpers.pointAt(p.m0);
  const route = { x: rx, z: rz };
  const seat =
    (p.eventIndex !== undefined ? helpers.seatOf?.(p.eventIndex) : null) ??
    seatFor(helpers.pointAt, p.m0, null);
  // The seat point is her root while seated: the bench-front stand point (the bench's front edge
  // is behind it, HERO_BENCH.frontEdgeZ); the clips carry the hips back onto the seat, the root
  // never moves during sit_down / sit_idle / stand_up. Seated she faces the route.
  const fdx = route.x - seat.x;
  const fdz = route.z - seat.z;
  const walkLen = Math.hypot(fdx, fdz);
  const rate = (r: [number, number]) =>
    r[1] > r[0] ? walkLen / (r[1] - r[0]) / HERO_REF_PACE_MPS : 0;
  return {
    sch,
    route,
    seat,
    face: yawOf(fdx, fdz),
    toBench: yawOf(-fdx, -fdz),
    rateIn: rate(sch.approach),
    rateOut: rate(sch.back),
  };
}

/**
 * Per helpers (the seats shape the rest walks) and per timeline: each phase's cycle rate, the walk
 * clip time at its start (rest approach and back walks included, so leaving a rest never snaps
 * the feet) and each rest's geometry.
 */
interface WalkClock {
  rate: number[];
  cum: number[];
  rest: (RestGeom | null)[];
}
const clocks = new WeakMap<HeroPathHelpers, WeakMap<Timeline, WalkClock>>();

function phaseRate(p: Phase, pace: number): number {
  const dur = p.t1 - p.t0;
  if (!(dur > 0) || !(p.m1 > p.m0)) return 0;
  if (p.kind === "walk") return (pace / HERO_REF_PACE_MPS) * WALK_PHASE_RATE;
  // a moving hold (verified / covered / gap): her on-screen speed against the reference pace
  return (p.m1 - p.m0) / dur / HERO_REF_PACE_MPS;
}

function walkClock(tl: Timeline, helpers: HeroPathHelpers): WalkClock {
  let byTl = clocks.get(helpers);
  if (!byTl) {
    byTl = new WeakMap();
    clocks.set(helpers, byTl);
  }
  const hit = byTl.get(tl);
  if (hit) return hit;
  const rate: number[] = [];
  const cum: number[] = [];
  const rest: (RestGeom | null)[] = [];
  let c = 0;
  for (const p of tl.phases) {
    cum.push(c);
    if (p.event?.kind === "rest") {
      const g = restGeom(p, helpers);
      rest.push(g);
      rate.push(0);
      c +=
        g.rateIn * (g.sch.approach[1] - g.sch.approach[0]) +
        TURN_RATE * (g.sch.turn[1] - g.sch.turn[0]) +
        g.rateOut * (g.sch.back[1] - g.sch.back[0]);
      continue;
    }
    const r = phaseRate(p, tl.plan.pace_m_per_s);
    rest.push(null);
    rate.push(r);
    c += r * (p.t1 - p.t0);
  }
  const wc = { rate, cum, rest };
  byTl.set(tl, wc);
  return wc;
}

/** Index of the phase holding t, by binary search (no HUD state, no clock formatting). */
function phaseIndexAt(tl: Timeline, t: number): number {
  const ps = tl.phases;
  let lo = 0;
  let hi = ps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((ps[mid] as Phase).t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface Raw extends HeroState {
  /** Screen time the current beat (one clip) started. */
  beat0: number;
  /** The yaw is an explicit eased turn or a held facing (turn and sit beats): not smoothed again. */
  yawExact?: boolean;
}

function restRaw(p: Phase, local: number, g: RestGeom, base: number): Raw {
  const { sch } = g;
  const seg = (r: [number, number]) => (r[1] > r[0] ? (local - r[0]) / (r[1] - r[0]) : 1);
  const span = Math.hypot(g.seat.x - g.route.x, g.seat.z - g.route.z) || 1;
  const out = (
    pos: { x: number; z: number },
    yaw: number,
    clip: HeroClip,
    clipTime: number,
    beat: [number, number],
    walkRate = 0,
    yawExact = false,
  ): Raw => ({
    yawExact,
    distance_m: p.m0,
    x: pos.x,
    z: pos.z,
    yaw,
    clip,
    clipTime,
    walkRate,
    beat0: p.t0 + beat[0],
    rest: {
      eventIndex: p.eventIndex as number,
      offRoute: Math.min(1, Math.hypot(pos.x - g.route.x, pos.z - g.route.z) / span),
    },
  });
  if (local < sch.approach[1]) {
    const pos = lerp2(g.route, g.seat, ease(seg(sch.approach)));
    return out(pos, g.toBench, "walk", base + g.rateIn * local, sch.approach, g.rateIn);
  }
  const turn0 = base + g.rateIn * (sch.approach[1] - sch.approach[0]);
  if (local < sch.turn[1]) {
    // step round in place to face away from the bench: sit_down starts already facing the route
    const yaw = slerpAngle(g.toBench, g.face, ease(seg(sch.turn)));
    const clip = turn0 + TURN_RATE * (local - sch.turn[0]);
    return out(g.seat, yaw, "walk", clip, sch.turn, TURN_RATE, true);
  }
  // sit_down / sit_idle / stand_up: the root stays at the stand point (the clips move the hips)
  if (local < sch.sitDown[1])
    return out(g.seat, g.face, "sit_down", local - sch.sitDown[0], sch.sitDown, 0, true);
  if (local < sch.sitIdle[1])
    return out(g.seat, g.face, "sit_idle", local - sch.sitIdle[0], sch.sitIdle, 0, true);
  if (local < sch.standUp[1])
    return out(g.seat, g.face, "stand_up", local - sch.standUp[0], sch.standUp, 0, true);
  const back0 = turn0 + TURN_RATE * (sch.turn[1] - sch.turn[0]);
  const pos = lerp2(g.seat, g.route, ease(seg(sch.back)));
  return out(pos, g.face, "walk", back0 + g.rateOut * (local - sch.back[0]), sch.back, g.rateOut);
}

/** The unsmoothed state at t (yaw is the target heading) plus the start of its beat. */
function rawAt(tl: Timeline, t: number, helpers: HeroPathHelpers): Raw {
  const tc = Math.max(0, Math.min(tl.total, Number.isFinite(t) ? t : 0));
  const i = phaseIndexAt(tl, tc);
  const p = tl.phases[i] as Phase;
  const local = Math.max(0, tc - p.t0);
  const wc = walkClock(tl, helpers);
  const base = wc.cum[i] ?? 0;
  const g = wc.rest[i];
  if (g) return restRaw(p, local, g, base);
  const dur = p.t1 - p.t0;
  const u = dur > 0 ? Math.min(1, local / dur) : 1;
  const m = p.m0 + (p.m1 - p.m0) * u;
  const [x, z] = helpers.pointAt(m);
  const yaw = tangentYaw(helpers.pointAt, m);
  const rate = wc.rate[i] ?? 0;
  const at = (clip: HeroClip, clipTime: number, walkRate = 0): Raw => ({
    distance_m: m,
    x,
    z,
    yaw,
    clip,
    clipTime,
    walkRate,
    beat0: p.t0,
  });
  if (p.event?.kind === "unknown") return at("look", local);
  if (rate > 0) return at("walk", base + rate * local, rate);
  return at("idle", local);
}

/**
 * The hero at screen time `t` (clamped to the timeline). Deterministic: a pure function of
 * (timeline, t, helpers). The yaw is smoothYaw folded over the last YAW_WINDOW_S of target headings.
 * In the first HERO_FADE_S of a beat whose clip differs from the beat before, `fade` names the
 * outgoing clip, its time (run on from the boundary) and the incoming clip's weight.
 */
export function heroStateAt(tl: Timeline, t: number, helpers: HeroPathHelpers): HeroState {
  const tc = Math.max(0, Math.min(tl.total, Number.isFinite(t) ? t : 0));
  const { beat0, yawExact, ...now } = rawAt(tl, tc, helpers);
  let yaw = now.yaw;
  if (!yawExact) {
    // turn and sit beats carry their own eased facing (she must face away from the bench before
    // sit_down); everything else follows the target heading through smoothYaw
    const n = Math.round(YAW_WINDOW_S / YAW_STEP_S);
    yaw = rawAt(tl, tc - n * YAW_STEP_S, helpers).yaw;
    for (let k = n - 1; k >= 1; k--)
      yaw = smoothYaw(yaw, rawAt(tl, tc - k * YAW_STEP_S, helpers).yaw, YAW_STEP_S);
    yaw = smoothYaw(yaw, now.yaw, YAW_STEP_S);
  }
  const out: HeroState = { ...now, yaw };
  const since = tc - beat0;
  if (beat0 > 0 && since < HERO_FADE_S) {
    const prev = rawAt(tl, beat0 - 1e-6, helpers);
    if (prev.clip !== now.clip) {
      const prevRate = prev.clip === "walk" ? prev.walkRate : 1;
      out.fade = {
        prevClip: prev.clip,
        prevTime: prev.clipTime + since * prevRate,
        blend: since / HERO_FADE_S,
      };
    }
  }
  return out;
}
