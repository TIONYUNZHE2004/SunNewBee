import { hash01 } from "../assets/fit";
import type { Tile, TileKey } from "./tiles";

/** A planning box in local metres, half-open: [x0, x1) x [z0, z1). */
export type Box = Tile["box"];

/** What a planner plans: the box (a tile's, or a union of tiles) and the tile's seed. */
export interface PlanArea {
  box: Box;
  /** From `seedFor(tile.key, salt)`: depends only on the tile key, never on visit order. */
  seed: string;
}

/** Half-open membership, so a point on a shared edge belongs to exactly one of two adjacent boxes. */
export const inBox = (b: Box, x: number, z: number): boolean =>
  x >= b.x0 && x < b.x1 && z >= b.z0 && z < b.z1;

/** The box grown by `m` metres on every side (still half-open). */
export const growBox = (b: Box, m: number): Box => ({
  x0: b.x0 - m,
  z0: b.z0 - m,
  x1: b.x1 + m,
  z1: b.z1 + m,
});

export const boxCentre = (b: Box): [number, number] => [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2];

/** Closed overlap of a [x0, z0, x1, z1] bounds with the box (a cheap reject before exact tests). */
export const touchesBox = (b: Box, x0: number, z0: number, x1: number, z1: number): boolean =>
  x1 >= b.x0 && x0 <= b.x1 && z1 >= b.z0 && z0 <= b.z1;

/** The seed of one tile for one planner: `hash01(tileKey, salt)`, as a string. */
export const seedFor = (key: TileKey, salt: string): string => String(hash01(key, salt));

/** How many layer caches `perLayer` has built (a cold first call): the streamer's warm-up proof. */
export const perLayerStats = { builds: 0 };

/**
 * `build()` memoised per layer object and frame, both held weakly. A planner keeps the local-frame
 * copy of a layer (points, bounds) here, so planning many tiles converts each layer once and a
 * tile only filters. Layers are treated as immutable (they come from the query cache); a value
 * that is not an object is never cached.
 */
export function perLayer<T>(
  cache: WeakMap<object, WeakMap<object, T>>,
  layer: unknown,
  frame: object,
  build: () => T,
): T {
  if (typeof layer !== "object" || layer === null) return build();
  let byFrame = cache.get(layer);
  if (!byFrame) {
    byFrame = new WeakMap();
    cache.set(layer, byFrame);
  }
  let v = byFrame.get(frame);
  if (v === undefined) {
    perLayerStats.builds++;
    v = build();
    byFrame.set(frame, v);
  }
  return v;
}

/** The square box of side 2 r centred on (x, z): it covers the circle of radius r. */
export const boxAround = (x: number, z: number, r: number): Box => ({
  x0: x - r,
  z0: z - r,
  x1: x + r,
  z1: z + r,
});
