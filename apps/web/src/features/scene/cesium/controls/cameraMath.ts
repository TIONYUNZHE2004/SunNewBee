/** Pure camera maths for the 3D map (Cesium Realistic; STEP is shared with Three.js) (no Cesium import; unit-tested). */
const RAD = Math.PI / 180;
const M_PER_DEG = 111_320;
const TAU = Math.PI * 2;

export const LIMITS = {
  minRangeM: 30,
  maxRangeM: 20_000,
  /** Stop 5 degrees short of the horizon. */
  maxPitchRad: -5 * RAD,
  minPitchRad: -90 * RAD,
  boundsMarginM: 5000,
} as const;

export const STEP = {
  orbitRad: 15 * RAD,
  tiltRad: 7.5 * RAD,
  zoomIn: 0.7,
  zoomOut: 1 / 0.7,
  /** Keyboard move: this share of the camera height per press. */
  moveShare: 0.25,
} as const;

export type Hpr = { heading: number; pitch: number; range: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

export const clampPitch = (p: number) => clamp(p, LIMITS.minPitchRad, LIMITS.maxPitchRad);

export function orbitStep(h: Hpr, dHeading: number, dPitch: number, zoomFactor = 1): Hpr {
  return {
    heading: wrap(h.heading + dHeading),
    pitch: clampPitch(h.pitch + dPitch),
    range: clamp(h.range * zoomFactor, LIMITS.minRangeM, LIMITS.maxRangeM),
  };
}

/** Ground-plane move: heading clockwise from north; returns metres [east, north]. */
export function moveVector(headingRad: number, right: number, forward: number): [number, number] {
  const s = Math.sin(headingRad);
  const c = Math.cos(headingRad);
  return [right * c + forward * s, -right * s + forward * c];
}

export function clampToBounds(
  lon: number,
  lat: number,
  bbox: readonly [number, number, number, number],
  marginM: number,
): [number, number] {
  const [w, s, e, n] = bbox;
  const dLat = marginM / M_PER_DEG;
  const dLon = marginM / (M_PER_DEG * Math.cos(((s + n) / 2) * RAD));
  return [clamp(lon, w - dLon, e + dLon), clamp(lat, s - dLat, n + dLat)];
}

export type KeyAction =
  | { kind: "move"; right: number; forward: number }
  | { kind: "orbit"; dHeading: number; dPitch: number }
  | { kind: "zoom"; factor: number };

const KEYS: Record<string, KeyAction> = {
  w: { kind: "move", right: 0, forward: 1 },
  arrowup: { kind: "move", right: 0, forward: 1 },
  s: { kind: "move", right: 0, forward: -1 },
  arrowdown: { kind: "move", right: 0, forward: -1 },
  a: { kind: "move", right: -1, forward: 0 },
  arrowleft: { kind: "move", right: -1, forward: 0 },
  d: { kind: "move", right: 1, forward: 0 },
  arrowright: { kind: "move", right: 1, forward: 0 },
  q: { kind: "orbit", dHeading: -STEP.orbitRad, dPitch: 0 },
  e: { kind: "orbit", dHeading: STEP.orbitRad, dPitch: 0 },
  r: { kind: "orbit", dHeading: 0, dPitch: STEP.tiltRad },
  f: { kind: "orbit", dHeading: 0, dPitch: -STEP.tiltRad },
  "+": { kind: "zoom", factor: STEP.zoomIn },
  "=": { kind: "zoom", factor: STEP.zoomIn },
  "-": { kind: "zoom", factor: STEP.zoomOut },
  _: { kind: "zoom", factor: STEP.zoomOut },
};

export const keyAction = (key: string): KeyAction | null => KEYS[key.toLowerCase()] ?? null;
