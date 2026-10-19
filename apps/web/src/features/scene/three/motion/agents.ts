import type { Tier } from "../../shared/quality";
import { WIDTH_BY_TYPE } from "../../shared/roads";
import { hash01 } from "../assets/fit";
import type { Manifest } from "../assets/manifest";
import type { LocalFrame } from "../frame";
import { type Boundary, insideBoundary } from "../ground/boundary";
import { type BBox, bboxOf, inPoly, type Poly, polygonsOf } from "../props/polyGeom";
import { growBox, inBox, type PlanArea, perLayer, touchesBox } from "../stream/area";

/**
 * DECORATIVE traffic and pedestrians for one planning box. Agents walk walk-edge polylines from a
 * seeded start offset (ping-pong on open paths, looping on closed ones; see poseAt), with no
 * routing and no collision (ruling: cars may pass through each other at junctions). Nothing here is a fact about the township: no counts, no
 * flows, no speeds are measured. Pure: the same input always gives the same agents.
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

/** Point and tangent yaw at arc length s along the polyline (zero-length segments skipped). */
function along(p: Float32Array, s: number, out: Pose2): Pose2 {
  const n = p.length / 2;
  let lastYaw = 0;
  let lx = p[0] as number;
  let lz = p[1] as number;
  for (let i = 0; i < n - 1; i++) {
    const ax = p[2 * i] as number;
    const az = p[2 * i + 1] as number;
    const dx = (p[2 * i + 2] as number) - ax;
    const dz = (p[2 * i + 3] as number) - az;
    const l = Math.hypot(dx, dz);
    if (l === 0) continue;
    lastYaw = Math.atan2(dx, dz);
    lx = ax + dx;
    lz = az + dz;
    if (s <= l) {
      const t = Math.max(0, s / l);
      return setPose(out, ax + dx * t, az + dz * t, lastYaw);
    }
    s -= l;
  }
  return setPose(out, lx, lz, lastYaw);
}

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
const BUSY_PLACES = new Set(["school", "mall", "park"]);
const BUSY_RANGE_M = 150;
const BUSY_WEIGHT = 3;
const MIN_EDGE_M = 10;
/** Malaysia drives on the left: a vehicle keeps a quarter of the road width left of its centre line. */
const LANE_SHARE = 0.25;
const PAVEMENT_OFFSET_M: [number, number] = [0.3, 0.8];
/** Heavy vehicles only on major roads. */
const MAJOR_ONLY = new Set(["bus", "lorry"]);
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
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const featuresOf = (fc: unknown): Record<string, unknown>[] =>
  isRec(fc) && Array.isArray(fc.features) ? fc.features.filter(isRec) : [];
const propsOf = (f: Record<string, unknown>): Record<string, unknown> =>
  isRec(f.properties) ? f.properties : {};

const polyLength = (pts: P[]) => {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++)
    l += Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]);
  return l;
};

/** The polyline moved `d` metres to the left of its direction (vertex normals averaged). */
function offsetLeft(pts: P[], d: number): P[] {
  const n = pts.length;
  return pts.map((p, i) => {
    let lx = 0;
    let lz = 0;
    for (const [a, b] of [
      [i - 1, i],
      [i, i + 1],
    ] as const) {
      if (a < 0 || b >= n) continue;
      const dx = pts[b]![0] - pts[a]![0];
      const dz = pts[b]![1] - pts[a]![1];
      const l = Math.hypot(dx, dz) || 1;
      // Left of travel with y up: (dz, -dx).
      lx += dz / l;
      lz += -dx / l;
    }
    const l = Math.hypot(lx, lz) || 1;
    return [p[0] + (lx / l) * d, p[1] + (lz / l) * d];
  });
}

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
    featuresOf(walk).forEach((f, fi) => {
      const g = f.geometry;
      if (!isRec(g) || g.type !== "LineString" || !Array.isArray(g.coordinates)) return;
      const p = propsOf(f);
      const type = String(p.type ?? "");
      const kind: Agent["kind"] | null = VEHICLE_TYPES.has(type)
        ? "vehicle"
        : PEOPLE_TYPES.has(type)
          ? "person"
          : null;
      if (!kind) return;
      const fid = String(p.id ?? `w${fi}`);
      // Runs of consecutive valid vertices (an invalid coordinate breaks the line).
      const runs: P[][] = [[]];
      for (const c of g.coordinates) {
        const run = runs[runs.length - 1]!;
        if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
          if (run.length > 0) runs.push([]);
          continue;
        }
        const q = frame.toLocal(c[0] as number, c[1] as number);
        const last = run[run.length - 1];
        if (!last || last[0] !== q[0] || last[1] !== q[1]) run.push(q);
      }
      runs.forEach((pts, ri) => {
        if (pts.length < 2) return;
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
        out.push({ fid, ri, kind, type, pts, length: polyLength(pts), bb: [x0, z0, x1, z1] });
      });
    });
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
/** Whether any point of the polyline (vertices, and every OBSTACLE_STEP_M along it) is inside an obstacle. */
function pathBlocked(grids: Map<number, Obstacle[]>[], pts: P[]): boolean {
  if (grids.length === 0) return false;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    if (insideObstacle(grids, a[0], a[1])) return true;
    const b = pts[i + 1];
    if (!b) break;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.floor(l / OBSTACLE_STEP_M);
    for (let k = 1; k <= n; k++) {
      const t = (k * OBSTACLE_STEP_M) / l;
      if (insideObstacle(grids, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return true;
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
const segDist = (x: number, z: number, c: Carriage) => {
  const dx = c.bx - c.ax;
  const dz = c.bz - c.az;
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - c.ax) * dx + (z - c.az) * dz) / l2));
  return Math.hypot(x - c.ax - dx * t, z - c.az - dz * t);
};
/**
 * Whether a pavement point keeps clear of the carriageways: at least half width + PAVEMENT_CLEAR_M
 * from every other street / major_road centre line, and out of its own road (half width + 0.3 m).
 */
function pavementClear(g: Map<number, Carriage[]>, fid: string, x: number, z: number): boolean {
  const k = obstKey(Math.floor(x / CARRIAGE_CELL_M), Math.floor(z / CARRIAGE_CELL_M));
  for (const c of g.get(k) ?? []) {
    const need = c.half + (c.fid === fid ? OWN_ROAD_CLEAR_M : PAVEMENT_CLEAR_M);
    if (segDist(x, z, c) < need) return false;
  }
  return true;
}
/**
 * The longest stretch of a pavement line that keeps clear of every carriageway (C-T8 fix 1): the
 * line is sampled every OBSTACLE_STEP_M (its vertices kept) and cut where it meets a cross street,
 * so a pavement walker turns round at the kerb instead of walking into the junction.
 */
function trimPavement(g: Map<number, Carriage[]>, fid: string, pts: P[]): P[] {
  const samples: P[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] as P;
    const b = pts[i + 1] as P;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(l / OBSTACLE_STEP_M));
    for (let k = 0; k < n; k++)
      samples.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  samples.push(pts[pts.length - 1] as P);
  let best: P[] = [];
  let bestLen = 0;
  let cur: P[] = [];
  let curLen = 0;
  for (const q of samples) {
    if (pavementClear(g, fid, q[0], q[1])) {
      const last = cur[cur.length - 1];
      if (last) curLen += Math.hypot(q[0] - last[0], q[1] - last[1]);
      cur.push(q);
      if (curLen > bestLen) {
        best = cur;
        bestLen = curLen;
      }
    } else {
      cur = [];
      curLen = 0;
    }
  }
  return bestLen >= MIN_EDGE_M ? best : [];
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

/** The point at arc length s along `pts`. */
function pointAt(pts: P[], s: number): P {
  let walked = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= walked + l && l > 0) {
      const t = (s - walked) / l;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    walked += l;
  }
  return pts[pts.length - 1]!;
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
  const inside = (lane: P[]) => {
    const b = input.boundary;
    return !b || lane.every(([x, z]) => insideBoundary(b, x, z));
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
      const variant = pool[Math.floor(hash01(id, "variant") * pool.length)] as string;
      const reverse = hash01(id, "dir") < 0.5;
      const pts = reverse ? [...e.pts].reverse() : e.pts;
      let lane: P[] | null = null;
      let speed: number;
      if (kind === "vehicle") {
        const lateral = (WIDTH_BY_TYPE[e.type] ?? 6) * LANE_SHARE;
        speed = lerp(major ? SPEED.major : SPEED.street, hash01(id, "speed"));
        // Vehicles (ruling P4-O): a closed out-and-back loop, each leg in its own left lane, joined
        // by lane-change U-turns and closed on the first point, so poseAt loops it and the return
        // leg never drives on the right.
        const loop = [...offsetLeft(pts, lateral), ...offsetLeft([...pts].reverse(), lateral)];
        loop.push(loop[0] as P);
        if (inside(loop)) lane = loop;
      } else {
        // People keep a single pavement line and ping-pong. The hashed side first; if that line
        // enters a footprint or water (P7) or leaves the boundary, the other side; else none.
        const side = hash01(id, "side") < 0.5 ? -1 : 1;
        const off = e.pavement
          ? (WIDTH_BY_TYPE[e.type] ?? 6) / 2 + lerp(PAVEMENT_KERB_M, hash01(id, "lateral"))
          : lerp(PAVEMENT_OFFSET_M, hash01(id, "lateral"));
        for (const s of [side, -side]) {
          const raw = offsetLeft(pts, s * off);
          const l = e.pavement ? trimPavement(carriages, e.fid, raw) : raw;
          if (l.length >= 2 && inside(l) && !pathBlocked(grids, l)) {
            lane = l;
            break;
          }
        }
        speed = variant === "jogger" ? SPEED.jogger : lerp(SPEED.walk, hash01(id, "speed"));
      }
      if (!lane) continue;
      const length = polyLength(lane);
      out.push({
        id,
        kind,
        variant,
        path: Float32Array.from(lane.flat()),
        length,
        speed,
        offset: hash01(id, "offset") * length,
      });
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
