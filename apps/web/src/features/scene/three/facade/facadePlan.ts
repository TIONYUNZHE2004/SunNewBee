import { hash01 } from "../assets/fit";
import type { Manifest } from "../assets/manifest";
import { type FallbackColours, fallbackColours } from "../fallbackStyle";

/**
 * Procedural facade planning (pure): storeys, bays and window/shopfront quads for an extruded
 * building. Decorative only: the facade never changes a footprint or a height, and nothing here is
 * a fact about the real building (its card still says "(shown as a simple block)").
 */

/** Displayed height per storey. */
export const STOREY_M = 3.2;
/** Quads float this far out from the wall plane (no z-fighting with the extrusion). */
export const WALL_OFFSET_M = 0.05;
/** No quad within this distance of a wall's corner. */
export const CORNER_INSET_M = 0.6;
/** No quad within this distance of the top of the wall (the parapet band stays clear). */
export const TOP_CLEAR_M = 0.5;
/** No quad lower than this above the wall's base. */
export const BASE_CLEAR_M = 0.3;
/** A part whose base is above this is raised (podium tower, upper part): no ground floor. */
const GRADE_M = 0.5;
/** Quads shorter than this after clamping are dropped. */
const MIN_QUAD_H_M = 0.35;

export type WindowStyle = 0 | 1 | 2 | 3;
export type GroundFloor = "shop" | "plain" | "garage";

export interface FacadeSpec {
  buildingId: string;
  storeys: number;
  windowStyle: WindowStyle;
  bayM: number;
  groundFloor: GroundFloor;
  palette: FallbackColours;
}

/** storeys = max(1, round(displayHeightM / 3.2)). */
export function storeysFor(displayHeightM: number): number {
  if (!Number.isFinite(displayHeightM)) return 1;
  return Math.max(1, Math.round(displayHeightM / STOREY_M));
}

/** Window style choices per archetype (manifest names) and per OSM kind; picked by hash01(id). */
const STYLE_BY_ARCHETYPE: Record<string, WindowStyle[]> = {
  link_intermediate: [0, 2],
  link_long: [0, 2],
  superlink: [0, 2],
  semi_d: [0, 2],
  bungalow: [0],
  townhouse: [2, 0],
  shop_office: [1, 0],
  highrise: [3, 1],
  school: [1],
  mosque: [2],
  factory: [1],
  mall: [3],
};
const STYLE_BY_KIND: Record<string, WindowStyle[]> = {
  residential: [0, 2],
  commercial: [1, 3],
  retail: [1],
  office: [3, 1],
  industrial: [1],
  civic: [1, 2],
};
const DEFAULT_STYLES: WindowStyle[] = [0, 1, 2];

/** Base bay width by archetype group / kind; jittered by ±0.3 m per id and clamped to 3.0–4.5 m. */
const BAY_BY_KIND: Record<string, number> = {
  residential: 3.2,
  commercial: 3.8,
  retail: 3.8,
  office: 4.0,
  industrial: 4.5,
  civic: 3.8,
};
const ARCHETYPE_KIND: Record<string, string> = {
  link_intermediate: "residential",
  link_long: "residential",
  superlink: "residential",
  semi_d: "residential",
  bungalow: "residential",
  townhouse: "residential",
  highrise: "residential",
  shop_office: "commercial",
  mall: "retail",
  school: "civic",
  mosque: "civic",
  factory: "industrial",
};
const RESIDENTIAL_LOW = new Set([
  "link_intermediate",
  "link_long",
  "superlink",
  "semi_d",
  "bungalow",
  "townhouse",
]);

const pick = <T>(xs: readonly T[], u: number): T =>
  xs[Math.min(xs.length - 1, Math.floor(u * xs.length))]!;

/**
 * The facade spec of one building. Storeys come from the displayed height only; bayM 3.0–4.5 m by
 * kind; windowStyle and groundFloor by kind, archetype and hash01(id). Deterministic per id.
 */
export function facadeFor(
  b: { id: string; heightM: number; kind?: string; archetype?: string; precinct?: string },
  m: Manifest | null,
): FacadeSpec {
  const storeys = storeysFor(b.heightM);
  const arch = b.archetype ?? "";
  const kind = ARCHETYPE_KIND[arch] ?? b.kind ?? "";
  const tall = storeys >= 8;
  const styles: WindowStyle[] = tall
    ? [3, 1]
    : (STYLE_BY_ARCHETYPE[arch] ?? STYLE_BY_KIND[b.kind ?? ""] ?? DEFAULT_STYLES);
  const windowStyle = pick(styles, hash01(b.id, "facade:style"));

  const base = BAY_BY_KIND[kind] ?? 3.5;
  const bayM = Math.min(4.5, Math.max(3.0, base + (hash01(b.id, "facade:bay") - 0.5) * 0.6));

  const u = hash01(b.id, "facade:ground");
  let groundFloor: GroundFloor = "plain";
  if (arch === "shop_office" || arch === "mall" || kind === "commercial" || kind === "retail")
    groundFloor = "shop";
  else if (kind === "office") groundFloor = u < 0.5 ? "shop" : "plain";
  else if (kind === "industrial") groundFloor = "garage";
  else if (RESIDENTIAL_LOW.has(arch) || (kind === "residential" && !tall))
    groundFloor = u < 0.35 ? "garage" : "plain";

  const palette = fallbackColours(
    { id: b.id, kind: b.kind, archetype: b.archetype, precinct: b.precinct },
    m,
    m?.precinctGroups ?? [],
  );
  return { buildingId: b.id, storeys, windowStyle, bayM, groundFloor, palette };
}

/**
 * Window shape per style, as fractions: width of the bay, sill and height of the storey.
 * 0 punched, 1 wide strip, 2 tall narrow, 3 ribbon glazing.
 */
const STYLE_SHAPE: Record<WindowStyle, { w: number; sill: number; h: number }> = {
  0: { w: 0.42, sill: 0.32, h: 0.42 },
  1: { w: 0.7, sill: 0.34, h: 0.36 },
  2: { w: 0.3, sill: 0.2, h: 0.6 },
  3: { w: 0.88, sill: 0.15, h: 0.62 },
};
const SHOP_W = 0.88;
const SHOP_H_M = 3.0;

/** Ring without the closing point or consecutive duplicates; null if any coordinate is bad. */
function cleanRing(ring: ReadonlyArray<readonly [number, number]>): Array<[number, number]> | null {
  const out: Array<[number, number]> = [];
  for (const p of ring) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push([p[0], p[1]]);
  }
  const first = out[0];
  const end = out[out.length - 1];
  if (first && end && out.length > 1 && first[0] === end[0] && first[1] === end[1]) out.pop();
  return out.length >= 3 ? out : null;
}

/** Signed area in (east, north) with north = -z: positive means counter-clockwise from above. */
function signedArea(ring: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j]![0] * -ring[i]![1] - ring[i]![0] * -ring[j]![1];
  return a / 2;
}

/**
 * Column-major mat4 (three.js order) for a unit quad (x, y in [-0.5, 0.5], facing +z) scaled to
 * w x h, turned so its +z faces the outward normal (nx, nz), centred at (cx, cy, cz).
 */
function writeQuad(
  out: number[],
  cx: number,
  cy: number,
  cz: number,
  nx: number,
  nz: number,
  w: number,
  h: number,
) {
  // rotY(t) with sin t = nx, cos t = nz maps +z to (nx, 0, nz) and +x to (nz, 0, -nx).
  out.push(nz * w, 0, -nx * w, 0, 0, h, 0, 0, nx, 0, nz, 0, cx, cy, cz, 1);
}

/**
 * Window quads (offset 0.05 m out from each wall, inset 0.6 m from corners, none within 0.5 m of the
 * top or 0.3 m of the base) as one mat4 per window, plus ground-floor shopfront quads. Each wall of
 * length L gets floor((L - 1.2) / bayM) bays per storey. Rows never exceed what the wall height
 * allows. `ring` is the footprint in the local (x, z) frame, either winding. Pure.
 */
export function facadeInstances(
  ring: Array<[number, number]>,
  heightM: number,
  minHeightM: number,
  spec: FacadeSpec,
): { windows: Float32Array; shopfronts: Float32Array; count: number } {
  const empty = { windows: new Float32Array(0), shopfronts: new Float32Array(0), count: 0 };
  const pts = cleanRing(ring);
  const y0 = Number.isFinite(minHeightM) ? minHeightM : 0;
  const yTop = heightM - TOP_CLEAR_M;
  const yBot = y0 + BASE_CLEAR_M;
  if (!pts || !Number.isFinite(heightM) || yTop - yBot < MIN_QUAD_H_M) return empty;
  const bayM = spec.bayM > 0 ? spec.bayM : 3.5;
  const wallH = heightM - y0;
  const rows = Math.min(
    Math.max(1, Math.floor(spec.storeys)),
    Math.max(1, Math.round(wallH / STOREY_M)),
  );
  const sh = wallH / rows;
  const atGrade = y0 <= GRADE_M;
  const groundSpecial = atGrade && spec.groundFloor !== "plain";
  const shape = STYLE_SHAPE[spec.windowStyle] ?? STYLE_SHAPE[0];
  const flip = signedArea(pts) < 0 ? -1 : 1;

  const win: number[] = [];
  const shop: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.floor((len - 2 * CORNER_INSET_M) / bayM);
    if (!(n >= 1)) continue;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    // Counter-clockwise in (east, north): the outward side is to the right of the edge.
    const nx = -uz * flip;
    const nz = ux * flip;
    const bayW = (len - 2 * CORNER_INSET_M) / n;
    for (let k = 0; k < n; k++) {
      const t = CORNER_INSET_M + (k + 0.5) * bayW;
      const cx = ax + ux * t + nx * WALL_OFFSET_M;
      const cz = az + uz * t + nz * WALL_OFFSET_M;
      for (let r = 0; r < rows; r++) {
        const base = y0 + r * sh;
        if (r === 0 && groundSpecial) {
          if (spec.groundFloor === "shop") {
            const lo = yBot;
            const hi = Math.min(yTop, base + Math.min(SHOP_H_M, sh * 0.8));
            if (hi - lo >= MIN_QUAD_H_M)
              writeQuad(shop, cx, (lo + hi) / 2, cz, nx, nz, bayW * SHOP_W, hi - lo);
          }
          continue; // a garage ground floor stays a plain wall
        }
        const lo = Math.max(yBot, base + sh * shape.sill);
        const hi = Math.min(yTop, base + sh * (shape.sill + shape.h));
        if (hi - lo < MIN_QUAD_H_M) continue;
        writeQuad(win, cx, (lo + hi) / 2, cz, nx, nz, bayW * shape.w, hi - lo);
      }
    }
  }
  return {
    windows: new Float32Array(win),
    shopfronts: new Float32Array(shop),
    count: win.length / 16,
  };
}
