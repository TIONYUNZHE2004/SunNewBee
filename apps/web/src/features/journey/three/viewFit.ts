import * as THREE from "three";
import type { CamPoseLike, SafeRect, ViewFit } from "../../scene/three/journey/safeFrame";

const RAD = Math.PI / 180;

/**
 * A `ViewFit` from a perspective camera's projection (view offset for the side panel included):
 * `project` places a scratch camera with the same projection at any pose, so the fit sees exactly
 * what the engine camera would draw. `size` is the canvas in CSS px.
 */
export function createViewFit(
  camera: THREE.PerspectiveCamera,
  size: readonly [number, number],
  safe: SafeRect,
): ViewFit {
  const scratch = new THREE.PerspectiveCamera();
  scratch.projectionMatrix.copy(camera.projectionMatrix);
  scratch.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
  const v = new THREE.Vector3();
  let last: CamPoseLike | null = null;
  const place = (pose: CamPoseLike) => {
    if (last === pose) return;
    last = pose;
    scratch.position.set(...pose.pos);
    scratch.lookAt(pose.look[0], pose.look[1], pose.look[2]);
    scratch.updateMatrixWorld(true);
  };
  return {
    project(pose, p) {
      place(pose);
      v.set(p[0], p[1], p[2]).applyMatrix4(scratch.matrixWorldInverse);
      if (v.z >= 0) return null;
      v.applyMatrix4(scratch.projectionMatrix);
      return [((v.x + 1) / 2) * size[0], ((1 - v.y) / 2) * size[1]];
    },
    focalPx: size[1] / 2 / Math.tan((camera.fov * RAD) / 2),
    safe,
  };
}

/** Margins (CSS px) of the UI-safe area inside the card viewport (sides, and above the controls). */
export const SAFE_MARGIN = { side: 16, top: 16, bottom: 64, frameShare: 0.1 } as const;

/**
 * The UI-safe rectangle of the map: the card viewport (`measureMapArea`: left of the side panel,
 * above the phone sheet and attribution) minus the top stack (header, status, Simulation label,
 * HUD) and a band over the bottom controls.
 */
export function safeRectOf(vp: { w: number; h: number; top?: number }): SafeRect {
  // never wider than AC-D8's frame with its 10 % margin (her box must stay inside that too)
  const m = SAFE_MARGIN.frameShare;
  const t = Math.max((vp.top ?? 0) + SAFE_MARGIN.top, m * vp.h + 4);
  const b = Math.max(t + 1, Math.min(vp.h - SAFE_MARGIN.bottom, (1 - m) * vp.h - 4));
  const l = Math.max(SAFE_MARGIN.side, m * vp.w + 4);
  const r = Math.max(l + 1, Math.min(vp.w - SAFE_MARGIN.side, (1 - m) * vp.w - 4));
  return { l, t, r, b };
}
