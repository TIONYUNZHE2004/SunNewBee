/** Township streaming grid: 250 m squares in the local frame (x east, z = -north), keyed from the origin. */

export const TILE_M = 250;

/** "i,j": i = floor(x / TILE_M), j = floor(z / TILE_M). */
export type TileKey = string;

export interface Tile {
  key: TileKey;
  i: number;
  j: number;
  /** Half-open box [x0, x1) x [z0, z1) in local metres. */
  box: { x0: number; z0: number; x1: number; z1: number };
}

/** Ring 2 applies only while the camera range is at most this (metres). */
export const RING2_MAX_RANGE_M = 1500;

/** The tile at grid index (i, j). */
export function tileOf(i: number, j: number): Tile {
  return {
    key: `${i},${j}`,
    i,
    j,
    box: { x0: i * TILE_M, z0: j * TILE_M, x1: (i + 1) * TILE_M, z1: (j + 1) * TILE_M },
  };
}

/** The tile containing (x, z). A point on a shared edge belongs to the higher index. */
export function tileAt(x: number, z: number): Tile {
  // `+ 0` turns -0 into 0 so keys never read "-0,3".
  return tileOf(Math.floor(x / TILE_M) + 0, Math.floor(z / TILE_M) + 0);
}

/**
 * The tiles around the camera target: ring 0 is the target tile, ring 1 the 8 around it, ring 2
 * (only when `rangeM <= 1500`) 16 more. Ring is the Chebyshev tile distance. Ordered ring first,
 * then by distance from the target to the tile centre, then by key (a stable total order).
 */
export function activeTiles(
  target: { x: number; z: number },
  rangeM: number,
): Array<{ tile: Tile; ring: 0 | 1 | 2 }> {
  const c = tileAt(target.x, target.z);
  const maxRing = rangeM <= RING2_MAX_RANGE_M ? 2 : 1;
  const out: Array<{ tile: Tile; ring: 0 | 1 | 2; d: number }> = [];
  for (let dj = -maxRing; dj <= maxRing; dj++) {
    for (let di = -maxRing; di <= maxRing; di++) {
      const ring = Math.max(Math.abs(di), Math.abs(dj)) as 0 | 1 | 2;
      const tile = tileOf(c.i + di, c.j + dj);
      const cx = (tile.box.x0 + tile.box.x1) / 2;
      const cz = (tile.box.z0 + tile.box.z1) / 2;
      out.push({ tile, ring, d: Math.hypot(cx - target.x, cz - target.z) });
    }
  }
  out.sort((a, b) => a.ring - b.ring || a.d - b.d || (a.tile.key < b.tile.key ? -1 : 1));
  return out.map(({ tile, ring }) => ({ tile, ring }));
}
