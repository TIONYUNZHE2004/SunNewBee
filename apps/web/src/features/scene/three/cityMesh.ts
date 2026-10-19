import * as THREE from "three";
import type { BuildingsLayer } from "../../../lib/api";
import { type LonLat, waterPolygons } from "../geo";
import { type HeightOf, toBuildings } from "../shared/model";
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
    for (const p of [a, b, c]) {
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
 * one wall quad, so a building has 6 + 12 * edges vertices (30 + 6 * edges without it). Without
 * `colours` the display-only KIND_COLOUR tan stays (no manifest).
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
  } = {},
): CityGeometry {
  const { only, colours, roofTint } = opts;
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
    const y0 = b.minHeight;
    const y1 = b.height;
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
