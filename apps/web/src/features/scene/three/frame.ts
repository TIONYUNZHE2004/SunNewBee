import type { LonLat } from "../geo";

/** Local east-north-up frame in metres, in Three.js axes (x east, y up, z = −north). */
export interface LocalFrame {
  origin: LonLat;
  /** Metres: x east, z = −north (Three.js y-up). */
  toLocal(lon: number, lat: number): [x: number, z: number];
  toLonLat(x: number, z: number): LonLat;
}

const A = 6378137;
const E2 = 0.00669437999014;
const RAD = Math.PI / 180;

/**
 * Local tangent plane at `origin` using the WGS84 radii of curvature there.
 * The error stays under 1 m across the township.
 */
export function createFrame(origin: LonLat): LocalFrame {
  const phi0 = origin[1] * RAD;
  const s = 1 - E2 * Math.sin(phi0) ** 2;
  const meridional = (A * (1 - E2)) / s ** 1.5;
  const eastPerRad = (A / Math.sqrt(s)) * Math.cos(phi0);
  return {
    origin,
    toLocal(lon, lat) {
      const x = (lon - origin[0]) * RAD * eastPerRad;
      const north = (lat - origin[1]) * RAD * meridional;
      return [x, north === 0 ? 0 : -north];
    },
    toLonLat(x, z) {
      return [origin[0] + x / eastPerRad / RAD, origin[1] + -z / meridional / RAD];
    },
  };
}
