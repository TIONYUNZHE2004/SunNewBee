import { STEP } from "../cesium/controls/cameraMath";
import type { CameraOps } from "../cesium/controls/cameraOps";
import { reducedMotion } from "../cesium/controls/cameraOps";

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
  maxRangeM: 9000,
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

export function clampPose(p: Pose, bounds: { min: [number, number]; max: [number, number] }): Pose {
  const m = LIMITS.maxCentreOffsetM;
  return {
    target: [
      clamp(p.target[0], bounds.min[0] - m, bounds.max[0] + m),
      clamp(p.target[1], bounds.min[1] - m, bounds.max[1] + m),
    ],
    rangeM: clamp(p.rangeM, LIMITS.minRangeM, LIMITS.maxRangeM),
    pitchDeg: clamp(p.pitchDeg, LIMITS.minPitchDeg, LIMITS.maxPitchDeg),
    headingDeg: p.headingDeg,
  };
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
