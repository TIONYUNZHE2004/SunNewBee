import { STEP } from "../cesium/controls/cameraMath";
import type { CameraOps } from "../cesium/controls/cameraOps";
import { reducedMotion } from "../cesium/controls/cameraOps";
import { type Boundary, insideBoundary, nearestEdgePoint } from "./ground/boundary";

/** Camera pose in the local frame. Heading 0 = facing north; target is [x, z]. */
export interface Pose {
  target: [number, number];
  rangeM: number;
  pitchDeg: number;
  headingDeg: number;
}

export const VFOV_DEG = 30;
export const LIMITS = {
  minRangeM: 30,
  maxRangeM: 7900,
  minPitchDeg: -89,
  maxPitchDeg: -5,
  maxCentreOffsetM: 5000,
} as const;

const RAD = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function poseToCamera(p: Pose): {
  position: [number, number, number];
  target: [number, number, number];
} {
  const h = p.headingDeg * RAD;
  const pt = p.pitchDeg * RAD;
  const fx = Math.sin(h) * Math.cos(pt);
  const fy = Math.sin(pt);
  const fz = -Math.cos(h) * Math.cos(pt);
  const [tx, tz] = p.target;
  return {
    position: [tx - fx * p.rangeM, -fy * p.rangeM, tz - fz * p.rangeM],
    target: [tx, 0, tz],
  };
}

/**
 * The slab the camera is bound to (spec 2026-10-19 resident journey A6, task A-T5), built once per
 * outline by `cameraFit.ts` `fitFor`. Display only.
 */
export interface CameraFit {
  boundary: Boundary;
  /** What must be on screen at max range: every outline vertex (y 0) and the outer foot of its soil section. */
  corners: readonly (readonly [number, number, number])[];
  /**
   * The corners on the convex hull of each height level (the outline at y 0, the section feet
   * below): the vertices of the corners' 3D hull are among them. A projection's extremes (and any
   * corner behind the camera) lie on hull vertices, so `requiredVfovDeg` over `hull` equals it over
   * `corners`, for a fraction of the cost.
   */
  hull: readonly (readonly [number, number, number])[];
  /** The max-range target is `centre` (inside the outline) plus `shiftM` along the view (`fitCentre`). */
  centre: [number, number];
  shiftM: number;
  /** The max-range view faces this heading or its opposite (deg, [0, 180)). */
  axisHeadingDeg: number;
}

/**
 * Long-range rules (A-T5, AC-A6). Below `startRangeM` the camera is exactly as before (street and
 * mid-range pitch, heading, target and field of view unchanged). From there to LIMITS.maxRangeM a
 * smoothstep weight (`fitWeight`) narrows the pose towards the max-range framing:
 * - the target is pulled towards the fit centre (allowed radius: the outline box diagonal -> 0);
 * - the pitch band narrows from [-89, -5] to [farPitchMinDeg, farPitchMaxDeg] (steeper at range);
 * - the heading window narrows from free to `farHeadingDevDeg` either side of the slab axis;
 * - the vertical field of view widens from VFOV_DEG to what the slab corners need at max range for
 *   that heading, pitch and canvas aspect (`vfovFor`), capped at `maxVfovDeg`.
 * LIMITS.maxRangeM itself is unchanged (AC-A7: 25 wheel notches).
 */
export const FIT = {
  startRangeM: 2500,
  farPitchMinDeg: -60,
  farPitchMaxDeg: -45,
  farHeadingDevDeg: 15,
  /**
   * The safe frame, in NDC: corners must project at most `safeTop` up, `safeBottom` down and
   * `safeSide` sideways. The map chrome overlays the canvas edges (1440x900, canvas 874 px high: the
   * brand / mode pill reaches about 66 px into the top, the attribution bar about 45 px into the
   * bottom), so the slab edge is kept clear of it, not only inside the canvas.
   */
  safeTop: 0.82,
  safeBottom: 0.86,
  safeSide: 0.96,
  maxVfovDeg: 50,
} as const;

/** 0 up to FIT.startRangeM, 1 at LIMITS.maxRangeM, smoothstep between. */
export function fitWeight(rangeM: number): number {
  const t = clamp((rangeM - FIT.startRangeM) / (LIMITS.maxRangeM - FIT.startRangeM), 0, 1);
  return t * t * (3 - 2 * t);
}

/** An angle difference (deg) wrapped to [-180, 180). */
export const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** The heading kept within `devDeg` of the axis or its opposite, whichever is nearer. Pure. */
export function clampHeading(headingDeg: number, axisDeg: number, devDeg: number): number {
  let a = axisDeg;
  let d = wrap180(headingDeg - a);
  if (Math.abs(d) > 90) {
    a += 180;
    d = wrap180(headingDeg - a);
  }
  if (Math.abs(d) <= devDeg) return headingDeg;
  return (((a + Math.sign(d) * devDeg) % 360) + 360) % 360;
}

/**
 * The max-range target for a heading: the fit centre moved `shiftM` along the view direction
 * (perspective shrinks the far side, so the framing looks past the middle), kept inside. Pure.
 */
export function fitCentre(fit: CameraFit, headingDeg: number): [number, number] {
  const h = headingDeg * RAD;
  const p: [number, number] = [
    fit.centre[0] + Math.sin(h) * fit.shiftM,
    fit.centre[1] - Math.cos(h) * fit.shiftM,
  ];
  return insideBoundary(fit.boundary, p[0], p[1]) ? p : towards(fit.boundary, fit.centre, p);
}

/** Last point inside the outline on the segment from `inside` (inside) towards `p`. */
function towards(b: Boundary, inside: [number, number], p: [number, number]): [number, number] {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (insideBoundary(b, inside[0] + (p[0] - inside[0]) * m, inside[1] + (p[1] - inside[1]) * m))
      lo = m;
    else hi = m;
  }
  return [inside[0] + (p[0] - inside[0]) * lo, inside[1] + (p[1] - inside[1]) * lo];
}

/**
 * The target kept inside the outline (projected to the nearest outline point, nudged 0.5 m in,
 * when outside) and within `radiusM` of `centre` (inside the outline). Idempotent. Pure.
 */
export function clampTarget(
  target: [number, number],
  fit: CameraFit,
  centre: [number, number],
  radiusM: number,
): [number, number] {
  const b = fit.boundary;
  let p: [number, number] = [target[0], target[1]];
  if (!insideBoundary(b, p[0], p[1])) {
    const q = nearestEdgePoint(b, p[0], p[1]);
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const l = Math.hypot(dx, dz) || 1;
    const n: [number, number] = [q[0] + (dx / l) * 0.5, q[1] + (dz / l) * 0.5];
    p = insideBoundary(b, n[0], n[1]) ? n : towards(b, centre, q);
  }
  const [cx, cz] = centre;
  const d = Math.hypot(p[0] - cx, p[1] - cz);
  if (d > radiusM) {
    const k = radiusM / d;
    const s: [number, number] = [cx + (p[0] - cx) * k, cz + (p[1] - cz) * k];
    p = insideBoundary(b, s[0], s[1]) ? s : towards(b, centre, s);
  }
  return p;
}

/**
 * Range and pitch limits, and the target bound: with a fit (a world with an outline) the target
 * stays inside the outline and the long-range rules apply (FIT); without one (the tiny fixture)
 * the target stays within LIMITS.maxCentreOffsetM of the bounds box.
 */
export function clampPose(
  p: Pose,
  bounds: { min: [number, number]; max: [number, number] },
  fit?: CameraFit | null,
): Pose {
  const rangeM = clamp(p.rangeM, LIMITS.minRangeM, LIMITS.maxRangeM);
  if (!fit) {
    const m = LIMITS.maxCentreOffsetM;
    return {
      target: [
        clamp(p.target[0], bounds.min[0] - m, bounds.max[0] + m),
        clamp(p.target[1], bounds.min[1] - m, bounds.max[1] + m),
      ],
      rangeM,
      pitchDeg: clamp(p.pitchDeg, LIMITS.minPitchDeg, LIMITS.maxPitchDeg),
      headingDeg: p.headingDeg,
    };
  }
  const t = fitWeight(rangeM);
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const headingDeg =
    t > 0
      ? clampHeading(p.headingDeg, fit.axisHeadingDeg, lerp(90, FIT.farHeadingDevDeg))
      : p.headingDeg;
  return {
    target: clampTarget(
      p.target,
      fit,
      fitCentre(fit, headingDeg),
      t > 0
        ? (1 - t) *
            Math.hypot(
              fit.boundary.box[2] - fit.boundary.box[0],
              fit.boundary.box[3] - fit.boundary.box[1],
            )
        : Number.POSITIVE_INFINITY,
    ),
    rangeM,
    pitchDeg: clamp(
      p.pitchDeg,
      lerp(LIMITS.minPitchDeg, FIT.farPitchMinDeg),
      lerp(LIMITS.maxPitchDeg, FIT.farPitchMaxDeg),
    ),
    headingDeg,
  };
}

/**
 * The vertical field of view (deg) that puts every corner inside the safe frame (FIT.safeTop,
 * safeBottom, safeSide) for a pose and canvas aspect (width / height); Infinity when a corner is
 * behind the camera. Pure.
 */
export function requiredVfovDeg(p: Pose, corners: CameraFit["corners"], aspect: number): number {
  const h = p.headingDeg * RAD;
  const pt = p.pitchDeg * RAD;
  const f = [Math.sin(h) * Math.cos(pt), Math.sin(pt), -Math.cos(h) * Math.cos(pt)] as const;
  const r = [Math.cos(h), 0, Math.sin(h)] as const;
  // up = right x forward
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const c = poseToCamera(p).position;
  let tan = 0;
  for (const [x, y, z] of corners) {
    const dx = x - c[0];
    const dy = y - c[1];
    const dz = z - c[2];
    const depth = dx * f[0] + dy * f[1] + dz * f[2];
    if (depth <= 0) return Infinity;
    const th = Math.abs(dx * r[0] + dz * r[2]) / depth / aspect / FIT.safeSide;
    const up = (dx * u[0]! + dy * u[1]! + dz * u[2]!) / depth;
    const tv = up >= 0 ? up / FIT.safeTop : -up / FIT.safeBottom;
    tan = Math.max(tan, th, tv);
  }
  return (2 * Math.atan(tan)) / RAD;
}

/**
 * The camera's vertical field of view (deg) for a pose: VFOV_DEG below FIT.startRangeM; towards
 * max range it widens (fitWeight) to what the slab needs at max range from the fit centre at this
 * heading and pitch, never below VFOV_DEG nor above FIT.maxVfovDeg. Pure.
 */
export function vfovFor(p: Pose, fit: CameraFit | null | undefined, aspect: number): number {
  if (!fit) return VFOV_DEG;
  const t = fitWeight(p.rangeM);
  if (t === 0) return VFOV_DEG;
  const need = requiredVfovDeg(
    { ...p, target: fitCentre(fit, p.headingDeg), rangeM: LIMITS.maxRangeM },
    fit.hull,
    aspect,
  );
  return VFOV_DEG + (clamp(need, VFOV_DEG, FIT.maxVfovDeg) - VFOV_DEG) * t;
}

const ease = (t: number) => t * t * (3 - 2 * t);

/** Eased blend; heading takes the shortest arc. */
export function tweenPose(a: Pose, b: Pose, t: number): Pose {
  const k = ease(clamp(t, 0, 1));
  const dh = ((((b.headingDeg - a.headingDeg) % 360) + 540) % 360) - 180;
  return {
    target: [
      a.target[0] + (b.target[0] - a.target[0]) * k,
      a.target[1] + (b.target[1] - a.target[1]) * k,
    ],
    rangeM: a.rangeM + (b.rangeM - a.rangeM) * k,
    pitchDeg: a.pitchDeg + (b.pitchDeg - a.pitchDeg) * k,
    headingDeg: a.headingDeg + dh * k,
  };
}

/** Arguments for camera.setViewOffset so the look point sits mid-way across the area left of the panel. */
export function viewOffsetFor(
  w: number,
  h: number,
  panelPx: number,
): [number, number, number, number, number, number] {
  return [w, h, panelPx / 2, 0, w, h];
}

export interface CameraRig {
  get(): Pose;
  set(p: Pose): void;
  flyTo(p: Pose, durationMs: number): void;
  /** Ground point [x, z] under a screen position, or null (sky). */
  pick(screen: { x: number; y: number }): [number, number] | null;
}

const FLY_MS = 1200;
const GLIDE_MS = 800;

/** `CameraOps` with a plain `{x, y}` glideTo (a Cesium Cartesian2 satisfies it, so this is assignable to `CameraOps`). */
export type ThreeCameraOps = Omit<CameraOps, "glideTo"> & {
  glideTo(screen: { x: number; y: number }): void;
};

export function createThreeCameraOps(
  rig: CameraRig,
  home: () => Pose,
  whole: () => Pose,
  onUserMove?: () => void,
): ThreeCameraOps {
  const apply = (p: Pose, ms: number) => {
    if (reducedMotion()) rig.set(p);
    else rig.flyTo(p, ms);
  };
  const change = (patch: (p: Pose) => Partial<Pose>) => {
    onUserMove?.();
    const p = rig.get();
    rig.set({ ...p, ...patch(p) });
  };
  const zoom = (factor: number) => change((p) => ({ rangeM: p.rangeM * factor }));

  return {
    orbit: (dHeading, dPitch) =>
      change((p) => ({
        headingDeg: (((p.headingDeg + dHeading / RAD) % 360) + 360) % 360,
        pitchDeg: p.pitchDeg + dPitch / RAD,
      })),
    zoom,
    move: (right, forward) =>
      change((p) => {
        const step = Math.max(10, p.rangeM * STEP.moveShare);
        const h = p.headingDeg * RAD;
        const east = (right * Math.cos(h) + forward * Math.sin(h)) * step;
        const north = (-right * Math.sin(h) + forward * Math.cos(h)) * step;
        return { target: [p.target[0] + east, p.target[1] - north] };
      }),
    glideTo(screen) {
      const hit = rig.pick(screen);
      if (!hit) {
        zoom(0.5);
        return;
      }
      onUserMove?.();
      const p = rig.get();
      apply({ ...p, target: hit, rangeM: Math.max(LIMITS.minRangeM, p.rangeM * 0.5) }, GLIDE_MS);
    },
    faceNorth: () => change(() => ({ headingDeg: 0 })),
    home() {
      onUserMove?.();
      apply(home(), FLY_MS);
    },
    whole() {
      onUserMove?.();
      apply(whole(), FLY_MS);
    },
    headingRad: () => rig.get().headingDeg * RAD,
  };
}
