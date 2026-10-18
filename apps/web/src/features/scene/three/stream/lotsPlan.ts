import type { Tier } from "../../cesium/stylised/quality";
import { hash01, type Placement } from "../assets/fit";
import type { LocalFrame } from "../frame";
import { planParking } from "../ground/parking";
import { planConstructionSites, type Site, sitesOf } from "../props/construction";
import { bboxOf } from "../props/polyGeom";
import { perLayer, touchesBox } from "./area";
import { tileCap } from "./caps";
import type { Ring, TileContent } from "./streamer";
import type { TileInputs } from "./tilePlan";
import type { Tile } from "./tiles";

/**
 * Task 10 (wiring): parking lots and construction land for one streamed tile. Kept in its own
 * module so `planTile` calls it from one line. Everything here is DECORATIVE:
 * - stall markings and parked cars only on land-cover `parking` polygons (OSM `amenity=parking`);
 *   the cars are vehicles-kit placements that ride the static kit buckets (never the motion layer),
 *   so they never move and never fade with Day / Rollout playback (they cannot be read as residents);
 * - construction land dressed as a site: by-area kit props, earth tracks and a gravel tint of every
 *   site touching the tile (the props planner's construction cap is 0, so nothing is placed twice).
 * Low plans none of it; beyond 1500 m the streamer's far view drops it (not "trees and roads").
 */

export interface TileLots {
  /** Construction kits and parked cars, by kit key, to merge into the tile's kits. */
  kits: Map<string, Placement[]>;
  /** The TileContent fields this planner owns. */
  content: Pick<TileContent, "parking" | "tracks" | "gravel">;
}

const NO_LOTS: TileLots = Object.freeze({
  kits: new Map<string, Placement[]>(),
  content: Object.freeze({}),
}) as TileLots;

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

interface LotLayers {
  parking: GeoJSON.Feature[];
  construction: GeoJSON.Feature[];
}
const lotLayers = new WeakMap<object, WeakMap<object, LotLayers>>();
/** The land cover's `parking` and `construction` features, split once per land cover (same arrays every tile, so ids are global). */
function lotLayersOf(landcover: unknown, frame: LocalFrame): LotLayers {
  return perLayer(lotLayers, landcover, frame, () => {
    const out: LotLayers = { parking: [], construction: [] };
    const feats = isRec(landcover) && Array.isArray(landcover.features) ? landcover.features : [];
    for (const f of feats) {
      const cls = isRec(f) && isRec(f.properties) ? f.properties.class : undefined;
      if (cls === "parking") out.parking.push(f as GeoJSON.Feature);
      else if (cls === "construction") out.construction.push(f as GeoJSON.Feature);
    }
    return out;
  });
}

const siteBoxes = new WeakMap<Site, [number, number, number, number]>();
const siteBox = (s: Site) => {
  let b = siteBoxes.get(s);
  if (!b) {
    b = bboxOf(s.poly[0]!);
    siteBoxes.set(s, b);
  }
  return b;
};

/**
 * Parked cars kept under the tile's `parked` cap: when the occupied stalls outnumber it, the kept
 * cars are picked by a hash of their id (spread over the lot, not clustered), then restored to the
 * planner's order. Deterministic per stall id.
 */
export function capCars(cars: Placement[], cap: number): Placement[] {
  const limit = Math.max(0, Math.floor(cap));
  if (cars.length <= limit) return cars;
  const keep = new Set(
    cars
      .map((c) => ({ c, h: hash01(c.id, "parked-keep") }))
      .sort((a, b) => a.h - b.h || (a.c.id < b.c.id ? -1 : 1))
      .slice(0, limit)
      .map((x) => x.c),
  );
  return cars.filter((c) => keep.has(c));
}

/** Parking and construction for one tile (pure apart from the night weight read at plan time). */
export function planTileLots(inp: TileInputs, tile: Tile, ring: Ring, tier: Tier): TileLots {
  const { frame, buildings, manifest } = inp;
  if (tier === "low" || !buildings || !manifest) return NO_LOTS;
  const layers = lotLayersOf(buildings.landcover, frame);
  if (layers.parking.length + layers.construction.length === 0) return NO_LOTS;
  const cap = (kind: Parameters<typeof tileCap>[2]) => tileCap(tier, ring, kind, tile, frame);
  const kits = new Map<string, Placement[]>();
  const add = (k: string, l: Placement[]) => {
    if (l.length === 0) return;
    const cur = kits.get(k);
    if (cur) cur.push(...l);
    else kits.set(k, [...l]);
  };
  const content: TileLots["content"] = {};

  // Parking: stall markings (capped per tile) and parked cars (their own cap).
  const stallCap = cap("parking");
  if (stallCap > 0 && layers.parking.length > 0) {
    const night = inp.night?.() ?? 0;
    const p = planParking(layers.parking, tile, frame, stallCap, {
      m: manifest,
      night,
      roads: inp.walk,
    });
    const cars = capCars(p.cars, cap("parked"));
    if (p.stalls.length > 0) content.parking = { stalls: p.stalls, cars };
    for (const c of cars) add(`${c.asset}/${c.variant}`, [c]);
  }

  // Construction: kits by area (capped), earth tracks and the gravel tint (ground detail, every ring).
  if (layers.construction.length > 0) {
    const sites = sitesOf(layers.construction, frame);
    const box = tile.box;
    const touching = sites.filter((s) => {
      const b = siteBox(s);
      return touchesBox(box, b[0], b[1], b[2], b[3]);
    });
    if (touching.length > 0) {
      const c = planConstructionSites(touching, box, cap("construction"), manifest);
      for (const [k, l] of c.kits) add(k, l);
      if (c.tracks.length > 0) content.tracks = c.tracks;
      content.gravel = touching;
    }
  }
  return kits.size === 0 && Object.keys(content).length === 0 ? NO_LOTS : { kits, content };
}

/** The tile's kits with the lots' kits appended (a new map only when there is something to add). */
export function lotKits(kits: Map<string, Placement[]>, lots: TileLots): Map<string, Placement[]> {
  if (lots.kits.size === 0) return kits;
  const out = new Map<string, Placement[]>(kits);
  for (const [k, l] of lots.kits) out.set(k, [...(out.get(k) ?? []), ...l]);
  return out;
}

/** A box every lot and site falls in: planning it lays out every lot and site once. */
const EVERYWHERE: Tile = {
  key: "warm-lots",
  i: 0,
  j: 0,
  box: { x0: -1e7, z0: -1e7, x1: 1e7, z1: 1e7 },
};

/**
 * Lays out every parking lot and construction site once (the 1-35 ms cold layouts, cached per
 * polygon), outside any streamed frame: called by `warmPlanners` at world load. The same feature
 * arrays (`lotLayersOf`) and frame are used by every later tile, so no LOD tick pays a cold layout.
 */
export function warmLots(inp: TileInputs): void {
  const { frame, buildings, manifest } = inp;
  if (!buildings || !manifest) return;
  const layers = lotLayersOf(buildings.landcover, frame);
  if (layers.parking.length > 0)
    planParking(layers.parking, EVERYWHERE, frame, 1, { m: manifest, roads: inp.walk });
  if (layers.construction.length > 0)
    planConstructionSites(sitesOf(layers.construction, frame), EVERYWHERE.box, 0, manifest);
}
