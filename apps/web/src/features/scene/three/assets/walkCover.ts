import type { LocalFrame } from "../frame";

/**
 * 9.1 F1: an archetype stand-in (fitted to its footprint OBB, ADR 0012) or a landmark model is a
 * display stand-in, larger than its OSM outline wherever the outline is not a rectangle. Where that
 * drawn mass lies over a walk edge the outline does not cover, the walker is drawn under a roof
 * that is not there (the Lakeside Mall over the park path). `planCity` then draws the building as
 * its extruded OSM footprint, the fact geometry. Display only: the walk is read, never changed.
 */

type Pt = [number, number];

/**
 * A walk point counts as covered only when it lies this far inside the drawn ring AND this far
 * outside the fact outline (m): a footway hugging a wall, or an outline traced a hair off its
 * model, is not a cover.
 */
export const WALK_COVER_MARGIN_M = 0.5;
/** Sampling step along a covered piece of a walk edge (m). */
const STEP_M = 0.5;
/** Grid cell of the walk index (m). */
const CELL_M = 32;

interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/** The walk LineStrings' segments in local metres, bucketed on a grid. */
export interface WalkIndex {
  readonly segs: readonly Seg[];
  readonly grid: ReadonlyMap<number, readonly number[]>;
}

const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function linesOf(geom: unknown): unknown[][] {
  if (!isRec(geom) || !Array.isArray(geom.coordinates)) return [];
  if (geom.type === "LineString") return [geom.coordinates];
  if (geom.type === "MultiLineString")
    return (geom.coordinates as unknown[]).filter((l): l is unknown[] => Array.isArray(l));
  return [];
}

/** Build the index from a FeatureCollection's LineStrings (other geometries are skipped). Pure. */
export function buildWalkIndex(fc: unknown, frame: LocalFrame): WalkIndex {
  const segs: Seg[] = [];
  const grid = new Map<number, number[]>();
  const features = isRec(fc) && Array.isArray(fc.features) ? fc.features : [];
  for (const f of features) {
    if (!isRec(f)) continue;
    for (const line of linesOf(f.geometry)) {
      let prev: Pt | null = null;
      for (const c of line) {
        if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
          prev = null;
          continue;
        }
        const q = frame.toLocal(c[0] as number, c[1] as number);
        if (prev && (prev[0] !== q[0] || prev[1] !== q[1])) {
          const id = segs.length;
          segs.push({ ax: prev[0], az: prev[1], bx: q[0], bz: q[1] });
          const i0 = Math.floor(Math.min(prev[0], q[0]) / CELL_M);
          const i1 = Math.floor(Math.max(prev[0], q[0]) / CELL_M);
          const j0 = Math.floor(Math.min(prev[1], q[1]) / CELL_M);
          const j1 = Math.floor(Math.max(prev[1], q[1]) / CELL_M);
          for (let i = i0; i <= i1; i++)
            for (let j = j0; j <= j1; j++) {
              const k = key(i, j);
              const list = grid.get(k);
              if (list) list.push(id);
              else grid.set(k, [id]);
            }
        }
        prev = q;
      }
    }
  }
  return { segs, grid };
}

const memo = new WeakMap<object, WeakMap<LocalFrame, WalkIndex>>();
/** `buildWalkIndex`, memoised per layer object and frame (null without a layer). */
export function walkIndexOf(fc: unknown, frame: LocalFrame): WalkIndex | null {
  if (!isRec(fc)) return null;
  let per = memo.get(fc);
  if (!per) {
    per = new WeakMap();
    memo.set(fc, per);
  }
  let idx = per.get(frame);
  if (!idx) {
    idx = buildWalkIndex(fc, frame);
    per.set(frame, idx);
  }
  return idx;
}

function inside(ring: readonly Pt[], x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

function nearEdge(ring: readonly Pt[], x: number, z: number, d: number): boolean {
  const d2 = d * d;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j]!;
    const [bx, bz] = ring[i]!;
    const ex = bx - ax;
    const ez = bz - az;
    const l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
    const dx = ax + t * ex - x;
    const dz = az + t * ez - z;
    if (dx * dx + dz * dz <= d2) return true;
  }
  return false;
}

/** Signed area x2 (sign gives the winding). */
function area2(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return a;
}

/**
 * The parameter range [t0, t1] of segment s that lies at least `m` inside the convex ring, or null
 * (Cyrus-Beck against each edge's inward half-plane, offset by m).
 */
function clipConvex(ring: readonly Pt[], s: Seg, m: number): [number, number] | null {
  const sign = area2(ring) >= 0 ? 1 : -1;
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  let t0 = 0;
  let t1 = 1;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [px, pz] = ring[j]!;
    const [qx, qz] = ring[i]!;
    const ex = qx - px;
    const ez = qz - pz;
    const len = Math.hypot(ex, ez);
    if (len < 1e-9) continue;
    // inward unit normal: for a counter-clockwise ring (positive area in x/z) it is (-ez, ex)
    const nx = (-ez / len) * sign;
    const nz = (ex / len) * sign;
    // n . (a + t d - p) >= m
    const f = nx * (s.ax - px) + nz * (s.az - pz) - m;
    const g = nx * dx + nz * dz;
    if (Math.abs(g) < 1e-12) {
      if (f < 0) return null;
      continue;
    }
    const t = -f / g;
    if (g > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

/**
 * The first walk point that a drawn ring covers and the fact outline does not, or null. `drawn`
 * are convex rings (model boxes, raster cells) in local metres; `fact` the building's outline
 * ring(s): a point inside any of them, or within `margin` of one, is the building's own ground.
 * Pure.
 */
export function walkCoverPoint(
  drawn: readonly (readonly Pt[])[],
  fact: readonly (readonly Pt[])[],
  walk: WalkIndex,
  margin = WALK_COVER_MARGIN_M,
): Pt | null {
  const seen = new Set<number>();
  for (const ring of drawn) {
    if (ring.length < 3) continue;
    let x0 = Number.POSITIVE_INFINITY;
    let z0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let z1 = Number.NEGATIVE_INFINITY;
    for (const [x, z] of ring) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    seen.clear();
    for (let i = Math.floor(x0 / CELL_M); i <= Math.floor(x1 / CELL_M); i++)
      for (let j = Math.floor(z0 / CELL_M); j <= Math.floor(z1 / CELL_M); j++) {
        for (const id of walk.grid.get(key(i, j)) ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const s = walk.segs[id]!;
          const r = clipConvex(ring, s, margin);
          if (!r) continue;
          const len = Math.hypot(s.bx - s.ax, s.bz - s.az) * (r[1] - r[0]);
          const n = Math.max(1, Math.ceil(len / STEP_M));
          for (let k = 0; k <= n; k++) {
            const t = r[0] + ((r[1] - r[0]) * k) / n;
            const x = s.ax + (s.bx - s.ax) * t;
            const z = s.az + (s.bz - s.az) * t;
            if (fact.some((f) => f.length >= 3 && (inside(f, x, z) || nearEdge(f, x, z, margin))))
              continue;
            return [x, z];
          }
        }
      }
  }
  return null;
}
