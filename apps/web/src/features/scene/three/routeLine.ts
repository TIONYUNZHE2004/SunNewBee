import type { LonLat } from "../geo";
import type { LocalFrame } from "./frame";

/** Metres the route ribbon floats above the ground so it never z-fights. */
export const ROUTE_LIFT_M = 0.6;

/** Lon/lat line to local xyz triplets (y up). Non-finite points are dropped; under 2 points gives empty. */
export function lineToLocal(
  coords: LonLat[],
  frame: LocalFrame,
  liftM = ROUTE_LIFT_M,
): Float32Array {
  const pts = coords.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (pts.length < 2) return new Float32Array(0);
  const out = new Float32Array(pts.length * 3);
  pts.forEach((c, i) => {
    const [x, z] = frame.toLocal(c[0], c[1]);
    out[i * 3] = x;
    out[i * 3 + 1] = liftM;
    out[i * 3 + 2] = z;
  });
  return out;
}
