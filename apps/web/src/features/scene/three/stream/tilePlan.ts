import type { BuildingsLayer } from "../../../../lib/api";
import type { Tier } from "../../cesium/stylised/quality";
import type { Placement } from "../assets/fit";
import type { Manifest } from "../assets/manifest";
import type { FacadeBuilding } from "../facade/facadeLayer";
import type { LocalFrame } from "../frame";
import { ribbonsFromWalk } from "../ground/ribbons";
import { planAgents } from "../motion/agents";
import { planProps } from "../props/propsPlan";
import { planSigns } from "../signs/signPlan";
import { type PlanArea, seedFor } from "./area";
import { tileCap } from "./caps";
import type { Ring, TileContent } from "./streamer";
import { type Tile, type TileKey, tileAt } from "./tiles";

/** What every tile is planned from. All of it is static per world (the walk is latched). */
export interface TileInputs {
  frame: LocalFrame;
  /** The latched access layer (walk LineStrings and place points); never re-keyed by profile. */
  walk: unknown;
  buildings: BuildingsLayer | null | undefined;
  /** Props and agents need the kit manifest; without it a tile has roads and signs only. */
  manifest: Manifest | null;
  /** Facade inputs by tile (`bucketFacades`); null: no facades (no assets, showroom). */
  facades: Map<TileKey, FacadeBuilding[]> | null;
}

/** Per-planner seed salt: the seed is `hash01(tileKey, salt)` (`seedFor`), never visit order. */
const SALT = { props: "props", motion: "motion", signs: "signs", roads: "roads" } as const;
const LAMP_KITS = ["furniture/lamp_single", "furniture/lamp_double"];
const NO_KITS: Map<string, Placement[]> = new Map();

const areaOf = (tile: Tile, salt: string): PlanArea => ({
  box: tile.box,
  seed: seedFor(tile.key, salt),
});

/**
 * One tile's decorative content (pure). Caps come from `tileCap` (the only place HERO_BOOST enters),
 * seeds from the tile key. Low plans roads only (no props, agents, signs or facades). Facades are
 * planned for rings 0-1 only (P4-H): ring 2 and beyond show the plain palette extrusion.
 */
export function planTile(inp: TileInputs, tile: Tile, ring: Ring, tier: Tier): TileContent {
  const { frame, walk, buildings, manifest } = inp;
  const cap = (kind: Parameters<typeof tileCap>[2]) => tileCap(tier, ring, kind, tile, frame);
  const rich = tier !== "low";
  const kits =
    rich && manifest && buildings
      ? planProps({
          walk,
          landcover: buildings.landcover,
          buildings: buildings.buildings,
          parks: buildings.parks,
          trees: buildings.trees,
          places: walk,
          frame,
          area: areaOf(tile, SALT.props),
          tier,
          caps: {
            trees: cap("trees"),
            lamps: cap("lamps"),
            furniture: cap("furniture"),
            construction: cap("construction"),
          },
          m: manifest,
        }).kits
      : NO_KITS;
  const vehicles = cap("vehicles");
  const people = cap("people");
  const signCap = cap("signs");
  // A planner with nothing to place (ring 2, Low) is not run.
  const agents =
    rich && manifest && vehicles + people > 0
      ? planAgents({
          walk,
          places: walk,
          frame,
          area: areaOf(tile, SALT.motion),
          tier,
          caps: { vehicles, people },
          m: manifest,
        })
      : [];
  const signs =
    rich && buildings && signCap > 0
      ? planSigns(buildings.signage, buildings.buildings, walk, frame, {
          area: areaOf(tile, SALT.signs),
          cap: signCap,
        }).signs
      : [];
  const ribbons = ribbonsFromWalk(walk as GeoJSON.FeatureCollection, frame, {
    area: areaOf(tile, SALT.roads),
  });
  return {
    kits,
    lamps: LAMP_KITS.flatMap((k) => kits.get(k) ?? []),
    agents,
    signs,
    ribbons,
    facades: rich && ring <= 1 ? (inp.facades?.get(tile.key) ?? []) : undefined,
  };
}

/** A box no data reaches: planning it builds every planner's layer cache and places nothing. */
const NOWHERE: Tile = {
  key: "warm",
  i: 0,
  j: 0,
  box: { x0: 1e9, z0: 1e9, x1: 1e9 + 1, z1: 1e9 + 1 },
};

/**
 * Builds every planner's per-layer cache (the ~20-60 ms cold first call each) by planning an empty
 * box at Medium, plus every sign once. Run once per input set, outside any streamed frame (an idle callback at world
 * load), so no LOD tick pays the cold cost. The caches are keyed by the layer objects and the
 * frame, which stay the same across profile and scenario switches (the walk is latched).
 */
export function warmPlanners(inp: TileInputs): void {
  planTile(inp, NOWHERE, 0, "medium");
  // The sign planner builds its building and street caches only once a sign is in the box: plan
  // every sign once (no area), which reaches them.
  if (inp.buildings) planSigns(inp.buildings.signage, inp.buildings.buildings, inp.walk, inp.frame);
}

/** Facade inputs grouped by the tile holding their footprint's bounding-box centre (half-open). */
export function bucketFacades(list: readonly FacadeBuilding[]): Map<TileKey, FacadeBuilding[]> {
  const out = new Map<TileKey, FacadeBuilding[]>();
  for (const b of list) {
    let x0 = Number.POSITIVE_INFINITY;
    let z0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let z1 = Number.NEGATIVE_INFINITY;
    for (const [x, z] of b.ring) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    if (!Number.isFinite(x0)) continue;
    const key = tileAt((x0 + x1) / 2, (z0 + z1) / 2).key;
    const l = out.get(key);
    if (l) l.push(b);
    else out.set(key, [b]);
  }
  return out;
}
