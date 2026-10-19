import type * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";

/** GTAO material parameters plus the blend (B-T4: `AO_PARAMS`, `LightPreset.aoBlend`). */
export interface AoParams {
  radius: number;
  distanceExponent: number;
  thickness: number;
  scale: number;
  blendIntensity: number;
}

/**
 * GTAOPass whose normal/depth G-buffer leaves out `skip()` objects (the far LOD2 blocks): hidden
 * for the whole pass, then restored. The beauty image is already rendered by the RenderPass and
 * the later passes are full-screen, so only the AO input changes: the skipped pixels read as
 * background and get no AO, which at > 1.5 km is below a pixel of darkening anyway (perf, I3).
 */
export class CityGTAOPass extends GTAOPass {
  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
    private readonly skip: () => readonly THREE.Object3D[],
    params?: AoParams,
  ) {
    super(scene, camera, width, height);
    if (params) this.applyParams(params);
  }

  /**
   * Sets the GTAO material parameters (radius in metres, distance exponent, thickness, scale) and
   * the blend intensity (0 = no AO, 1 = full); B-T4 values are `AO_PARAMS` in lighting.ts.
   */
  applyParams(p: AoParams): void {
    this.updateGtaoMaterial({
      radius: p.radius,
      distanceExponent: p.distanceExponent,
      thickness: p.thickness,
      scale: p.scale,
    });
    this.blendIntensity = p.blendIntensity;
  }

  override render(...args: Parameters<GTAOPass["render"]>): void {
    const hidden = this.skip().filter((o) => o.visible);
    for (const o of hidden) o.visible = false;
    try {
      super.render(...args);
    } finally {
      for (const o of hidden) o.visible = true;
    }
  }
}
