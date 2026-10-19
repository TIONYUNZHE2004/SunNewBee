import type { LocalFrame } from "../frame";

/** A polygon-clipping MultiPolygon (lon/lat): type only, so this module never loads the library. */
type PcMulti = [number, number][][][];

/**
 * The Elmina outline (`/site` `boundary.geometry`, display only) in the local frame, and the pure
 * clip helpers every stylised planner uses (polygon cutting lives in `clipPolygon.ts`, so the
 * tile-plan worker never bundles polygon-clipping) (spec 2026-10-19 resident journey A5, task A-T4). Only
 * the display is clipped: routing, evaluation, the API data and the data overlays never are.
 */

export type P = [number, number];

export interface Boundary {
  /** Polygons in local metres (x east, z = -north): each is [outer, ...holes], rings not closed. */
  polys: P[][][];
  /** The same polygons in lon/lat, closed rings (the `clipPolygon.ts` input). */
  lonlat: PcMulti;
  /** Local bounds [x0, z0, x1, z1]. */
  box: [number, number, number, number];
  /** Every ring edge as x0, z0, x1, z1. */
  edges: Float64Array;
}

/**
 * How far (m) a building footprint vertex may lie outside the outline and still be drawn (AC-A5:
 * no display vertex more than 5 m outside). Also the vertex guard of streamed ground triangles.
 */
export const CLIP_TOLERANCE_M = 5;

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isPt = (p: unknown): p is P =>
  Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

function ringOf(raw: unknown): P[] | null {
  if (!Array.isArray(raw)) return null;
  const out: P[] = [];
  for (const p of raw) {
    if (!isPt(p)) return null;
    out.push([p[0], p[1]]);
  }
  // Drop the closing point.
  const a = out[0];
  const b = out[out.length - 1];
  if (out.length > 1 && a && b && a[0] === b[0] && a[1] === b[1]) out.pop();
  return out.length >= 3 ? out : null;
}

/** A GeoJSON Polygon / MultiPolygon geometry to a `Boundary`; null when it is not one. Pure. */
export function boundaryOf(geom: unknown, frame: LocalFrame): Boundary | null {
  if (!isRec(geom) || !Array.isArray(geom.coordinates)) return null;
  const raw =
    geom.type === "Polygon"
      ? [geom.coordinates]
      : geom.type === "MultiPolygon"
        ? geom.coordinates
        : null;
  if (!raw) return null;
  const polys: P[][][] = [];
  const lonlat: PcMulti = [];
  for (const poly of raw) {
    if (!Array.isArray(poly)) continue;
    const rings = poly.map(ringOf);
    const outer = rings[0];
    if (!outer) continue;
    const ok = rings.filter((r): r is P[] => r !== null);
    lonlat.push(ok.map((r) => [...r, r[0]!] as P[]));
    polys.push(ok.map((r) => r.map(([lon, lat]) => frame.toLocal(lon, lat))));
  }
  if (polys.length === 0) return null;
  let n = 0;
  for (const poly of polys) for (const r of poly) n += r.length;
  const edges = new Float64Array(n * 4);
  const box: Boundary["box"] = [Infinity, Infinity, -Infinity, -Infinity];
  let o = 0;
  for (const poly of polys)
    for (const r of poly)
      for (let i = 0; i < r.length; i++) {
        const a = r[i]!;
        const b = r[(i + 1) % r.length]!;
        edges[o++] = a[0];
        edges[o++] = a[1];
        edges[o++] = b[0];
        edges[o++] = b[1];
        box[0] = Math.min(box[0], a[0]);
        box[1] = Math.min(box[1], a[1]);
        box[2] = Math.max(box[2], a[0]);
        box[3] = Math.max(box[3], a[1]);
      }
  return { polys, lonlat, box, edges };
}

/** Even-odd point in polygon over every ring (holes included), local metres. Pure. */
export function insideBoundary(b: Boundary, x: number, z: number): boolean {
  if (x < b.box[0] || x > b.box[2] || z < b.box[1] || z > b.box[3]) return false;
  const e = b.edges;
  let inside = false;
  for (let i = 0; i < e.length; i += 4) {
    const x0 = e[i]!;
    const z0 = e[i + 1]!;
    const x1 = e[i + 2]!;
    const z1 = e[i + 3]!;
    if (z0 > z !== z1 > z && x < ((x1 - x0) * (z - z0)) / (z1 - z0) + x0) inside = !inside;
  }
  return inside;
}

/** Distance (m) from a point to the nearest outline edge. Pure. */
export function edgeDistance(b: Boundary, x: number, z: number): number {
  const [px, pz] = nearestEdgePoint(b, x, z);
  return Math.hypot(x - px, z - pz);
}

/** The point on the outline (any ring edge) nearest to (x, z), local metres. Pure. */
export function nearestEdgePoint(b: Boundary, x: number, z: number): P {
  const e = b.edges;
  let best = Infinity;
  let out: P = [x, z];
  for (let i = 0; i < e.length; i += 4) {
    const x0 = e[i]!;
    const z0 = e[i + 1]!;
    const dx = e[i + 2]! - x0;
    const dz = e[i + 3]! - z0;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2)) : 0;
    const px = x0 + t * dx;
    const pz = z0 + t * dz;
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < best) {
      best = d;
      out = [px, pz];
    }
  }
  return out;
}

/** Signed clearance (m): + distance to the edge inside the outline, - distance outside. Pure. */
export function clearance(b: Boundary, x: number, z: number): number {
  const d = edgeDistance(b, x, z);
  return insideBoundary(b, x, z) ? d : -d;
}

/** How far (m) a point lies outside the outline (0 inside). Pure. */
export function outsideBy(b: Boundary, x: number, z: number): number {
  return insideBoundary(b, x, z) ? 0 : edgeDistance(b, x, z);
}

/** True when every point lies at most `tolM` outside the outline. Pure. */
export function allWithin(b: Boundary, pts: Iterable<P>, tolM = 0): boolean {
  for (const [x, z] of pts)
    if (!insideBoundary(b, x, z) && (tolM <= 0 || edgeDistance(b, x, z) > tolM)) return false;
  return true;
}

/**
 * The items whose every point (local metres, from `pointsOf`) lies at most `tolM` outside the
 * outline; `dropped` counts the rest. Order is kept. Pure. With no boundary every item is kept.
 */
export function clipToBoundary<T>(
  items: readonly T[],
  pointsOf: (item: T) => Iterable<P>,
  b: Boundary | null,
  tolM = 0,
): { kept: T[]; dropped: number } {
  if (!b) return { kept: [...items], dropped: 0 };
  const kept = items.filter((it) => allWithin(b, pointsOf(it), tolM));
  return { kept, dropped: items.length - kept.length };
}

/** Parameters (0..1, sorted, deduplicated) where segment a-b crosses an outline edge. */
export function crossings(b: Boundary, a: P, c: P): number[] {
  const e = b.edges;
  const out: number[] = [];
  const rx = c[0] - a[0];
  const rz = c[1] - a[1];
  for (let i = 0; i < e.length; i += 4) {
    const qx = e[i]!;
    const qz = e[i + 1]!;
    const sx = e[i + 2]! - qx;
    const sz = e[i + 3]! - qz;
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((qx - a[0]) * sz - (qz - a[1]) * sx) / den;
    const u = ((qx - a[0]) * rz - (qz - a[1]) * rx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) out.push(t);
  }
  return out.sort((p, q) => p - q);
}

/**
 * A polyline (local metres) cut to the outline: the runs of it that lie inside, split exactly at
 * the edge crossings (the crossing points end the runs). Pure.
 */
export function clipLine(b: Boundary, pts: readonly P[]): P[][] {
  const runs: P[][] = [];
  let cur: P[] = [];
  const close = () => {
    if (cur.length >= 2) runs.push(cur);
    cur = [];
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const c = pts[i + 1]!;
    const ts = [0, ...crossings(b, a, c), 1];
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k]!;
      const t1 = ts[k + 1]!;
      if (t1 - t0 < 1e-9) continue;
      const tm = (t0 + t1) / 2;
      const at = (t: number): P =>
        t === 0
          ? [a[0], a[1]]
          : t === 1
            ? [c[0], c[1]]
            : [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
      const [mx, mz] = at(tm);
      if (insideBoundary(b, mx, mz)) {
        const p0 = at(t0);
        const last = cur[cur.length - 1];
        if (!last || last[0] !== p0[0] || last[1] !== p0[1]) {
          close();
          cur.push(p0);
        }
        cur.push(at(t1));
      } else close();
    }
  }
  close();
  return runs;
}

/** How far inside the outline (m) a bookmark's centre must lie (A-T5: probes and hero). */
export const ANCHOR_CLEARANCE_M = 300;

/**
 * A bookmark centre kept at least `minClearM` inside the outline: unchanged when it already is,
 * else the nearest point that is (rings every 50 m out to 5 km, 48 directions each). Lets fixed
 * camera bookmarks survive outline edits (A-T5). Null when no such point lies within 5 km. Pure.
 */
export function anchorInside(
  b: Boundary,
  x: number,
  z: number,
  minClearM = ANCHOR_CLEARANCE_M,
): P | null {
  if (clearance(b, x, z) >= minClearM) return [x, z];
  for (let r = 50; r <= 5000; r += 50) {
    let best: P | null = null;
    let bestC = -Infinity;
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * 2 * Math.PI;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const c = clearance(b, px, pz);
      if (c >= minClearM && c > bestC) {
        bestC = c;
        best = [px, pz];
      }
    }
    if (best) return best;
  }
  return null;
}
