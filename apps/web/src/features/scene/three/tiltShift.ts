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
 * farther 0.000022 / 0.006), blended over NEAR_M..FAR_M instead of the prototype's step, and
 * capped so the blur saturates no closer than `bandK` x the focus depth (a band at any range).
 * In follow mode (a subject) the blur is stronger and tighter around her (`TILT_SHIFT.subject`).
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
  /**
   * The blur saturates (maxblur) no closer than bandK x the focus depth: the prototype's far
   * aperture does that at ~300 m (0.006 / 0.000022 = 272 m), and the cap keeps the ratio at every
   * range. Without it the 7 km overview was blurred everywhere (first GPU run), not a band.
   */
  bandK: 0.9,
  /** Max blur at overview range (about 4 px at 1440 px), faded in over overviewFromM..overviewToM:
   * the far slab edge's 3 px soil bands stay readable (AC-A5 / AC-B10). */
  overviewMaxblur: 0.003,
  overviewFromM: 1000,
  overviewToM: 4000,
  /**
   * Follow mode (a subject set: `Engine.setFocusPoint`, her chest; AC-B4). The prototype's near
   * values (blur saturating ~44 m behind a ~10 m focus, at most ~4 px) left the far field and the
   * near canopies in the top of a follow frame about as sharp as she is (gate: ratio 0.13-2.99).
   * With a subject the blur saturates `bandK` x the focus distance from her (in front or behind)
   * and reaches `maxblur` (~10 px at 1440 px); faded back to the plain values over fullM..fadeM of
   * camera distance (log), so the dive from the overview and the pull-back have no pop. `slabM`: a
   * depth slab around her (her, the walker, the bench) with no blur at all; the blur ramps from its
   * faces. Without it the hero box lost ~2/3 of its sharpness to sub-pixel blur (GPU run 1).
   */
  subject: { maxblur: 0.018, bandK: 0.6, slabM: 2.5, fullM: 120, fadeM: 2000 },
} as const;

/** Whether depth of field runs: the tier has it, the FX toggle is on and motion is not reduced. */
export function dofActive(s: { tier: Tier; fx: boolean; reducedMotion: boolean }): boolean {
  return THREE_TIERS[s.tier].dof && s.fx && !s.reducedMotion;
}

/** Aperture and max blur for a camera `distM` from its focus (log-distance blend, monotone). */
export function tiltShiftParams(
  distM: number,
  subject = false,
): { aperture: number; maxblur: number; slab: number } {
  const base = { ...plainParams(distM), slab: 0 };
  if (!subject) return base;
  const { maxblur, bandK, slabM, fullM, fadeM } = TILT_SHIFT.subject;
  const d = Math.max(1, distM);
  const k = Math.min(1, Math.max(0, Math.log(d / fullM) / Math.log(fadeM / fullM)));
  const w = 1 - k * k * (3 - 2 * k); // 1 close in, 0 at fadeM and beyond
  if (w <= 0) return base;
  const mb = base.maxblur + (Math.max(maxblur, base.maxblur) - base.maxblur) * w;
  const ap = Math.max(base.aperture, mb / (bandK * d));
  return {
    aperture: Math.exp(Math.log(base.aperture) + (Math.log(ap) - Math.log(base.aperture)) * w),
    maxblur: mb,
    slab: slabM * w,
  };
}

function plainParams(distM: number): { aperture: number; maxblur: number } {
  const { near, far, nearM, farM } = TILT_SHIFT;
  const d = Math.max(1, distM);
  const k = Math.min(1, Math.max(0, Math.log(d / nearM) / Math.log(farM / nearM)));
  const s = k * k * (3 - 2 * k);
  // Aperture blends in log space (it spans 7x), max blur linearly.
  const aperture = Math.exp(
    Math.log(near.aperture) + (Math.log(far.aperture) - Math.log(near.aperture)) * s,
  );
  const k2 = Math.min(
    1,
    Math.max(
      0,
      (d - TILT_SHIFT.overviewFromM) / (TILT_SHIFT.overviewToM - TILT_SHIFT.overviewFromM),
    ),
  );
  const s2 = k2 * k2 * (3 - 2 * k2);
  const blend = near.maxblur + (far.maxblur - near.maxblur) * s;
  const maxblur = blend + (TILT_SHIFT.overviewMaxblur - blend) * s2;
  return { aperture: Math.min(aperture, maxblur / (TILT_SHIFT.bandK * d)), maxblur };
}

/** BokehShader blur distance with an in-focus slab of half depth `slab` (m) around the focus. */
export const SLAB_FACTOR_GLSL =
  "float factor = sign( focus + viewZ ) * max( 0.0, abs( focus + viewZ ) - slab );";

/** The blur (UV) the patched shader gives a fragment at `depth` (pure; tests and docs). */
export function blurAt(
  p: { aperture: number; maxblur: number; slab: number },
  focus: number,
  depth: number,
): number {
  return Math.min(p.maxblur, Math.max(0, Math.abs(depth - focus) - p.slab) * p.aperture);
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
    // The in-focus slab (follow mode): 0 leaves the stock shader's blur unchanged.
    const m = this.materialBokeh;
    const from = "float factor = ( focus + viewZ );";
    if (!m.fragmentShader.includes(from)) throw new Error("BokehShader changed: no focus factor");
    m.fragmentShader = m.fragmentShader
      .replace("uniform float focus;", "uniform float focus;\nuniform float slab;")
      .replace(from, SLAB_FACTOR_GLSL);
    m.uniforms.slab = { value: 0 };
    m.needsUpdate = true;
  }

  /**
   * Focus at view depth `focusM` with the aperture for a camera `distM` from its focus; `subject`
   * when the focus is a followed subject (follow mode), not the camera target.
   */
  aim(focusM: number, distM: number, subject = false): void {
    const p = tiltShiftParams(distM, subject);
    const u = this.uniforms as Record<string, { value: number }>;
    (u.focus as { value: number }).value = focusM;
    (u.aperture as { value: number }).value = p.aperture;
    (u.maxblur as { value: number }).value = p.maxblur;
    (u.slab as { value: number }).value = p.slab;
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
