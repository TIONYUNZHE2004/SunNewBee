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
 * - rest holds: walk to the bench, `sit_down` (<= 1.5 s), `sit_idle`, `stand_up` (<= 1.5 s), walk back;
 * - arrive, the dive and the pull-back: `idle`.
 *
 * Yaw follows the route tangent (model front +z, yaw = atan2(dx, dz), as `motion/agents.ts`),
 * smoothed with the motion layer's `smoothYaw` folded over a fixed window of earlier times, so the
 * smoothing is deterministic too.
 */

import { type JourneyState, type Phase, stateAt, type Timeline } from "../../../journey/timeline";
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
/** A bench place this far from the route point (m) is used as the seat itself. */
export const SEAT_PLACE_RANGE_M: readonly [number, number] = [1.2, 6];
/** She stands this far in front of the seat before turning and sitting (m). */
export const SEAT_FRONT_M = 0.55;
/** Rest choreography durations (screen seconds) for a full-length (4.2 s) hold. */
export const REST_TIMING = {
  approachS: 0.7,
  sitDownS: 0.9,
  standUpS: 0.9,
  backS: 0.7,
  /** Sitting still for at least this share of the hold when it is compressed. */
  minIdleS: 0.4,
} as const;
/** Yaw smoothing window and step (s): smoothYaw folded over [t - window, t]. */
export const YAW_WINDOW_S = 1;
const YAW_STEP_S = 1 / 30;

export interface RestSchedule {
  approach: [number, number];
  sitDown: [number, number];
  sitIdle: [number, number];
  standUp: [number, number];
  back: [number, number];
}

/** Rest-hold beats in seconds from the hold start; compressed proportionally when the hold is short. */
export function restSchedule(holdS: number): RestSchedule {
  const r = REST_TIMING;
  const moving = r.approachS + r.sitDownS + r.standUpS + r.backS;
  const k = holdS >= moving + r.minIdleS ? 1 : Math.max(0, holdS / (moving + r.minIdleS));
  const a = r.approachS * k;
  const sd = r.sitDownS * k;
  const su = r.standUpS * k;
  const b = r.backS * k;
  const idle = Math.max(0, holdS - a - sd - su - b);
  const s1 = a + sd;
  const s2 = s1 + idle;
  const s3 = s2 + su;
  return {
    approach: [0, a],
    sitDown: [a, s1],
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
 * The seat for a rest at plan metre `at_m`: the bench place itself when it lies 1.2-6 m from the
 * route point, else SEAT_OFFSET_M off the route, on the bench place's side (the left without one).
 */
export function seatFor(
  pointAt: HeroPathHelpers["pointAt"],
  at_m: number,
  place: [number, number] | null,
): HeroSeat {
  const [px, pz] = pointAt(at_m);
  if (place) {
    const d = Math.hypot(place[0] - px, place[1] - pz);
    if (d >= (SEAT_PLACE_RANGE_M[0] as number) && d <= (SEAT_PLACE_RANGE_M[1] as number))
      return { x: place[0], z: place[1] };
  }
  const y = tangentYaw(pointAt, at_m);
  // tangent (sin y, cos y); left normal (cos y, -sin y)
  let nx = Math.cos(y);
  let nz = -Math.sin(y);
  if (place && (place[0] - px) * nx + (place[1] - pz) * nz < 0) {
    nx = -nx;
    nz = -nz;
  }
  return { x: px + nx * SEAT_OFFSET_M, z: pz + nz * SEAT_OFFSET_M };
}

/** Per-timeline walk-clip bookkeeping: each phase's cycle rate and the walk clip time at its start. */
interface WalkClock {
  rate: number[];
  cum: number[];
}
const clocks = new WeakMap<Timeline, WalkClock>();

function phaseRate(p: Phase, pace: number): number {
  const dur = p.t1 - p.t0;
  if (!(dur > 0) || !(p.m1 > p.m0)) return 0;
  if (p.kind === "walk") return (pace / HERO_REF_PACE_MPS) * WALK_PHASE_RATE;
  // a moving hold (verified / covered / gap): her on-screen speed against the reference pace
  return (p.m1 - p.m0) / dur / HERO_REF_PACE_MPS;
}

function walkClock(tl: Timeline): WalkClock {
  const hit = clocks.get(tl);
  if (hit) return hit;
  const rate: number[] = [];
  const cum: number[] = [];
  let c = 0;
  for (const p of tl.phases) {
    const r = phaseRate(p, tl.plan.pace_m_per_s);
    rate.push(r);
    cum.push(c);
    c += r * (p.t1 - p.t0);
  }
  const wc = { rate, cum };
  clocks.set(tl, wc);
  return wc;
}

function restState(st: JourneyState, t: number, helpers: HeroPathHelpers, base: number): HeroState {
  const p = st.phase;
  const local = Math.max(0, t - p.t0);
  const sch = restSchedule(p.t1 - p.t0);
  const [rx, rz] = helpers.pointAt(p.m0);
  const route = { x: rx, z: rz };
  const seat =
    (p.eventIndex !== undefined ? helpers.seatOf?.(p.eventIndex) : null) ??
    seatFor(helpers.pointAt, p.m0, null);
  // seated she faces the route; she stands SEAT_FRONT_M in front of the seat before sitting
  const fdx = route.x - seat.x;
  const fdz = route.z - seat.z;
  const fl = Math.hypot(fdx, fdz) || 1;
  const face = yawOf(fdx, fdz);
  const front = { x: seat.x + (fdx / fl) * SEAT_FRONT_M, z: seat.z + (fdz / fl) * SEAT_FRONT_M };
  const toBench = yawOf(front.x - route.x, front.z - route.z);
  const walkLen = Math.hypot(front.x - route.x, front.z - route.z);
  const seg = (r: [number, number]) => (r[1] > r[0] ? (local - r[0]) / (r[1] - r[0]) : 1);
  const out = (
    pos: { x: number; z: number },
    yaw: number,
    clip: HeroClip,
    clipTime: number,
    rate = 0,
  ) => ({
    distance_m: p.m0,
    x: pos.x,
    z: pos.z,
    yaw,
    clip,
    clipTime,
    walkRate: rate,
  });
  const walkRate = (r: [number, number]) =>
    r[1] > r[0] ? walkLen / (r[1] - r[0]) / HERO_REF_PACE_MPS : 0;

  if (local < sch.approach[1]) {
    const r = walkRate(sch.approach);
    return out(lerp2(route, front, ease(seg(sch.approach))), toBench, "walk", base + r * local, r);
  }
  if (local < sch.sitDown[1]) {
    const u = seg(sch.sitDown);
    // turn round in place first, then lower back onto the seat
    const yaw = slerpAngle(toBench, face, ease(u / 0.5));
    return out(lerp2(front, seat, ease((u - 0.3) / 0.7)), yaw, "sit_down", local - sch.sitDown[0]);
  }
  if (local < sch.sitIdle[1]) return out(seat, face, "sit_idle", local - sch.sitIdle[0]);
  if (local < sch.standUp[1]) {
    const u = seg(sch.standUp);
    return out(lerp2(seat, front, ease(u / 0.7)), face, "stand_up", local - sch.standUp[0]);
  }
  const r = walkRate(sch.back);
  const u = seg(sch.back);
  return out(lerp2(front, route, ease(u)), face, "walk", base + r * (local - sch.back[0]), r);
}

/** The unsmoothed state at t (yaw is the target heading). */
function rawAt(tl: Timeline, t: number, helpers: HeroPathHelpers): HeroState {
  const st = stateAt(tl, t);
  const p = st.phase;
  const tc = Math.max(0, Math.min(tl.total, Number.isFinite(t) ? t : 0));
  const local = Math.max(0, tc - p.t0);
  const wc = walkClock(tl);
  const base = wc.cum[st.phaseIndex] ?? 0;
  const rate = wc.rate[st.phaseIndex] ?? 0;
  const kind = p.event?.kind;
  if (kind === "rest") return restState(st, tc, helpers, base);
  const [x, z] = helpers.pointAt(st.distance_m);
  const yaw = tangentYaw(helpers.pointAt, st.distance_m);
  const at = (clip: HeroClip, clipTime: number, walkRate = 0): HeroState => ({
    distance_m: st.distance_m,
    x,
    z,
    yaw,
    clip,
    clipTime,
    walkRate,
  });
  if (kind === "unknown") return at("look", local);
  if (rate > 0) return at("walk", base + rate * local, rate);
  return at("idle", local);
}

/**
 * The hero at screen time `t` (clamped to the timeline). Deterministic: a pure function of
 * (timeline, t, helpers). The yaw is smoothYaw folded over the last YAW_WINDOW_S of target headings.
 */
export function heroStateAt(tl: Timeline, t: number, helpers: HeroPathHelpers): HeroState {
  const tc = Math.max(0, Math.min(tl.total, Number.isFinite(t) ? t : 0));
  const now = rawAt(tl, tc, helpers);
  const n = Math.round(YAW_WINDOW_S / YAW_STEP_S);
  let yaw = rawAt(tl, tc - n * YAW_STEP_S, helpers).yaw;
  for (let k = n - 1; k >= 1; k--)
    yaw = smoothYaw(yaw, rawAt(tl, tc - k * YAW_STEP_S, helpers).yaw, YAW_STEP_S);
  yaw = smoothYaw(yaw, now.yaw, YAW_STEP_S);
  return { ...now, yaw };
}
