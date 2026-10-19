import type { MultiPolygon as PcMulti } from "polygon-clipping";
import * as pcModule from "polygon-clipping";
import type { LocalFrame } from "../frame";
import { type Boundary, crossings, insideBoundary, type P } from "./boundary";

/**
 * Polygon cutting against the Elmina outline (A-T4, display only). Kept apart from `boundary.ts`
 * so only the main thread (`clipLayer.ts`) bundles polygon-clipping; the tile-plan worker imports
 * `boundary.ts` alone.
 */

// The package's ESM build has only a default export while its types declare named ones.
const pc = (pcModule as unknown as { default?: typeof pcModule }).default ?? pcModule;

/** True when some edge of the ring crosses the outline. */
function ringCrosses(b: Boundary, ring: readonly P[]): boolean {
  for (let i = 0; i < ring.length; i++)
    if (crossings(b, ring[i]!, ring[(i + 1) % ring.length]!).length > 0) return true;
  return false;
}

function pointInRing(ring: readonly P[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A polygon (lon/lat rings, outer first, closed or not) cut to the outline: the polygons of the
 * intersection (lon/lat, closed rings; [] when it lies outside). A polygon whose edges never cross
 * the outline and that contains no outline ring (an outer ring, or a hole of the outline) is
 * returned as it is when inside, or dropped when outside; anything else goes through the exact
 * intersection. The local frame is linear in lon/lat, so the cut is exact in metres too. Pure.
 */
export function clipPolygon(b: Boundary, rings: P[][], frame: LocalFrame): P[][][] {
  const outer = rings[0];
  if (!outer || outer.length < 3) return [];
  const local = outer.map(([lon, lat]) => frame.toLocal(lon, lat));
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [x, z] of local) {
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  }
  if (x1 < b.box[0] || x0 > b.box[2] || z1 < b.box[1] || z0 > b.box[3]) return [];
  if (!ringCrosses(b, local)) {
    // No crossing: each outline ring is wholly inside or wholly outside this polygon.
    const holds = b.polys.some((poly) =>
      poly.some((r) => r[0] !== undefined && pointInRing(local, r[0][0], r[0][1])),
    );
    if (!holds) {
      const [px, pz] = local[0]!;
      return insideBoundary(b, px, pz) ? [rings] : [];
    }
  }
  const closed = rings.map((r) => {
    const a = r[0]!;
    const z = r[r.length - 1]!;
    return a[0] === z[0] && a[1] === z[1] ? r : [...r, a];
  });
  try {
    return pc.intersection(closed as PcMulti[number], b.lonlat as PcMulti) as P[][][];
  } catch {
    // A degenerate ring polygon-clipping cannot cut: drop it rather than draw it outside.
    return [];
  }
}
