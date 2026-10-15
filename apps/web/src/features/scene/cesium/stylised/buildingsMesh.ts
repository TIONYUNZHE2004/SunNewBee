import { type Building, COL_M } from "./model";

/**
 * Pure mesh builder for the stylised buildings (no Cesium import, unit-tested).
 *
 * Why our own geometry instead of an extruded `PolygonGeometry`: in Cesium 1.146 the `st` of an
 * extruded polygon's walls is the planar projection of the footprint (top and bottom vertices
 * share the same st), so st carries no height and cannot place floors (spike, see task-5 report).
 * Here walls get metric texture coordinates instead:
 *   s = window columns along the perimeter (each wall a whole number of columns, so corners land
 *       on cell edges), offset by a per-building seed and by `tone * TONE_STRIDE`;
 *   t = floors (0 at the base, `floors` at the top). Roofs get t = -1 (the shader's roof flag).
 */
export const TONE_STRIDE = 10_000;
export const TONES = { warm: 0, cool: 1, rose: 2 } as const;

export interface Mesh {
  /** ECEF metres, xyz per vertex. */
  positions: Float64Array;
  normals: Float32Array;
  st: Float32Array;
  indices: Uint32Array;
}

/** Triangulates a simple polygon given as flat [x0,y0,x1,y1,...]; returns triangle indices. */
export type Triangulate = (xy: number[]) => number[];

const A = 6_378_137;
const E2 = 6.69437999014e-3;
const M_PER_DEG = 111_320;
const RAD = Math.PI / 180;

/** WGS84 geodetic (degrees, metres) to ECEF metres. */
export function ecef(lon: number, lat: number, h: number): [number, number, number] {
  const l = lon * RAD;
  const p = lat * RAD;
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  const n = A / Math.sqrt(1 - E2 * sp * sp);
  return [(n + h) * cp * Math.cos(l), (n + h) * cp * Math.sin(l), (n * (1 - E2) + h) * sp];
}

/** Local ENU basis (east, north, up) as ECEF unit vectors at lon/lat (degrees). */
export function enuBasis(lon: number, lat: number) {
  const l = lon * RAD;
  const p = lat * RAD;
  const [sl, cl, sp, cp] = [Math.sin(l), Math.cos(l), Math.sin(p), Math.cos(p)];
  return {
    east: [-sl, cl, 0] as const,
    north: [-sp * cl, -sp * sl, cp] as const,
    up: [cp * cl, cp * sl, sp] as const,
  };
}

/** A local ENU vector at lon/lat expressed in ECEF. */
export function enuToEcef(v: readonly [number, number, number], lon: number, lat: number) {
  const { east, north, up } = enuBasis(lon, lat);
  return [0, 1, 2].map((i) => v[0] * east[i]! + v[1] * north[i]! + v[2] * up[i]!) as [
    number,
    number,
    number,
  ];
}

/** Open ring (no closing duplicate, no repeated consecutive points), counter-clockwise. */
export function cleanRing(ring: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  if (out.length > 1) {
    const [a, b] = [out[0]!, out[out.length - 1]!];
    if (a[0] === b[0] && a[1] === b[1]) out.pop();
  }
  let area2 = 0;
  for (let i = 0, j = out.length - 1; i < out.length; j = i++) {
    area2 += out[j]![0] * out[i]![1] - out[i]![0] * out[j]![1];
  }
  return area2 < 0 ? out.reverse() : out;
}

export function buildMesh(buildings: Building[], triangulate: Triangulate): Mesh {
  const rings = buildings.map((b) => cleanRing(b.ring));
  let nv = 0;
  let ni = 0;
  for (const r of rings) {
    if (r.length < 3) continue;
    nv += r.length * 4 + r.length;
    ni += r.length * 6 + (r.length - 2) * 3;
  }
  const positions = new Float64Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const st = new Float32Array(nv * 2);
  const indices = new Uint32Array(ni);
  let v = 0;
  let k = 0;
  const put = (p: number[], n: readonly number[], s: number, t: number) => {
    positions.set(p, v * 3);
    normals.set(n, v * 3);
    st[v * 2] = s;
    st[v * 2 + 1] = t;
    return v++;
  };

  buildings.forEach((b, bi) => {
    const ring = rings[bi]!;
    if (ring.length < 3) return;
    const [lon0, lat0] = ring[0]!;
    const { east, north, up } = enuBasis(lon0, lat0);
    const kx = Math.cos(lat0 * RAD) * M_PER_DEG;
    const s0 = TONES[b.tone] * TONE_STRIDE + Math.round(b.litSeed * 997);
    const lo = ring.map(([x, y]) => ecef(x, y, b.minHeight));
    const hi = ring.map(([x, y]) => ecef(x, y, b.height));

    // Walls: one quad per edge, outward normal = (dy, -dx) for a counter-clockwise ring.
    let s = s0;
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const dx = (ring[j]![0] - ring[i]![0]) * kx;
      const dy = (ring[j]![1] - ring[i]![1]) * M_PER_DEG;
      const len = Math.hypot(dx, dy) || 1;
      const [ox, oy] = [dy / len, -dx / len];
      const n = [0, 1, 2].map((c) => ox * east[c]! + oy * north[c]!);
      const cols = Math.max(1, Math.round(len / COL_M));
      const b1 = put(lo[i]!, n, s, 0);
      const b2 = put(lo[j]!, n, s + cols, 0);
      const t2 = put(hi[j]!, n, s + cols, b.floors);
      const t1 = put(hi[i]!, n, s, b.floors);
      indices.set([b1, b2, t2, b1, t2, t1], k);
      k += 6;
      s += cols;
    }

    // Roof at b.height, triangulated in local metres; force counter-clockwise (upward) winding.
    const xy: number[] = [];
    for (const [x, y] of ring) xy.push((x - lon0) * kx, (y - lat0) * M_PER_DEG);
    const base = v;
    for (const p of hi) put(p, up, s0, -1);
    const tris = triangulate(xy);
    const maxQ = Math.min(tris.length, (ring.length - 2) * 3); // never overrun the allotment
    for (let q = 0; q + 2 < maxQ; q += 3) {
      const [a, c, d] = [tris[q]!, tris[q + 1]!, tris[q + 2]!];
      const cross =
        (xy[c * 2]! - xy[a * 2]!) * (xy[d * 2 + 1]! - xy[a * 2 + 1]!) -
        (xy[c * 2 + 1]! - xy[a * 2 + 1]!) * (xy[d * 2]! - xy[a * 2]!);
      indices.set(cross >= 0 ? [base + a, base + c, base + d] : [base + a, base + d, base + c], k);
      k += 3;
    }
  });
  return { positions, normals, st, indices: k === indices.length ? indices : indices.slice(0, k) };
}
