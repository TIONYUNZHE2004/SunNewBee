/**
 * UI-safe framing for the journey camera (final gate, AC-D11 / AC-D8): at an event hold the hero,
 * the event's element and its marker must land inside the part of the map that no UI covers (below
 * the header / status / HUD stack, left of the side panel, above the bottom controls). The follow rig
 * frames in world space; this pass corrects a pose in screen space: it turns the camera (pitch, then
 * yaw) so the subjects' screen box sits inside the safe rectangle, and pulls it back along its view
 * line (at most `SAFE_FIT.maxPull`) when the box is larger than the rectangle.
 *
 * Pure: the projection is passed in (`ViewFit.project`, the engine camera's projection at a pose),
 * so the same pose, subjects and view give the same answer (scrub equals play, AC-D17).
 */

import type { Vec3 } from "../clearance";

export interface CamPoseLike {
  pos: Vec3;
  look: Vec3;
}

/** A screen rectangle in canvas CSS px (left, top, right, bottom). */
export interface SafeRect {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** What the fit needs from the view: a projector for any pose, its focal length and the safe area. */
export interface ViewFit {
  /** Canvas CSS px [x right, y down] of world point `p` seen from `pose`; null behind the camera. */
  project(pose: CamPoseLike, p: Vec3): [number, number] | null;
  /** Vertical focal length in CSS px (h / 2 / tan(fov / 2)). */
  focalPx: number;
  /** The UI-safe rectangle (canvas CSS px). */
  safe: SafeRect;
}

/** A point to keep inside the safe rectangle, with a screen pad (px) around it (a marker's size). */
export interface Subject {
  p: Vec3;
  padPx: number;
}

export const SAFE_FIT = {
  /** Largest pull-back along the view line (factor on the camera-to-look distance). */
  maxPull: 2.0,
  pullStep: 1.12,
  iterations: 16,
  /** A residual under this many px is done. */
  tolPx: 0.5,
  /** The camera never looks above this downward slope (dir.y / |dir|): it stays a look-down shot. */
  maxUpSlope: -0.03,
  /** Seconds a hold's fit eases in after the hold starts and out before it ends. */
  rampS: 0.6,
  /** Screen pads: the active marker sprite (~65 px tall at 900 px), the element, her body. */
  markerPadPx: 36,
  /** Her box for the fit (m): half-width around her and top; seated, the walker stands out. */
  heroBoxRadiusM: 1.25,
  heroBoxTopM: 2.6,
  elementPadPx: 12,
  heroPadPx: 8,
} as const;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Rodrigues: v turned by `rad` about the unit axis k. */
function rotate(v: Vec3, k: Vec3, rad: number): Vec3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * kd,
    v[1] * c + kv[1] * s + k[1] * kd,
    v[2] * c + kv[2] * s + k[2] * kd,
  ];
}

/**
 * Turns the camera about its position: `yaw` (rad, + turns left, so the image moves right) about the
 * vertical, then `pitch` (rad, + tilts up, so the image moves down) about its right axis. The look
 * distance is kept; the view never rises above `SAFE_FIT.maxUpSlope`.
 */
export function turnCamera(p: CamPoseLike, yaw: number, pitch: number): CamPoseLike {
  let dir = sub(p.look, p.pos);
  const len = norm(dir) || 1e-6;
  dir = rotate(dir, [0, 1, 0], yaw);
  const right = cross(dir, [0, 1, 0]);
  const rl = norm(right);
  if (rl > 1e-9) {
    const turned = rotate(dir, scale(right, 1 / rl), pitch);
    if (turned[1] / len <= SAFE_FIT.maxUpSlope) dir = turned;
    else {
      // the steepest allowed slope instead (keep the horizontal heading)
      const h = Math.hypot(turned[0], turned[2]) || 1e-6;
      const y = SAFE_FIT.maxUpSlope * len;
      const hl = Math.sqrt(Math.max(0, len * len - y * y));
      dir = [(turned[0] / h) * hl, y, (turned[2] / h) * hl];
    }
  }
  return { pos: [...p.pos], look: add(p.pos, dir) };
}

/** The camera moved back along its view line by factor k (the look point stays). */
export function pullBack(p: CamPoseLike, k: number): CamPoseLike {
  return { pos: add(p.look, scale(sub(p.pos, p.look), k)), look: [...p.look] };
}

/** The subjects' padded screen box, or null when one is behind the camera. */
function screenBox(p: CamPoseLike, subjects: readonly Subject[], view: ViewFit) {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const s of subjects) {
    const q = view.project(p, s.p);
    if (!q) return null;
    x0 = Math.min(x0, q[0] - s.padPx);
    x1 = Math.max(x1, q[0] + s.padPx);
    y0 = Math.min(y0, q[1] - s.padPx);
    y1 = Math.max(y1, q[1] + s.padPx);
  }
  return { x0, y0, x1, y1 };
}

/**
 * Shift (px) for the span [a, b] against [lo, hi]: none while it is inside; once any part is out,
 * the shift that centres it (a minimal shift parks the subjects on the edge: her feet on the
 * frame's bottom margin when the marker is brought down, gate AC-D8).
 */
function shiftInto(a: number, b: number, lo: number, hi: number): number {
  if (a >= lo && b <= hi) return 0;
  return (lo + hi) / 2 - (a + b) / 2;
}

/** True when every subject's padded box lies inside the safe rectangle (within `tolPx`). */
export function insideSafe(p: CamPoseLike, subjects: readonly Subject[], view: ViewFit): boolean {
  const b = screenBox(p, subjects, view);
  const s = view.safe;
  const e = SAFE_FIT.tolPx;
  return !!b && b.x0 >= s.l - e && b.x1 <= s.r + e && b.y0 >= s.t - e && b.y1 <= s.b + e;
}

/**
 * The pose turned (and if needed pulled back) so the subjects' padded screen box lies inside the
 * safe rectangle. A pose already inside is returned unchanged. Deterministic (a fixed iteration).
 */
export function fitSafe(
  pose: CamPoseLike,
  subjects: readonly Subject[],
  view: ViewFit,
  /** Applied to the camera after every move (e.g. the hard floor), so the fit sees the result. */
  constrain?: (p: CamPoseLike) => void,
): CamPoseLike {
  if (subjects.length === 0) return pose;
  let p: CamPoseLike = { pos: [...pose.pos], look: [...pose.look] };
  let pulled = 1;
  const s = view.safe;
  const f = Math.max(1, view.focalPx);
  for (let i = 0; i < SAFE_FIT.iterations; i++) {
    const b = screenBox(p, subjects, view);
    const canPull = pulled * SAFE_FIT.pullStep <= SAFE_FIT.maxPull + 1e-9;
    if (!b) {
      if (!canPull) break;
      p = pullBack(p, SAFE_FIT.pullStep);
      pulled *= SAFE_FIT.pullStep;
      constrain?.(p);
      continue;
    }
    const tooBig = b.x1 - b.x0 > s.r - s.l || b.y1 - b.y0 > s.b - s.t;
    if (tooBig && canPull) {
      p = pullBack(p, SAFE_FIT.pullStep);
      pulled *= SAFE_FIT.pullStep;
      constrain?.(p);
      continue;
    }
    const dx = shiftInto(b.x0, b.x1, s.l, s.r);
    const dy = shiftInto(b.y0, b.y1, s.t, s.b);
    if (Math.abs(dx) < SAFE_FIT.tolPx && Math.abs(dy) < SAFE_FIT.tolPx) break;
    p = turnCamera(p, Math.atan(dx / f), Math.atan(dy / f));
  }
  return p;
}

/** Linear blend of two poses (position and look point), k in [0, 1]. */
export function lerpPose(a: CamPoseLike, b: CamPoseLike, k: number): CamPoseLike {
  const l = (u: Vec3, v: Vec3): Vec3 => [
    u[0] + (v[0] - u[0]) * k,
    u[1] + (v[1] - u[1]) * k,
    u[2] + (v[2] - u[2]) * k,
  ];
  return { pos: l(a.pos, b.pos), look: l(a.look, b.look) };
}

/** The hold fit's weight at screen time t in a hold [t0, t1): eases in and out over `rampS`. */
export function holdFitWeight(t: number, t0: number, t1: number): number {
  const r = SAFE_FIT.rampS;
  const u = Math.max(0, Math.min(1, (t - t0) / r, (t1 - t) / r));
  return u * u * (3 - 2 * u);
}
