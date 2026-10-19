/**
 * Journey follow camera (spec 2026-10-19 resident journey §6.4 "Camera", D-T5, AC-D8 / AC-D9).
 *
 * Pure pose maths: for a screen time `t` on a journey `Timeline` it says where the camera stands and
 * what it looks at. It never reads the scene, the clock or earlier calls, so a scrub to `t` and a
 * play to `t` give the same pose (deterministic, like `heroDriver.ts`). Separate from the orbit rig
 * (`cameraRig.ts`): the follow camera stands 8.5 m behind her, which is under the rig's minimum
 * range, and it is applied through the engine's camera driver (`Engine.setCameraDriver`).
 *
 * - **Follow** (walks and verified / covered / gap holds): the prototype's pose, 8.5 m back along the
 *   route tangent, 4.5 m to the side, 4.2 m up, looking 4 m ahead of her.
 * - **Framing per event kind** (the prototype's ramp shot lost the ramp behind the mall podium):
 *   rest: a side view of the bench (her route point and the seat both in frame); unknown: the
 *   element (the route point at `at_m`) in frame from the side with the clearer view; arrive: from
 *   behind her towards the destination, both in frame.
 * - **Damped**: the offsets from her (not her position) are smoothed with a Gaussian kernel over
 *   ±0.75 s of timeline time, so the camera never lags her and a framing change eases in.
 * - **Building clearance** (`clearance.ts`, A-T7): the camera is lifted (x, z kept) when a building
 *   would stand between it and her; the lift is the max over the same window with a taper, so it
 *   rises before the building arrives and never under-lifts at `t`. The hard floor (roof + 2 m
 *   inside a footprint) is applied last and never eased: the camera is never inside a building.
 *   Lifting only raises the camera, so it never dives into her.
 * - **Dive / pull-back**: a tween between the overview pose and the follow pose; the distance to
 *   the look point is interpolated in log space and the look point by the share of distance
 *   covered, so the approach reads as one continuous zoom.
 *
 * Coordinates: the local frame (x east, y up, z = -north, metres).
 */

import type { JourneyEventKind, Timeline } from "../../../journey/timeline";
import { HOLD_MOVES, stateAt } from "../../../journey/timeline";
import { type Clearance, MAX_SKIRT_M, type Vec3 } from "../clearance";
import {
  fitSafe,
  holdFitWeight,
  lerpPose,
  SAFE_FIT,
  type Subject,
  type ViewFit,
} from "./safeFrame";

/**
 * The prototype's follow pose (spec §6.4): 8.5 m back, 4.5 m side, 4.2 m up, looking 4 m ahead.
 * Two framing values are this task's (the prototype looked 1.5 m up, on her line): the look point
 * sits 0.3 m up and 1.5 m to the far side of her line, which centres her whole box (walker
 * included) with a >= 14% margin on frames from 1.1:1 to 16:9 (AC-D8 asks for 10%); on her line
 * she sat at the frame's left edge (3% margin).
 */
export const FOLLOW = {
  backM: 8.5,
  sideM: 4.5,
  upM: 4.2,
  aheadM: 4,
  lookYM: 0.3,
  lookSideM: 1.5,
  /** Half-width of the central difference for the route tangent (prototype `tangentAt(d, 10)`). */
  tangentM: 10,
} as const;

/** Damping kernel over timeline time (s). */
export const SMOOTH = {
  halfWindowS: 0.75,
  stepS: 0.05,
  sigmaS: 0.7,
  /** Lift taper half-width: a lift needed this far ahead (or behind) counts with weight 0. */
  liftWindowS: 1.0,
} as const;

/** Unknown-event framing: a little further back and higher, so the element reads in context. */
export const UNKNOWN_FRAME = { backM: 10, sideM: 6, upM: 6, aheadM: 2, lookYM: 0.6 } as const;
/** Rest framing: side view of the bench. Distance grows with the route-to-seat spread. */
export const REST_FRAME = {
  minDistM: 9,
  maxDistM: 22,
  perSpreadM: 1.6,
  upM: 3.2,
  upPerDist: 0.15,
  lookYM: 0.9,
} as const;
/** Arrive framing: behind her, looking towards the destination. */
export const ARRIVE_FRAME = {
  minBackM: 9,
  maxBackM: 40,
  perDistM: 0.5,
  sideM: 3,
  upM: 4.5,
  upPerBack: 0.12,
  lookYM: 0.8,
  /** A destination further than this from the route end is not framed (only her). */
  maxDestM: 80,
} as const;

/** Her chest height (the line-of-sight target), metres above the ground. */
export const HERO_CHEST_Y = 1.4;
/** AC-D9: the camera never comes within this distance of the hero mesh. */
export const MIN_HERO_DIST_M = 1.5;
/** Her mesh's half-width (the walker and the yellow ring included), metres. */
export const HERO_RADIUS_M = 0.9;
/** The follow camera moves to another side of her only when that saves this much lift (m). */
export const SWAP_GAIN_M = 3;
/**
 * The follow framing's alternatives, in order of preference: [side, turn about her (deg)]. The same
 * shot mirrored, then turned a quarter and half way round her (facing her as she walks out).
 */
export const ORBIT_ALTERNATIVES: readonly (readonly [side: number, deg: number])[] = [
  [-1, 0],
  [1, 90],
  [-1, -90],
  [1, 180],
  [-1, 180],
];

/** A pose turned by `rad` about the vertical through `c` (x east, z south; positive turns x to z). */
export function turnPose(p: CamPose, c: [number, number], rad: number): CamPose {
  const cs = Math.cos(rad);
  const sn = Math.sin(rad);
  const t = (v: Vec3): Vec3 => {
    const dx = v[0] - c[0];
    const dz = v[2] - c[1];
    return [c[0] + dx * cs - dz * sn, v[1], c[1] + dx * sn + dz * cs];
  };
  return { pos: t(p.pos), look: t(p.look) };
}
/** A lift of this many metres turns the look point halfway onto her. */
export const LIFT_LOOK_M = 4;
/** The skirt (m) the anticipating lift sees beyond the hard floor's pad (`floorAt`). */
export const LIFT_SKIRT_M = 6;

export type Framing = "follow" | "rest" | "unknown" | "arrive";

export interface CamPose {
  pos: Vec3;
  look: Vec3;
}

/** What the follow camera needs from the scene. All pure lookups. */
export interface FollowScene {
  timeline: Timeline;
  /** [x, z] on the route at plan metres `m` (`RoutePath.pointAt`). */
  pointAt(m: number): [number, number];
  /** The rest seat of plan event `i` (the hero layer's seats), or null. */
  seatOf?(eventIndex: number): { x: number; z: number } | null;
  /** The destination place [x, z] (the arrive event's element), or null: the route end. */
  destination?: [number, number] | null;
  /** The building grid (A-T7), or null before the city arrives (no lift, no floor). */
  clearance?: Clearance | null;
  /** The overview the dive starts from (and the pull-back ends at, without `pullBackTo`). */
  overview: CamPose;
  /**
   * Where the pull-back ends: the route's own overview (gate §9.1 F4: ending on the whole
   * township left her under a pixel and the route a hairline). Default: `overview`.
   */
  pullBackTo?: CamPose;
  /** Her drawn ground position [x, z] at t (`heroStateAt`, pure); default: her route point. */
  heroAt?(t: number): [number, number];
  /**
   * Her body box (world) at screen time t, else null: the hold fit frames it. Must be a pure
   * function of t (the drawn skinned pose is not: it follows the animation mixer's state).
   */
  heroBox?(t: number): { min: Vec3; max: Vec3 } | null;
  /** The marker position of plan event `i` (the journey layer's `anchorOf`), or null. */
  markerOf?(eventIndex: number): Vec3 | null;
  /**
   * The view for the UI-safe hold fit (`safeFrame.ts`): at an event hold her body, the element and
   * the marker are kept inside the part of the map no UI covers. Absent: no screen-space fit.
   */
  view?: ViewFit | null;
  /**
   * The track's grid samples (`trackMemoFor`): one memo per scene inputs. Absent, the scene object
   * itself keys a memo (a caller that rebuilds the scene every frame passes one).
   */
  track?: TrackMemo;
}

/** The framing rule of an event kind (spec §6.4); verified, covered and gap holds follow her. */
export function framingFor(kind: JourneyEventKind | undefined): Framing {
  return kind === "rest" || kind === "unknown" || kind === "arrive" ? kind : "follow";
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ease = (u: number) => {
  const k = clamp(u, 0, 1);
  return k * k * (3 - 2 * k);
};

/** Unit route direction [fx, fz] at `m` (central difference, widened where degenerate). */
export function tangentAt(pointAt: FollowScene["pointAt"], m: number): [number, number] {
  for (const h of [FOLLOW.tangentM, 25, 60]) {
    const a = pointAt(m - h);
    const b = pointAt(m + h);
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz);
    if (l > 1e-6) return [dx / l, dz / l];
  }
  return [0, -1];
}

/** The right-hand side of a direction (x east, z south): facing east, +z (south) is the right. */
const rightOf = (f: [number, number]): [number, number] => [-f[1], f[0]];

/**
 * The follow pose around a ground point with direction `f` (spec §6.4: 8.5 m back, 4.5 m side,
 * 4.2 m up, looking 4 m ahead). `side` +1 is the prototype's side (right of travel), -1 mirrors it.
 */
export function followPose(at: [number, number], f: [number, number], side = 1): CamPose {
  const s = rightOf(f);
  return {
    pos: [
      at[0] - f[0] * FOLLOW.backM + s[0] * FOLLOW.sideM * side,
      FOLLOW.upM,
      at[1] - f[1] * FOLLOW.backM + s[1] * FOLLOW.sideM * side,
    ],
    look: [
      at[0] + f[0] * FOLLOW.aheadM - s[0] * FOLLOW.lookSideM * side,
      FOLLOW.lookYM,
      at[1] + f[1] * FOLLOW.aheadM - s[1] * FOLLOW.lookSideM * side,
    ],
  };
}

/** Camera height the view of `subject` from `pos` needs above pos (lift), 0 without a grid. */
export function liftNeed(c: Clearance | null | undefined, pos: Vec3, subject: Vec3): number {
  if (!c) return 0;
  const seg = c.segmentLiftM(pos, subject);
  const floor = c.floorAt(pos[0], pos[2], LIFT_SKIRT_M);
  return Math.max(0, seg - pos[1], floor - pos[1]);
}

/** The phase's framing and the event it frames (pull-back keeps the arrive framing). */
function framingAt(sc: FollowScene, t: number) {
  const st = stateAt(sc.timeline, t);
  let framing: Framing = "follow";
  let eventIndex: number | undefined;
  if (st.phase.kind === "event") {
    framing = framingFor(st.event?.kind);
    eventIndex = st.eventIndex;
  } else if (st.phase.kind === "pull") {
    const evs = sc.timeline.plan.events;
    const last = evs.length - 1;
    if (last >= 0 && evs[last]?.kind === "arrive") {
      framing = "arrive";
      eventIndex = last;
    }
  }
  return { st, framing, eventIndex };
}

/** Where a rest's hero sits (the seat), else 1.9 m to the left of the route (`seatFor` default). */
function seatPoint(sc: FollowScene, i: number, r: [number, number], f: [number, number]) {
  const s = sc.seatOf?.(i);
  if (s) return [s.x, s.z] as [number, number];
  const right = rightOf(f);
  return [r[0] - right[0] * 1.9, r[1] - right[1] * 1.9] as [number, number];
}

/**
 * The 3D point of an event's element (AC-D8 "the event's element projects inside the frame"):
 * the bench seat for a rest, the destination for arrive, else the route point at `at_m`. For a
 * walking hold (verified / covered / gap) with her route metre `distanceM`, the point of the
 * stretch she walks (the plan span the event starts) nearest to her.
 */
export function elementPoint(sc: FollowScene, eventIndex: number, distanceM?: number): Vec3 | null {
  const e = sc.timeline.plan.events[eventIndex];
  if (!e) return null;
  const r = sc.pointAt(e.at_m);
  if (e.kind === "rest") {
    const s = seatPoint(sc, eventIndex, r, tangentAt(sc.pointAt, e.at_m));
    return [s[0], 0.5, s[1]];
  }
  if (e.kind === "arrive") {
    const d = destinationOf(sc, r);
    return [d[0], 0.5, d[1]];
  }
  if (distanceM !== undefined && HOLD_MOVES.has(e.kind)) {
    // a walking hold: the element is the stretch she walks (its plan span); its nearest point to her
    const span = sc.timeline.plan.spans.find(([a, b]) => e.at_m >= a - 0.05 && e.at_m < b);
    const end = span ? Math.max(span[1], e.at_m) : e.at_m;
    const p = sc.pointAt(clamp(distanceM, e.at_m, end));
    return [p[0], 0.3, p[1]];
  }
  return [r[0], 0.3, r[1]];
}

function destinationOf(sc: FollowScene, end: [number, number]): [number, number] {
  const d = sc.destination;
  if (d && Math.hypot(d[0] - end[0], d[1] - end[1]) <= ARRIVE_FRAME.maxDestM) return d;
  return end;
}

/** One raw (unsmoothed) framing at time t: offsets from the anchor (her route point). */
export interface RawFrame {
  framing: Framing;
  /** Her route point (the camera anchor). */
  anchor: [number, number];
  /** Camera position and look point minus [anchor x, 0, anchor z]. */
  off: Vec3;
  lookOff: Vec3;
  /** Metres the camera must rise for a clear view of the subject (and the anticipating floor). */
  lift: number;
}

const sub = (p: Vec3, a: [number, number]): Vec3 => [p[0] - a[0], p[1], p[2] - a[1]];

/** Metres of lift a half turn of the camera round her is worth (hold side choice, iteration 2). */
export const TURN_COST_M = 20;

/** Turns (deg) round the framed point a hold's framing may take to find a clear view. */
export const HOLD_TURNS_DEG: readonly number[] = [0, 45, -45, 90, -90];
/** Metres of lift each 45 deg of such a turn is worth (the framing's own side wins near-ties). */
export const HOLD_TURN_STEP_M = 1.5;

/**
 * A hold's framing: the candidate poses (in order of preference), each also turned round the framed
 * point by HOLD_TURNS_DEG; the one with the least lift wins, where a turn away from the framing
 * costs HOLD_TURN_STEP_M per 45 deg and, with `ref` (the follow camera's azimuth round the route
 * point at the event), a candidate further round her costs up to TURN_COST_M more: entering and
 * leaving the hold is a small turn, not a half circle, and the camera does not park against a wall.
 */
function clearer(
  c: Clearance | null | undefined,
  subject: Vec3,
  centre: [number, number],
  bases: readonly CamPose[],
  ref?: { at: [number, number]; az: number },
) {
  const turn = (p: CamPose) =>
    ref
      ? (TURN_COST_M *
          Math.abs(wrapPi(Math.atan2(p.pos[2] - ref.at[1], p.pos[0] - ref.at[0]) - ref.az))) /
        Math.PI
      : 0;
  let best: { pose: CamPose; lift: number } | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  bases.forEach((base, bi) => {
    for (const deg of c ? HOLD_TURNS_DEG : [0]) {
      const pose = deg === 0 ? base : turnPose(base, centre, (deg * Math.PI) / 180);
      const lift = liftNeed(c, pose.pos, subject);
      // a lift over the pitch cap leaves her hidden: that part costs four times as much
      const over = lift - capLift(c, pose.pos, subject, lift);
      // and a camera parked against a wall (a smoothed camera drifts up its floor ramp)
      const wall = c
        ? Math.max(0, c.floorAt(pose.pos[0], pose.pos[2], MAX_SKIRT_M) - pose.pos[1] - lift)
        : 0;
      const cost =
        lift +
        3 * over +
        0.5 * wall +
        turn(pose) +
        (HOLD_TURN_STEP_M * Math.abs(deg)) / 45 +
        bi * 0.25;
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        best = { pose, lift };
      }
    }
  });
  return best ?? { pose: bases[0] as CamPose, lift: 0 };
}

/** The follow camera's azimuth round her route point at metre m (its side from `sideAt`). */
function followRef(sc: FollowScene, m: number): { at: [number, number]; az: number } {
  const at = sc.pointAt(m);
  const f = tangentAt(sc.pointAt, m);
  const alt = sideAt(sc, m);
  const [side, deg] = alt >= 0 ? (ORBIT_ALTERNATIVES[alt] as readonly [number, number]) : [1, 0];
  const p = turnPose(followPose(at, f, side), at, (deg * Math.PI) / 180);
  return { at, az: Math.atan2(p.pos[2] - at[1], p.pos[0] - at[0]) };
}

/** Metres of lift a half turn of the follow side round her is worth (`sideAt`). */
export const SIDE_TURN_M = 3;
/** Route metres either side of a metre that the follow side choice looks at (`sideAt`). */
export const SIDE_REACH_M: readonly number[] = [-20, -10, 0, 10, 20];

/**
 * The follow framing's side at route metre m: -1 for the default, else an `ORBIT_ALTERNATIVES`
 * index. The mean lift each candidate needs over the stretch m + SIDE_REACH_M decides; each step
 * away from the default costs SWAP_GAIN_M, so the default wins near-ties; and a change of side
 * from the metre before (or from the framing of a hold at the metre before: the camera leaves a
 * hold from where it framed it) costs up to SIDE_TURN_M per half turn round her. Per whole metre,
 * computed in route order and memoised with the track: a pure function of m.
 */
export function sideAt(sc: FollowScene, m: number): number {
  const c = sc.clearance;
  if (!c) return -1;
  const memo = memoOf(sc);
  const key = Math.max(0, Math.round(m));
  const hit = memo.sides.get(key);
  if (hit !== undefined) return hit;
  let k = key;
  while (k > 0 && !memo.sides.has(k - 1)) k--;
  for (; k <= key; k++) memo.sides.set(k, sideChoice(sc, c, memo, k));
  return memo.sides.get(key) as number;
}

/** The azimuth round her route point at metre k of the follow pose with side choice `alt`. */
function sideAz(sc: FollowScene, k: number, alt: number): number {
  const a = sc.pointAt(k);
  const f = tangentAt(sc.pointAt, k);
  const [side, deg] = alt >= 0 ? (ORBIT_ALTERNATIVES[alt] as readonly [number, number]) : [1, 0];
  const p = turnPose(followPose(a, f, side), a, (deg * Math.PI) / 180);
  return Math.atan2(p.pos[2] - a[1], p.pos[0] - a[0]);
}

/** The azimuth the camera leaves metre k - 1 with: a hold's framing there, else its side. */
function previousAz(sc: FollowScene, memo: TrackMemo, k: number): number | null {
  if (k <= 0) return null;
  const tl = sc.timeline;
  let hold: (typeof tl.phases)[number] | undefined;
  for (const p of tl.phases)
    if (
      p.kind === "event" &&
      p.event &&
      framingFor(p.event.kind) !== "follow" &&
      Math.round(p.event.at_m) === k - 1
    )
      hold = p;
  if (hold) {
    const r = rawFrameAt(sc, (hold.t0 + hold.t1) / 2);
    return Math.atan2(r.off[2], r.off[0]);
  }
  return sideAz(sc, k - 1, memo.sides.get(k - 1) ?? -1);
}

function sideChoice(sc: FollowScene, c: Clearance, memo: TrackMemo, key: number): number {
  const cost = new Array<number>(ORBIT_ALTERNATIVES.length + 1).fill(0);
  for (const dm of SIDE_REACH_M) {
    const mm = key + dm;
    const a = sc.pointAt(mm);
    const f = tangentAt(sc.pointAt, mm);
    const subject: Vec3 = [a[0], HERO_CHEST_Y, a[1]];
    cost[0] = (cost[0] as number) + liftNeed(c, followPose(a, f).pos, subject);
    ORBIT_ALTERNATIVES.forEach(([side, deg], i) => {
      const p = turnPose(followPose(a, f, side), a, (deg * Math.PI) / 180);
      cost[i + 1] = (cost[i + 1] as number) + liftNeed(c, p.pos, subject);
    });
  }
  const n = SIDE_REACH_M.length;
  const prev = previousAz(sc, memo, key);
  const turn = (alt: number) =>
    prev === null ? 0 : (SIDE_TURN_M * Math.abs(wrapPi(sideAz(sc, key, alt) - prev))) / Math.PI;
  let best = -1;
  let bestCost = (cost[0] as number) / n + turn(-1);
  if ((cost[0] as number) / n > SWAP_GAIN_M || prev !== null)
    for (let i = 0; i < ORBIT_ALTERNATIVES.length; i++) {
      const ci = (cost[i + 1] as number) / n + SWAP_GAIN_M * (i + 1) + turn(i);
      if (ci < bestCost) {
        bestCost = ci;
        best = i;
      }
    }
  return best;
}

/** The raw framing at screen time t (pure). */
export function rawFrameAt(sc: FollowScene, t: number): RawFrame {
  const { st, framing, eventIndex } = framingAt(sc, t);
  const anchor = sc.pointAt(st.distance_m);
  const c = sc.clearance;
  const ev = eventIndex !== undefined ? sc.timeline.plan.events[eventIndex] : undefined;
  let pose: CamPose;
  let lift: number;
  if (framing === "rest" && ev && eventIndex !== undefined) {
    const r = sc.pointAt(ev.at_m);
    const f = tangentAt(sc.pointAt, ev.at_m);
    const s = seatPoint(sc, eventIndex, r, f);
    let ux = s[0] - r[0];
    let uz = s[1] - r[1];
    const spread = Math.hypot(ux, uz);
    if (spread < 0.3) [ux, uz] = rightOf(f).map((v) => -v) as [number, number];
    else [ux, uz] = [ux / spread, uz / spread];
    // the side view looks across the route-to-seat line; prefer the side behind her travel
    let w: [number, number] = [-uz, ux];
    if (w[0] * -f[0] + w[1] * -f[1] < 0) w = [-w[0], -w[1]];
    const m: [number, number] = [(r[0] + s[0]) / 2, (r[1] + s[1]) / 2];
    const d = clamp(
      REST_FRAME.minDistM + REST_FRAME.perSpreadM * spread,
      REST_FRAME.minDistM,
      REST_FRAME.maxDistM,
    );
    const at = (k: number): CamPose => ({
      pos: [m[0] + w[0] * d * k, REST_FRAME.upM + REST_FRAME.upPerDist * d, m[1] + w[1] * d * k],
      look: [m[0], REST_FRAME.lookYM, m[1]],
    });
    const best = clearer(c, [s[0], HERO_CHEST_Y, s[1]], m, [at(1), at(-1)], followRef(sc, ev.at_m));
    pose = best.pose;
    lift = best.lift;
  } else if (framing === "unknown" && ev) {
    const e = sc.pointAt(ev.at_m);
    const f = tangentAt(sc.pointAt, ev.at_m);
    const s = rightOf(f);
    const at = (side: number): CamPose => ({
      pos: [
        e[0] - f[0] * UNKNOWN_FRAME.backM + s[0] * UNKNOWN_FRAME.sideM * side,
        UNKNOWN_FRAME.upM,
        e[1] - f[1] * UNKNOWN_FRAME.backM + s[1] * UNKNOWN_FRAME.sideM * side,
      ],
      look: [
        e[0] + f[0] * UNKNOWN_FRAME.aheadM,
        UNKNOWN_FRAME.lookYM,
        e[1] + f[1] * UNKNOWN_FRAME.aheadM,
      ],
    });
    const best = clearer(c, [e[0], HERO_CHEST_Y, e[1]], e, [at(1), at(-1)], followRef(sc, ev.at_m));
    pose = best.pose;
    lift = best.lift;
  } else if (framing === "arrive") {
    const h = anchor;
    const dest = destinationOf(sc, h);
    const ax = dest[0] - h[0];
    const az = dest[1] - h[1];
    const dist = Math.hypot(ax, az);
    if (dist < 3) {
      pose = followPose(h, tangentAt(sc.pointAt, st.distance_m));
    } else {
      const u: [number, number] = [ax / dist, az / dist];
      const s = rightOf(u);
      const back = clamp(
        ARRIVE_FRAME.minBackM + ARRIVE_FRAME.perDistM * dist,
        ARRIVE_FRAME.minBackM,
        ARRIVE_FRAME.maxBackM,
      );
      const at = (side: number): CamPose => ({
        pos: [
          h[0] - u[0] * back + s[0] * ARRIVE_FRAME.sideM * side,
          ARRIVE_FRAME.upM + ARRIVE_FRAME.upPerBack * back,
          h[1] - u[1] * back + s[1] * ARRIVE_FRAME.sideM * side,
        ],
        look: [h[0] + ax * 0.5, ARRIVE_FRAME.lookYM, h[1] + az * 0.5],
      });
      pose = clearer(
        c,
        [h[0], HERO_CHEST_Y, h[1]],
        h,
        [at(1), at(-1)],
        followRef(sc, st.distance_m),
      ).pose;
    }
    lift = liftNeed(c, pose.pos, [h[0], HERO_CHEST_Y, h[1]]);
  } else {
    const f = tangentAt(sc.pointAt, st.distance_m);
    const subject: Vec3 = [anchor[0], HERO_CHEST_Y, anchor[1]];
    // A building where the default camera stands (she walks out of a building, a tower beside her):
    // the same framing from another side of her (mirrored, or turned about her), when that saves
    // lift. The side is chosen per route metre over a stretch around it (`sideAt`), so it does
    // not flicker from frame to frame (iteration 2: the owner's recording swung 20-40 deg).
    const alt = sideAt(sc, st.distance_m);
    const [side, deg] = alt >= 0 ? (ORBIT_ALTERNATIVES[alt] as readonly [number, number]) : [1, 0];
    pose = turnPose(followPose(anchor, f, side), anchor, (deg * Math.PI) / 180);
    lift = liftNeed(c, pose.pos, subject);
  }
  // She stands inside a footprint the route itself crosses (Harmoni 1 at the start, the Sales
  // Gallery at ~836 m; ruling): look down at her from above its roof (+ clearance), where the drawn
  // walls hide her least; never lower.
  if (c) {
    const h = sc.heroAt?.(t) ?? anchor;
    const top = c.topAt(h[0], h[1]);
    if (top > 0) lift = Math.max(lift, top + c.clearanceM - pose.pos[1]);
  }
  return { framing, anchor, off: sub(pose.pos, anchor), lookOff: sub(pose.look, anchor), lift };
}

const wrapPi = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

/** A raw frame's offsets in polar form about her: azimuth, horizontal distance, height, and the
 * look offset in the camera's frame (u along the azimuth, y, v across). */
function polar(r: RawFrame) {
  const azm = Math.atan2(r.off[2], r.off[0]);
  const c = Math.cos(azm);
  const s = Math.sin(azm);
  const [lx, ly, lz] = r.lookOff;
  return {
    az: azm,
    r: Math.hypot(r.off[0], r.off[2]),
    y: r.off[1],
    look: [lx * c + lz * s, ly, -lx * s + lz * c] as Vec3,
  };
}

/** The lift taper: 1 at the centre, cos² down to 0 at ±SMOOTH.liftWindowS. */
export function liftTaper(dtS: number): number {
  const u = Math.abs(dtS) / SMOOTH.liftWindowS;
  if (u >= 1) return 0;
  const c = Math.cos((Math.PI / 2) * u);
  return c * c;
}

/** Her chest at t: where the hero driver puts her (off the route at a rest), else her route point. */
function subjectAt(sc: FollowScene, t: number, anchor: [number, number]): Vec3 {
  const h = sc.heroAt?.(t) ?? anchor;
  return [h[0], HERO_CHEST_Y, h[1]];
}

/**
 * The damped follow pose at t (follow / per-event framing, lift, hard floor), for any t: in the
 * dive it is the pose at her start, in the pull-back the arrive framing. Pure.
 */
export function followPoseAt(sc: FollowScene, t: number): CamPose {
  const total = sc.timeline.total;
  const tc = clamp(Number.isFinite(t) ? t : 0, 0, total);
  const n = Math.round(SMOOTH.halfWindowS / SMOOTH.stepS);
  const nl = Math.round(SMOOTH.liftWindowS / SMOOTH.stepS);
  // Offsets are averaged in polar form about her (azimuth, horizontal distance, height; the look
  // offset in the camera's own frame), so a change of side swings round her, never through her.
  const here = rawFrameAt(sc, tc);
  const p0 = polar(here);
  let az = 0;
  let rad = 0;
  let hy = 0;
  const lk3: Vec3 = [0, 0, 0];
  let wsum = 0;
  let lift = 0;
  for (let k = -Math.max(n, nl); k <= Math.max(n, nl); k++) {
    const dt = k * SMOOTH.stepS;
    const r = k === 0 ? here : rawFrameAt(sc, clamp(tc + dt, 0, total));
    if (Math.abs(k) <= n) {
      const w = Math.exp(-(dt * dt) / (2 * SMOOTH.sigmaS * SMOOTH.sigmaS));
      const q = k === 0 ? p0 : polar(r);
      az += w * wrapPi(q.az - p0.az);
      rad += w * q.r;
      hy += w * q.y;
      for (let i = 0; i < 3; i++) lk3[i] = (lk3[i] as number) + w * (q.look[i] as number);
      wsum += w;
    }
    lift = Math.max(lift, r.lift * liftTaper(dt));
  }
  const a = here.anchor;
  const A = p0.az + az / wsum;
  const R = rad / wsum;
  const ca = Math.cos(A);
  const sa = Math.sin(A);
  const pos: Vec3 = [a[0] + ca * R, hy / wsum, a[1] + sa * R];
  // the look offset back from the camera frame (u along the azimuth, v across it)
  const lu = (lk3[0] as number) / wsum;
  const lv = (lk3[2] as number) / wsum;
  const lk: Vec3 = [a[0] + ca * lu - sa * lv, (lk3[1] as number) / wsum, a[1] + sa * lu + ca * lv];
  // never under-lifted at t: the exact need of the smoothed pose, then the windowed lift
  const subject = subjectAt(sc, tc, a);
  const up = capLift(
    sc.clearance,
    pos,
    subject,
    Math.max(lift, liftNeed(sc.clearance, pos, subject)),
  );
  pos[1] += up;
  // a lifted camera tilts down onto her (else she drops out of the bottom of the frame)
  if (up > 0) {
    const k = up / (up + LIFT_LOOK_M);
    lk[0] += (subject[0] - lk[0]) * k;
    lk[1] += (FOLLOW.lookYM - lk[1]) * k;
    lk[2] += (subject[2] - lk[2]) * k;
  }
  keepOffHero(pos, subject);
  applyFloor(sc.clearance, pos);
  return { pos, look: lk };
}

/**
 * A lift no higher than a TRACK.maxPitchDeg look-down onto her from where the camera stands
 * (iteration 2: a tower beside her asked for a 150 m lift, an overhead shot); a building that
 * still stands in the way is the side choice's job (`sideAt`). Where she stands inside a footprint
 * the route crosses, the lift is over its roof (ruling), and `limitPitch` then stands the camera
 * back instead of looking straight down.
 */
function capLift(c: Clearance | null | undefined, pos: Vec3, subject: Vec3, need: number) {
  if (!c || need <= 0) return 0;
  const hd = Math.hypot(pos[0] - subject[0], pos[2] - subject[2]);
  const cap = FOLLOW.lookYM + hd * Math.tan((TRACK.maxPitchDeg * Math.PI) / 180) - pos[1];
  const top = c.topAt(subject[0], subject[2]);
  const roof = top > 0 ? top + c.clearanceM - pos[1] : 0;
  return Math.max(0, Math.min(need, Math.max(cap, roof)));
}

/** AC-D9 guard: at least MIN_HERO_DIST_M + HERO_RADIUS_M (+ margin) from her, pushed out sideways. */
function keepOffHero(pos: Vec3, subject: Vec3) {
  const min = MIN_HERO_DIST_M + HERO_RADIUS_M + 1;
  const dx = pos[0] - subject[0];
  const dz = pos[2] - subject[2];
  const dy = pos[1] - subject[1];
  const d = Math.hypot(dx, dy, dz);
  if (d >= min) return;
  // raise first (never dive into her): the vertical gap that restores the distance
  const h = Math.hypot(dx, dz);
  pos[1] = subject[1] + Math.sqrt(Math.max(0, min * min - h * h)) + 1e-6;
}

/** The hard floor: roof + clearance inside a footprint (never eased). */
function applyFloor(c: Clearance | null | undefined, pos: Vec3) {
  if (!c) return;
  pos[1] = Math.max(pos[1], c.floorAt(pos[0], pos[2]));
}

/**
 * A blend between two camera poses: the look point moves by the share of distance covered, the
 * camera-to-look distance in log space and its direction by a slerp (k in [0, 1], already eased).
 */
export function blendPose(a: CamPose, b: CamPose, k: number): CamPose {
  const oa: Vec3 = [a.pos[0] - a.look[0], a.pos[1] - a.look[1], a.pos[2] - a.look[2]];
  const ob: Vec3 = [b.pos[0] - b.look[0], b.pos[1] - b.look[1], b.pos[2] - b.look[2]];
  const la = Math.hypot(...oa) || 1e-6;
  const lb = Math.hypot(...ob) || 1e-6;
  const kk = clamp(k, 0, 1);
  const l = Math.exp(Math.log(la) + (Math.log(lb) - Math.log(la)) * kk);
  // the look point follows the distance: halfway down in distance is (almost) there in look
  const kl = Math.abs(la - lb) > 1e-6 ? clamp((la - l) / (la - lb), 0, 1) : kk;
  const look: Vec3 = [
    a.look[0] + (b.look[0] - a.look[0]) * kl,
    a.look[1] + (b.look[1] - a.look[1]) * kl,
    a.look[2] + (b.look[2] - a.look[2]) * kl,
  ];
  const ua = oa.map((v) => v / la) as Vec3;
  const ub = ob.map((v) => v / lb) as Vec3;
  const dot = clamp(ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2], -1, 1);
  const th = Math.acos(dot);
  let dir: Vec3;
  if (th < 1e-4) dir = ua;
  else {
    const s = Math.sin(th);
    const wa = Math.sin((1 - kk) * th) / s;
    const wb = Math.sin(kk * th) / s;
    dir = [ua[0] * wa + ub[0] * wb, ua[1] * wa + ub[1] * wb, ua[2] * wa + ub[2] * wb];
  }
  return { pos: [look[0] + dir[0] * l, look[1] + dir[1] * l, look[2] + dir[2] * l], look };
}

export type JourneyCamMode = "follow" | "overview" | "free";

/**
 * The camera track (iteration 2, owner video): the per-sample camera above (follow pose, per-event
 * framing, lift, hold fit) still switches discretely (a side swap round her, a framing change at a
 * hold, a lift window, a fit step), and the owner saw each switch as a shake. The drawn camera is
 * that per-sample camera on a fixed grid of trip times (every `stepS`), low-passed in t with a
 * Gaussian per channel in polar form about her (anchor, azimuth round her, horizontal distance,
 * height, the look offset in the camera's frame). Every weight is a smooth function of t, so the
 * track is smooth in t (bounded velocity and acceleration), and it is a pure function of t: a grid
 * sample depends only on its own trip time (scrub equals play, AC-D17). The azimuth gets the
 * widest kernel (its swings are what read as shaking); the anchor the narrowest (she stays framed).
 */
export const TRACK = {
  stepS: 0.1,
  anchorSigmaS: 0.12,
  /** The anchor's integration step (s), about t itself. */
  anchorStepS: 0.02,
  azSigmaS: 1.0,
  sigmaS: 0.7,
  /** The dive lands this far (s) into the track (`landingTime`). */
  landingS: 0.6,
  /** The steepest look-down (deg) of a follow or hold camera: a 3/4 view, never overhead. */
  maxPitchDeg: 45,
  /** A high camera (from highFromM to highFullM up, low-passed over highLevelSigmaS) pans slower. */
  highFromM: 5,
  highFullM: 14,
  highLevelSigmaS: 1,
  highAzSigmaS: 2.5,
  /** The lift envelope: a need is held flat for liftHoldS either side, gone by liftReachS; its
   * low-pass width. */
  liftHoldS: 0.4,
  liftReachS: 1.2,
  liftSigmaS: 0.3,
  liftMarginM: 1.5,
  /** A side change larger than this (rad) picks its way round her (`turnAt`); metres per rad. */
  sweepCheckRad: 2,
  sweepPerRadM: 2,
  /** Clear turns: hidden beyond this (m of lift over the cap), step (deg), low-pass width (s). */
  clearTolM: 0.5,
  clearStepDeg: 5,
  clearSigmaS: 0.65,
  turnHoldS: 0.2,
  turnReachS: 0.8,
  /** The width (m) of the smooth maximum that joins the camera height and the floor ramp. */
  floorSoftM: 1,
  /** The width (m) of the smooth maximum of the pitch limit's stand-back. */
  pitchSoftM: 1.5,
} as const;

/** One grid sample of the follow camera in polar form about her (see TRACK). */
interface TrackSample {
  ax: number;
  az: number;
  /** Azimuth of the camera round her (rad), its horizontal distance, its height. */
  th: number;
  r: number;
  y: number;
  /** The look point minus her, in the camera's frame: u along the azimuth, v across, height. */
  lu: number;
  lv: number;
  ly: number;
}

/** The grid samples of one follow scene (cleared when what the samples depend on changes). */
export interface TrackMemo {
  deps: readonly unknown[];
  samples: Map<number, TrackSample>;
  /** The follow side per whole route metre (`sideAt`). */
  sides: Map<number, number>;
  /** The lift the kernel pass needs per grid time (`needAt`), and dilated (`dilatedNeedAt`). */
  needs: Map<number, number>;
  dilated: Map<number, number>;
  /** The azimuth step into each grid sample (`turnAt`), and its clear turn (`clearTurnAt`). */
  turns: Map<number, number>;
  clearTurns: Map<number, number>;
  dilatedTurns: Map<number, number>;
  /** `warmTrack`'s cursors: the next grid sample and the next grid need to compute. */
  warm?: { sample: number; need: number };
}

/**
 * A memo for `FollowScene.track`: the same object while every dep is the same (by identity), a
 * fresh one when one changes (a new timeline, the building grid arriving, a new view or seats).
 */
export function trackMemoFor(prev: TrackMemo | null, deps: readonly unknown[]): TrackMemo {
  if (prev && prev.deps.length === deps.length && prev.deps.every((d, i) => d === deps[i]))
    return prev;
  return newMemo(deps);
}

const newMemo = (deps: readonly unknown[]): TrackMemo => ({
  deps: [...deps],
  samples: new Map(),
  sides: new Map(),
  needs: new Map(),
  dilated: new Map(),
  turns: new Map(),
  clearTurns: new Map(),
  dilatedTurns: new Map(),
});

const ownMemo = new WeakMap<FollowScene, TrackMemo>();

/** The scene's memo: its own `track`, else one keyed by the scene object. */
function memoOf(sc: FollowScene): TrackMemo {
  let memo = sc.track ?? ownMemo.get(sc);
  if (!memo) {
    memo = newMemo([]);
    ownMemo.set(sc, memo);
  }
  return memo;
}

/**
 * The grid indices of the follow span. Every kernel of the track sums over these only (weights
 * renormalised), so at the span's ends a kernel is one-sided: padding with copies of the end sample
 * pulled the track's first pose towards it (iteration 2: she steps into Harmoni 1 just after the
 * dive, the end sample is not yet over the roof, and the camera dived to 20 m, then rose to 32 m).
 */
function gridSpan(sc: FollowScene): [number, number] {
  const [a, b] = followSpan(sc.timeline);
  return [Math.ceil(a / TRACK.stepS - 1e-9), Math.floor(b / TRACK.stepS + 1e-9)];
}

/** The follow span of the trip: from the end of the dive to the start of the pull-back. */
export function followSpan(tl: Timeline): [number, number] {
  const dive = tl.phases.find((p) => p.kind === "dive");
  const pull = tl.phases.find((p) => p.kind === "pull");
  const a = dive ? dive.t1 : 0;
  const b = pull ? pull.t0 : tl.total;
  return [a, Math.max(a, b)];
}

/** A pose made no steeper than TRACK.maxPitchDeg: the camera stands back (same height). */
export function limitPitch(p: CamPose, softM = 0): void {
  const dx = p.pos[0] - p.look[0];
  const dz = p.pos[2] - p.look[2];
  const dy = p.pos[1] - p.look[1];
  const h = Math.hypot(dx, dz);
  const need = dy / Math.tan((TRACK.maxPitchDeg * Math.PI) / 180);
  if (dy <= 0) return;
  const to = softMax(h, need, softM);
  if (to <= h) return;
  const ux = h > 1e-6 ? dx / h : 0;
  const uz = h > 1e-6 ? dz / h : 1;
  p.pos[0] = p.look[0] + ux * to;
  p.pos[2] = p.look[2] + uz * to;
}

/**
 * max(a, b) with a quadratic blend over ±e around a = b (continuous slope); e = 0 is the plain
 * max. Never below either.
 */
function softMax(a: number, b: number, e: number): number {
  const d = b - a;
  if (d <= -e) return a;
  if (d >= e) return b;
  return a + ((d + e) * (d + e)) / (4 * e);
}

/**
 * The per-sample follow camera at trip time t (no track): the damped follow pose with per-event
 * framing, the hold's UI-safe fit and the pitch limit; dive and pull-back times give the pose at
 * the follow span's ends. Pure.
 */
export function followTargetAt(sc: FollowScene, t: number): CamPose {
  const [a, b] = followSpan(sc.timeline);
  const tt = clamp(Number.isFinite(t) ? t : 0, a, b);
  const st = stateAt(sc.timeline, tt);
  let p = followPoseAt(sc, tt);
  if (st.phase.kind === "event" && st.eventIndex !== undefined) p = fitHold(sc, tt, st, p);
  limitPitch(p);
  applyFloor(sc.clearance, p.pos);
  return p;
}

function sampleAt(sc: FollowScene, memo: TrackMemo, index: number): TrackSample {
  const [a, b] = followSpan(sc.timeline);
  // grid times outside the follow span are its end samples (one memo entry each)
  const i = clamp(index, Math.ceil(a / TRACK.stepS - 1e-9), Math.floor(b / TRACK.stepS + 1e-9));
  const hit = memo.samples.get(i);
  if (hit) return hit;
  const tt = clamp(i * TRACK.stepS, a, b);
  const p = followTargetAt(sc, tt);
  const st = stateAt(sc.timeline, tt);
  const h = sc.heroAt?.(tt) ?? sc.pointAt(st.distance_m);
  const ox = p.pos[0] - h[0];
  const oz = p.pos[2] - h[1];
  const th = Math.atan2(oz, ox);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const lx = p.look[0] - h[0];
  const lz = p.look[2] - h[1];
  const out: TrackSample = {
    ax: h[0],
    az: h[1],
    th,
    r: Math.hypot(ox, oz),
    y: p.pos[1],
    lu: lx * c + lz * s,
    lv: -lx * s + lz * c,
    ly: p.look[1],
  };
  memo.samples.set(i, out);
  return out;
}

/**
 * A Gaussian with compact support: times (1 - u²)² for u = dt / 3σ, 0 beyond 3σ. A sample entering
 * the window enters with zero weight and slope (a plain Gaussian cut at 3σ let each new grid sample
 * in with a small step, a 10 Hz ripple in the camera).
 */
const gauss = (dt: number, sg: number) => {
  const u = dt / (3 * sg);
  if (u * u >= 1) return 0;
  const b = 1 - u * u;
  return Math.exp(-(dt * dt) / (2 * sg * sg)) * b * b;
};

/** The kernel pass of the track at t: the grid samples low-passed per channel (see TRACK). */
function basePoseAt(sc: FollowScene, memo: TrackMemo, tc: number): CamPose {
  const h = TRACK.stepS;
  const azSigma = azSigmaAt(sc, memo, tc);
  const reach = 3 * Math.max(azSigma, TRACK.sigmaS);
  const [g0, g1] = gridSpan(sc);
  const i0 = Math.max(g0, Math.ceil((tc - reach) / h));
  const i1 = Math.min(g1, Math.floor((tc + reach) / h));
  let wz = 0;
  let ws = 0;
  let th = 0;
  let r = 0;
  let y = 0;
  let lu = 0;
  let lv = 0;
  let ly = 0;
  // the azimuth unwrapped pairwise along the grid (the same offsets whatever the window)
  let prevTh = Number.NaN;
  let unwrapped = 0;
  let th0 = 0;
  for (let i = i0; i <= i1; i++) {
    const q = sampleAt(sc, memo, i);
    if (Number.isNaN(prevTh)) {
      unwrapped = q.th;
      th0 = q.th;
    } else unwrapped += turnAt(sc, memo, i);
    prevTh = q.th;
    const dt = i * h - tc;
    const w2 = gauss(dt, azSigma);
    const w3 = gauss(dt, TRACK.sigmaS);
    wz += w2;
    th += w2 * (unwrapped - th0);
    ws += w3;
    r += w3 * q.r;
    y += w3 * q.y;
    lu += w3 * q.lu;
    lv += w3 * q.lv;
    ly += w3 * q.ly;
  }
  const A = th0 + th / wz;
  const R = r / ws;
  const c = Math.cos(A);
  const s = Math.sin(A);
  const [cx, cz] = anchorAt(sc, tc);
  const LU = lu / ws;
  const LV = lv / ws;
  return {
    pos: [cx + c * R, y / ws, cz + s * R],
    look: [cx + c * LU - s * LV, ly / ws, cz + s * LU + c * LV],
  };
}

/**
 * The azimuth kernel's width at t: TRACK.azSigmaS, widened up to TRACK.highAzSigmaS where the
 * camera is high (a lift over a roof or a tower): from up there a slow pan follows her, where a
 * close camera swinging round each turn of a short path beside a tower read as shaking. The
 * height is the samples' own, low-passed, so the width is a smooth function of t.
 */
function azSigmaAt(sc: FollowScene, memo: TrackMemo, tc: number): number {
  const h = TRACK.stepS;
  const sg = TRACK.highLevelSigmaS;
  const [g0, g1] = gridSpan(sc);
  const i0 = Math.max(g0, Math.ceil((tc - 3 * sg) / h));
  const i1 = Math.min(g1, Math.floor((tc + 3 * sg) / h));
  let w = 0;
  let y = 0;
  for (let i = i0; i <= i1; i++) {
    const g = gauss(i * h - tc, sg);
    w += g;
    y += g * sampleAt(sc, memo, i).y;
  }
  const k = clamp((y / w - TRACK.highFromM) / (TRACK.highFullM - TRACK.highFromM), 0, 1);
  const e = k * k * (3 - 2 * k);
  return TRACK.azSigmaS + (TRACK.highAzSigmaS - TRACK.azSigmaS) * e;
}

/**
 * The camera's anchor at t: her ground position low-passed over TRACK.anchorSigmaS, integrated on
 * a fine step about t itself (a kernel this narrow on the 10 Hz grid rippled with the grid).
 */
function anchorAt(sc: FollowScene, tc: number): [number, number] {
  const [a, b] = followSpan(sc.timeline);
  const sg = TRACK.anchorSigmaS;
  const d = TRACK.anchorStepS;
  const n = Math.ceil((3 * sg) / d);
  let w = 0;
  let x = 0;
  let z = 0;
  for (let k = -n; k <= n; k++) {
    const g = gauss(k * d, sg);
    const tt = clamp(tc + k * d, a, b);
    const h = sc.heroAt?.(tt) ?? sc.pointAt(stateAt(sc.timeline, tt).distance_m);
    w += g;
    x += g * h[0];
    z += g * h[1];
  }
  return [x / w, z / w];
}

/**
 * The azimuth step from grid sample i - 1 to i (memoised). A small step is the short way round. A
 * large one (a framing change of side) goes the way round her with the clearer view: the lift the
 * camera would need at a quarter, half and three quarters of each sweep, plus a little per radian
 * for the longer way (iteration 2: the short way round from the 836 m rest swept the camera
 * behind a building for a second).
 */
function turnAt(sc: FollowScene, memo: TrackMemo, i: number): number {
  const hit = memo.turns.get(i);
  if (hit !== undefined) return hit;
  const a = sampleAt(sc, memo, i - 1);
  const b = sampleAt(sc, memo, i);
  const d = wrapPi(b.th - a.th);
  let out = d;
  const c = sc.clearance;
  if (c && Math.abs(d) > TRACK.sweepCheckRad) {
    const other = d - Math.sign(d) * 2 * Math.PI;
    const subject: Vec3 = [b.ax, HERO_CHEST_Y, b.az];
    const cost = (dd: number) => {
      let v = TRACK.sweepPerRadM * Math.abs(dd);
      for (const k of [0.25, 0.5, 0.75]) {
        const th = a.th + dd * k;
        const r = a.r + (b.r - a.r) * k;
        const y = a.y + (b.y - a.y) * k;
        v += liftNeed(c, [b.ax + Math.cos(th) * r, y, b.az + Math.sin(th) * r], subject);
      }
      return v;
    };
    if (cost(other) < cost(d)) out = other;
  }
  memo.turns.set(i, out);
  return out;
}

/**
 * The turn round her (rad) that gives the kernel pass at grid time i a view of her within the
 * pitch limit, memoised: 0 when it has one, else the smallest turn (5 deg steps, up to 90 deg
 * either way) that does. The kernel's azimuth is an average, and between two clear sides (a hold's
 * framing and the follow side) it can land behind a building (iteration 2: the walk from the
 * 836 m rest to the 888 m rest).
 */
function clearTurnAt(sc: FollowScene, memo: TrackMemo, i: number): number {
  const hit = memo.clearTurns.get(i);
  if (hit !== undefined) return hit;
  const c = sc.clearance;
  let out = 0;
  if (c) {
    const t = i * TRACK.stepS;
    const p = basePoseAt(sc, memo, t);
    const subject = trackSubject(sc, t);
    const hidden = (pos: Vec3) => {
      const need = liftNeed(c, pos, subject);
      return need - capLift(c, pos, subject, need) > TRACK.clearTolM;
    };
    if (hidden(p.pos)) {
      const step = (TRACK.clearStepDeg * Math.PI) / 180;
      const n = Math.round(90 / TRACK.clearStepDeg);
      search: for (let k = 1; k <= n; k++)
        for (const sgn of [1, -1]) {
          const q = turnPose(p, [subject[0], subject[2]], sgn * k * step);
          if (!hidden(q.pos)) {
            out = sgn * k * step;
            break search;
          }
        }
    }
  }
  memo.clearTurns.set(i, out);
  return out;
}

/** The clear turns' dilation taper: flat for `turnHoldS`, cos² down to 0 at `turnReachS`. */
function turnTaper(dtS: number): number {
  const u = (Math.abs(dtS) - TRACK.turnHoldS) / (TRACK.turnReachS - TRACK.turnHoldS);
  if (u <= 0) return 1;
  if (u >= 1) return 0;
  const c = Math.cos((Math.PI / 2) * u);
  return c * c;
}

/**
 * The clear turns dilated in time (the largest within the envelope taper, sign kept), memoised: a
 * turn a moment ahead is taken early and held, as a lift is (a lone sample's turn was averaged
 * away and left her hidden for 0.2 s).
 */
function dilatedTurnAt(sc: FollowScene, memo: TrackMemo, i: number): number {
  const hit = memo.dilatedTurns.get(i);
  if (hit !== undefined) return hit;
  const n = Math.ceil(TRACK.turnReachS / TRACK.stepS);
  let v = 0;
  const [g0, g1] = gridSpan(sc);
  for (let j = Math.max(g0, i - n); j <= Math.min(g1, i + n); j++) {
    const w = clearTurnAt(sc, memo, j) * turnTaper((j - i) * TRACK.stepS);
    if (Math.abs(w) > Math.abs(v)) v = w;
  }
  memo.dilatedTurns.set(i, v);
  return v;
}

/** The kernel pass turned round her by the low-passed clear turns (`clearTurnAt`): smooth in t. */
function clearPoseAt(sc: FollowScene, memo: TrackMemo, tc: number): CamPose {
  const p = basePoseAt(sc, memo, tc);
  if (!sc.clearance) return p;
  const h = TRACK.stepS;
  const sg = TRACK.clearSigmaS;
  const [g0, g1] = gridSpan(sc);
  const i0 = Math.max(g0, Math.ceil((tc - 3 * sg) / h));
  const i1 = Math.min(g1, Math.floor((tc + 3 * sg) / h));
  let w = 0;
  let v = 0;
  for (let i = i0; i <= i1; i++) {
    const g = gauss(i * h - tc, sg);
    w += g;
    v += g * dilatedTurnAt(sc, memo, i);
  }
  const turn = w > 0 ? v / w : 0;
  if (Math.abs(turn) < 1e-9) return p;
  return turnPose(p, anchorAt(sc, tc), turn);
}

/** Her chest at trip time t, clamped into the follow span. */
function trackSubject(sc: FollowScene, t: number): Vec3 {
  const [a, b] = followSpan(sc.timeline);
  const tt = clamp(t, a, b);
  return subjectAt(sc, tt, sc.pointAt(stateAt(sc.timeline, tt).distance_m));
}

/**
 * The lift the kernel pass needs at grid time i (memoised): a clear view of her chest and the
 * anticipating floor (`liftNeed`), and over the roof where she stands inside a footprint the route
 * crosses. Pure: it depends only on grid time i.
 */
function needAt(sc: FollowScene, memo: TrackMemo, i: number): number {
  const hit = memo.needs.get(i);
  if (hit !== undefined) return hit;
  const c = sc.clearance;
  let need = 0;
  if (c) {
    const t = i * TRACK.stepS;
    const p = clearPoseAt(sc, memo, t);
    const subject = trackSubject(sc, t);
    // the view's lift is capped at the pitch limit; the floor ramp is not (the camera keeps clear
    // of roofs whatever the pitch, and the envelope then carries it over smoothly)
    const floor = c.floorAt(p.pos[0], p.pos[2], LIFT_SKIRT_M) - p.pos[1];
    need = Math.max(capLift(c, p.pos, subject, liftNeed(c, p.pos, subject)), floor);
    // a margin, so the low-passed envelope clears the floor ramp and `softFloor` seldom binds
    if (need > 0) need += TRACK.liftMarginM;
  }
  memo.needs.set(i, need);
  return need;
}

/** The lift taper of the envelope: flat for `liftHoldS`, then cos² down to 0 at `liftReachS`. */
function envelopeTaper(dtS: number): number {
  const u = (Math.abs(dtS) - TRACK.liftHoldS) / (TRACK.liftReachS - TRACK.liftHoldS);
  if (u <= 0) return 1;
  if (u >= 1) return 0;
  const c = Math.cos((Math.PI / 2) * u);
  return c * c;
}

/** The grid needs dilated in time (max over the envelope taper), memoised per grid index. */
function dilatedNeedAt(sc: FollowScene, memo: TrackMemo, i: number): number {
  const hit = memo.dilated.get(i);
  if (hit !== undefined) return hit;
  const n = Math.ceil(TRACK.liftReachS / TRACK.stepS);
  let v = 0;
  const [g0, g1] = gridSpan(sc);
  for (let j = Math.max(g0, i - n); j <= Math.min(g1, i + n); j++) {
    const need = needAt(sc, memo, j);
    if (need > v) v = Math.max(v, need * envelopeTaper((j - i) * TRACK.stepS));
  }
  memo.dilated.set(i, v);
  return v;
}

/**
 * The lift envelope at t: the grid needs dilated in time (a lift rises before the building arrives
 * and is held after it), then low-passed with a Gaussian in t, so the lift is smooth in t (a max
 * taken at t itself ripples with the grid).
 */
function liftEnvelope(sc: FollowScene, memo: TrackMemo, tc: number): number {
  if (!sc.clearance) return 0;
  const h = TRACK.stepS;
  const sg = TRACK.liftSigmaS;
  const [g0, g1] = gridSpan(sc);
  const i0 = Math.max(g0, Math.ceil((tc - 3 * sg) / h));
  const i1 = Math.min(g1, Math.floor((tc + 3 * sg) / h));
  let w = 0;
  let v = 0;
  for (let i = i0; i <= i1; i++) {
    const g = gauss(i * h - tc, sg);
    w += g;
    v += g * dilatedNeedAt(sc, memo, i);
  }
  return v / w;
}

/**
 * Fills the track's memo ahead of need, for at most `budgetMs` (an idle slice): the grid samples
 * first, then the lift needs, in trip order. The values are the ones a frame would compute (pure),
 * so warming changes no pose; it only keeps the first frames of the dive (the track's first pose)
 * and a seek from computing a window of samples at once. True when the whole trip is warm.
 */
export function warmTrack(sc: FollowScene, budgetMs: number): boolean {
  const memo = memoOf(sc);
  const h = TRACK.stepS;
  const [a, b] = followSpan(sc.timeline);
  const i0 = Math.ceil(a / h - 1e-9);
  const i1 = Math.floor(b / h + 1e-9);
  const w = memo.warm ?? { sample: i0, need: i0 };
  memo.warm = w;
  const end = performance.now() + budgetMs;
  while (w.sample <= i1) {
    sampleAt(sc, memo, w.sample++);
    if (performance.now() >= end) return false;
  }
  while (sc.clearance && w.need <= i1) {
    dilatedNeedAt(sc, memo, w.need++);
    if (performance.now() >= end) return false;
  }
  return true;
}

/** The follow camera track at trip time t (see TRACK): smooth and pure in t. */
export function followTrackAt(sc: FollowScene, t: number): CamPose {
  const memo = memoOf(sc);
  const tc = Number.isFinite(t) ? t : 0;
  const { pos, look } = clearPoseAt(sc, memo, tc);
  const subject = trackSubject(sc, tc);
  const up = liftEnvelope(sc, memo, tc);
  pos[1] += up;
  // a lifted camera tilts down onto her (else she drops out of the bottom of the frame)
  // (onto the smoothed anchor: her raw position turns each corner in one frame)
  if (up > 0) {
    const k = up / (up + LIFT_LOOK_M);
    const [ax, az] = anchorAt(sc, tc);
    look[0] += (ax - look[0]) * k;
    look[1] += (FOLLOW.lookYM - look[1]) * k;
    look[2] += (az - look[2]) * k;
  }
  const out = { pos, look };
  // the floor as a ramp (the anticipating floor the samples already respect): continuous where
  // the pad alone is a step of tens of metres at its edge; first, a camera the floor envelope
  // lifted past the pitch limit stands back to it (a 3/4 view, never overhead)
  limitPitch(out, TRACK.pitchSoftM);
  softFloor(sc.clearance, pos);
  keepOffHero(pos, subject);
  applyFloor(sc.clearance, pos);
  return out;
}

/**
 * The floor with its ramp (`LIFT_SKIRT_M`) outside the pad, continuous in the camera's position,
 * joined by a smooth maximum (no kink where it starts to bind; never below either).
 */
function softFloor(c: Clearance | null | undefined, pos: Vec3) {
  if (!c) return;
  pos[1] = softMax(pos[1], c.floorAt(pos[0], pos[2], LIFT_SKIRT_M), TRACK.floorSoftM);
}

/**
 * The track time the camera shows at trip time t: t itself, except over the dive's landing (the
 * first 2 x TRACK.landingS of the follow span), where it runs ahead by up to TRACK.landingS and
 * eases back (continuous rate, never backwards). The dive lands on the track a moment into the
 * first hold, not on its first sample (iteration 2: at the dive's end she steps into Harmoni 1,
 * the camera dived to 40 m from her, then backed out to 44 m as the roof lift came in).
 */
export function landingTime(tl: Timeline, t: number): number {
  const [a, b] = followSpan(tl);
  const l = Math.min(TRACK.landingS, (b - a) / 4);
  const u = (t - a) / (2 * l);
  if (l <= 0 || u >= 1) return t;
  const k = clamp(u, 0, 1);
  return t + l * (1 - k * k * (3 - 2 * k));
}

/**
 * The journey camera at screen time t for a mode (pure): `overview` is the overview pose, `follow`
 * the dive (overview -> the track's first pose), the follow track (per-event framing included),
 * then the pull-back (the track's last pose -> `pullBackTo`, else the overview); `free` is null
 * (the orbit rig has the camera).
 */
export function journeyCameraAt(sc: FollowScene, t: number, mode: JourneyCamMode): CamPose | null {
  if (mode === "free") return null;
  if (mode === "overview") return { pos: [...sc.overview.pos], look: [...sc.overview.look] };
  const tl = sc.timeline;
  const tc = clamp(Number.isFinite(t) ? t : 0, 0, tl.total);
  const st = stateAt(tl, tc);
  const kind = st.phase.kind;
  if (kind !== "dive" && kind !== "pull") return followTrackAt(sc, landingTime(tl, tc));
  const [a, b] = followSpan(tl);
  const p = blendPose(
    kind === "dive" ? sc.overview : followTrackAt(sc, b),
    kind === "dive" ? followTrackAt(sc, landingTime(tl, a)) : (sc.pullBackTo ?? sc.overview),
    ease(st.u),
  );
  applyFloor(sc.clearance, p.pos);
  return p;
}

/** The subjects a hold keeps inside the UI-safe area: her body, the element and the marker. */
export function holdSubjects(
  sc: FollowScene,
  t: number,
  eventIndex: number,
  distanceM: number,
): Subject[] {
  const h = sc.heroAt?.(t) ?? sc.pointAt(distanceM);
  // her body box (feet to head, walker around her; seated she leans and the walker stands out
  // further, so a wider box than her standing radius): the AC-D8 box with room to spare
  const out: Subject[] = [];
  const box = sc.heroBox?.(t);
  if (box) {
    for (const x of [box.min[0], box.max[0]])
      for (const y of [box.min[1], box.max[1]])
        for (const z of [box.min[2], box.max[2]])
          out.push({ p: [x, y, z], padPx: SAFE_FIT.heroPadPx });
  }
  const r = box ? -1 : SAFE_FIT.heroBoxRadiusM;
  if (r > 0)
    for (const y of [0, SAFE_FIT.heroBoxTopM])
      for (const dx of [-r, r])
        for (const dz of [-r, r])
          out.push({ p: [h[0] + dx, y, h[1] + dz], padPx: SAFE_FIT.heroPadPx });
  const el = elementPoint(sc, eventIndex, distanceM);
  if (el) out.push({ p: el, padPx: SAFE_FIT.elementPadPx });
  const mk = sc.markerOf?.(eventIndex);
  if (mk) out.push({ p: [mk[0], mk[1], mk[2]], padPx: SAFE_FIT.markerPadPx });
  return out;
}

/** An event hold's pose fitted into the UI-safe area (eased in and out over the hold). */
function fitHold(sc: FollowScene, t: number, st: ReturnType<typeof stateAt>, p: CamPose): CamPose {
  const view = sc.view;
  if (!view || st.eventIndex === undefined) return p;
  const w = holdFitWeight(t, st.phase.t0, st.phase.t1);
  if (w <= 0) return p;
  // the hard floor inside the fit: a pulled-back camera raised over a roof is re-aimed
  const fit = fitSafe(p, holdSubjects(sc, t, st.eventIndex, st.distance_m), view, (q) =>
    softFloor(sc.clearance, q.pos),
  );
  const out = lerpPose(p, fit, w) as CamPose;
  applyFloor(sc.clearance, out.pos);
  return out;
}
