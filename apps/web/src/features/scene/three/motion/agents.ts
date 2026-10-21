import type { Tier } from "../../shared/quality";
import { WIDTH_BY_TYPE } from "../../shared/roads";
import { hash01 } from "../assets/fit";
import type { Manifest } from "../assets/manifest";
import type { LocalFrame } from "../frame";
import { type Boundary, insideBoundary } from "../ground/boundary";
import { type BBox, bboxOf, inPoly, type Poly, polygonsOf } from "../props/polyGeom";
import { boxAround, growBox, inBox, type PlanArea, perLayer, touchesBox } from "../stream/area";
import { roadGraphOf, type Step, walkRuns } from "./roadGraph";
import {
  createPathBuilder,
  ENDED,
  type Leg,
  leftTurn,
  pathWarp,
  pointAlong as pointAt,
  polyLength,
  REJECTED,
  reversalCut,
} from "./walkPath";

/**
 * DECORATIVE traffic and pedestrians for one planning box. Planned agents drive or walk a seeded
 * random walk over the junction graph (`roadGraph.ts`, demo polish A1): through junctions, turning
 * back only at real dead ends, and fading out at the end of their path to reappear at its start
 * (`ends: "fade"`). Hand-made paths (no `ends`) keep the older rule: ping-pong on open paths,
 * looping on closed ones (see poseAt). No routing and no collision (ruling: cars may pass through
 * each other at junctions). Nothing here is a fact about the township: no counts, no flows, no
 * speeds are measured. Pure: the same input always gives the same agents.
 */
export interface Agent {
  id: string;
  kind: "vehicle" | "person";
  variant: string;
  /** xz pairs (local metres), already offset into the lane / pavement side. */
  path: Float32Array;
  length: number;
  /** m/s */
  speed: number;
  /** Start distance along the path (m). */
  offset: number;
  /** People only: a crowd look id (crowd.json `looks[].id`); unset, the crowd renderer picks one by seed. */
  look?: string;
  /**
   * "fade": the path is walked once per lap and never reversed by `poseAt`: the agent fades out over
   * the last FADE_S of it and back in at its start (`fadeAt`). Unset: ping-pong / loop (poseAt).
   */
  ends?: "fade";
  /** Slow zones (corners, dead-end U-turns) as (nominal metres, path metres) knot pairs from (0, 0). */
  warp?: Float32Array;
  /** xz pairs of the real dead ends (graph degree 1) where the path turns back. */
  deadEnds?: Float32Array;
}

/**
 * Agents (and the journey hero, which imports it from here so the hero never loads the crowd
 * modules) stand on the road ribbons (0.08 m) rather than in them.
 */
export const AGENT_LIFT_M = 0.08;

export interface MoodMix {
  day: number;
  dusk: number;
  night: number;
}

const DENSITY = { day: 1, dusk: 1.15, night: 0.45 };
/** The densest mood: a plan without weights holds this many agents and the layer thins it. */
export const DENSITY_PEAK = DENSITY.dusk;

/** Density by mood: day 1.0, dusk 1.15 (commuter rush), night 0.45 ("fewer but clearly present"). Blended by weights. */
export function densityFor(w: MoodMix): number {
  const sum = w.day + w.dusk + w.night;
  if (!(sum > 0)) return DENSITY.day;
  return (w.day * DENSITY.day + w.dusk * DENSITY.dusk + w.night * DENSITY.night) / sum;
}

const SCALE_NEAR_M = 150;
const SCALE_FAR_M = 800;
const SCALE_MAX = 3;
/**
 * VEHICLES ONLY (owner ruling P2): 1 within 150 m of the camera, rising linearly to 3 at 800 m,
 * capped at 3. People use `peopleScale` (R-J7 superseded this curve for people). Decorative only.
 */
export function displayScale(distanceM: number): number {
  if (distanceM <= SCALE_NEAR_M) return 1;
  if (distanceM >= SCALE_FAR_M) return SCALE_MAX;
  return 1 + ((SCALE_MAX - 1) * (distanceM - SCALE_NEAR_M)) / (SCALE_FAR_M - SCALE_NEAR_M);
}

/** People's displayed size within PEOPLE_SCALE_NEAR_M of the camera: the hero's 1.55x (R-J3). */
export const PEOPLE_SCALE_NEAR = 1.55;
/** The cap reached at PEOPLE_VISIBLE_M and held beyond (R-J7). */
export const PEOPLE_SCALE_MAX = 2.5;
export const PEOPLE_SCALE_NEAR_M = 300;
/** People (crowd LOD1 and the legacy people kit) are drawn out to this distance, hidden beyond (R-J7). */
export const PEOPLE_VISIBLE_M = 800;

/**
 * People's display scale by camera distance (R-J3, R-J7; spec P6): 1.55x true height within 300 m
 * (the hero's scale), then a smoothstep up to 2.5x at 800 m, held at 2.5x beyond. Continuous with a
 * continuous slope (no step at either end) and monotonic. Replaces `displayScale` (1x to 3x) for
 * people; decorative only, it changes no fact.
 */
export function peopleScale(distanceM: number): number {
  if (!(distanceM > PEOPLE_SCALE_NEAR_M)) return PEOPLE_SCALE_NEAR;
  if (distanceM >= PEOPLE_VISIBLE_M) return PEOPLE_SCALE_MAX;
  const u = (distanceM - PEOPLE_SCALE_NEAR_M) / (PEOPLE_VISIBLE_M - PEOPLE_SCALE_NEAR_M);
  return PEOPLE_SCALE_NEAR + (PEOPLE_SCALE_MAX - PEOPLE_SCALE_NEAR) * u * u * (3 - 2 * u);
}

export interface Pose2 {
  x: number;
  z: number;
  yaw: number;
}
const lerp = (r: readonly [number, number], u: number) => r[0] + (r[1] - r[0]) * u;
const setPose = (out: Pose2, x: number, z: number, yaw: number) => {
  out.x = x;
  out.z = z;
  out.yaw = yaw;
  return out;
};

/** An open path's agent turns around in place at each end over this long (at its nominal speed). */
export const TURN_S = 1.5;
/** A path whose first and last points are this close is a closed loop: agents keep looping. */
export const CLOSED_LOOP_M = 1;
/** Speed eases by this share either way, per agent, on a slow sine (no lockstep traffic). */
export const EASE_AMP = 0.15;
/** The easing sine's period range (s), picked per agent by hash. */
export const EASE_PERIOD_S: readonly [number, number] = [20, 40];
/** Time constant (s) of the motion layer's yaw smoothing. */
export const YAW_TAU_S = 0.25;

const TAU = Math.PI * 2;
const wrapPi = (v: number) => v - TAU * Math.floor((v + Math.PI) / TAU);

/** `from` turned toward `to` by share `t` the short way round (result in [-pi, pi)). */
export function slerpAngle(from: number, to: number, t: number): number {
  return wrapPi(from + wrapPi(to - from) * t);
}

/**
 * Facing at `tSec` as a pure function of time (no history): along the chord from where the agent
 * was YAW_TAU_S earlier to where it is now, which turns through a corner over that look-back like
 * the smoothed facing does; the tangent when it has not moved. Used while a journey's trip clock
 * drives the crowd (scrub equals play, AC-D17).
 */
export function yawAt(a: Agent, tSec: number, now: Pose2, back: Pose2): number {
  poseAt(a, tSec, now);
  // a fading agent that restarted at its path start within the look-back: its tangent (no chord
  // across the jump)
  if (a.ends === "fade" && fadeAt(a, tSec, _lapA).lap !== fadeAt(a, tSec - YAW_TAU_S, _lapB).lap)
    return now.yaw;
  poseAt(a, tSec - YAW_TAU_S, back);
  const dx = now.x - back.x;
  const dz = now.z - back.z;
  if (Math.hypot(dx, dz) < 1e-3) return now.yaw;
  // the same convention as the tangent yaw of poseAt
  return Math.atan2(dx, dz);
}

const _lapA = { opacity: 1, lap: 0 };
const _lapB = { opacity: 1, lap: 0 };

/** One smoothing step: `yaw = slerpAngle(prev, tangent, 1 - exp(-dt / 0.25 s))`. */
export function smoothYaw(prev: number, tangent: number, dtSec: number): number {
  if (!(dtSec > 0)) return prev;
  return slerpAngle(prev, tangent, 1 - Math.exp(-dtSec / YAW_TAU_S));
}

/** Per-agent constants for poseAt, derived once from the path and id. */
interface Track {
  /** Arc length of the polyline itself (m). */
  len: number;
  /** Closed loops add the closing gap (last -> first point) to the lap; 0 when open. */
  gap: number;
  closed: boolean;
  /** Angular frequency (rad/s) and phase of the speed easing. */
  w: number;
  phase: number;
  cos0: number;
}
const tracks = new WeakMap<Agent, Track>();
function trackOf(a: Agent): Track {
  const hit = tracks.get(a);
  if (hit) return hit;
  const p = a.path;
  const n = p.length / 2;
  let len = 0;
  for (let i = 0; i < n - 1; i++)
    len += Math.hypot(
      (p[2 * i + 2] as number) - (p[2 * i] as number),
      (p[2 * i + 3] as number) - (p[2 * i + 1] as number),
    );
  const gap =
    n >= 3
      ? Math.hypot(
          (p[2 * n - 2] as number) - (p[0] as number),
          (p[2 * n - 1] as number) - (p[1] as number),
        )
      : Number.POSITIVE_INFINITY;
  const closed = gap <= CLOSED_LOOP_M && len > 0;
  const period = lerp(EASE_PERIOD_S, hash01(a.id, "ease-period"));
  const phase = hash01(a.id, "ease-phase") * TAU;
  const t: Track = {
    len,
    gap: closed ? gap : 0,
    closed,
    w: TAU / period,
    phase,
    cos0: Math.cos(phase),
  };
  tracks.set(a, t);
  return t;
}

/**
 * Metres travelled after `tSec`: the integral of speed x (1 + 0.15 sin(w t + phase)), so the eased
 * speed stays within +-15 % and the distance is exact at any time (no per-frame accumulation).
 */
export function easedDistance(a: Agent, tSec: number): number {
  const k = trackOf(a);
  return a.speed * (tSec + (EASE_AMP / k.w) * (k.cos0 - Math.cos(k.w * tSec + k.phase)));
}

/**
 * Per path: the arc length at every vertex (`cum`), the index of the first and last non-degenerate
 * segments (-1 when every segment has zero length) and the end of the last one. Built once per path
 * array (agents copied for a per-look speed share the path, so they share this too).
 */
interface PathTable {
  cum: Float64Array;
  first: number;
  last: number;
}
const pathTables = new WeakMap<Float32Array, PathTable>();
function pathTable(p: Float32Array): PathTable {
  const hit = pathTables.get(p);
  if (hit) return hit;
  const n = p.length / 2;
  const cum = new Float64Array(Math.max(1, n));
  let first = -1;
  let last = -1;
  for (let i = 0; i < n - 1; i++) {
    const l = Math.hypot(
      (p[2 * i + 2] as number) - (p[2 * i] as number),
      (p[2 * i + 3] as number) - (p[2 * i + 1] as number),
    );
    cum[i + 1] = (cum[i] as number) + l;
    if (l > 0) {
      if (first < 0) first = i;
      last = i;
    }
  }
  const t: PathTable = { cum, first, last };
  pathTables.set(p, t);
  return t;
}

const segYaw = (p: Float32Array, i: number) =>
  Math.atan2(
    (p[2 * i + 2] as number) - (p[2 * i] as number),
    (p[2 * i + 3] as number) - (p[2 * i + 1] as number),
  );

/**
 * Point and tangent yaw at arc length s along the polyline (zero-length segments skipped): a binary
 * search over the path's cumulative lengths (built once per path), so a pose costs O(log n) instead
 * of a walk over every vertex each frame (GATE AC-D18 profile: the linear walk was a steady main-
 * thread cost). Same result as walking the segments: s <= 0 sits at the start of the first real
 * segment, s past the end at the end of the last one, both with that segment's tangent.
 */
export function alongPath(p: Float32Array, s: number, out: Pose2): Pose2 {
  const { cum, first, last } = pathTable(p);
  if (first < 0) return setPose(out, p[0] as number, p[1] as number, 0);
  if (!(s > 0))
    return setPose(out, p[2 * first] as number, p[2 * first + 1] as number, segYaw(p, first));
  const n = p.length / 2;
  if (s > (cum[n - 1] as number)) {
    return setPose(out, p[2 * last + 2] as number, p[2 * last + 3] as number, segYaw(p, last));
  }
  // The first vertex j with cum[j] >= s; segment j - 1 is then non-degenerate (cum[j - 1] < s).
  let lo = 1;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((cum[mid] as number) >= s) hi = mid;
    else lo = mid + 1;
  }
  const i = lo - 1;
  const ax = p[2 * i] as number;
  const az = p[2 * i + 1] as number;
  const dx = (p[2 * i + 2] as number) - ax;
  const dz = (p[2 * i + 3] as number) - az;
  const l = (cum[i + 1] as number) - (cum[i] as number);
  const t = Math.min(1, Math.max(0, (s - (cum[i] as number)) / l));
  return setPose(out, ax + dx * t, az + dz * t, Math.atan2(dx, dz));
}
const along = alongPath;

/** Tangent yaw of the first non-degenerate segment (the heading when leaving the start). */
function startYaw(p: Float32Array): number {
  for (let i = 0; i + 3 < p.length; i += 2) {
    const dx = (p[i + 2] as number) - (p[i] as number);
    const dz = (p[i + 3] as number) - (p[i + 1] as number);
    if (dx !== 0 || dz !== 0) return Math.atan2(dx, dz);
  }
  return 0;
}

/**
 * The agent's pose at `tSec` (real time). Yaw turns the model's +z (its front) onto the tangent.
 * Continuous by construction (Review Focus 4):
 * - closed loops (ends within 1 m) keep looping, crossing the closing gap as one more segment;
 * - open paths ping-pong: walk to the end, turn around in place over 1.5 s (yaw sweeps by pi),
 *   walk back, turn again at the start. A turn is TURN_S x speed metres of the cycle, so it takes
 *   1.5 s at the nominal speed (the +-15 % easing stretches it slightly).
 * The yaw here still follows each segment's tangent; the motion layer smooths it per agent.
 * Writes into `out` when given (the motion layer reuses one object per tick) and returns it.
 */
export function poseAt(a: Agent, tSec: number, out: Pose2 = { x: 0, z: 0, yaw: 0 }): Pose2 {
  const p = a.path;
  const n = p.length / 2;
  const k = n >= 2 ? trackOf(a) : null;
  if (!k || !(k.len > 0)) return setPose(out, p[0] ?? 0, p[1] ?? 0, 0);
  const d = a.offset + easedDistance(a, tSec);
  if (a.ends === "fade") {
    const ln = nominalLength(a);
    const u = d - ln * Math.floor(d / ln);
    return along(p, a.warp ? warpedArc(a.warp, u) : u, out);
  }
  if (k.closed) {
    const lap = k.len + k.gap;
    const s = d - lap * Math.floor(d / lap);
    if (s <= k.len || k.gap === 0) return along(p, s, out);
    // On the closing gap: last point -> first point.
    const lx = p[2 * n - 2] as number;
    const lz = p[2 * n - 1] as number;
    const dx = (p[0] as number) - lx;
    const dz = (p[1] as number) - lz;
    const t = (s - k.len) / k.gap;
    return setPose(out, lx + dx * t, lz + dz * t, Math.atan2(dx, dz));
  }
  const turn = TURN_S * a.speed;
  const cycle = 2 * k.len + 2 * turn;
  const u = d - cycle * Math.floor(d / cycle);
  if (u < k.len) return along(p, u, out);
  if (u < k.len + turn) {
    along(p, k.len, out);
    return setPose(out, out.x, out.z, wrapPi(out.yaw + (Math.PI * (u - k.len)) / turn));
  }
  if (u < 2 * k.len + turn) {
    along(p, k.len - (u - k.len - turn), out);
    return setPose(out, out.x, out.z, wrapPi(out.yaw + Math.PI));
  }
  const yaw = startYaw(p) + Math.PI + (Math.PI * (u - 2 * k.len - turn)) / turn;
  return setPose(out, p[0] as number, p[1] as number, wrapPi(yaw));
}

/** A fading agent fades out over this long at its path end and back in at its start (s, nominal speed). */
export const FADE_S = 0.8;

/** Path metres at nominal distance `u` along a warp (binary search over the knots). */
function warpedArc(w: Float32Array, u: number): number {
  const n = w.length / 2;
  if (!(u > 0)) return 0;
  if (u >= (w[2 * n - 2] as number)) return w[2 * n - 1] as number;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((w[2 * mid] as number) <= u) lo = mid;
    else hi = mid;
  }
  const n0 = w[2 * lo] as number;
  const n1 = w[2 * hi] as number;
  const s0 = w[2 * lo + 1] as number;
  const s1 = w[2 * hi + 1] as number;
  return n1 > n0 ? s0 + ((s1 - s0) * (u - n0)) / (n1 - n0) : s0;
}

/** One lap of a fading agent in nominal metres (its path length stretched by the slow zones). */
export function nominalLength(a: Agent): number {
  const w = a.warp;
  if (w && w.length >= 4) return w[w.length - 2] as number;
  return trackOf(a).len;
}

/**
 * A fading agent's opacity and lap at `tSec`: 0 at the path's start and end, rising to 1 over the
 * first FADE_S x speed nominal metres and falling over the last (so a fade takes at most
 * FADE_S / (1 - EASE_AMP) = 0.94 s). Agents without `ends: "fade"` are always 1, lap 0.
 */
export function fadeAt(a: Agent, tSec: number, out: { opacity: number; lap: number }) {
  out.opacity = 1;
  out.lap = 0;
  if (a.ends !== "fade") return out;
  const ln = nominalLength(a);
  if (!(ln > 0)) return out;
  const d = a.offset + easedDistance(a, tSec);
  const lap = Math.floor(d / ln);
  const u = d - ln * lap;
  const span = FADE_S * a.speed;
  out.lap = lap;
  out.opacity = span > 0 ? Math.max(0, Math.min(1, Math.min(u, ln - u) / span)) : 1;
  return out;
}

const VEHICLE_TYPES = new Set(["street", "major_road"]);
const PEOPLE_TYPES = new Set(["footway", "path", "pedestrian", "sidewalk", "crossing"]);
/**
 * Roads that also carry people, on pavement paths beside the carriageway (A-T12 hand-off): offset
 * WIDTH_BY_TYPE[type] / 2 + PAVEMENT_KERB_M from the centre line, so on the verge, never in the road.
 */
const PAVEMENT_TYPES = new Set(["street", "major_road"]);
/** Pavement walkers keep this far beyond the kerb (m), picked per agent (A-T12 hand-off). */
export const PAVEMENT_KERB_M: readonly [number, number] = [0.6, 1.2];
/**
 * Spawn floor (A-T12 hand-off): at day density at least one person per this many metres of street
 * (street + major_road) in a tile of the detail bubble (`floorPerM` = 1 / 40 for rings 0 and 1).
 */
export const PAVEMENT_FLOOR_M = 40;
/** People variants never planned: a cyclist would render as a person walking at 4.5 m/s (C-T7 ruling). */
const PEOPLE_EXCLUDED = new Set(["cyclist"]);
/** A person's path is checked against building footprints and water every this many metres. */
const OBSTACLE_STEP_M = 1;
/**
 * A pavement path is cut back where it meets another street / major_road: it keeps at least that
 * road's half width + this far from its centre line (C-T8 fix 1), and half width + OWN_ROAD_CLEAR_M
 * from its own road (the inside of a bend).
 */
const PAVEMENT_CLEAR_M = 1.2;
const OWN_ROAD_CLEAR_M = 0.3;
/** Within this far of a junction node a pavement only has to keep out of the carriageways (m). */
const JUNCTION_ZONE_M = 12;
/** A planned agent's walk is extended edge by edge to at least this many seconds at its speed. */
export const WALK_S = 120;
/**
 * A walk stays inside the square of this half side around its chunk's midpoint: a node beyond it is a
 * tile edge, where the path ends and the agent fades (A1). Independent of the planning box, so tiles
 * planned apart give the agents of their union.
 */
export const WANDER_M = 250;
/** No junction choice turns the heading by more than this from any heading of the last ~2 s. */
export const MAX_NET_TURN = (140 * Math.PI) / 180;
/** Corner fillet radius ranges (m) by walker, picked per agent. */
const FILLET_M = {
  vehicle: [3, 6],
  person: [1, 2],
  pavement: [1.5, 3],
} as const satisfies Record<string, readonly [number, number]>;
/** Fastest heading change away from a dead end (rad/s): 150 deg then takes over 2 s even at +15 %. */
const TURN_RATE: Record<Agent["kind"], number> = { vehicle: 0.8, person: 1.0 };
/**
 * A reversal (> 145 deg) closer than this along the path (m) ends the path before it (review fix
 * 1): a car never pivots through a hairpin (an OSM teardrop loop) at a crawl. People keep only the
 * share floor (MIN_SHARE).
 */
const REVERSE_MIN_ARC_M: Record<Agent["kind"], number> = { vehicle: 15, person: 0 };
/** A path's end lies at least this far from its start, where the agent reappears (m; review M3). */
export const RESPAWN_APART_M = 30;
/** A leg is cut to the walk's remaining length only when it is this much longer (m). */
const LEG_SLACK_M = 10;
/** Safety bound on the legs of one walk. */
const MAX_LEGS = 200;
const BUSY_PLACES = new Set(["school", "mall", "park"]);
const BUSY_RANGE_M = 150;
const BUSY_WEIGHT = 3;
const MIN_EDGE_M = 10;
/** Malaysia drives on the left: a vehicle keeps a quarter of the road width left of its centre line. */
const LANE_SHARE = 0.25;
const PAVEMENT_OFFSET_M: [number, number] = [0.3, 0.8];
/** Heavy vehicles only on major roads. */
const MAJOR_ONLY = new Set(["bus", "lorry"]);
const MAJOR_TYPES: ReadonlySet<string> = new Set(["major_road"]);

/**
 * The variant at `rnd` in [0, 1): uniform over `pool` (today), or by `weights` (share per variant id,
 * missing ids weigh 0) when given, so a mix table (A4) can be dropped in. Deterministic.
 */
export function pickVariant(
  pool: readonly string[],
  rnd: number,
  weights?: Readonly<Record<string, number>>,
): string {
  const r = Math.min(0.999999, Math.max(0, rnd));
  if (weights) {
    const w = pool.map((v) => Math.max(0, weights[v] ?? 0));
    const sum = w.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      let acc = 0;
      for (let i = 0; i < pool.length; i++) {
        acc += w[i] as number;
        if (r * sum < acc) return pool[i] as string;
      }
      return pool[pool.length - 1] as string;
    }
  }
  return pool[Math.floor(r * pool.length)] as string;
}
const SPEED = {
  street: [8, 11],
  major: [12, 16],
  walk: [1.2, 1.5],
  jogger: 2.5,
} as const;

type P = [number, number];
interface Edge {
  pts: P[];
  length: number;
  type: string;
  weight: number;
  /** People on a street or major_road: a pavement path beside the carriageway. */
  pavement: boolean;
  /** The walk feature id (pavement trimming skips its own road). */
  fid: string;
  /** The run's key (`${fid}:${run}`, the road graph's edge key) and the chunk's arc range on it. */
  key: string;
  s0: number;
  s1: number;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const featuresOf = (fc: unknown): Record<string, unknown>[] =>
  isRec(fc) && Array.isArray(fc.features) ? fc.features.filter(isRec) : [];
const propsOf = (f: Record<string, unknown>): Record<string, unknown> =>
  isRec(f.properties) ? f.properties : {};

/**
 * Longest agent path (m). A walk line longer than this is cut into equal chunks; each chunk is
 * owned by the box that holds its arc midpoint, so a path reaches at most half a chunk past its
 * box and adjacent boxes never share an agent. (Most Elmina walk edges are shorter: median 47 m.)
 */
export const AGENT_CHUNK_M = 120;
/** One candidate agent per this many metres of spawn weight (chunk length x busy weight). */
const SPAWN_SPACING_M = 25;

export interface AgentsInput {
  walk: unknown;
  places: unknown;
  frame: LocalFrame;
  /** The box to plan (half-open, by chunk midpoint) and its tile seed. */
  area: PlanArea;
  /** Low plans nothing, whatever the caps say. */
  tier: Tier;
  /** Agents for this box at density 1: `tileCap(tier, ring, "vehicles" | "people", tile, frame)`. */
  caps: { vehicles: number; people: number };
  m: Manifest;
  weights?: MoodMix;
  /** The Elmina outline (A-T4): an agent whose path leaves it is not planned. Display only. */
  boundary?: Boundary | null;
  /**
   * Building footprints and water polygons (FeatureCollections): a person's path that enters one is
   * moved to the other side of its line, else not planned (spec P7). Display only.
   */
  obstacles?: { buildings?: unknown; water?: unknown } | null;
  /**
   * Spawn floor, people per metre of street (street + major_road) owned by the box, at day density
   * (A-T12 hand-off: 1 / PAVEMENT_FLOOR_M in the detail bubble). Raises the people count above
   * `caps.people` when the streets need more. 0 or absent: no floor.
   */
  floorPerM?: number;
}

interface Cand {
  id: string;
  edge: Edge;
  prio: number;
}

/** One run of valid vertices of an eligible walk line, in local metres. */
interface Run {
  fid: string;
  ri: number;
  /** Vehicle runs on streets and major roads also carry pavement people. */
  kind: Agent["kind"];
  type: string;
  pts: P[];
  length: number;
  bb: [number, number, number, number];
}
const runsCache = new WeakMap<object, WeakMap<object, Run[]>>();
const busyCache = new WeakMap<object, WeakMap<object, P[]>>();

/** The vehicle and people lines of the walk layer, built once per layer and frame. */
const runsOf = (walk: unknown, frame: LocalFrame): Run[] =>
  perLayer(runsCache, walk, frame, () => {
    const out: Run[] = [];
    // the same run parser as the road graph (`walkRuns`), so chunk keys always match its edges
    for (const { fid, ri, type, pts, length } of walkRuns(
      walk,
      frame,
      (t) => VEHICLE_TYPES.has(t) || PEOPLE_TYPES.has(t),
    )) {
      const kind: Agent["kind"] = VEHICLE_TYPES.has(type) ? "vehicle" : "person";
      let x0 = Number.POSITIVE_INFINITY;
      let z0 = Number.POSITIVE_INFINITY;
      let x1 = Number.NEGATIVE_INFINITY;
      let z1 = Number.NEGATIVE_INFINITY;
      for (const [x, z] of pts) {
        x0 = Math.min(x0, x);
        z0 = Math.min(z0, z);
        x1 = Math.max(x1, x);
        z1 = Math.max(z1, z);
      }
      out.push({ fid, ri, kind, type, pts, length, bb: [x0, z0, x1, z1] });
    }
    return out;
  });

/** Obstacle polygons (footprints, water) by 32 m grid cell; a polygon sits in every cell its bounds touch. */
interface Obstacle {
  poly: Poly;
  bb: BBox;
}
const OBST_CELL_M = 32;
const obstCache = new WeakMap<object, WeakMap<object, Map<number, Obstacle[]>>>();
const obstKey = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);
const obstaclesOf = (fc: unknown, frame: LocalFrame): Map<number, Obstacle[]> =>
  perLayer(obstCache, fc, frame, () => {
    const g = new Map<number, Obstacle[]>();
    for (const f of featuresOf(fc))
      for (const poly of polygonsOf(f.geometry, frame)) {
        const bb = bboxOf(poly[0] as P[]);
        const o = { poly, bb };
        for (let i = Math.floor(bb[0] / OBST_CELL_M); i <= Math.floor(bb[2] / OBST_CELL_M); i++)
          for (let j = Math.floor(bb[1] / OBST_CELL_M); j <= Math.floor(bb[3] / OBST_CELL_M); j++) {
            const k = obstKey(i, j);
            const l = g.get(k);
            if (l) l.push(o);
            else g.set(k, [o]);
          }
      }
    return g;
  });
const insideObstacle = (grids: Map<number, Obstacle[]>[], x: number, z: number): boolean => {
  const k = obstKey(Math.floor(x / OBST_CELL_M), Math.floor(z / OBST_CELL_M));
  for (const g of grids)
    for (const o of g.get(k) ?? []) {
      const b = o.bb;
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
      if (inPoly(x, z, o.poly)) return true;
    }
  return false;
};
const cross2 = (ax: number, az: number, bx: number, bz: number) => ax * bz - az * bx;
/** Whether segments p-q and r-s properly intersect or touch (2D). */
function segsMeet(
  px: number,
  pz: number,
  qx: number,
  qz: number,
  rx: number,
  rz: number,
  sx: number,
  sz: number,
): boolean {
  const d1 = cross2(qx - px, qz - pz, rx - px, rz - pz);
  const d2 = cross2(qx - px, qz - pz, sx - px, sz - pz);
  const d3 = cross2(sx - rx, sz - rz, px - rx, pz - rz);
  const d4 = cross2(sx - rx, sz - rz, qx - rx, qz - rz);
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}
/**
 * Whether the short step a-b (at most OBSTACLE_STEP_M) crosses an obstacle outline (review fix
 * round 1: a 1 m sample spacing let a path clip a 0.3 m sliver of a footprint corner).
 */
function stepCrossesObstacle(
  grids: Map<number, Obstacle[]>[],
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const z0 = Math.min(az, bz);
  const z1 = Math.max(az, bz);
  const keys = new Set([
    obstKey(Math.floor(ax / OBST_CELL_M), Math.floor(az / OBST_CELL_M)),
    obstKey(Math.floor(bx / OBST_CELL_M), Math.floor(bz / OBST_CELL_M)),
  ]);
  for (const g of grids)
    for (const k of keys)
      for (const o of g.get(k) ?? []) {
        const b = o.bb;
        if (x1 < b[0] || x0 > b[2] || z1 < b[1] || z0 > b[3]) continue;
        for (const ring of o.poly)
          for (let i = 0; i < ring.length; i++) {
            const r = ring[i] as P;
            const q = ring[(i + 1) % ring.length] as P;
            if (segsMeet(ax, az, bx, bz, r[0], r[1], q[0], q[1])) return true;
          }
      }
  return false;
}
/** Carriageway segments (street / major_road centre lines with half their drawn width), gridded. */
interface Carriage {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
  fid: string;
}
const CARRIAGE_CELL_M = 16;
const carriageCache = new WeakMap<object, WeakMap<object, Map<number, Carriage[]>>>();
const carriagesOf = (walk: unknown, frame: LocalFrame): Map<number, Carriage[]> =>
  perLayer(carriageCache, walk, frame, () => {
    const g = new Map<number, Carriage[]>();
    for (const r of runsOf(walk, frame)) {
      if (!PAVEMENT_TYPES.has(r.type)) continue;
      const half = (WIDTH_BY_TYPE[r.type] ?? 6) / 2;
      const pad = half + PAVEMENT_CLEAR_M + 1;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i] as P;
        const [bx, bz] = r.pts[i + 1] as P;
        const c = { ax, az, bx, bz, half, fid: r.fid };
        const c0 = (v: number) => Math.floor(v / CARRIAGE_CELL_M);
        for (let ci = c0(Math.min(ax, bx) - pad); ci <= c0(Math.max(ax, bx) + pad); ci++)
          for (let cj = c0(Math.min(az, bz) - pad); cj <= c0(Math.max(az, bz) + pad); cj++) {
            const k = obstKey(ci, cj);
            const l = g.get(k);
            if (l) l.push(c);
            else g.set(k, [c]);
          }
      }
    }
    return g;
  });
/**
 * Pavement points (C-T8 fix 1, demo polish A1): every sample (each OBSTACLE_STEP_M) keeps out of
 * every carriageway by OWN_ROAD_CLEAR_M; away from the junctions (`nodes`, JUNCTION_ZONE_M) it also
 * keeps PAVEMENT_CLEAR_M beyond the half width of every other road. A pavement walker turns round
 * the block corner at a junction, so near a node only the carriageways themselves are out of bounds.
 */
function pavementPointOk(
  g: Map<number, Carriage[]>,
  fid: string,
  nodes: P[],
  x: number,
  z: number,
): boolean {
  const J2 = JUNCTION_ZONE_M * JUNCTION_ZONE_M;
  let nearJ = false;
  for (const n of nodes) {
    const dx = x - n[0];
    const dz = z - n[1];
    if (dx * dx + dz * dz <= J2) {
      nearJ = true;
      break;
    }
  }
  const list = g.get(obstKey(Math.floor(x / CARRIAGE_CELL_M), Math.floor(z / CARRIAGE_CELL_M)));
  if (!list) return true;
  for (const c of list) {
    const need = c.half + (nearJ || c.fid === fid ? OWN_ROAD_CLEAR_M : PAVEMENT_CLEAR_M);
    // squared distance to the segment (hot path: no Math.hypot)
    const dx = c.bx - c.ax;
    const dz = c.bz - c.az;
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - c.ax) * dx + (z - c.az) * dz) / l2));
    const ex = x - c.ax - dx * t;
    const ez = z - c.az - dz * t;
    if (ex * ex + ez * ez < need * need) return false;
  }
  return true;
}

/**
 * Metres of `pts` from its start that stay clear: every vertex passes `vertexOk` and every vertex
 * and OBSTACLE_STEP_M sample passes `pointOk`. Infinity when all of it is clear. Cut a step short of
 * the first failing sample.
 */
function clearPrefix(
  pts: P[],
  pointOk: ((x: number, z: number) => boolean) | null,
  vertexOk: (x: number, z: number) => boolean,
  /** Also checked on every step between consecutive samples (an outline crossing). */
  stepOk?: (ax: number, az: number, bx: number, bz: number) => boolean,
): number {
  let walked = 0;
  let prev = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as P;
    // a vertex out of the boundary: back to the previous vertex (a cut point is a vertex too)
    if (!vertexOk(a[0], a[1])) return prev;
    if (pointOk && !pointOk(a[0], a[1])) return Math.max(prev, walked - OBSTACLE_STEP_M);
    prev = walked;
    const b = pts[i + 1];
    if (!b) break;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (pointOk) {
      const n = Math.floor(l / OBSTACLE_STEP_M);
      let px = a[0];
      let pz = a[1];
      for (let k = 1; k <= n + 1; k++) {
        const last = k === n + 1;
        const t = last ? 1 : (k * OBSTACLE_STEP_M) / l;
        const qx = a[0] + (b[0] - a[0]) * t;
        const qz = a[1] + (b[1] - a[1]) * t;
        const stepBad = stepOk ? !stepOk(px, pz, qx, qz) : false;
        px = qx;
        pz = qz;
        if (stepBad || (!last && !pointOk(qx, qz))) {
          // the cut point (the last clear sample) becomes a vertex: it must be inside as well
          const tc = ((k - 1) * OBSTACLE_STEP_M) / l;
          const ok = vertexOk(a[0] + (b[0] - a[0]) * tc, a[1] + (b[1] - a[1]) * tc);
          return ok ? walked + (k - 1) * OBSTACLE_STEP_M : walked;
        }
      }
    }
    walked += l;
  }
  return Number.POSITIVE_INFINITY;
}

/** Points of the places that triple the spawn weight (school, mall, park). */
const busyOf = (places: unknown, frame: LocalFrame): P[] =>
  perLayer(busyCache, places, frame, () => {
    const busy: P[] = [];
    for (const f of featuresOf(places)) {
      const g = f.geometry;
      if (!isRec(g) || g.type !== "Point" || !Array.isArray(g.coordinates)) continue;
      const [lon, lat] = g.coordinates as number[];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (BUSY_PLACES.has(String(propsOf(f).type))) busy.push(frame.toLocal(lon!, lat!));
    }
    return busy;
  });

/** The sub-polyline of `pts` between arc lengths s0 and s1. */
function slice(pts: P[], s0: number, s1: number): P[] {
  const out: P[] = [];
  let walked = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const at = (s: number): P => {
      const t = l === 0 ? 0 : (s - walked) / l;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    if (out.length === 0 && s0 <= walked + l) out.push(at(Math.max(s0, walked)));
    if (out.length > 0) {
      if (s1 <= walked + l + 1e-9) {
        out.push(at(Math.min(s1, walked + l)));
        return out;
      }
      out.push(b);
    }
    walked += l;
  }
  return out;
}

/**
 * Vehicles on street/major_road edges (speed 8–11 m/s, major 12–16). People on
 * footway/path/pedestrian/sidewalk/crossing lines (0.3–0.8 m either side of the line) and on pavement
 * paths beside street/major_road edges (WIDTH_BY_TYPE / 2 + 0.6–1.2 m either side; A-T12 hand-off),
 * walking 1.2–1.5 m/s (jogger 2.5; no cyclists: they would render as walking people). Spawn weight ×3
 * within 150 m of places of type school|mall|park. Every walk line is cut into chunks of at most
 * AGENT_CHUNK_M; a chunk belongs to the box holding its arc midpoint and seeds about one candidate
 * per 25 m of spawn weight and kind, keyed by the chunk (never by the box). Count = cap ×
 * densityFor(weights), raised for people to the spawn floor (`floorPerM` × street metres owned by the
 * box × density / day density); picked from the candidates in the order of a hash salted with the
 * tile seed, skipping candidates whose path leaves the boundary or (people) enters a footprint or
 * water on both sides of its line. Without weights, the peak (dusk) density, so a layer can thin the
 * plan by mood without replanning (the plan is in pick order).
 */
export function planAgents(input: AgentsInput): Agent[] {
  const { frame, m, area } = input;
  if (input.tier === "low") return [];
  const box = area.box;
  const reach = growBox(box, AGENT_CHUNK_M);
  const density = input.weights ? densityFor(input.weights) : DENSITY_PEAK;

  const busy = busyOf(input.places, frame);
  const nearBusy = (pts: P[]) =>
    pts.some((p) => busy.some((b) => Math.hypot(p[0] - b[0], p[1] - b[1]) <= BUSY_RANGE_M));
  const obst = input.obstacles;
  const grids = [obst?.buildings, obst?.water]
    .filter((fc) => isRec(fc))
    .map((fc) => obstaclesOf(fc, frame));

  const cands: Record<Agent["kind"], Cand[]> = { vehicle: [], person: [] };
  let streetM = 0;
  for (const { fid, ri, kind, type, pts: run, length, bb } of runsOf(input.walk, frame)) {
    if (!touchesBox(reach, bb[0], bb[1], bb[2], bb[3])) continue;
    if (length < MIN_EDGE_M) continue;
    const kinds: Agent["kind"][] = PAVEMENT_TYPES.has(type) ? [kind, "person"] : [kind];
    const n = Math.ceil(length / AGENT_CHUNK_M);
    const cl = length / n;
    for (let c = 0; c < n; c++) {
      const mid = pointAt(run, (c + 0.5) * cl);
      if (!inBox(box, mid[0], mid[1])) continue;
      const pts = slice(run, c * cl, (c + 1) * cl);
      const chunk = `${fid}:${ri}:${c}`;
      const weight = cl * (nearBusy(pts) ? BUSY_WEIGHT : 1);
      if (PAVEMENT_TYPES.has(type)) streetM += cl;
      for (const k of kinds) {
        const edge: Edge = {
          pts,
          length: cl,
          type,
          weight,
          pavement: k === "person" && kind === "vehicle",
          fid,
          key: `${fid}:${ri}`,
          s0: c * cl,
          s1: (c + 1) * cl,
        };
        const cnt = Math.floor(weight / SPAWN_SPACING_M + hash01(chunk, `spawn:${k}`));
        for (let j = 0; j < cnt; j++) {
          const id = `${k}:${chunk}:${j}`;
          cands[k].push({ id, edge, prio: hash01(id, area.seed) });
        }
      }
    }
  }

  // Built once per walk layer (eagerly, so warmPlanners pays for it before the first real tile).
  const carriages = carriagesOf(input.walk, frame);
  const out: Agent[] = [];
  const bound = input.boundary;
  const insidePt = (x: number, z: number) => !bound || insideBoundary(bound, x, z);
  const gV = roadGraphOf(input.walk, frame, VEHICLE_TYPES);
  const gP = roadGraphOf(input.walk, frame, PEOPLE_TYPES);
  /**
   * A1: the agent's seeded random walk over the junction graph, from its chunk's start (in the
   * hashed direction) edge by edge until it is WALK_S long at its speed. At a node it takes another
   * edge (seeded; pavement walkers follow the block corner on their side, so they never cross a
   * carriageway), turning back only at a real dead end (degree 1). The walk ends (the agent fades)
   * where no edge may be taken: past WANDER_M (a tile edge), out of the boundary, into a footprint
   * or water (people), off the pavement, or a turn that would reverse the heading within ~2 s.
   * Vehicles keep the left lane (left-hand traffic) through rounded corners and slow down through
   * them and through U-turns. People try their hashed side first, then the other; else none.
   */
  const walkOf = (
    id: string,
    kind: Agent["kind"],
    e: Edge,
    speed: number,
    types: ReadonlySet<string> | null,
  ) => {
    const pave = kind === "person" && e.pavement;
    const g = kind === "vehicle" || pave ? gV : gP;
    const ge = g.byKey.get(e.key);
    if (!ge) return null;
    const reverse = hash01(id, "dir") < 0.5;
    const first: Step = { edge: ge.id, end: reverse ? 1 : 0 };
    const startPts = reverse ? slice(ge.pts, 0, e.s1).reverse() : slice(ge.pts, e.s0, ge.length);
    const [mx, mz] = pointAt(ge.pts, (e.s0 + e.s1) / 2);
    const wander = boxAround(mx, mz, WANDER_M);
    const kerb = lerp(PAVEMENT_KERB_M, hash01(id, "lateral"));
    const foot = lerp(PAVEMENT_OFFSET_M, hash01(id, "lateral"));
    const range =
      kind === "vehicle" ? FILLET_M.vehicle : pave ? FILLET_M.pavement : FILLET_M.person;
    const fillet = lerp(range, hash01(id, "fillet"));
    const window = 2.3 * speed + 2;
    const hashed = hash01(id, "side") < 0.5 ? -1 : 1;
    const sides = kind === "vehicle" ? [1] : [hashed, -hashed];
    for (const side of sides) {
      const offOf = (type: string) => {
        const w = WIDTH_BY_TYPE[type] ?? 6;
        if (kind === "vehicle") return w * LANE_SHARE;
        return side * (pave ? w / 2 + kerb : foot);
      };
      let legFid = ge.fid;
      let legNodes: P[] = [g.nodes[ge.a] as P, g.nodes[ge.b] as P];
      const builder = createPathBuilder({
        fillet,
        check: (pts: P[]) =>
          clearPrefix(
            pts,
            kind === "vehicle"
              ? null
              : (x, z) =>
                  !insideObstacle(grids, x, z) &&
                  (!pave || pavementPointOk(carriages, legFid, legNodes, x, z)),
            insidePt,
            kind === "vehicle"
              ? undefined
              : (ax, az, bx, bz) => !stepCrossesObstacle(grids, ax, az, bx, bz),
          ),
      });
      // a long first edge is walked only as far as the walk needs (then the agent fades)
      const target = speed * WALK_S;
      const firstPts =
        polyLength(startPts) > target + LEG_SLACK_M ? slice(startPts, 0, target) : startPts;
      const started = builder.add({ pts: firstPts, off: offOf(ge.type) });
      if (started === REJECTED) continue;
      let ended = started === ENDED || firstPts !== startPts;
      // centre-line headings of the walk so far (yaw, centre-line metres at the segment end)
      const hist: { s: number; yaw: number }[] = [];
      let sNow = 0;
      const pushHist = (pts: P[]) => {
        for (let i = 0; i < pts.length - 1; i++) {
          const dx = pts[i + 1]![0] - pts[i]![0];
          const dz = pts[i + 1]![1] - pts[i]![1];
          const l = Math.hypot(dx, dz);
          if (!(l > 0)) continue;
          sNow += l;
          hist.push({ s: sNow, yaw: Math.atan2(dx, dz) });
        }
      };
      pushHist(firstPts);
      const headingOk = (st: Step) => {
        const d = g.leaveDir(st);
        const sp = g.ptsOf(st);
        const yc = [
          Math.atan2(d[0], d[1]),
          Math.atan2(sp[1]![0] - sp[0]![0], sp[1]![1] - sp[0]![1]),
        ];
        for (let i = hist.length - 1; i >= 0; i--) {
          const h = hist[i]!;
          if (h.s < sNow - window && i < hist.length - 1) break;
          for (const y of yc) if (Math.abs(wrapPi(y - h.yaw)) > MAX_NET_TURN) return false;
        }
        return true;
      };
      let cur = first;
      let node = g.far(cur);
      for (let k = 0; !ended && builder.length() < target && k < MAX_LEGS; k++) {
        const at = g.nodes[node] as P;
        const arrived: 0 | 1 = cur.end === 0 ? 1 : 0;
        const deg = g.degree(node);
        let nx: Step | null;
        if (deg === 1) nx = g.next(cur.edge, node, 0, { arrived });
        else if (pave) {
          // the block corner on the walker's side: the sharpest turn toward it
          const back = g.leaveDir({ edge: cur.edge, end: arrived });
          const u: P = [-back[0], -back[1]];
          let best: Step | null = null;
          let bestTurn = 0;
          for (const st of g.inc[node] ?? []) {
            if (st.edge === cur.edge && st.end === arrived) continue;
            const t = side * leftTurn(u, g.leaveDir(st));
            if (!best || t > bestTurn) {
              best = st;
              bestTurn = t;
            }
          }
          nx = best && headingOk(best) ? best : null;
        } else
          nx = g.next(cur.edge, node, hash01(id, `walk:${k}`), {
            arrived,
            accept: (st) => (!types || types.has(g.edges[st.edge]!.type)) && headingOk(st),
          });
        if (!nx) break;
        // a leg ending past the wander square is a tile edge: the path ends here (the agent fades)
        const farP = g.nodes[g.far(nx)] as P;
        if (!inBox(wander, farP[0], farP[1])) break;
        const ne = g.edges[nx.edge]!;
        // the last leg only as far as the walk still needs (the path ends mid-edge: a fade)
        const full = g.ptsOf(nx);
        const need = target - builder.length() + LEG_SLACK_M;
        const pts = ne.length > need + LEG_SLACK_M ? slice(full, 0, need) : full;
        const leg: Leg = { pts, off: offOf(ne.type), node: at };
        if (deg === 1) leg.uturn = true;
        legFid = ne.fid;
        legNodes = [at, farP];
        const added = builder.add(leg);
        if (added === REJECTED) break;
        ended = added === ENDED || pts !== full;
        if (deg === 1) hist.length = 0;
        pushHist(pts);
        cur = nx;
        node = g.far(nx);
      }
      const r = builder.result();
      // review fix 1: end the path before a hairpin only a crawl could take (the agent fades)
      const keep = reversalCut(r.pts, r.uturn, speed, REVERSE_MIN_ARC_M[kind]);
      let pts = r.pts.slice(0, keep);
      let uturn = r.uturn.slice(0, keep);
      // review M3: the respawn (path start) is never right next to where the agent faded out
      const [sx, sz] = pts[0] as P;
      let last = pts.length;
      while (last >= 2) {
        const q = pts[last - 1] as P;
        if (Math.hypot(q[0] - sx, q[1] - sz) >= RESPAWN_APART_M) break;
        last--;
      }
      if (last < 2) continue;
      pts = pts.slice(0, last);
      uturn = uturn.slice(0, last);
      const length = polyLength(pts);
      if (length < 2 * FADE_S * speed + 4) continue;
      const deadEnds = r.deadEnds.filter((d) =>
        pts.some((p) => Math.hypot(p[0] - d[0], p[1] - d[1]) <= 12),
      );
      return { pts, uturn, length, deadEnds };
    }
    return null;
  };
  const plan = (kind: Agent["kind"], list: Cand[], n: number, asset: string) => {
    const variants = Object.keys(m.assets[asset]?.variants ?? {}).filter(
      (v) => kind === "vehicle" || !PEOPLE_EXCLUDED.has(v),
    );
    if (n <= 0 || list.length === 0 || variants.length === 0) return;
    list.sort((a, b) => a.prio - b.prio || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const light = variants.filter((v) => !MAJOR_ONLY.has(v));
    let placed = 0;
    for (const { id, edge: e } of list) {
      if (placed >= n) break;
      const major = e.type === "major_road";
      const pool = kind === "vehicle" && !major && light.length > 0 ? light : variants;
      const variant = pickVariant(pool, hash01(id, "variant"));
      const speed =
        kind === "vehicle"
          ? lerp(major ? SPEED.major : SPEED.street, hash01(id, "speed"))
          : variant === "jogger"
            ? SPEED.jogger
            : lerp(SPEED.walk, hash01(id, "speed"));
      // heavy vehicles keep to major roads all the way (MAJOR_ONLY)
      const walked = walkOf(id, kind, e, speed, MAJOR_ONLY.has(variant) ? MAJOR_TYPES : null);
      if (!walked) continue;
      const { pts, uturn, deadEnds, length } = walked;
      // A1: slow through corners and curves (heading turns at most TURN_RATE rad/s), and turn a
      // dead end's half circle over about TURN_S
      const warp = pathWarp(pts, uturn, speed, TURN_RATE[kind], Math.PI / TURN_S);
      const nominal = warp ? (warp[warp.length - 2] as number) : length;
      const agent: Agent = {
        id,
        kind,
        variant,
        path: Float32Array.from(pts.flat()),
        length,
        speed,
        offset: hash01(id, "offset") * nominal,
        ends: "fade",
      };
      if (warp) agent.warp = warp;
      if (deadEnds.length > 0) agent.deadEnds = Float32Array.from(deadEnds.flat());
      out.push(agent);
      placed++;
    }
  };
  const count = (cap: number) => Math.floor(Math.max(0, cap) * density);
  const floor =
    input.floorPerM && input.floorPerM > 0
      ? Math.ceil((streetM * input.floorPerM * density) / DENSITY.day - 1e-9)
      : 0;
  plan("vehicle", cands.vehicle, count(input.caps.vehicles), "vehicles");
  plan("person", cands.person, Math.max(count(input.caps.people), floor), "people");
  return out;
}
