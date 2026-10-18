import { ROAD_WIDTH_UNKNOWN, WIDTH_BY_TYPE } from "../../cesium/stylised/ground";
import { footprintObb, hash01, jitterFor, type Placement, paletteFor } from "../assets/fit";
import type { Manifest } from "../assets/manifest";
import type { LocalFrame } from "../frame";
import {
  type BBox,
  bboxOf,
  distSeg,
  distToPoly,
  inPoly,
  type P,
  type Poly,
  polygonsOf,
} from "../props/polyGeom";
import { boxCentre, inBox, perLayer, touchesBox } from "../stream/area";
import type { Tile } from "../stream/tiles";

/**
 * Parking lots: white stall markings and parked cars, for one streaming tile. Pure and DECORATIVE:
 * stalls exist only inside land-cover `parking` polygons (OSM `amenity=parking` areas), never
 * anywhere else, and the cars are illustration, not data about who is parked where. The cars never
 * move and never fade with Day playback (they cannot be read as residents).
 *
 * Layout per polygon: its min-area rectangle gives the long axis; stall rows run along it with
 * 6 m aisles between them (a single row against the edge, then aisle, double row, aisle, ...),
 * stalls 2.5 x 5.0 m, everything inset 1 m from the boundary and clear of drawn ribbons. Stall ids
 * are global to the polygon (row, column), a stall belongs to the tile whose half-open box holds
 * its centre, and a car is decided by `hash01(stall id)`, so adjacent tiles never double-place
 * and a tile's output depends only on the data, its box and the mood weight.
 */

export const STALL_W_M = 2.5;
export const STALL_D_M = 5.0;
export const AISLE_M = 6.0;
export const LOT_INSET_M = 1.0;
/** Marking line width (m) and its lift (the markings layer, spec lift table). */
export const STALL_LINE_M = 0.1;
export const STALL_LIFT_Y = 0.1;
/** Floats per stall in `stalls`: centre x, centre z, heading yaw (the direction a car nose points). */
export const STALL_STRIDE = 3;
/**
 * Share of stalls holding a car: fixed (ruling P4-AF). Parked cars never depend on the mood or Day
 * playback, so a tile's content depends only on its key, the tier and the data.
 */
export const CARS_SHARE = 0.7;
/** Stalls stay this clear (beyond the ribbon half-width) of a drawn road: the stall's half-diagonal. */
const RIBBON_CLEAR_M = Math.hypot(STALL_W_M, STALL_D_M) / 2;
/** Parked variants of the vehicles kit and their shares (hatchback, sedan, MPV). */
const VARIANTS: [string, number][] = [
  ["hatchback", 0.5],
  ["sedan", 0.8],
  ["mpv", 1],
];

interface Stall {
  id: string;
  x: number;
  z: number;
  yaw: number;
}
interface Lot {
  stalls: Stall[];
  bb: BBox;
}
interface Ribbon {
  pts: P[];
  half: number;
  bb: BBox;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const ribbonsCache = new WeakMap<object, WeakMap<object, Ribbon[]>>();
const NO_ROADS = {};

/** Every walk LineString (each one is a drawn ribbon) with its half-width. */
function ribbonsOf(walk: unknown, frame: LocalFrame): Ribbon[] {
  return perLayer(ribbonsCache, walk, frame, () => {
    const out: Ribbon[] = [];
    const feats = isRec(walk) && Array.isArray(walk.features) ? walk.features : [];
    for (const f of feats) {
      if (!isRec(f) || !isRec(f.geometry) || f.geometry.type !== "LineString") continue;
      const coords = f.geometry.coordinates;
      if (!Array.isArray(coords)) continue;
      const pts: P[] = [];
      let ok = true;
      for (const c of coords) {
        if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
          ok = false;
          break;
        }
        pts.push(frame.toLocal(c[0] as number, c[1] as number));
      }
      if (!ok || pts.length < 2) continue;
      const type =
        isRec(f.properties) && typeof f.properties.type === "string" ? f.properties.type : "";
      out.push({ pts, half: (WIDTH_BY_TYPE[type] ?? ROAD_WIDTH_UNKNOWN) / 2, bb: bboxOf(pts) });
    }
    return out;
  });
}

const lotsCache = new WeakMap<object, WeakMap<object, Map<string, Lot>>>();
const polysCache = new WeakMap<object, WeakMap<object, { poly: Poly; id: string }[]>>();

function layoutLot(poly: Poly, id: string, ribbons: Ribbon[]): Lot {
  const ring = poly[0]!;
  const bb = bboxOf(ring);
  const obb = footprintObb(ring);
  const stalls: Stall[] = [];
  if (!obb) return { stalls, bb };
  // u: the long axis (angle runs from +x toward -z), v: across it.
  const ux = Math.cos(obb.angle);
  const uz = -Math.sin(obb.angle);
  const vx = -uz;
  const vz = ux;
  const la = obb.l / 2;
  const lb = obb.w / 2;
  const near = ribbons.filter((r) =>
    touchesBox(
      { x0: bb[0], z0: bb[1], x1: bb[2], z1: bb[3] },
      r.bb[0] - r.half - RIBBON_CLEAR_M,
      r.bb[1] - r.half - RIBBON_CLEAR_M,
      r.bb[2] + r.half + RIBBON_CLEAR_M,
      r.bb[3] + r.half + RIBBON_CLEAR_M,
    ),
  );
  const onRibbon = (x: number, z: number): boolean => {
    for (const r of near)
      for (let i = 0; i < r.pts.length - 1; i++)
        if (distSeg(x, z, r.pts[i]!, r.pts[i + 1]!) < r.half + RIBBON_CLEAR_M) return true;
    return false;
  };
  const at = (a: number, b: number): P => [obb.cx + ux * a + vx * b, obb.cz + uz * a + vz * b];
  const fits = (x: number, z: number, hx: number, hz: number): boolean => {
    // The four corners must be inside the polygon and at least the inset from its boundary.
    for (const sa of [-1, 1])
      for (const sb of [-1, 1]) {
        const cx = x + (hz * sa * STALL_W_M) / 2 + hx * sb * (STALL_D_M / 2);
        const cz = z + (-hx * sa * STALL_W_M) / 2 + hz * sb * (STALL_D_M / 2);
        if (!inPoly(cx, cz, poly) || distToPoly(cx, cz, poly) < LOT_INSET_M) return false;
      }
    return true;
  };
  // Rows from the low-b edge: a single row, an aisle, then double rows (back to back) with aisles.
  let b = -lb + LOT_INSET_M;
  const bEnd = lb - LOT_INSET_M;
  let row = 0;
  let face = 1;
  while (b + STALL_D_M <= bEnd + 1e-9) {
    const bc = b + STALL_D_M / 2;
    // Nose toward +v for a row whose aisle lies on the +v side, -v otherwise.
    const hx = vx * face;
    const hz = vz * face;
    const yaw = Math.atan2(hx, hz);
    let col = 0;
    for (
      let a = -la + LOT_INSET_M;
      a + STALL_W_M <= la - LOT_INSET_M + 1e-9;
      a += STALL_W_M, col++
    ) {
      const [x, z] = at(a + STALL_W_M / 2, bc);
      if (!fits(x, z, hx, hz) || onRibbon(x, z)) continue;
      stalls.push({ id: `${id}:${row}:${col}`, x, z, yaw });
    }
    // Next row: the row after a single/first row faces the other way after an aisle; the second
    // of a back-to-back pair sits directly behind the first and faces +v again.
    if (row === 0 || face === 1) {
      b += STALL_D_M + AISLE_M;
      face = -1;
    } else {
      b += STALL_D_M;
      face = 1;
    }
    row++;
  }
  return { stalls, bb };
}

/** What 10b passes: the asset manifest and the drawn walk network. */
export interface ParkingOptions {
  m: Manifest;
  /** `/layers/access` FeatureCollection: stalls keep clear of every LineString ribbon. */
  roads?: unknown;
}

/**
 * Parking for one tile. `lots` is the whole list of parking polygons (Polygon / MultiPolygon
 * features; the same array every tile, so ids are global). `cap` is the most stalls this tile
 * draws (`tileCap(tier, ring, "parking", ...)`; nearer stalls first); cars are a subset of them.
 */
export function planParking(
  lots: GeoJSON.Feature[],
  tile: Tile,
  frame: LocalFrame,
  cap: number,
  opts: ParkingOptions,
): { stalls: Float32Array; cars: Placement[] } {
  const limit = Math.max(0, Math.floor(cap));
  if (limit === 0 || lots.length === 0) return { stalls: new Float32Array(0), cars: [] };
  const box = tile.box;
  const walk = opts.roads ?? NO_ROADS;
  const ribbons = opts.roads === undefined ? [] : ribbonsOf(opts.roads, frame);

  const polys = perLayer(polysCache, lots, frame, () =>
    lots.flatMap((f, fi) =>
      isRec(f) ? polygonsOf(f.geometry, frame).map((poly, k) => ({ poly, id: `${fi}.${k}` })) : [],
    ),
  );
  const [cx, cz] = boxCentre(box);
  const picked: (Stall & { d: number })[] = [];
  for (const { poly, id } of polys) {
    const bb = bboxOf(poly[0]!);
    if (!touchesBox(box, bb[0], bb[1], bb[2], bb[3])) continue;
    const lot = lotFor(poly, id, walk, ribbons);
    for (const s of lot.stalls)
      if (inBox(box, s.x, s.z)) picked.push({ ...s, d: Math.hypot(s.x - cx, s.z - cz) });
  }
  picked.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const kept = picked.slice(0, limit);

  const stalls = new Float32Array(kept.length * STALL_STRIDE);
  kept.forEach((s, i) => {
    stalls[i * STALL_STRIDE] = s.x;
    stalls[i * STALL_STRIDE + 1] = s.z;
    stalls[i * STALL_STRIDE + 2] = s.yaw;
  });

  const spec = opts.m.assets.vehicles;
  const share = CARS_SHARE;
  const cars: Placement[] = [];
  if (spec) {
    for (const s of kept) {
      if (hash01(s.id, "occupied") >= share) continue;
      const r = hash01(s.id, "variant");
      const variant = VARIANTS.find(([, upTo]) => r < upTo)![0];
      if (!spec.variants[variant]) continue;
      const id = `pk:${s.id}`;
      const sc = jitterFor(spec, id).scale;
      cars.push({
        id,
        asset: "vehicles",
        variant,
        x: s.x,
        z: s.z,
        yaw: s.yaw + (hash01(s.id, "skew") - 0.5) * 0.1,
        sx: sc,
        sy: sc,
        sz: sc,
        palette: paletteFor(spec, "default", id),
      });
    }
  }
  return { stalls, cars };
}

function lotFor(poly: Poly, id: string, walk: object, ribbons: Ribbon[]): Lot {
  let byWalk = lotsCache.get(poly);
  if (!byWalk) {
    byWalk = new WeakMap();
    lotsCache.set(poly, byWalk);
  }
  let byId = byWalk.get(walk);
  if (!byId) {
    byId = new Map();
    byWalk.set(walk, byId);
  }
  let lot = byId.get(id);
  if (!lot) {
    lot = layoutLot(poly, id, ribbons);
    byId.set(id, lot);
  }
  return lot;
}
