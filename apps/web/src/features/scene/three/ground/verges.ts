import { ROAD_WIDTH_UNKNOWN, WIDTH_BY_TYPE } from "../../shared/roads";
import { hash01, type Placement } from "../assets/fit";
import type { LocalFrame } from "../frame";
import { inBox, perLayer, touchesBox } from "../stream/area";
import type { Tile } from "../stream/tiles";
import { VERGE_Y } from "./bands";

/**
 * Grass verges and shrub rows beside street, residential and service roads, for one streaming
 * tile. Pure and DECORATIVE: nothing here is a fact about the township, and routing never reads it.
 *
 * Determinism and tiling: every piece and every shrub is keyed by global ids (walk feature index,
 * side, arc position along the whole line), and belongs to the tile whose half-open box holds its
 * midpoint or position. Two adjacent tiles therefore never both place one, and a tile's output
 * depends only on the data and its own box.
 */

type P = [number, number];
type Ring = P[];

/** Verges run from the kerb (half the 6 m street width) out to 1.5 m beyond it. */
export const VERGE_INNER_M = 3;
export const VERGE_OUTER_M = 4.5;
/** Length of one strip piece along the road (m). */
const PIECE_M = 2;
/** Shrub row spacing, jitter along the row, and lateral jitter across the verge (m). */
export const SHRUB_SPACING_M = 4;
export const SHRUB_JITTER_M = 0.5;
const SHRUB_LATERAL_M = 0.15;
/** A building footprint closer than this to the kerb is a driveway: no shrubs there. */
export const DRIVEWAY_GAP_M = 3;
/** Shrubs keep this far clear of a footprint edge and of any ribbon edge. */
const SHRUB_CLEAR_M = 0.6;
const RIBBON_CLEAR_M = 0.3;
/** Share of shrubs that are hedge pieces (the rest are round bushes). */
const HEDGE_SHARE = 0.3;
const VERGE_TYPES = new Set(["street", "residential", "service"]);
/** The kit's own default palette (manifest `trees.palettes.default`); 9b may repaint per precinct. */
const SHRUB_PALETTE: [string, string, string] = ["#d8d6d0", "#3d4147", "#8a8f96"];
/** Spatial grid cell (m) for the ribbon and footprint lookups (each query reads one cell). */
const GRID_M = 16;
/** The widest ribbon query margin (`RIBBON_CLEAR_M`) and footprint query distance (`DRIVEWAY_GAP_M`). */
const SEG_PAD_M = 0.3;
const FOOT_PAD_M = 3;

interface Line {
  idx: number;
  pts: P[];
  type: string;
  width: number;
  /** Cumulative arc length at each vertex. */
  cum: number[];
  bb: [number, number, number, number];
}
interface Footprint {
  ring: Ring;
  bb: [number, number, number, number];
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const toLocal = (c: unknown, frame: LocalFrame): P | null =>
  Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])
    ? frame.toLocal(c[0] as number, c[1] as number)
    : null;

function boundsOf(pts: P[]): [number, number, number, number] {
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
  return [x0, z0, x1, z1];
}

const featuresOf = (fc: unknown): unknown[] =>
  isRec(fc) && Array.isArray(fc.features) ? fc.features : [];

const linesCache = new WeakMap<object, WeakMap<object, Line[]>>();
const footCache = new WeakMap<object, WeakMap<object, Footprint[]>>();
const segGridCache = new WeakMap<object, WeakMap<object, Grid<Seg>>>();
const footGridCache = new WeakMap<object, WeakMap<object, Grid<Footprint>>>();

interface Seg {
  a: P;
  b: P;
  half: number;
}
/** Items by grid cell; an item sits in every cell its padded bounds touch, so a point query reads one cell. */
type Grid<T> = Map<number, T[]>;
const cellOf = (v: number) => Math.floor(v / GRID_M);
const cellKey = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);
function gridAdd<T>(g: Grid<T>, item: T, x0: number, z0: number, x1: number, z1: number): void {
  for (let i = cellOf(x0); i <= cellOf(x1); i++)
    for (let j = cellOf(z0); j <= cellOf(z1); j++) {
      const k = cellKey(i, j);
      const l = g.get(k);
      if (l) l.push(item);
      else g.set(k, [item]);
    }
}
const NO_ITEMS: never[] = [];
const gridAt = <T>(g: Grid<T>, x: number, z: number): T[] =>
  g.get(cellKey(cellOf(x), cellOf(z))) ?? NO_ITEMS;

/** Every walk LineString in local metres (all are drawn ribbons), with its feature index. */
const linesOf = (walk: unknown, frame: LocalFrame): Line[] =>
  perLayer(linesCache, walk, frame, () => {
    const out: Line[] = [];
    featuresOf(walk).forEach((f, idx) => {
      const g = isRec(f) && isRec(f.geometry) ? f.geometry : null;
      if (!g || g.type !== "LineString" || !Array.isArray(g.coordinates)) return;
      const pts: P[] = [];
      for (const c of g.coordinates) {
        const q = toLocal(c, frame);
        if (!q) return;
        const last = pts[pts.length - 1];
        if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q);
      }
      if (pts.length < 2) return;
      const props = isRec((f as Record<string, unknown>).properties)
        ? ((f as Record<string, unknown>).properties as Record<string, unknown>)
        : {};
      const type = typeof props.type === "string" ? props.type : "";
      const cum = [0];
      for (let i = 1; i < pts.length; i++)
        cum.push(
          cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]),
        );
      out.push({
        idx,
        pts,
        type,
        width: WIDTH_BY_TYPE[type] ?? ROAD_WIDTH_UNKNOWN,
        cum,
        bb: boundsOf(pts),
      });
    });
    return out;
  });

/** Outer rings of every building polygon (a hole is a courtyard; the outer ring is what to keep clear of). */
const footprintsOf = (buildings: unknown, frame: LocalFrame): Footprint[] =>
  perLayer(footCache, buildings, frame, () => {
    const out: Footprint[] = [];
    for (const f of featuresOf(buildings)) {
      const g = isRec(f) && isRec(f.geometry) ? f.geometry : null;
      if (!g || !Array.isArray(g.coordinates)) continue;
      const polys: unknown[] =
        g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      for (const p of polys) {
        const outer = Array.isArray(p) ? p[0] : null;
        if (!Array.isArray(outer)) continue;
        const ring: Ring = [];
        let ok = true;
        for (const c of outer) {
          const q = toLocal(c, frame);
          if (!q) {
            ok = false;
            break;
          }
          ring.push(q);
        }
        if (ok && ring.length >= 4) out.push({ ring, bb: boundsOf(ring) });
      }
    }
    return out;
  });

interface Area {
  outer: Ring;
  holes: Ring[];
  bb: [number, number, number, number];
}
const areaCache = new WeakMap<object, WeakMap<object, Area[]>>();

/** Polygon areas (park or base water) in local metres: outer ring, holes, bounds. */
const areasOf = (fc: unknown, frame: LocalFrame): Area[] =>
  perLayer(areaCache, fc, frame, () => {
    const out: Area[] = [];
    const ringOf = (r: unknown): Ring | null => {
      if (!Array.isArray(r)) return null;
      const ring: Ring = [];
      for (const c of r) {
        const q = toLocal(c, frame);
        if (!q) return null;
        ring.push(q);
      }
      return ring.length >= 4 ? ring : null;
    };
    for (const f of featuresOf(fc)) {
      const g = isRec(f) && isRec(f.geometry) ? f.geometry : null;
      if (!g || !Array.isArray(g.coordinates)) continue;
      const polys: unknown[] =
        g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      for (const p of polys) {
        if (!Array.isArray(p)) continue;
        const outer = ringOf(p[0]);
        if (!outer) continue;
        const holes: Ring[] = [];
        for (const h of p.slice(1)) {
          const hr = ringOf(h);
          if (hr) holes.push(hr);
        }
        out.push({ outer, holes, bb: boundsOf(outer) });
      }
    }
    return out;
  });

/** Every ribbon segment (all walk lines are drawn ribbons), gridded by its bounds plus half width. */
const segGridOf = (walk: unknown, frame: LocalFrame): Grid<Seg> =>
  perLayer(segGridCache, walk, frame, () => {
    const g: Grid<Seg> = new Map();
    for (const l of linesOf(walk, frame)) {
      const half = l.width / 2;
      const r = half + SEG_PAD_M;
      for (let i = 0; i < l.pts.length - 1; i++) {
        const a = l.pts[i]!;
        const b = l.pts[i + 1]!;
        gridAdd(
          g,
          { a, b, half },
          Math.min(a[0], b[0]) - r,
          Math.min(a[1], b[1]) - r,
          Math.max(a[0], b[0]) + r,
          Math.max(a[1], b[1]) + r,
        );
      }
    }
    return g;
  });

/** Footprints gridded by their bounds plus the widest query distance. */
const footGridOf = (buildings: unknown, frame: LocalFrame): Grid<Footprint> =>
  perLayer(footGridCache, buildings, frame, () => {
    const g: Grid<Footprint> = new Map();
    for (const f of footprintsOf(buildings, frame))
      gridAdd(
        g,
        f,
        f.bb[0] - FOOT_PAD_M,
        f.bb[1] - FOOT_PAD_M,
        f.bb[2] + FOOT_PAD_M,
        f.bb[3] + FOOT_PAD_M,
      );
    return g;
  });

/** Squared distance from a point to a segment (no `Math.hypot`: this is the planner's hot loop). */
function distSeg2(px: number, pz: number, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2));
  const ex = px - (a[0] + t * dx);
  const ez = pz - (a[1] + t * dz);
  return ex * ex + ez * ez;
}

function inRing(x: number, z: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToRing(x: number, z: number, ring: Ring): number {
  let d = Number.POSITIVE_INFINITY;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    d = Math.min(d, distSeg2(x, z, ring[j]!, ring[i]!));
  return Math.sqrt(d);
}

/**
 * Verge strips (flat triangles at the verge lift, `x y z` per vertex, 9 floats per triangle, two
 * triangles per 2 m piece) and shrub placements for one tile.
 *
 * `cap` limits the shrubs and `pieceCap` the 2 m strip pieces (two triangles each), both nearest
 * the tile centre first (the stream sets both from the tile's `verges` cap). Pieces whose
 * corners fall on a ribbon (a footway or street crossing) or inside a footprint are dropped, so a
 * verge never lies on a ribbon or under a building. Nothing is planned inside a `keepOut` park or
 * base-water polygon (the verge was hidden there anyway). Shrubs use the `trees` kit variants
 * `shrub_round` and `shrub_hedge`.
 */
export function planVerges(
  walk: unknown,
  buildings: unknown,
  tile: Tile,
  frame: LocalFrame,
  cap: number,
  pieceCap = Number.POSITIVE_INFINITY,
  keepOut: { parks?: unknown; water?: unknown } = {},
): { strips: Float32Array; shrubs: Placement[] } {
  const box = tile.box;
  const lines = linesOf(walk, frame);
  const segGrid = segGridOf(walk, frame);
  const footGrid = footGridOf(buildings, frame);
  const areas = [...areasOf(keepOut.parks, frame), ...areasOf(keepOut.water, frame)];
  const inKeepOut = (x: number, z: number): boolean => {
    for (const a of areas) {
      const b = a.bb;
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
      if (inRing(x, z, a.outer) && !a.holes.some((h) => inRing(x, z, h))) return true;
    }
    return false;
  };

  // `extra` is at most SEG_PAD_M and `within` at most FOOT_PAD_M (the grid padding).
  const onRibbon = (x: number, z: number, extra: number): boolean => {
    for (const s of gridAt(segGrid, x, z)) {
      const r = s.half + extra;
      if (r > 0 && distSeg2(x, z, s.a, s.b) < r * r) return true;
    }
    return false;
  };
  const nearFootprint = (x: number, z: number, within: number): boolean => {
    for (const f of gridAt(footGrid, x, z)) {
      const b = f.bb;
      if (x < b[0] - within || x > b[2] + within || z < b[1] - within || z > b[3] + within)
        continue;
      if (inRing(x, z, f.ring) || distToRing(x, z, f.ring) < within) return true;
    }
    return false;
  };

  const pieces: { d: number; quad: P[] }[] = [];
  const shrubs: { pl: Placement; d: number }[] = [];
  const cx = (box.x0 + box.x1) / 2;
  const cz = (box.z0 + box.z1) / 2;

  for (const l of lines) {
    if (!VERGE_TYPES.has(l.type)) continue;
    // The verge starts at the kerb: half the road width (3 m for the 6 m street).
    const inner = l.width / 2;
    const outer = inner + (VERGE_OUTER_M - VERGE_INNER_M);
    const mid = (inner + outer) / 2;
    const reach = outer + 2;
    if (!touchesBox(box, l.bb[0] - reach, l.bb[1] - reach, l.bb[2] + reach, l.bb[3] + reach))
      continue;
    // A segment whose bounds plus `reach` miss the tile holds none of its pieces or shrubs.
    const near = (s: number): boolean => {
      const a = l.pts[s]!;
      const b = l.pts[s + 1]!;
      return touchesBox(
        box,
        Math.min(a[0], b[0]) - reach,
        Math.min(a[1], b[1]) - reach,
        Math.max(a[0], b[0]) + reach,
        Math.max(a[1], b[1]) + reach,
      );
    };

    for (let s = 0; s < l.pts.length - 1; s++) {
      const a = l.pts[s]!;
      const b = l.pts[s + 1]!;
      const len = l.cum[s + 1]! - l.cum[s]!;
      if (len < 0.1 || !near(s)) continue;
      const ux = (b[0] - a[0]) / len;
      const uz = (b[1] - a[1]) / len;
      const nx = uz; // left of travel, viewed from above (x east, z south)
      const nz = -ux;
      const n = Math.max(1, Math.ceil(len / PIECE_M));
      for (const side of [1, -1]) {
        for (let k = 0; k < n; k++) {
          const t0 = (k / n) * len;
          const t1 = ((k + 1) / n) * len;
          const at = (t: number, d: number): P => [
            a[0] + ux * t + nx * side * d,
            a[1] + uz * t + nz * side * d,
          ];
          const m = at((t0 + t1) / 2, mid);
          if (!inBox(box, m[0], m[1]) || inKeepOut(m[0], m[1])) continue;
          const c00 = at(t0, inner);
          const c01 = at(t0, outer);
          const c10 = at(t1, inner);
          const c11 = at(t1, outer);
          let bad = false;
          for (const q of [c00, c01, c10, c11, m]) {
            if (onRibbon(q[0], q[1], -0.02) || nearFootprint(q[0], q[1], 0.01)) {
              bad = true;
              break;
            }
          }
          if (bad) continue;
          // Wound to face +y, like the road ribbons.
          const quad = side === 1 ? [c00, c10, c01, c10, c11, c01] : [c00, c01, c10, c01, c11, c10];
          pieces.push({ d: Math.hypot(m[0] - cx, m[1] - cz), quad });
        }
      }
    }

    // Shrub rows: one position per SHRUB_SPACING_M of arc length along the whole line, each side.
    // Position k belongs to the segment whose half-open arc range holds it; only segments near the
    // tile are visited (a shrub of a far segment lies outside the box anyway).
    for (let si = 0; si < l.pts.length - 1; si++) {
      const lo = l.cum[si]!;
      const hi = l.cum[si + 1]!;
      const len = hi - lo;
      if (len < 0.1 || !near(si)) continue;
      const a = l.pts[si]!;
      const b = l.pts[si + 1]!;
      const kLo = Math.max(
        0,
        Math.ceil((lo - SHRUB_SPACING_M / 2 - SHRUB_JITTER_M) / SHRUB_SPACING_M),
      );
      const kHi = Math.floor((hi - SHRUB_SPACING_M / 2 + SHRUB_JITTER_M) / SHRUB_SPACING_M);
      for (const side of [1, -1])
        for (let k = kLo; k <= kHi; k++) {
          const id = `vg${l.idx}.${side > 0 ? "L" : "R"}.${k}`;
          const arc =
            SHRUB_SPACING_M * k +
            SHRUB_SPACING_M / 2 +
            (2 * hash01(id, "along") - 1) * SHRUB_JITTER_M;
          if (arc < lo || arc >= hi) continue;
          const ux = (b[0] - a[0]) / len;
          const uz = (b[1] - a[1]) / len;
          const nx = uz;
          const nz = -ux;
          const t = arc - lo;
          const off = mid + (2 * hash01(id, "across") - 1) * SHRUB_LATERAL_M;
          const x = a[0] + ux * t + nx * side * off;
          const z = a[1] + uz * t + nz * side * off;
          if (!inBox(box, x, z) || inKeepOut(x, z)) continue;
          if (onRibbon(x, z, RIBBON_CLEAR_M)) continue;
          if (nearFootprint(x, z, SHRUB_CLEAR_M)) continue;
          // Driveway: a footprint within 3 m of the kerb point abreast of this shrub.
          const kx = a[0] + ux * t + nx * side * inner;
          const kz = a[1] + uz * t + nz * side * inner;
          if (nearFootprint(kx, kz, DRIVEWAY_GAP_M)) continue;
          const hedge = hash01(id, "kind") < HEDGE_SHARE;
          const sc = 0.9 + 0.2 * hash01(id, "scale");
          shrubs.push({
            pl: {
              id,
              asset: "trees",
              variant: hedge ? "shrub_hedge" : "shrub_round",
              x,
              z,
              yaw: hedge ? Math.atan2(-uz, ux) : hash01(id, "yaw") * Math.PI * 2,
              sx: sc,
              sy: sc,
              sz: sc,
              palette: SHRUB_PALETTE,
            },
            d: Math.hypot(x - cx, z - cz),
          });
        }
    }
  }

  shrubs.sort((p, q) => p.d - q.d || (p.pl.id < q.pl.id ? -1 : p.pl.id > q.pl.id ? 1 : 0));
  // Piece cap: nearest the tile centre first (a stable sort keeps the planning order on ties).
  const keep = Math.max(0, Math.floor(pieceCap));
  if (pieces.length > keep) pieces.sort((p, q) => p.d - q.d);
  const n = Math.min(pieces.length, keep);
  const strips = new Float32Array(n * 18);
  for (let i = 0, o = 0; i < n; i++)
    for (const p of pieces[i]!.quad) {
      strips[o++] = p[0];
      strips[o++] = VERGE_Y;
      strips[o++] = p[1];
    }
  return {
    strips,
    shrubs: shrubs.slice(0, Math.max(0, Math.floor(cap))).map((s) => s.pl),
  };
}
