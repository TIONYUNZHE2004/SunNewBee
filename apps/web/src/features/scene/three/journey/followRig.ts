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
import type { Clearance, Vec3 } from "../clearance";
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
  sigmaS: 0.3,
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
  /** The overview the dive starts from and the pull-back ends at. */
  overview: CamPose;
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

/** Two candidate poses: the one that needs less lift wins; the first on a tie. */
function clearer(c: Clearance | null | undefined, subject: Vec3, a: CamPose, b: CamPose) {
  const la = liftNeed(c, a.pos, subject);
  const lb = liftNeed(c, b.pos, subject);
  return lb < la - 0.25 ? { pose: b, lift: lb } : { pose: a, lift: la };
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
    const best = clearer(c, [m[0], HERO_CHEST_Y, m[1]], at(1), at(-1));
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
    const best = clearer(c, [e[0], HERO_CHEST_Y, e[1]], at(1), at(-1));
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
      pose = clearer(c, [h[0], HERO_CHEST_Y, h[1]], at(1), at(-1)).pose;
    }
    lift = liftNeed(c, pose.pos, [h[0], HERO_CHEST_Y, h[1]]);
  } else {
    const f = tangentAt(sc.pointAt, st.distance_m);
    const subject: Vec3 = [anchor[0], HERO_CHEST_Y, anchor[1]];
    pose = followPose(anchor, f);
    lift = liftNeed(c, pose.pos, subject);
    // A building where the default camera stands (she walks out of a building, a tower beside her):
    // the same framing from another side of her (mirrored, or turned about her), when that saves
    // lift; each step away from the default costs SWAP_GAIN_M, so the default wins near-ties.
    if (lift > SWAP_GAIN_M) {
      let cost = lift;
      ORBIT_ALTERNATIVES.forEach(([side, deg], i) => {
        const alt = turnPose(followPose(anchor, f, side), anchor, (deg * Math.PI) / 180);
        const la = liftNeed(c, alt.pos, subject);
        const ca = la + SWAP_GAIN_M * (i + 1);
        if (ca < cost) {
          cost = ca;
          pose = alt;
          lift = la;
        }
      });
    }
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
  const up = Math.max(lift, liftNeed(sc.clearance, pos, subject));
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
 * The journey camera at screen time t for a mode (pure): `overview` is the overview pose, `follow`
 * the dive (overview -> follow), the follow pose with per-event framing, then the pull-back
 * (follow -> overview); `free` is null (the orbit rig has the camera).
 */
export function journeyCameraAt(sc: FollowScene, t: number, mode: JourneyCamMode): CamPose | null {
  if (mode === "free") return null;
  if (mode === "overview") return { pos: [...sc.overview.pos], look: [...sc.overview.look] };
  const tl = sc.timeline;
  const tc = clamp(Number.isFinite(t) ? t : 0, 0, tl.total);
  const st = stateAt(tl, tc);
  const kind = st.phase.kind;
  if (kind !== "dive" && kind !== "pull") {
    const p = followPoseAt(sc, tc);
    return kind === "event" && st.eventIndex !== undefined ? fitHold(sc, tc, st, p) : p;
  }
  const p = blendPose(
    kind === "dive" ? sc.overview : followPoseAt(sc, tc),
    kind === "dive" ? followPoseAt(sc, tc) : sc.overview,
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
    applyFloor(sc.clearance, q.pos),
  );
  const out = lerpPose(p, fit, w) as CamPose;
  applyFloor(sc.clearance, out.pos);
  return out;
}
