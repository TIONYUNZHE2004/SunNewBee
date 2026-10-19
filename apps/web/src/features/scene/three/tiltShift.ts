import * as THREE from "three";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import type { Tier } from "../shared/quality";
import { THREE_TIERS } from "./quality";

/**
 * Tilt-shift depth of field (B-T5; spec 2026-10-19 resident journey §8 "Tilt-shift"): the toy
 * diorama look. A BokehPass focused on the subject: the follow target (`Engine.setFocusPoint`,
 * set by the journey follow rig), else the camera target (the map centre), which in a tilted
 * overview gives a horizontal band in focus. Aperture by camera distance, from the prototype
 * (`docs/03-product/prototypes/resident-journey`: <= 120 m aperture 0.00016 / maxblur 0.007,
 * farther 0.000022 / 0.006), blended over NEAR_M..FAR_M instead of the prototype's step.
 *
 * Display only. On High only (`THREE_TIERS.dof`), and off with the FX toggle off or under
 * prefers-reduced-motion (AC-B5). Markers and journey pins render after the composer, so they are
 * never blurred; the hero sits at the focus depth and stays sharp (AC-B4).
 */
export const TILT_SHIFT = {
  near: { aperture: 0.00016, maxblur: 0.007 },
  far: { aperture: 0.000022, maxblur: 0.006 },
  /** Camera distances (m) of the blend: near values at or under NEAR_M, far at or over FAR_M. */
  nearM: 60,
  farM: 240,
} as const;

/** Whether depth of field runs: the tier has it, the FX toggle is on and motion is not reduced. */
export function dofActive(s: { tier: Tier; fx: boolean; reducedMotion: boolean }): boolean {
  return THREE_TIERS[s.tier].dof && s.fx && !s.reducedMotion;
}

/** Aperture and max blur for a camera `distM` from its focus (log-distance blend, monotone). */
export function tiltShiftParams(distM: number): { aperture: number; maxblur: number } {
  const { near, far, nearM, farM } = TILT_SHIFT;
  const d = Math.max(1, distM);
  const k = Math.min(1, Math.max(0, Math.log(d / nearM) / Math.log(farM / nearM)));
  const s = k * k * (3 - 2 * k);
  // Aperture blends in log space (it spans 7x), max blur linearly.
  const aperture = Math.exp(
    Math.log(near.aperture) + (Math.log(far.aperture) - Math.log(near.aperture)) * s,
  );
  return { aperture, maxblur: near.maxblur + (far.maxblur - near.maxblur) * s };
}

const tmp = new THREE.Vector3();

/** BokehPass `focus`: the point's depth along the camera's view axis, at least the near plane. */
export function focusDepth(camera: THREE.PerspectiveCamera, point: THREE.Vector3): number {
  camera.updateMatrixWorld();
  tmp.copy(point).applyMatrix4(camera.matrixWorldInverse);
  return Math.max(camera.near, -tmp.z);
}

/**
 * BokehPass whose depth render leaves out `skip()` objects (Line2 batches: overlay lines and the
 * journey ribbon draw garbage quads under the depth override material). Hidden for the pass, then
 * restored; the colour image is the composer's, so the lines are still drawn (with the depth of
 * the surface under them).
 */
export class CityBokehPass extends BokehPass {
  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    private readonly skip: () => readonly THREE.Object3D[],
  ) {
    super(scene, camera, {
      focus: 100,
      aperture: TILT_SHIFT.far.aperture,
      maxblur: TILT_SHIFT.far.maxblur,
    });
  }

  /** Focus at view depth `focusM` with the aperture for a camera `distM` from its focus. */
  aim(focusM: number, distM: number): void {
    const p = tiltShiftParams(distM);
    const u = this.uniforms as Record<string, { value: number }>;
    (u.focus as { value: number }).value = focusM;
    (u.aperture as { value: number }).value = p.aperture;
    (u.maxblur as { value: number }).value = p.maxblur;
  }

  override render(...args: Parameters<BokehPass["render"]>): void {
    const hidden = this.skip().filter((o) => o.visible);
    for (const o of hidden) o.visible = false;
    try {
      super.render(...args);
    } finally {
      for (const o of hidden) o.visible = true;
    }
  }
}
