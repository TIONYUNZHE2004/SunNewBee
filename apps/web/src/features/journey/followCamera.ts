import { reducedMotion } from "../scene/cesium/controls/cameraOps";
import { overviewPose } from "../scene/three/cameraFit";
import { LIMITS, type Pose, poseToCamera } from "../scene/three/cameraRig";
import type { Clearance } from "../scene/three/clearance";
import type { CameraDriver, Engine } from "../scene/three/engine";
import {
  blendPose,
  type CamPose,
  type FollowScene,
  journeyCameraAt,
} from "../scene/three/journey/followRig";
import { useJourney } from "./journeyStore";

/** Wall-clock ms a camera mode change (or the hand-over to the player) eases in. */
export const MODE_BLEND_MS = 1000;
/** Wall-clock ms of the flight that hands the camera to the orbit rig in Free mode. */
export const FREE_HANDOFF_MS = 600;

const RAD = Math.PI / 180;
const ease = (u: number) => {
  const k = Math.max(0, Math.min(1, u));
  return k * k * (3 - 2 * k);
};

/** An overview of the route itself, for a world without a slab fit (the tiny fixture). */
export function routeOverview(pointAt: (m: number) => [number, number], lengthM: number): CamPose {
  let x0 = Number.POSITIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  const n = 32;
  for (let i = 0; i <= n; i++) {
    const [x, z] = pointAt((lengthM * i) / n);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  const diag = Math.hypot(x1 - x0, z1 - z0);
  const c = poseToCamera({
    target: [(x0 + x1) / 2, (z0 + z1) / 2],
    rangeM: Math.max(300, Math.min(LIMITS.maxRangeM, diag * 1.6)),
    pitchDeg: -50,
    headingDeg: 0,
  });
  return { pos: c.position, look: c.target };
}

/** The overview the dive starts from: the slab's derived overview (A-T5), else the route's. */
export function overviewFor(
  engine: Pick<Engine, "cameraFit">,
  pointAt: (m: number) => [number, number],
  lengthM: number,
): CamPose {
  const fit = engine.cameraFit?.();
  if (fit) {
    const c = poseToCamera(overviewPose(fit));
    return { pos: c.position, look: c.target };
  }
  return routeOverview(pointAt, lengthM);
}

/** The orbit pose that keeps a camera where it is, around a ground point (Free mode hand-over). */
export function orbitPoseAround(
  camera: readonly [number, number, number],
  centre: readonly [number, number],
): Pose {
  const dx = camera[0] - centre[0];
  const dy = camera[1];
  const dz = camera[2] - centre[1];
  const r = Math.max(LIMITS.minRangeM, Math.hypot(dx, dy, dz));
  const pitch = -Math.asin(Math.max(-1, Math.min(1, dy / Math.max(1e-6, Math.hypot(dx, dy, dz)))));
  return {
    target: [centre[0], centre[1]],
    rangeM: r,
    pitchDeg: pitch / RAD,
    headingDeg: (((Math.atan2(-dx, dz) / RAD) % 360) + 360) % 360,
  };
}

export interface FollowController {
  driver: CameraDriver;
  /** The player takes the camera (play, seek, a camera mode chosen): until reset. */
  engage(): void;
  /** A new plan (or none): the camera stays with the rig until the player is used. */
  reset(): void;
  readonly engaged: boolean;
  /** The journey t of the last pose the driver returned (null when it did not drive). */
  readonly drivenT: number | null;
}

/**
 * The journey camera as an engine camera driver (`Engine.setCameraDriver`). While the player is in
 * use (`engage`) and the mode is follow or overview, every frame's camera is `journeyCameraAt` at the
 * store's `t`: a pure function of t, so a scrub and a play agree. A mode change, or the player
 * taking the camera, eases in over MODE_BLEND_MS (wall clock; at once under reduced motion). Free
 * mode and the end of the trip hand the camera back to the orbit rig where it stands (Free: around
 * her, through a short flight).
 */
export function createFollowController(deps: {
  engine: Pick<Engine, "rig" | "cameraFit">;
  /** The follow scene for the current plan, or null (no plan, no route yet). */
  scene: () => FollowScene | null;
  /** Her ground position now [x, z] (Free mode orbits around her). */
  hero: () => [number, number] | null;
  reduced?: () => boolean;
}): FollowController {
  const reduced = deps.reduced ?? reducedMotion;
  let engaged = false;
  let driven = false;
  let lastMode: string | null = null;
  let blend: { from: CamPose; t0: number } | null = null;
  let drivenT: number | null = null;

  const release = (current: { position: [number, number, number] }, free: boolean) => {
    if (driven && free) {
      const h = deps.hero();
      if (h) {
        const p = orbitPoseAround(current.position, h);
        if (reduced()) deps.engine.rig.set(p);
        else deps.engine.rig.flyTo(p, FREE_HANDOFF_MS);
      }
    }
    driven = false;
    blend = null;
    lastMode = null;
  };

  const driver: CameraDriver = (now, current) => {
    drivenT = null;
    const s = useJourney.getState();
    if (!engaged || !s.timeline) {
      driven = false;
      return null;
    }
    const ended = s.t >= s.timeline.total && !s.playing;
    if (s.camMode === "free" || ended) {
      release(current, s.camMode === "free");
      return null;
    }
    const sc = deps.scene();
    if (!sc) return null;
    const target = journeyCameraAt(sc, s.t, s.camMode);
    if (!target) return null;
    if (!driven || s.camMode !== lastMode) {
      blend = reduced() ? null : { from: { pos: current.position, look: current.look }, t0: now };
      lastMode = s.camMode;
    }
    driven = true;
    drivenT = s.t;
    if (blend) {
      const u = (now - blend.t0) / MODE_BLEND_MS;
      if (u < 1) {
        const p = blendPose(blend.from, target, ease(u));
        floorOf(sc.clearance, p);
        return { position: p.pos, look: p.look, animating: true };
      }
      blend = null;
    }
    return { position: target.pos, look: target.look };
  };

  return {
    driver,
    engage() {
      engaged = true;
    },
    reset() {
      engaged = false;
      driven = false;
      blend = null;
      lastMode = null;
    },
    get engaged() {
      return engaged;
    },
    get drivenT() {
      return drivenT;
    },
  };
}

function floorOf(c: Clearance | null | undefined, p: CamPose) {
  if (c) p.pos[1] = Math.max(p.pos[1], c.floorAt(p.pos[0], p.pos[2]));
}
