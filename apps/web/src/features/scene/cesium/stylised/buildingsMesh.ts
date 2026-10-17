import { type Building, COL_M, FLOOR_M, STYLE_LIST } from "./model";

/**
 * Pure mesh builder for the stylised buildings (no Cesium import, unit-tested).
 *
 * Why our own geometry instead of an extruded `PolygonGeometry`: in Cesium 1.146 the `st` of an
 * extruded polygon's walls is the planar projection of the footprint (top and bottom vertices
 * share the same st), so st carries no height and cannot place floors (spike, see task-5 report).
 * Here walls get metric texture coordinates instead:
 *   s = window columns along the perimeter (each wall a whole number of columns, so corners land
 *       on cell edges), offset by a per-building seed (< SEED_RANGE) and by
 *       `(tone * 3 + style) * TONE_STRIDE`, so one primitive can hold every class: the shader
 *       decodes the class from s. Within a class s stays below the next stride (a wall run that
 *       would cross it restarts at the seed, on a corner), and the largest s (18 * 1024) keeps
 *       float32 steps under 0.002 of a window cell;
 *   t = 0 at the base, 1 at the top of the (taller) ground floor, then one unit per upper floor.
 *       Flags: t = -1 roof and setback ledge, t = -2 parapet (outer band, cap and inner face).
 *
 * Shape per building: ground-floor band, upper floors (with one setback on tall convex towers),
 * a parapet lip above the roof line, and the roof inset behind the parapet. Round footprints get
 * smooth wall normals so they shade as cylinders rather than facets.
 */
export const TONE_STRIDE = 1024;
/** Per-building window seed range (added to s, below TONE_STRIDE). */
export const SEED_RANGE = 256;
export const GROUND_FLOOR_M = 4.2;
export const PARAPET_M = 0.6;
export const PARAPET_INSET_M = 0.3;
export const SETBACK_MIN_FLOORS = 9;
export const SETBACK_AT = 0.6;
export const SETBACK_SCALE = 0.82;
const SMOOTH_MIN_VERTS = 12;
const SMOOTH_MAX_EDGE_M = 4;
/** Within a smooth ring, a corner sharper than this (turn angle, ~40 deg) keeps its crease. */
const SMOOTH_MIN_COS = 0.76;
/** Inset miter limit (times the inset distance), so needle-sharp corners cannot spike. */
const MITER_MAX = 3;

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

/** Floors coordinate t at height h above the building base (the ground floor is taller). */
export const tAt = (h: number) =>
  h <= GROUND_FLOOR_M ? h / GROUND_FLOOR_M : 1 + (h - GROUND_FLOOR_M) / FLOOR_M;

export function isConvex(ring: [number, number][]): boolean {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]!;
    const [bx, by] = ring[(i + 1) % ring.length]!;
    const [cx, cy] = ring[(i + 2) % ring.length]!;
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(z) < 1e-18) continue;
    if (sign === 0) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

/**
 * Inset an open ring by m metres: every edge moves inward by m and each corner goes to the
 * intersection of its two moved edges (a miter, capped at MITER_MAX * m). Exact for convex and
 * concave corners alike; either winding.
 */
export function shrinkRing(ring: [number, number][], m: number): [number, number][] {
  const n = ring.length;
  if (n < 3) return ring.slice();
  const kx = Math.cos(ring[0]![1] * RAD) * M_PER_DEG;
  let area2 = 0;
  for (let i = 0, j = n - 1; i < n; j = i++)
    area2 += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  const side = area2 >= 0 ? 1 : -1; // inward is to the left of travel for counter-clockwise
  // Inward unit normal of edge i (ring[i] -> ring[i + 1]), in local metres.
  // A zero-length edge has no normal: it borrows its neighbour's (NaN marks it).
  const nx = new Float64Array(n).fill(Number.NaN);
  const ny = new Float64Array(n).fill(Number.NaN);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = (ring[j]![0] - ring[i]![0]) * kx;
    const dy = (ring[j]![1] - ring[i]![1]) * M_PER_DEG;
    const len = Math.hypot(dx, dy);
    if (len > 1e-9) {
      nx[i] = (-dy / len) * side;
      ny[i] = (dx / len) * side;
    }
  }
  const out: [number, number][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const pOk = !Number.isNaN(nx[p]!);
    const iOk = !Number.isNaN(nx[i]!);
    if (!pOk && !iOk) {
      out[i] = [ring[i]![0], ring[i]![1]];
      continue;
    }
    const ax = pOk ? nx[p]! : nx[i]!;
    const ay = pOk ? ny[p]! : ny[i]!;
    const bx = iOk ? nx[i]! : ax;
    const by = iOk ? ny[i]! : ay;
    const d = 1 + ax * bx + ay * by;
    let ox = 0;
    let oy = 0;
    if (d > 1e-9) {
      ox = (ax + bx) / d;
      oy = (ay + by) / d;
      const f = Math.hypot(ox, oy);
      if (f > MITER_MAX) {
        ox *= MITER_MAX / f;
        oy *= MITER_MAX / f;
      }
    }
    out[i] = [ring[i]![0] + (ox * m) / kx, ring[i]![1] + (oy * m) / M_PER_DEG];
  }
  return out;
}

/** Scale an open ring about its vertex centroid by k (an affine map, so triangulations carry). */
function scaleRing(ring: [number, number][], k: number): [number, number][] {
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p[0];
    cy += p[1];
  }
  cx /= ring.length;
  cy /= ring.length;
  return ring.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

const hasSetback = (ring: [number, number][], b: Building) =>
  b.floors >= SETBACK_MIN_FLOORS && ring.length <= 12 && isConvex(ring);

/**
 * Per building (n = ring vertices):
 *   walls: n quads per band. Bands: ground floor, upper floors (or lower + upper with a setback),
 *     plus an outer parapet band. That is 4 vertices and 6 indices per quad.
 *   setback ledge: one roof-flagged ring triangulation (n verts, (n-2)*3 idx).
 *   parapet inner face: n quads. Parapet cap: n quads (thin ring between outer and inner).
 *   roof: n verts, (n-2)*3 idx.
 */
export function meshBudget(ring: [number, number][], b: Building) {
  const n = ring.length;
  const setback = hasSetback(ring, b);
  const bands = (setback ? 3 : 2) + 1; // ground, upper(s), outer parapet
  const quads = n * bands + n /* parapet inner */ + n /* parapet cap */;
  const ledge = setback ? 1 : 0;
  return {
    vertices: quads * 4 + n * (1 + ledge),
    indices: quads * 6 + (n - 2) * 3 * (1 + ledge),
  };
}

/**
 * Per-vertex geodetic terms of a ring, so a vertex at any height is three multiply-adds:
 * [cos(lat)cos(lon), cos(lat)sin(lon), sin(lat), N] per vertex.
 */
function geoTerms(ring: [number, number][]): Float64Array {
  const g = new Float64Array(ring.length * 4);
  for (let i = 0; i < ring.length; i++) {
    const l = ring[i]![0] * RAD;
    const p = ring[i]![1] * RAD;
    const sp = Math.sin(p);
    const cp = Math.cos(p);
    g[i * 4] = cp * Math.cos(l);
    g[i * 4 + 1] = cp * Math.sin(l);
    g[i * 4 + 2] = sp;
    g[i * 4 + 3] = A / Math.sqrt(1 - E2 * sp * sp);
  }
  return g;
}

/**
 * Outward wall normals of a counter-clockwise ring, as local (east, north) pairs: `edge` per edge
 * (index i = edge i -> i+1) and `vert` per vertex (smoothed where the ring is round, else the
 * normal of the edge that starts there is used for both quad ends).
 */
function wallNormals(ring: [number, number][], kx: number) {
  const n = ring.length;
  const edge = new Float64Array(n * 2);
  let maxLen = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = (ring[j]![0] - ring[i]![0]) * kx;
    const dy = (ring[j]![1] - ring[i]![1]) * M_PER_DEG;
    const len = Math.hypot(dx, dy) || 1;
    edge[i * 2] = dy / len;
    edge[i * 2 + 1] = -dx / len;
    if (len > maxLen) maxLen = len;
  }
  if (n < SMOOTH_MIN_VERTS || maxLen > SMOOTH_MAX_EDGE_M) return { edge, vert: null };
  // Smooth vertex normal = normalised average of its two edge normals, unless the corner is sharp.
  const vert = new Float64Array(n * 2).fill(Number.NaN);
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const [ax, ay, bx, by] = [edge[p * 2]!, edge[p * 2 + 1]!, edge[i * 2]!, edge[i * 2 + 1]!];
    if (ax * bx + ay * by < SMOOTH_MIN_COS) continue; // crease: NaN = use the edge normal
    const sx = ax + bx;
    const sy = ay + by;
    const len = Math.hypot(sx, sy) || 1;
    vert[i * 2] = sx / len;
    vert[i * 2 + 1] = sy / len;
  }
  return { edge, vert };
}

export function buildMesh(buildings: Building[], triangulate: Triangulate): Mesh {
  const rings = buildings.map((b) => cleanRing(b.ring));
  let nv = 0;
  let ni = 0;
  buildings.forEach((b, bi) => {
    const r = rings[bi]!;
    if (r.length < 3) return;
    const want = meshBudget(r, b);
    nv += want.vertices;
    ni += want.indices;
  });
  const positions = new Float64Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const st = new Float32Array(nv * 2);
  const indices = new Uint32Array(ni);
  let v = 0;
  let k = 0;

  // Building-local state shared by the emitters below (set per building).
  let ex = 0;
  let ey = 0;
  let ez = 0;
  let nxx = 0;
  let nxy = 0;
  let nxz = 0;
  let ux = 0;
  let uy = 0;
  let uz = 0;
  let lo = 0;
  let s0 = 0;
  let sBase = 0;
  let kx = 0;

  /** Vertex i of ring terms g at height h with ECEF normal (x, y, z) and st. Returns its index. */
  const put = (
    g: Float64Array,
    i: number,
    h: number,
    x: number,
    y: number,
    z: number,
    s: number,
    t: number,
  ) => {
    const N = g[i * 4 + 3]!;
    const o = v * 3;
    positions[o] = (N + h) * g[i * 4]!;
    positions[o + 1] = (N + h) * g[i * 4 + 1]!;
    positions[o + 2] = (N * (1 - E2) + h) * g[i * 4 + 2]!;
    normals[o] = x;
    normals[o + 1] = y;
    normals[o + 2] = z;
    st[v * 2] = s;
    st[v * 2 + 1] = t;
    return v++;
  };
  /** Local (east, north) horizontal normal times dir, put as ECEF. */
  const putH = (
    g: Float64Array,
    i: number,
    h: number,
    oe: number,
    on: number,
    dir: number,
    s: number,
    t: number,
  ) =>
    put(
      g,
      i,
      h,
      dir * (oe * ex + on * nxx),
      dir * (oe * ey + on * nxy),
      dir * (oe * ez + on * nxz),
      s,
      t,
    );

  /**
   * One quad per edge of ring r (terms g, normals nm) from h0 to h1. dir = 1 faces outward;
   * dir = -1 faces inward (the parapet's inner face). tFlag replaces the floors coordinate.
   */
  const wallBand = (
    r: [number, number][],
    g: Float64Array,
    nm: ReturnType<typeof wallNormals>,
    h0: number,
    h1: number,
    dir: number,
    tFlag?: number,
  ) => {
    const n = r.length;
    const t0 = tFlag ?? tAt(h0 - lo);
    const t1 = tFlag ?? tAt(h1 - lo);
    const { edge, vert } = nm;
    let s = s0;
    const sEnd = sBase + TONE_STRIDE - 1; // s must stay inside this building's class
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ee = edge[i * 2]!;
      const en = edge[i * 2 + 1]!;
      const ie = vert && !Number.isNaN(vert[i * 2]!) ? vert[i * 2]! : ee;
      const inn = vert && !Number.isNaN(vert[i * 2]!) ? vert[i * 2 + 1]! : en;
      const je = vert && !Number.isNaN(vert[j * 2]!) ? vert[j * 2]! : ee;
      const jn = vert && !Number.isNaN(vert[j * 2]!) ? vert[j * 2 + 1]! : en;
      const dx = (r[j]![0] - r[i]![0]) * kx;
      const dy = (r[j]![1] - r[i]![1]) * M_PER_DEG;
      const cols = Math.min(
        TONE_STRIDE - SEED_RANGE - 1,
        Math.max(1, Math.round(Math.hypot(dx, dy) / COL_M)),
      );
      if (s + cols > sEnd) s = s0; // restart on this corner (whole columns, so cells still align)
      const b1 = putH(g, i, h0, ie, inn, dir, s, t0);
      const b2 = putH(g, j, h0, je, jn, dir, s + cols, t0);
      const u2 = putH(g, j, h1, je, jn, dir, s + cols, t1);
      const u1 = putH(g, i, h1, ie, inn, dir, s, t1);
      if (dir > 0) {
        indices[k] = b1;
        indices[k + 1] = b2;
        indices[k + 2] = u2;
        indices[k + 3] = b1;
        indices[k + 4] = u2;
        indices[k + 5] = u1;
      } else {
        indices[k] = b1;
        indices[k + 1] = u2;
        indices[k + 2] = b2;
        indices[k + 3] = b1;
        indices[k + 4] = u1;
        indices[k + 5] = u2;
      }
      k += 6;
      s += cols;
    }
  };

  /** A flat, up-facing, roof-flagged polygon from ring terms g at height h, using tris over xy. */
  const flat = (g: Float64Array, n: number, h: number, t: number, tris: number[], xy: number[]) => {
    const base = v;
    for (let i = 0; i < n; i++) put(g, i, h, ux, uy, uz, s0, t);
    const maxQ = Math.min(tris.length, (n - 2) * 3); // never overrun the allotment
    for (let q = 0; q + 2 < maxQ; q += 3) {
      const a = tris[q]!;
      const c = tris[q + 1]!;
      const d = tris[q + 2]!;
      const cross =
        (xy[c * 2]! - xy[a * 2]!) * (xy[d * 2 + 1]! - xy[a * 2 + 1]!) -
        (xy[c * 2 + 1]! - xy[a * 2 + 1]!) * (xy[d * 2]! - xy[a * 2]!);
      indices[k] = base + a;
      indices[k + 1] = base + (cross >= 0 ? c : d);
      indices[k + 2] = base + (cross >= 0 ? d : c);
      k += 3;
    }
  };

  buildings.forEach((b, bi) => {
    const ring = rings[bi]!;
    if (ring.length < 3) return;
    const n = ring.length;
    const [lon0, lat0] = ring[0]!;
    const { east, north, up } = enuBasis(lon0, lat0);
    [ex, ey, ez] = east;
    [nxx, nxy, nxz] = north;
    [ux, uy, uz] = up;
    kx = Math.cos(lat0 * RAD) * M_PER_DEG;
    lo = b.minHeight;
    const top = b.height;
    const gf = Math.min(top, lo + GROUND_FLOOR_M);
    const cls = Number(b.tone.slice(1)) * 3 + STYLE_LIST.indexOf(b.style);
    sBase = cls * TONE_STRIDE;
    s0 = sBase + Math.min(SEED_RANGE - 1, Math.floor(b.litSeed * SEED_RANGE));

    // One triangulation of the footprint serves the ledge and the roof: the setback ring is an
    // affine copy and the roof ring a small parallel inset, so the same topology stays valid.
    const xy: number[] = [];
    for (const [x, y] of ring) xy.push((x - lon0) * kx, (y - lat0) * M_PER_DEG);
    const tris = triangulate(xy);

    const outer = ring;
    const gOuter = geoTerms(outer);
    const nOuter = wallNormals(outer, kx);
    const setback = hasSetback(ring, b);
    const upperRing = setback ? scaleRing(ring, SETBACK_SCALE) : outer;
    const gUpper = setback ? geoTerms(upperRing) : gOuter;
    const nUpper = setback ? wallNormals(upperRing, kx) : nOuter;

    wallBand(outer, gOuter, nOuter, lo, gf, 1);
    if (setback) {
      const sb = lo + (top - lo) * SETBACK_AT;
      wallBand(outer, gOuter, nOuter, gf, sb, 1);
      flat(gOuter, n, sb, -1, tris, xy);
      wallBand(upperRing, gUpper, nUpper, sb, top, 1);
    } else {
      wallBand(outer, gOuter, nOuter, gf, top, 1);
    }

    // Parapet: outer band above the roof line, inner face looking in, and a cap joining them.
    const capH = top + PARAPET_M;
    const inner = shrinkRing(upperRing, PARAPET_INSET_M);
    const gInner = geoTerms(inner);
    wallBand(upperRing, gUpper, nUpper, top, capH, 1, -2);
    wallBand(inner, gInner, nUpper, top, capH, -1, -2);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const oi = put(gUpper, i, capH, ux, uy, uz, s0, -2);
      const oj = put(gUpper, j, capH, ux, uy, uz, s0, -2);
      const ij = put(gInner, j, capH, ux, uy, uz, s0, -2);
      const ii = put(gInner, i, capH, ux, uy, uz, s0, -2);
      indices[k] = oi;
      indices[k + 1] = oj;
      indices[k + 2] = ij;
      indices[k + 3] = oi;
      indices[k + 4] = ij;
      indices[k + 5] = ii;
      k += 6;
    }

    // Roof at the top, behind the parapet.
    flat(gInner, n, top, -1, tris, xy);
  });
  return { positions, normals, st, indices: k === indices.length ? indices : indices.slice(0, k) };
}
