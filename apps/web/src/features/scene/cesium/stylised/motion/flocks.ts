import { hashUnit } from "../model";

/**
 * Decorative bird loops and cloud spots (display only, seeded, never a fact). Positions are metres
 * east / north / up of the scene anchor `at`; times are seconds.
 */

const M_PER_DEG = 111_320;
const RAD = Math.PI / 180;

export interface Loop {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  z: number;
  period: number;
  phase: number;
}

export function flockLoops(
  at: { lon: number; lat: number },
  anchors: [number, number][],
  n: number,
  seed: string,
): Loop[] {
  const kx = Math.cos(at.lat * RAD) * M_PER_DEG;
  const pts = anchors.length > 0 ? anchors : [[at.lon, at.lat] as [number, number]];
  return Array.from({ length: n }, (_, i) => {
    const key = `${seed}:flock:${i}`;
    const [lon, lat] = pts[Math.floor(hashUnit(key, "a") * pts.length)]!;
    return {
      cx: (lon - at.lon) * kx,
      cy: (lat - at.lat) * M_PER_DEG,
      rx: 80 + hashUnit(key, "rx") * 120,
      ry: 50 + hashUnit(key, "ry") * 80,
      z: 40 + hashUnit(key, "z") * 50,
      period: 35 + hashUnit(key, "p") * 25,
      phase: hashUnit(key, "ph") * Math.PI * 2,
    };
  });
}

/** Smooth closed loop (ellipse with a gentle figure-eight wobble and bob). */
export function loopPoint(l: Loop, tSec: number): [number, number, number] {
  const a = (tSec / l.period) * Math.PI * 2 + l.phase;
  return [
    l.cx + l.rx * Math.cos(a),
    l.cy + l.ry * Math.sin(a) + 0.2 * l.ry * Math.sin(2 * a),
    l.z + 3 * Math.sin(3 * a),
  ];
}

export function cloudSpots(n: number, seed: string, extentM: number) {
  return Array.from({ length: n }, (_, i) => {
    const key = `${seed}:cloud:${i}`;
    return {
      x: (hashUnit(key, "x") - 0.5) * extentM,
      y: (hashUnit(key, "y") - 0.5) * extentM,
      z: 250 + hashUnit(key, "z") * 150,
      scale: 0.7 + hashUnit(key, "s") * 0.8,
    };
  });
}

/** Wrap `v` into [-extent/2, extent/2). */
export const wrapCentred = (v: number, extentM: number) =>
  ((((v + extentM / 2) % extentM) + extentM) % extentM) - extentM / 2;

/** Drift east-north-east at `speedMps`, wrapping within [-extent/2, extent/2]. */
export function cloudOffset(tSec: number, speedMps = 3, extentM = 4000): [number, number] {
  return [
    wrapCentred(tSec * speedMps * 0.92, extentM),
    wrapCentred(tSec * speedMps * 0.38, extentM),
  ];
}
