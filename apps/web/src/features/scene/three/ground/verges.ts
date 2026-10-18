import { ROAD_WIDTH_UNKNOWN, WIDTH_BY_TYPE } from "../../cesium/stylised/ground";
import { hash01, type Placement } from "../assets/fit";
import type { LocalFrame } from "../frame";
import { growBox, inBox, perLayer, touchesBox } from "../stream/area";
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
/** How far past the tile we look for ribbons and footprints that could cover a piece or shrub. */
const NEAR_M = 12;

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

function distSeg(px: number, pz: number, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2));
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
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
    d = Math.min(d, distSeg(x, z, ring[j]!, ring[i]!));
  return d;
}

/**
 * Verge strips (flat triangles at the verge lift, `x y z` per vertex, 9 floats per triangle, two
 * triangles per 2 m piece) and shrub placements for one tile.
 *
 * `cap` limits the shrubs (nearest the tile centre kept first); strips are not capped. Pieces whose
 * corners fall on a ribbon (a footway or street crossing) or inside a footprint are dropped, so a
 * verge never lies on a ribbon or under a building. Shrubs use the `trees` kit variants
 * `shrub_round` and `shrub_hedge`.
 */
export function planVerges(
  walk: unknown,
  buildings: unknown,
  tile: Tile,
  frame: LocalFrame,
  cap: number,
): { strips: Float32Array; shrubs: Placement[] } {
  const box = tile.box;
  const pad = growBox(box, NEAR_M);
  const lines = linesOf(walk, frame);

  // Ribbon segments (every walk line) and footprints near this tile.
  const segs: { a: P; b: P; half: number }[] = [];
  for (const l of lines) {
    const h = l.width / 2 + NEAR_M;
    if (!touchesBox(pad, l.bb[0] - h, l.bb[1] - h, l.bb[2] + h, l.bb[3] + h)) continue;
    for (let i = 0; i < l.pts.length - 1; i++)
      segs.push({ a: l.pts[i]!, b: l.pts[i + 1]!, half: l.width / 2 });
  }
  const feet = footprintsOf(buildings, frame).filter((f) =>
    touchesBox(pad, f.bb[0], f.bb[1], f.bb[2], f.bb[3]),
  );

  const onRibbon = (x: number, z: number, extra: number): boolean => {
    for (const s of segs) if (distSeg(x, z, s.a, s.b) < s.half + extra) return true;
    return false;
  };
  const nearFootprint = (x: number, z: number, within: number): boolean => {
    for (const f of feet) {
      const b = f.bb;
      if (x < b[0] - within || x > b[2] + within || z < b[1] - within || z > b[3] + within)
        continue;
      if (inRing(x, z, f.ring) || distToRing(x, z, f.ring) < within) return true;
    }
    return false;
  };

  const tri: number[] = [];
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
    const total = l.cum[l.cum.length - 1]!;

    for (let s = 0; s < l.pts.length - 1; s++) {
      const a = l.pts[s]!;
      const b = l.pts[s + 1]!;
      const len = l.cum[s + 1]! - l.cum[s]!;
      if (len < 0.1) continue;
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
          if (!inBox(box, m[0], m[1])) continue;
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
          for (const p of quad) tri.push(p[0], VERGE_Y, p[1]);
        }
      }
    }

    // Shrub rows: one position per SHRUB_SPACING_M of arc length along the whole line, each side.
    for (const side of [1, -1]) {
      for (let k = 0; ; k++) {
        const id = `vg${l.idx}.${side > 0 ? "L" : "R"}.${k}`;
        const arc =
          SHRUB_SPACING_M * k +
          SHRUB_SPACING_M / 2 +
          (2 * hash01(id, "along") - 1) * SHRUB_JITTER_M;
        if (arc >= total) break;
        let si = 0;
        while (si < l.pts.length - 2 && l.cum[si + 1]! <= arc) si++;
        const a = l.pts[si]!;
        const b = l.pts[si + 1]!;
        const len = l.cum[si + 1]! - l.cum[si]!;
        if (len < 0.1) continue;
        const ux = (b[0] - a[0]) / len;
        const uz = (b[1] - a[1]) / len;
        const nx = uz;
        const nz = -ux;
        const t = arc - l.cum[si]!;
        const off = mid + (2 * hash01(id, "across") - 1) * SHRUB_LATERAL_M;
        const x = a[0] + ux * t + nx * side * off;
        const z = a[1] + uz * t + nz * side * off;
        if (!inBox(box, x, z)) continue;
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
  return {
    strips: Float32Array.from(tri),
    shrubs: shrubs.slice(0, Math.max(0, Math.floor(cap))).map((s) => s.pl),
  };
}
