import * as THREE from "three";
import type { BuildingsLayer } from "../../../lib/api";
import { type LonLat, waterPolygons } from "../geo";
import { type HeightOf, toBuildings } from "../shared/model";
import type { Tier } from "../shared/quality";
import type { FallbackColours } from "./fallbackStyle";
import type { LocalFrame } from "./frame";
import { PARK_Y, WATER_Y } from "./ground/bands";
import { CLAY_PALETTE } from "./shared/clayTokens";

export { PARK_Y, WATER_Y };
/** Height of the trim (parapet) band at the top of a styled fallback building. */
export const PARAPET_M = 0.6;
const GROUND_MARGIN_M = 500;

/** Display-only tints per OSM building kind. Illustrative, not facts about the buildings. */
export const KIND_COLOUR: Record<string, string> = { ...CLAY_PALETTE.kindWall };
const PARK_COLOUR = CLAY_PALETTE.park;
/** Decorative base water. Deliberately not the flood scenario WATER_COLOR. */
export const BASE_WATER_COLOUR: string = CLAY_PALETTE.baseWater;

/** This overhaul's renderer may draw the Google-sampled display height (data/README.md). */
export const displayHeight: HeightOf = (p) => p.display_height_m ?? p.height_m;

export interface CityGeometry {
  buildings: THREE.BufferGeometry;
  parks: THREE.BufferGeometry;
  water: THREE.BufferGeometry;
  ground: { center: [number, number]; size: [number, number] };
  bounds: THREE.Box3;
  skipped: number;
  /** Which building each `buildings` triangle belongs to (see `faceBuildingId`). */
  faces: FaceTable;
  /** The extruded buildings actually drawn, in `faces` order: the facade layer's input. */
  footprints: Footprint[];
}

/** A drawn extrusion: its local `[x, z]` ring (counter-clockwise from above), display height and base. */
export interface Footprint {
  id: string;
  kind: string;
  ring: Pt[];
  heightM: number;
  minHeightM: number;
}

/** Building ids in triangle order: building i owns triangles starts[i] .. starts[i + 1] - 1. */
export interface FaceTable {
  ids: string[];
  starts: number[];
}

/** The building id of a triangle (a raycast's `faceIndex`) through a FaceTable, else null. */
export function faceBuildingId(
  table: unknown,
  faceIndex: number | null | undefined,
): string | null {
  const t = table as FaceTable | undefined;
  if (!t || !Array.isArray(t.starts) || faceIndex == null || faceIndex < 0) return null;
  let lo = 0;
  let hi = t.starts.length - 1;
  if (hi < 0 || faceIndex < (t.starts[0] as number)) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((t.starts[mid] as number) <= faceIndex) lo = mid;
    else hi = mid - 1;
  }
  return t.ids[lo] ?? null;
}

type Pt = [number, number];

/** Accumulates non-indexed triangles as position / normal / color. */
class Mesh {
  pos: number[] = [];
  get triangles() {
    return this.pos.length / 9;
  }
  nor: number[] = [];
  col: number[] = [];

  tri(a: number[], b: number[], c: number[], n: number[], rgb: number[]) {
    this.triN(a, b, c, n, n, n, rgb);
  }

  /** A triangle with one normal per corner (smooth shading across bevels and softened corners). */
  triN(
    a: number[],
    b: number[],
    c: number[],
    na: number[],
    nb: number[],
    nc: number[],
    rgb: number[],
  ) {
    for (const [p, n] of [
      [a, na],
      [b, nb],
      [c, nc],
    ] as const) {
      this.pos.push(p[0]!, p[1]!, p[2]!);
      this.nor.push(n[0]!, n[1]!, n[2]!);
      this.col.push(rgb[0]!, rgb[1]!, rgb[2]!);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

const rgbOf = (hex: string) => new THREE.Color(hex).toArray();

/** Signed area in (east, north) with north = −z: positive means counter-clockwise from above. */
function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j]![0] * -ring[i]![1] - ring[i]![0] * -ring[j]![1];
  }
  return a / 2;
}

/** Local ring without the closing point or consecutive duplicates; null if any coordinate is bad. */
export function localRing(ring: readonly LonLat[], frame: LocalFrame): Pt[] | null {
  const out: Pt[] = [];
  for (const p of ring) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    const q = frame.toLocal(p[0], p[1]);
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  const first = out[0];
  const end = out[out.length - 1];
  if (first && end && out.length > 1 && first[0] === end[0] && first[1] === end[1]) out.pop();
  return out;
}

/**
 * Triangles (index triples into contour ++ holes) facing +y, or null when the ring cannot be
 * triangulated faithfully (degenerate, or the triangles do not add up to the polygon area).
 */
export function triangulate(contour: Pt[], holes: Pt[][]): [number, number, number][] | null {
  if (contour.length < 3) return null;
  const v2 = (r: Pt[]) => r.map((p) => new THREE.Vector2(p[0], p[1]));
  const idx = THREE.ShapeUtils.triangulateShape(v2(contour), holes.map(v2));
  if (idx.length === 0) return null;
  const all = [...contour, ...holes.flat()];
  const out: [number, number, number][] = [];
  let area = 0;
  for (const [i, j, k] of idx as [number, number, number][]) {
    const a = all[i]!;
    const b = all[j]!;
    const c = all[k]!;
    const cross = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    area += Math.abs(cross) / 2;
    out.push(cross >= 0 ? [i, j, k] : [i, k, j]);
  }
  const expected =
    Math.abs(signedArea(contour)) - holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
  if (!(expected > 1e-6) || Math.abs(area - expected) > expected * 0.01) return null;
  return out;
}

function addFlat(mesh: Mesh, rings: Pt[][], y: number, rgb: number[]) {
  const [contour, ...holes] = rings;
  if (!contour) return;
  const tris = triangulate(contour, holes);
  if (!tris) return;
  const all = [...contour, ...holes.flat()];
  const p = (n: number) => [all[n]![0], y, all[n]![1]];
  for (const [i, j, k] of tris) mesh.tri(p(i), p(j), p(k), [0, 1, 0], rgb);
}

/** The plain box (pre-B-T2): roof cap, one wall quad per edge, and a trim band when styled. */
function addFlatBox(
  mesh: Mesh,
  ring: Pt[],
  tris: [number, number, number][],
  y0: number,
  y1: number,
  rgb: number[],
  roofRgb: number[],
  trimRgb: number[],
  styled: boolean,
) {
  // The band never takes more than half of a low wall.
  const yb = styled ? y1 - Math.min(PARAPET_M, (y1 - y0) / 2) : y1;
  const roof = (n: number) => [ring[n]![0], y1, ring[n]![1]];
  for (const [i, j, k] of tris) mesh.tri(roof(i), roof(j), roof(k), [0, 1, 0], roofRgb);
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]!;
    const [bx, bz] = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len === 0) continue;
    // Counter-clockwise in (east, north): the outward side is to the right of the edge.
    const n = [-(bz - az) / len, 0, (bx - ax) / len];
    mesh.tri([ax, y0, az], [bx, y0, bz], [bx, yb, bz], n, rgb);
    mesh.tri([ax, y0, az], [bx, yb, bz], [ax, yb, az], n, rgb);
    if (yb < y1) {
      mesh.tri([ax, yb, az], [bx, yb, bz], [bx, y1, bz], n, trimRgb);
      mesh.tri([ax, yb, az], [bx, y1, bz], [ax, y1, az], n, trimRgb);
    }
  }
}

/**
 * Rounded edges for the footprint extrusions (B-T2, AC-B3), kept to the facts (AC-B2):
 * - the top edge is a quarter-round of `radiusM` in `segments` steps, cut INTO the body (the
 *   prototype's negative `bevelOffset`): the walls stay on the outline and the roof keeps
 *   `display_height_m`; the flat roof cap is the outline inset by the radius;
 * - convex corners turning by `minTurnDeg` or more get a `chamferM` cut with smooth normals across
 *   it, so they shade round (the cut moves with its corner's miter up the bevel); the cut point stays within `chamferM` of the OSM corner, and the area it
 *   removes is under 1 % even for a 1 m box (the cut is at most a tenth of either edge);
 * - gentler vertices (curved outlines) share one averaged normal, so they shade smooth.
 * The radius shrinks for low or thin buildings (a quarter of the height, 0.4 x 2A/P) and halves
 * until the inset cap is a clean polygon; a building whose cap cannot be made clean stays a box.
 */
export interface BevelOptions {
  radiusM: number;
  segments: number;
  chamferM: number;
  minTurnDeg: number;
}

/**
 * `chamferM` must stay under 0.15 m: the corner cut is the only drawn change to the OSM outline,
 * and AC-B2 allows every OSM vertex at most 0.15 m from a drawn vertex (`cityMesh.fidelity.test.ts`).
 */
export const BUILDING_BEVEL: BevelOptions = {
  radiusM: 0.5,
  segments: 2,
  chamferM: 0.14,
  minTurnDeg: 30,
};

/**
 * The bevel per quality tier (B-T2 fix round 1): Low draws the plain box (its triangle budget is the
 * tightest), Medium a single 45° segment, High the full two-segment quarter-round.
 */
export const BEVEL_BY_TIER: Record<Tier, false | Partial<BevelOptions>> = {
  low: false,
  medium: { segments: 1 },
  high: { segments: 2 },
};

/** The `bevel` option of `buildCityGeometry` for a tier. */
export const bevelForTier = (tier: Tier): false | Partial<BevelOptions> => BEVEL_BY_TIER[tier];

/** The smallest radius still drawn as a bevel; below it the building stays a box. */
const MIN_BEVEL_M = 0.05;
const MAX_MITER = 3;

export interface BevelBody {
  /** The wall ring (the outline with its convex corners cut), counter-clockwise from above. */
  wall: Pt[];
  /** Per wall-ring vertex k: the horizontal normal the edge leaving k uses at k, and at k + 1. */
  nStart: Pt[];
  nEnd: Pt[];
  /** Per wall-ring vertex: the inward miter (offset per metre of inset). */
  miter: Pt[];
  radius: number;
  segments: number;
  /** The roof cap (the wall ring inset by `radius`) and its triangles. */
  cap: Pt[];
  capTris: [number, number, number][];
}

const unit = (x: number, z: number): Pt => {
  const l = Math.hypot(x, z);
  return l > 0 ? [x / l, z / l] : [0, 0];
};

/** The bevelled body of a counter-clockwise local ring, or null to keep the plain box. Pure. */
export function bevelBody(ring: Pt[], heightM: number, o: BevelOptions): BevelBody | null {
  const n = ring.length;
  if (n < 3 || !(heightM > 0) || !(o.radiusM > 0)) return null;
  const dir = (a: Pt, b: Pt) => unit(b[0] - a[0], b[1] - a[1]);
  const out = (d: Pt): Pt => [-d[1], d[0]];
  const cosMin = Math.cos((o.minTurnDeg * Math.PI) / 180);

  // 1. The wall ring: convex corners cut by a small chamfer.
  const wall: Pt[] = [];
  const chamferStart: boolean[] = [];
  const gentle: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const p = ring[i]!;
    const a = ring[(i + n - 1) % n]!;
    const b = ring[(i + 1) % n]!;
    const d1 = dir(a, p);
    const d2 = dir(p, b);
    const n1 = out(d1);
    const turnCos = d1[0] * d2[0] + d1[1] * d2[1];
    const convex = d2[0] * n1[0] + d2[1] * n1[1] < 0;
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]);
    const l2 = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const c = Math.min(o.chamferM, 0.1 * l1, 0.1 * l2);
    if (convex && turnCos <= cosMin && c > 1e-3) {
      wall.push([p[0] - c * d1[0], p[1] - c * d1[1]], [p[0] + c * d2[0], p[1] + c * d2[1]]);
      chamferStart.push(true, false);
      gentle.push(false, false);
    } else {
      wall.push(p);
      chamferStart.push(false);
      gentle.push(turnCos > cosMin);
    }
  }
  const m = wall.length;
  const edgeN: Pt[] = wall.map((p, k) => out(dir(p, wall[(k + 1) % m]!)));
  const prev = (k: number) => (k + m - 1) % m;
  // The horizontal normal edge e uses at its end vertex v (v = e or e + 1).
  const vn = (e: number, v: number): Pt => {
    const other = v === e ? prev(v) : v; // the vertex's other incident edge
    if (chamferStart[e]) return edgeN[other]!;
    if (chamferStart[other]) return edgeN[e]!;
    if (gentle[v]) {
      const s = edgeN[prev(v)]!;
      const t = edgeN[v]!;
      return unit(s[0] + t[0], s[1] + t[1]);
    }
    return edgeN[e]!;
  };
  const nStart = wall.map((_p, k) => vn(k, k));
  const nEnd = wall.map((_p, k) => vn(k, (k + 1) % m));
  // Inward miters. A chamfer's two points move with their OSM corner's miter, so the cut keeps its
  // size at every inset and never flips (the inset cap stays a clean polygon at the full radius).
  const miter: Pt[] = wall.map((_p, k) => {
    const s = chamferStart[prev(k)] ? edgeN[prev(prev(k))]! : edgeN[prev(k)]!;
    const t = chamferStart[k] ? edgeN[(k + 1) % m]! : edgeN[k]!;
    const den = 1 + s[0] * t[0] + s[1] * t[1];
    let mx = den > 1e-6 ? (s[0] + t[0]) / den : t[0];
    let mz = den > 1e-6 ? (s[1] + t[1]) / den : t[1];
    const len = Math.hypot(mx, mz);
    if (len > MAX_MITER) {
      mx *= MAX_MITER / len;
      mz *= MAX_MITER / len;
    }
    return [mx, mz];
  });

  // 2. The radius: capped by the height and the footprint's thickness, halved until the cap is clean.
  let area = 0;
  let perim = 0;
  for (let k = 0; k < m; k++) {
    const a = wall[k]!;
    const b = wall[(k + 1) % m]!;
    area += a[0] * b[1] - b[0] * a[1];
    perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  area = Math.abs(area) / 2;
  let r = Math.min(o.radiusM, heightM / 4, perim > 0 ? (0.8 * area) / perim : 0);
  for (let attempt = 0; attempt < 4 && r >= MIN_BEVEL_M; attempt++, r /= 2) {
    const cap = insetRing(wall, miter, r);
    let flipped = false;
    for (let k = 0; k < m && !flipped; k++) {
      const a = wall[k]!;
      const b = wall[(k + 1) % m]!;
      const p = cap[k]!;
      const q = cap[(k + 1) % m]!;
      if ((b[0] - a[0]) * (q[0] - p[0]) + (b[1] - a[1]) * (q[1] - p[1]) <= 0) flipped = true;
    }
    if (flipped) continue;
    const capTris = triangulate(cap, []);
    if (!capTris) continue;
    return {
      wall,
      nStart,
      nEnd,
      miter,
      radius: r,
      segments: Math.max(1, o.segments),
      cap,
      capTris,
    };
  }
  return null;
}

function insetRing(wall: Pt[], miter: Pt[], d: number): Pt[] {
  return wall.map((p, k) => [p[0] - d * miter[k]![0], p[1] - d * miter[k]![1]]);
}

function addBevelled(
  mesh: Mesh,
  body: BevelBody,
  y0: number,
  y1: number,
  rgb: number[],
  roofRgb: number[],
  trimRgb: number[],
  styled: boolean,
) {
  const { wall, nStart, nEnd, miter, radius: r, segments: s, cap, capTris } = body;
  const m = wall.length;
  const yw = y1 - r; // top of the straight wall, where the quarter-round starts
  const yb = styled ? Math.min(yw, y1 - Math.min(PARAPET_M, (y1 - y0) / 2)) : yw;
  const up = [0, 1, 0];
  for (const [i, j, k] of capTris) {
    const p = (n: number) => [cap[n]![0], y1, cap[n]![1]];
    mesh.tri(p(i), p(j), p(k), up, roofRgb);
  }
  // Ring k of the profile: inset r(1 - cos t), height yw + r sin t, normal cos t (out) + sin t (up).
  const rings: { pts: Pt[]; y: number; c: number; sn: number }[] = [];
  for (let q = 0; q <= s; q++) {
    const t = ((Math.PI / 2) * q) / s;
    rings.push({
      pts: q === 0 ? wall : q === s ? cap : insetRing(wall, miter, r * (1 - Math.cos(t))),
      y: q === s ? y1 : yw + r * Math.sin(t),
      c: Math.cos(t),
      sn: q === s ? 1 : Math.sin(t),
    });
  }
  for (let k = 0; k < m; k++) {
    const k1 = (k + 1) % m;
    const [ax, az] = wall[k]!;
    const [bx, bz] = wall[k1]!;
    const na = [nStart[k]![0], 0, nStart[k]![1]];
    const nb = [nEnd[k]![0], 0, nEnd[k]![1]];
    const quad = (ya: number, yz: number, colour: number[]) => {
      mesh.triN([ax, ya, az], [bx, ya, bz], [bx, yz, bz], na, nb, nb, colour);
      mesh.triN([ax, ya, az], [bx, yz, bz], [ax, yz, az], na, nb, na, colour);
    };
    quad(y0, yb, rgb);
    if (yb < yw) quad(yb, yw, trimRgb);
    for (let q = 0; q < s; q++) {
      const lo = rings[q]!;
      const hi = rings[q + 1]!;
      const nrm = (h: Pt, g: { c: number; sn: number }) => {
        const v = [h[0] * g.c, g.sn, h[1] * g.c];
        const l = Math.hypot(v[0]!, v[1]!, v[2]!);
        return [v[0]! / l, v[1]! / l, v[2]! / l];
      };
      const la = [lo.pts[k]![0], lo.y, lo.pts[k]![1]];
      const lb = [lo.pts[k1]![0], lo.y, lo.pts[k1]![1]];
      const ha = [hi.pts[k]![0], hi.y, hi.pts[k]![1]];
      const hb = [hi.pts[k1]![0], hi.y, hi.pts[k1]![1]];
      const nla = nrm(nStart[k]!, lo);
      const nlb = nrm(nEnd[k]!, lo);
      const nha = nrm(nStart[k]!, hi);
      const nhb = nrm(nEnd[k]!, hi);
      mesh.triN(la, lb, hb, nla, nlb, nhb, trimRgb);
      mesh.triN(la, hb, ha, nla, nhb, nha, trimRgb);
    }
  }
}

/** [outer, ...holes] ring sets of a flat layer's Polygon and MultiPolygon features, in lon/lat. */
function flatPolygons(fc: unknown): LonLat[][][] {
  const feats = (fc as { features?: unknown } | null | undefined)?.features;
  if (!Array.isArray(feats)) return [];
  const out: LonLat[][][] = [];
  for (const f of feats) {
    const g = (f as { geometry?: { type?: string; coordinates?: unknown } } | null)?.geometry;
    if (g?.type === "Polygon" && Array.isArray(g.coordinates))
      out.push(g.coordinates as LonLat[][]);
    else if (g?.type === "MultiPolygon" && Array.isArray(g.coordinates))
      out.push(...(g.coordinates as LonLat[][][]));
  }
  return out;
}

function buildFlat(
  polys: LonLat[][][],
  frame: LocalFrame,
  y: number,
  hex: string,
): THREE.BufferGeometry {
  const mesh = new Mesh();
  const rgb = rgbOf(hex);
  for (const rings of polys) {
    const local = rings.map((r) => localRing(r, frame));
    if (local.some((r) => !r)) continue;
    addFlat(mesh, local as Pt[][], y, rgb);
  }
  return mesh.geometry();
}

/**
 * Merged display geometry for the stylised city: one non-indexed geometry each for buildings,
 * parks and base water. Display only; routing, flood and answers never read it.
 * `toBuildings` already drops MultiPolygons, rings with fewer than 3 distinct points and
 * non-finite coordinates; footprints the mesher still cannot use are skipped here and counted.
 * `footprints` lists every drawn building (local ring, display height, base) for the facade layer.
 * `only`: extrude just these building ids (the rest are drawn as instanced archetypes).
 * `colours`: styled fallback (walls, roof cap, a PARAPET_M trim band); `roofTint` may recolour
 * the roof cap of a styled building (large flat roofs). Each ring edge then adds
 * one wall quad, so a flat box (`bevel: false`) has 6 + 12 * edges vertices (30 + 6 * edges
 * without it). Without `colours` the display-only KIND_COLOUR tan stays (no manifest).
 * By default every building is bevelled (`bevelBody`): rounded top edge, softened convex corners,
 * footprint, outline and top kept to AC-B2 (`cityMesh.fidelity.test.ts`).
 */
export function buildCityGeometry(
  layer: BuildingsLayer | null | undefined,
  frame: LocalFrame,
  opts: {
    only?: ReadonlySet<string>;
    colours?: (b: { id: string; kind: string }) => FallbackColours;
    /**
     * Styled roofs only: a roof cap colour from the local ring and the palette roof, or null to
     * keep the palette roof (`largeRoofTint`: large flat roofs are not flat grey).
     */
    roofTint?: (id: string, ring: Pt[], paletteRoof: string) => string | null;
    /**
     * Rounded edges (B-T2, AC-B3): on by default with `BUILDING_BEVEL`; `false` draws the plain box
     * (the pre-B-T2 contract: 30 + 6 * edges vertices, or 6 + 12 * edges styled).
     */
    bevel?: false | Partial<BevelOptions>;
  } = {},
): CityGeometry {
  const { only, colours, roofTint } = opts;
  const bevelOpts: BevelOptions | null =
    opts.bevel === false ? null : { ...BUILDING_BEVEL, ...(opts.bevel ?? {}) };
  const { buildings, skipped: dropped } = toBuildings(layer?.buildings, displayHeight);
  let skipped = dropped;
  const mesh = new Mesh();
  const faces: FaceTable = { ids: [], starts: [] };
  const footprints: Footprint[] = [];

  for (const b of buildings) {
    if (only && !only.has(b.id)) continue;
    let ring = localRing(b.ring, frame);
    if (ring && signedArea(ring) < 0) ring = ring.reverse();
    const tris = ring ? triangulate(ring, []) : null;
    if (!ring || !tris) {
      skipped++;
      continue;
    }
    faces.ids.push(b.id);
    faces.starts.push(mesh.triangles);
    footprints.push({ id: b.id, kind: b.kind, ring, heightM: b.height, minHeightM: b.minHeight });
    const styled = colours?.(b);
    const rgb = rgbOf(styled?.wall ?? KIND_COLOUR[b.kind] ?? KIND_COLOUR.building!);
    const roofRgb = styled ? rgbOf(roofTint?.(b.id, ring, styled.roof) ?? styled.roof) : rgb;
    const trimRgb = styled ? rgbOf(styled.trim) : rgb;
    const body = bevelOpts ? bevelBody(ring, b.height - b.minHeight, bevelOpts) : null;
    if (body) addBevelled(mesh, body, b.minHeight, b.height, rgb, roofRgb, trimRgb, !!styled);
    else addFlatBox(mesh, ring, tris, b.minHeight, b.height, rgb, roofRgb, trimRgb, !!styled);
  }

  const buildingsGeo = mesh.geometry();
  const parks = buildFlat(flatPolygons(layer?.parks), frame, PARK_Y, PARK_COLOUR);
  const water = buildFlat(
    waterPolygons(layer?.water).map((w) => w.rings),
    frame,
    WATER_Y,
    BASE_WATER_COLOUR,
  );

  const bounds = new THREE.Box3();
  for (const g of [buildingsGeo, parks, water]) {
    g.computeBoundingBox();
    if (g.boundingBox && !g.boundingBox.isEmpty()) bounds.union(g.boundingBox);
  }
  const bb = buildingsGeo.boundingBox;
  const base = bb && !bb.isEmpty() ? bb : bounds;
  const ground: CityGeometry["ground"] = base.isEmpty()
    ? { center: [0, 0], size: [2 * GROUND_MARGIN_M, 2 * GROUND_MARGIN_M] }
    : {
        center: [(base.min.x + base.max.x) / 2, (base.min.z + base.max.z) / 2],
        size: [
          base.max.x - base.min.x + 2 * GROUND_MARGIN_M,
          base.max.z - base.min.z + 2 * GROUND_MARGIN_M,
        ],
      };
  return { buildings: buildingsGeo, parks, water, ground, bounds, skipped, faces, footprints };
}
