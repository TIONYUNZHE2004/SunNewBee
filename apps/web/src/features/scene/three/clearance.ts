import type { BuildingsLayer } from "../../../lib/api";
import { toBuildings } from "../shared/model";
import type { Placement } from "./assets/fit";
import type { Manifest } from "./assets/manifest";
import type { CityPlan } from "./assets/plan";
import { displayHeight, localRing } from "./cityMesh";
import type { LocalFrame } from "./frame";

/**
 * Building clearance for every camera (spec A8, AC-A8; reused by the journey follow camera, D-T5).
 *
 * A footprint grid over the buildings the stylised renderer draws: every OSM footprint at its
 * display height (what `buildCityGeometry` extrudes), plus the box of every placed archetype unit
 * and landmark at its fitted size (a traced tower stands above its podium at its design height).
 * The camera is never inside a footprint below roof height + `CLEARANCE_M`, and it is lifted when the
 * camera-to-target segment passes through a building. Lifting keeps the camera's ground position
 * (x, z) and only raises it: the camera never moves sideways into a footprint.
 *
 * Coordinates are the local frame (`frame.ts`): x east, y up, z = -north, metres. Pure and
 * allocation-light; no Three.js dependency, so the follow camera and tests use it as is.
 *
 * Bounds a caller must plan for:
 * - The hard floor is never eased, so it can raise the camera in one frame by up to
 *   `maxTopM + CLEARANCE_M` minus the base height (about 132 m on the Elmina seed, whose tallest
 *   drawn building is 130 m). This happens when a low camera enters a footprint the segment lift did
 *   not anticipate, e.g. when the target is inside that building (the subject is never an obstacle).
 * - The segment lift asks for at most `MAX_SEGMENT_LIFT_M` (600 m) of camera height; the review
 *   measured 408 m on the seed (a low camera looking past a tower at a near target). It is eased.
 * - The last (1 - NEAR_TARGET_SHARE) = 20 % of the camera-to-target segment never lifts.
 */

export type Pt = [x: number, z: number];
export type Vec3 = [x: number, y: number, z: number];

/** A solid column from the ground to `topM` over a simple polygon (local [x, z], any winding). */
export interface Obstacle {
  id: string;
  ring: Pt[];
  topM: number;
}

/** Minimum camera height above any roof it is over (AC-A8). */
export const CLEARANCE_M = 2;
/**
 * The hard floor (roof + clearance) also holds this far outside a footprint (horizontal metres): the
 * near plane never grazes a wall. Beyond it there is no floor; approaching a building is handled by
 * the segment lift (the target leads the camera), so a street-level camera beside a tall building
 * is never lifted (review A-T7 r1: a long ramp ratcheted the camera up along tall streets).
 */
export const PAD_M = 1;
/** Upper bound of the optional skirt (a linear ramp beyond the pad; default 0 = none). */
export const MAX_SKIRT_M = 10;
/**
 * Buildings the camera-to-target segment crosses only this close to the target (share of the
 * segment, 0 = camera, 1 = target) never lift the camera: they are the subject, not an obstacle.
 */
export const NEAR_TARGET_SHARE = 0.8;
/** The segment lift never asks for more than this camera height (the floor still applies). */
export const MAX_SEGMENT_LIFT_M = 600;
/** Easing time constant of the lift (up and back down); the floor is never eased. */
export const LIFT_TAU_MS = 150;

const CELL_M = 32;

export interface ClearanceOptions {
  clearanceM?: number;
  /** Hard-floor pad outside a footprint (default PAD_M). */
  padM?: number;
  /** Default skirt beyond the pad, clamped to MAX_SKIRT_M (default 0: none). */
  skirtM?: number;
  nearTargetShare?: number;
  maxSegmentLiftM?: number;
  cellM?: number;
}

/** The first building a 3D segment passes through (`s`: share of the segment from `a`). */
export interface SegmentHit {
  id: string;
  topM: number;
  s: number;
}

/** Per-call options: a follow camera may drop the skirt or the segment lift. */
export interface ClearOptions {
  /** Skirt beyond the pad for this call (clamped to MAX_SKIRT_M); default: the grid's. */
  skirtM?: number;
  /** False: no segment lift (floor only). Default true. */
  segment?: boolean;
}

export interface ClearedPose {
  /** The corrected camera position (same x, z; y raised when needed). */
  position: Vec3;
  /** True when y was raised. */
  lifted: boolean;
  /** The floor at the camera's ground position (`floorAt`). */
  floorM: number;
  /** The camera height the segment test asks for (0 when nothing is in the way). */
  segmentM: number;
}

export interface Clearance {
  readonly count: number;
  readonly maxTopM: number;
  readonly clearanceM: number;
  /** Top of the tallest footprint containing (x, z), or 0 when none does. */
  topAt(x: number, z: number): number;
  /** Top of the tallest footprint within `radius` metres of (x, z) (0: inside only), or 0. */
  maxRoofNear(x: number, z: number, radius: number): number;
  /**
   * Every footprint containing (x, z), or within `radius` m of it: its id, bounding box and top
   * (the building a point stands in; the journey cutaway cuts only that one).
   */
  footprintsAt(x: number, z: number, radius?: number): FootprintBox[];
  /**
   * Minimum camera height at (x, z): roof + clearance inside a footprint or within `padM` of it;
   * with a skirt, falling linearly to 0 over `skirtM` beyond the pad; else 0.
   */
  floorAt(x: number, z: number, skirtM?: number): number;
  /**
   * The first building whose column the 3D segment a→b passes through below its roof + `marginM`
   * (default 0), or null. A segment end inside a column counts.
   */
  segmentHitsBuilding(a: Vec3, b: Vec3, marginM?: number): SegmentHit | null;
  /**
   * Camera height the camera→target segment needs to clear the buildings between them. Buildings
   * containing the target, and buildings the segment enters only in its last
   * (1 − nearTargetShare) = 20 % towards the target, are ignored: they are the subject.
   */
  segmentLiftM(camera: Vec3, target: Vec3): number;
  /** The camera raised to max(floor, segment lift); x and z are kept. */
  clearCameraPose(camera: Vec3, target: Vec3, opts?: ClearOptions): ClearedPose;
}

/** A footprint's horizontal bounding box and top (local metres). */
export interface FootprintBox {
  id: string;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  topM: number;
}

interface Entry {
  id: string;
  xs: Float64Array;
  zs: Float64Array;
  topM: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

function pointIn(e: Entry, x: number, z: number): boolean {
  if (x < e.minX || x > e.maxX || z < e.minZ || z > e.maxZ) return false;
  const { xs, zs } = e;
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    const zi = zs[i] as number;
    const zj = zs[j] as number;
    if (zi > z !== zj > z) {
      const xi = xs[i] as number;
      const xj = xs[j] as number;
      if (x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Horizontal distance from (x, z) to the polygon (0 inside). */
function distTo(e: Entry, x: number, z: number): number {
  if (pointIn(e, x, z)) return 0;
  const { xs, zs } = e;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    const ax = xs[j] as number;
    const az = zs[j] as number;
    const dx = (xs[i] as number) - ax;
    const dz = (zs[i] as number) - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - x;
    const pz = az + dz * t - z;
    const d2 = px * px + pz * pz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** Lower bound of the distance from (x, z) to the entry (its box). */
function boxDist(e: Entry, x: number, z: number): number {
  const dx = x < e.minX ? e.minX - x : x > e.maxX ? x - e.maxX : 0;
  const dz = z < e.minZ ? e.minZ - z : z > e.maxZ ? z - e.maxZ : 0;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Parameter interval [s0, s1] (shares of a→b, horizontal) inside the polygon, or null. Exact for
 * convex polygons; for concave ones it is the hull of the inside spans (conservative).
 */
function spanOf(e: Entry, ax: number, az: number, bx: number, bz: number): [number, number] | null {
  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minZ = Math.min(az, bz);
  const maxZ = Math.max(az, bz);
  if (maxX < e.minX || minX > e.maxX || maxZ < e.minZ || minZ > e.maxZ) return null;
  let s0 = Number.POSITIVE_INFINITY;
  let s1 = Number.NEGATIVE_INFINITY;
  if (pointIn(e, ax, az)) s0 = 0;
  if (pointIn(e, bx, bz)) s1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const { xs, zs } = e;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    const cx = xs[j] as number;
    const cz = zs[j] as number;
    const ex = (xs[i] as number) - cx;
    const ez = (zs[i] as number) - cz;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const s = ((cx - ax) * ez - (cz - az) * ex) / den;
    const u = ((cx - ax) * dz - (cz - az) * dx) / den;
    if (s < 0 || s > 1 || u < 0 || u > 1) continue;
    if (s < s0) s0 = s;
    if (s > s1) s1 = s;
  }
  if (!Number.isFinite(s0) && !Number.isFinite(s1)) return null;
  if (!Number.isFinite(s0)) s0 = s1;
  if (!Number.isFinite(s1)) s1 = s0;
  return [s0, s1];
}

/** Builds the footprint grid. Obstacles with fewer than 3 points or a non-positive top are dropped. */
export function createClearance(
  obstacles: readonly Obstacle[],
  opts: ClearanceOptions = {},
): Clearance {
  const clearanceM = opts.clearanceM ?? CLEARANCE_M;
  const padM = Math.max(0, opts.padM ?? PAD_M);
  const skirtDefault = Math.min(MAX_SKIRT_M, Math.max(0, opts.skirtM ?? 0));
  const nearShare = opts.nearTargetShare ?? NEAR_TARGET_SHARE;
  const maxLift = opts.maxSegmentLiftM ?? MAX_SEGMENT_LIFT_M;
  const cell = opts.cellM ?? CELL_M;

  const entries: Entry[] = [];
  let maxTopM = 0;
  for (const o of obstacles) {
    if (!(o.topM > 0) || o.ring.length < 3) continue;
    const xs = new Float64Array(o.ring.length);
    const zs = new Float64Array(o.ring.length);
    let minX = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    let ok = true;
    o.ring.forEach(([x, z], i) => {
      if (!Number.isFinite(x) || !Number.isFinite(z)) ok = false;
      xs[i] = x;
      zs[i] = z;
      minX = Math.min(minX, x);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxZ = Math.max(maxZ, z);
    });
    if (!ok) continue;
    entries.push({ id: o.id, xs, zs, topM: o.topM, minX, minZ, maxX, maxZ });
    if (o.topM > maxTopM) maxTopM = o.topM;
  }

  const grid = new Map<number, number[]>();
  const key = (ix: number, iz: number) => (ix + 0x8000) * 0x10000 + (iz + 0x8000);
  const ci = (v: number) => Math.floor(v / cell);
  entries.forEach((e, n) => {
    for (let ix = ci(e.minX); ix <= ci(e.maxX); ix++)
      for (let iz = ci(e.minZ); iz <= ci(e.maxZ); iz++) {
        const k = key(ix, iz);
        const list = grid.get(k);
        if (list) list.push(n);
        else grid.set(k, [n]);
      }
  });

  // Visit stamps: each query sees an entry once even when it spans several cells.
  const stamp = new Uint32Array(entries.length);
  let query = 0;
  const nextQuery = () => {
    query++;
    if (query === 0xffffffff) {
      stamp.fill(0);
      query = 1;
    }
    return query;
  };

  /** Calls `visit` once per entry in the cells overlapping the box. */
  const inBox = (x0: number, z0: number, x1: number, z1: number, visit: (e: Entry) => void) => {
    const q = nextQuery();
    for (let ix = ci(x0); ix <= ci(x1); ix++)
      for (let iz = ci(z0); iz <= ci(z1); iz++) {
        const list = grid.get(key(ix, iz));
        if (!list) continue;
        for (const n of list) {
          if (stamp[n] === q) continue;
          stamp[n] = q;
          visit(entries[n] as Entry);
        }
      }
  };

  /** Calls `visit` once per entry in the cells the horizontal segment crosses (grid traversal). */
  const alongSegment = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    visit: (e: Entry) => void,
  ) => {
    const q = nextQuery();
    const take = (ix: number, iz: number) => {
      const list = grid.get(key(ix, iz));
      if (!list) return;
      for (const n of list) {
        if (stamp[n] === q) continue;
        stamp[n] = q;
        visit(entries[n] as Entry);
      }
    };
    let ix = ci(ax);
    let iz = ci(az);
    const ex = ci(bx);
    const ez = ci(bz);
    const dx = bx - ax;
    const dz = bz - az;
    const sx = dx > 0 ? 1 : -1;
    const sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(cell / dx) : Number.POSITIVE_INFINITY;
    const tdz = dz !== 0 ? Math.abs(cell / dz) : Number.POSITIVE_INFINITY;
    let tmx =
      dx !== 0 ? ((dx > 0 ? (ix + 1) * cell : ix * cell) - ax) / dx : Number.POSITIVE_INFINITY;
    let tmz =
      dz !== 0 ? ((dz > 0 ? (iz + 1) * cell : iz * cell) - az) / dz : Number.POSITIVE_INFINITY;
    const steps = Math.abs(ex - ix) + Math.abs(ez - iz);
    take(ix, iz);
    for (let i = 0; i < steps; i++) {
      if (tmx < tmz) {
        ix += sx;
        tmx += tdx;
      } else {
        iz += sz;
        tmz += tdz;
      }
      take(ix, iz);
    }
  };

  const maxRoofNear = (x: number, z: number, radius: number) => {
    const r = Math.max(0, radius);
    let best = 0;
    inBox(x - r, z - r, x + r, z + r, (e) => {
      if (e.topM <= best || boxDist(e, x, z) > r) return;
      if (r === 0 ? pointIn(e, x, z) : distTo(e, x, z) <= r) best = e.topM;
    });
    return best;
  };

  const floorAt = (x: number, z: number, skirtM = skirtDefault) => {
    const skirt = Math.min(MAX_SKIRT_M, Math.max(0, skirtM));
    const reach = padM + skirt;
    let best = 0;
    const at = (peak: number, d: number) =>
      d <= padM ? peak : skirt > 0 && d < reach ? peak * (1 - (d - padM) / skirt) : 0;
    inBox(x - reach, z - reach, x + reach, z + reach, (e) => {
      const peak = e.topM + clearanceM;
      if (peak <= best || at(peak, boxDist(e, x, z)) <= best) return;
      const f = at(peak, distTo(e, x, z));
      if (f > best) best = f;
    });
    return best;
  };

  const segmentLiftM = (camera: Vec3, target: Vec3) => {
    const [cx, cy, cz] = camera;
    const [tx, ty, tz] = target;
    if (Math.hypot(tx - cx, tz - cz) < 1e-6) return 0;
    // Nothing can ask for more than this: the worst case is a max-height roof at the near share.
    if (cy >= (maxTopM + clearanceM) / (1 - nearShare)) return 0;
    let need = 0;
    alongSegment(cx, cz, tx, tz, (e) => {
      if (pointIn(e, tx, tz)) return; // the target's own building is the subject
      const span = spanOf(e, cx, cz, tx, tz);
      if (!span || span[0] >= nearShare) return;
      const s = Math.min(span[1], nearShare);
      const h = (e.topM + clearanceM - ty * s) / (1 - s);
      if (h > need) need = h;
    });
    return Math.min(need, maxLift);
  };

  return {
    count: entries.length,
    maxTopM,
    clearanceM,
    topAt: (x, z) => maxRoofNear(x, z, 0),
    maxRoofNear,
    footprintsAt(x, z, radius = 0) {
      const r = Math.max(0, radius);
      const out: FootprintBox[] = [];
      inBox(x - r, z - r, x + r, z + r, (e) => {
        if (boxDist(e, x, z) > r) return;
        if (!(r === 0 ? pointIn(e, x, z) : distTo(e, x, z) <= r)) return;
        if (out.some((o) => o.id === e.id)) return;
        out.push({
          id: e.id,
          minX: e.minX,
          minZ: e.minZ,
          maxX: e.maxX,
          maxZ: e.maxZ,
          topM: e.topM,
        });
      });
      return out;
    },
    floorAt,
    segmentHitsBuilding(a, b, marginM = 0) {
      let hit: SegmentHit | null = null;
      alongSegment(a[0], a[2], b[0], b[2], (e) => {
        const span = spanOf(e, a[0], a[2], b[0], b[2]);
        if (!span) return;
        // Lowest point of the segment over the span (y is linear in s).
        const y0 = a[1] + (b[1] - a[1]) * span[0];
        const y1 = a[1] + (b[1] - a[1]) * span[1];
        const top = e.topM + marginM;
        if (Math.min(y0, y1) >= top) return;
        // First s in the span below the top.
        let s = span[0];
        if (y0 >= top && y1 !== y0) s = span[0] + ((y0 - top) / (y0 - y1)) * (span[1] - span[0]);
        if (!hit || s < hit.s) hit = { id: e.id, topM: e.topM, s };
      });
      return hit;
    },
    segmentLiftM,
    clearCameraPose(camera, target, o = {}) {
      const floorM = floorAt(camera[0], camera[2], o.skirtM);
      const segmentM = o.segment === false ? 0 : segmentLiftM(camera, target);
      const y = Math.max(camera[1], floorM, segmentM);
      return { position: [camera[0], y, camera[2]], lifted: y > camera[1], floorM, segmentM };
    },
  };
}

/** One frame of a camera lift (`createLift`). */
export interface LiftStep {
  /** The camera height to render at (>= the base height and the floor). */
  y: number;
  /** y minus the base camera height. */
  liftM: number;
  /** False while the eased lift still moves (more than 5 cm to go): render another frame. */
  settled: boolean;
}

/**
 * The eased camera lift, as state that outlives a frame: the floor applies at once (never eased);
 * the segment lift eases up towards its height and eases back down when it is no longer needed,
 * with time constant `tauMs` (at once under reduced motion). Feed it the camera's *base* pose each
 * frame (the pose the user, a flight or a follow camera asks for, without the lift): the state keeps
 * the eased lift above the base (not an absolute height, so a teleport never animates from the old
 * height), so a flight that re-applies its tween pose every frame still lifts smoothly, and
 * the base never ratchets up.
 */
export function createLift(tauMs = LIFT_TAU_MS): {
  step(
    c: Clearance,
    base: Vec3,
    target: Vec3,
    dtMs: number,
    reduced: boolean,
    opts?: ClearOptions,
  ): LiftStep;
  reset(): void;
} {
  /** The eased lift above the base of the last step (metres), or null (no history). */
  let eased: number | null = null;
  return {
    step(c, base, target, dtMs, reduced, opts) {
      const full = c.clearCameraPose(base, target, opts);
      const goal = full.position[1] - base[1];
      const hard = Math.max(0, full.floorM - base[1]);
      let lift: number;
      if (reduced || eased === null) lift = goal;
      else {
        const k = 1 - Math.exp(-Math.min(50, Math.max(0, dtMs)) / tauMs);
        lift = Math.max(hard, eased + (goal - eased) * k);
        if (Math.abs(goal - lift) < 0.05) lift = goal;
      }
      eased = lift;
      return { y: base[1] + lift, liftM: lift, settled: lift === goal };
    },
    reset() {
      eased = null;
    },
  };
}

/** A model's local bounds (metres, before the placement's scale and yaw): x, z extent and top y. */
export interface ModelBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
}

/** The model's drawn bounds (all LODs), or null: `obstaclesFromCity` then uses the manifest size. */
export type ModelBoxOf = (asset: string, variant: string) => ModelBox | null;

/**
 * The box of a placed model as a ring, at its drawn height. With `boxOf` the box is the loaded
 * geometry's own bounds (a glb may rise above or sit off its manifest `size`: review A-T7 r1 found
 * a landmark drawn 2.5 m above its size); otherwise the manifest size centred on the origin.
 */
function placementObstacle(p: Placement, m: Manifest, boxOf?: ModelBoxOf): Obstacle | null {
  const size = m.assets[p.asset]?.variants[p.variant]?.size;
  const own = boxOf?.(p.asset, p.variant) ?? null;
  const box: ModelBox | null = own
    ? own
    : size
      ? {
          minX: -size[0] / 2,
          maxX: size[0] / 2,
          minZ: -size[2] / 2,
          maxZ: size[2] / 2,
          maxY: size[1],
        }
      : null;
  if (!box || !(box.maxY > 0)) return null;
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  // Scale, then rotation about +y by yaw: local (lx, lz) -> (lx cos + lz sin, -lx sin + lz cos).
  const at = (lx: number, lz: number): Pt => {
    const x = lx * p.sx;
    const z = lz * p.sz;
    return [p.x + x * c + z * s, p.z - x * s + z * c];
  };
  return {
    id: p.id,
    ring: [
      at(box.minX, box.minZ),
      at(box.maxX, box.minZ),
      at(box.maxX, box.maxZ),
      at(box.minX, box.maxZ),
    ],
    topM: box.maxY * p.sy,
  };
}

/**
 * What the stylised renderer draws as buildings: every OSM footprint at its display height (the
 * extruded fallbacks, and the footprints the archetypes are fitted to), plus, with a plan, the box
 * of every archetype unit and landmark at its fitted size (from `boxOf`, the loaded geometry's
 * bounds, when given). Display geometry only: this never feeds routing, evaluation or answers.
 */
export function obstaclesFromCity(
  layer: BuildingsLayer | null | undefined,
  frame: LocalFrame,
  plan?: CityPlan | null,
  manifest?: Manifest | null,
  boxOf?: ModelBoxOf,
): Obstacle[] {
  const out: Obstacle[] = [];
  for (const b of toBuildings(layer?.buildings, displayHeight).buildings) {
    const ring = localRing(b.ring, frame);
    if (ring && ring.length >= 3) out.push({ id: b.id, ring, topM: b.height });
  }
  if (plan && manifest) {
    for (const list of plan.placements.values())
      for (const p of list) {
        const o = placementObstacle(p, manifest, boxOf);
        if (o) out.push(o);
      }
    for (const p of plan.landmarks) {
      const o = placementObstacle(p, manifest, boxOf);
      if (o) out.push(o);
    }
  }
  return out;
}
