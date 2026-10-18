import type { Tier } from "../../cesium/stylised/quality";
import { HERO_CENTRE, HERO_RADIUS_M } from "../bookmarks";
import type { LocalFrame } from "../frame";
import type { Tile } from "./tiles";

export type StreamKind =
  | "trees"
  | "lamps"
  | "furniture"
  | "construction"
  | "people"
  | "vehicles"
  | "signs"
  | "verges"
  | "parking"
  | "parked";

/** Per-tile instance multiplier inside the hero district (its tiles are the dense ones). */
export const HERO_BOOST = 1.6;

/**
 * Triangles per instance at ring distance, an upper bound. Means over the manifest kit variants:
 * ring 0 uses LOD0 (the camera can be within 150 m), ring 1 LOD1, ring 2 the last LOD (the
 * KIT_LOD_SCALE-shortened ranges put ring 2 at the coarsest LOD). Measured from
 * `public/city/manifest.json` (P3 kits, as_of 2026-10).
 *  - trees: 1090 / 224 / 42      - construction: 894 / 214 / 44
 *  - people: 598 / 201 / 201     - vehicles: 658 / 349 / 349 (no coarser LOD)
 *  - lamps: 144 / 79 / 79 (lamp_single and lamp_double)
 *  - furniture: 97 / 41 / 41
 * Kinds without a kit asset are flat batches: signs (a quad plus a post box) 12, parking (a stall's
 * three marking lines, a quad each) 6.
 * verges: one cap unit is VERGE_PIECES_PER_CAP grass strip pieces of 2 triangles each (100), plus
 * at ring 0 VERGE_SHRUBS_PER_CAP shrubs (`trees` kit LOD0, shrub_round 70 % / shrub_hedge 30 %:
 * 424 each, so 212). Shrubs are ring 0 only; `planTileVerges` caps both.
 * Parked cars (`parked`, Task 10) are vehicles-kit instances of the parked variants (hatchback,
 * sedan, mpv): the worst of the three per LOD, 696 / 352 (mpv), counted per car (they are capped
 * per tile on their own, not as a share of the stalls).
 */
export const TRIS_PER: Record<StreamKind, Record<0 | 1 | 2, number>> = {
  trees: { 0: 1090, 1: 224, 2: 42 },
  lamps: { 0: 144, 1: 79, 2: 79 },
  furniture: { 0: 97, 1: 41, 2: 41 },
  construction: { 0: 894, 1: 214, 2: 44 },
  people: { 0: 598, 1: 201, 2: 201 },
  vehicles: { 0: 658, 1: 349, 2: 349 },
  signs: { 0: 12, 1: 12, 2: 12 },
  verges: { 0: 212 + 100, 1: 100, 2: 100 },
  parking: { 0: 6, 1: 6, 2: 6 },
  parked: { 0: 696, 1: 352, 2: 352 },
};

/** Grass strip pieces (2 m, 2 triangles) per unit of the `verges` cap. */
export const VERGE_PIECES_PER_CAP = 50;
/** Shrubs per unit of the `verges` cap, ring 0 only (strips read from afar, shrubs only up close). */
export const VERGE_SHRUBS_PER_CAP = 0.5;

const NONE: Record<StreamKind, number> = {
  trees: 0,
  lamps: 0,
  furniture: 0,
  construction: 0,
  people: 0,
  vehicles: 0,
  signs: 0,
  verges: 0,
  parking: 0,
  parked: 0,
};

/**
 * Instance caps per tier, ring and kind, before HERO_BOOST. Starting point: P3's hero totals
 * (Medium 2300 trees / 900 lamps / 350 furniture / 200 construction / 220 people / 140 vehicles)
 * spread over the ~23 hero tiles, ring 0 dense, ring 2 trees only (roads are not instanced here).
 * Sized so the stream stays inside its ~0.5 M tri slice of the 2.5 M Medium budget at any
 * position (tiles.test.ts); Task 15 tunes them by measurement. Low draws nothing.
 * Wave 4b (ruling P4-X): one budget counts verges and parked cars too. Room came from trees only
 * (smaller since Task 11, the largest consumer): Medium trees 70/55 -> 60/40, High 160/110 ->
 * 145/100, buying Medium parked cars 6 -> 20 at ring 0 (>= 25 % of hero-mid ring 0's stalls) and
 * Medium ring 1 verges 0 -> 20 (1,000 strip pieces; 1,600 boosted, a whole hero ring 1 tile).
 */
export const TILE_CAPS: Record<Tier, Record<0 | 1 | 2, Record<StreamKind, number>>> = {
  high: {
    0: {
      trees: 145,
      lamps: 80,
      furniture: 50,
      construction: 12,
      people: 24,
      vehicles: 16,
      signs: 60,
      verges: 50,
      parking: 200,
      parked: 24,
    },
    1: {
      trees: 100,
      lamps: 50,
      furniture: 28,
      construction: 6,
      people: 12,
      vehicles: 9,
      signs: 30,
      verges: 40,
      parking: 100,
      parked: 6,
    },
    2: { ...NONE, trees: 60 },
  },
  medium: {
    0: {
      trees: 60,
      lamps: 60,
      furniture: 36,
      construction: 6,
      people: 14,
      vehicles: 10,
      signs: 40,
      verges: 37,
      parking: 120,
      parked: 20,
    },
    1: {
      trees: 40,
      lamps: 36,
      furniture: 18,
      construction: 3,
      people: 8,
      vehicles: 5,
      signs: 20,
      verges: 20,
      parking: 60,
      parked: 1,
    },
    2: { ...NONE, trees: 40 },
  },
  low: { 0: { ...NONE }, 1: { ...NONE }, 2: { ...NONE } },
};

/** The cap for one tile: the ring cap, times HERO_BOOST when the tile centre is in the hero district. */
export function tileCap(
  tier: Tier,
  ring: 0 | 1 | 2,
  kind: StreamKind,
  tile: Tile,
  frame: LocalFrame,
): number {
  const base = TILE_CAPS[tier][ring][kind];
  if (base === 0) return 0;
  const [hx, hz] = frame.toLocal(HERO_CENTRE[0], HERO_CENTRE[1]);
  const cx = (tile.box.x0 + tile.box.x1) / 2;
  const cz = (tile.box.z0 + tile.box.z1) / 2;
  return Math.hypot(cx - hx, cz - hz) <= HERO_RADIUS_M ? Math.round(base * HERO_BOOST) : base;
}
