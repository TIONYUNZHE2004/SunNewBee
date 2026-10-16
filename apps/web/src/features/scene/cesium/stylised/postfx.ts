import type * as Cesium from "cesium";
import type { Palette } from "./palette";
import type { TierSpec } from "./quality";

type Stage = { enabled: boolean; uniforms: Record<string, number | boolean> };
export interface FxViewer {
  shadows: boolean;
  resolutionScale: number;
  scene: {
    postProcessStages: { fxaa: Stage; ambientOcclusion: Stage; bloom: Stage };
    shadowMap: {
      softShadows: boolean;
      size: number;
      maximumDistance: number;
      darkness: number;
    };
    requestRender(): void;
  };
}

/** Display-only post-processing for the stylised city, per mood and quality tier. */
export function applyPostFx(_C: typeof Cesium, viewer: FxViewer, p: Palette, tier: TierSpec): void {
  const { scene } = viewer;
  const s = scene.postProcessStages;
  s.fxaa.enabled = true;

  const ao = s.ambientOcclusion;
  ao.enabled = tier.ao !== "off";
  Object.assign(ao.uniforms, {
    intensity: tier.ao === "low" ? 2.0 : 3.0,
    bias: 0.1,
    lengthCap: 0.26,
    stepSize: tier.ao === "low" ? 2.0 : 1.0,
    frustumLength: 1000,
    blurStepSize: 0.86,
    ambientOcclusionOnly: false,
  });

  const bloom = s.bloom;
  bloom.enabled = p.bloom && tier.bloom;
  Object.assign(bloom.uniforms, {
    glowOnly: false,
    contrast: 128,
    brightness: -0.3,
    delta: 1.0,
    sigma: 2.5,
    stepSize: 1.0,
  });

  viewer.shadows = p.shadows && tier.shadows !== "off";
  if (viewer.shadows) {
    scene.shadowMap.softShadows = tier.shadows === "soft";
    scene.shadowMap.size = tier.shadowMapSize;
    scene.shadowMap.maximumDistance = 3000;
    scene.shadowMap.darkness = 0.45;
  }

  const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  viewer.resolutionScale = Math.min(dpr, tier.maxPixelRatio) / dpr;
  scene.requestRender();
}

export const skyCss = (p: Palette) => `linear-gradient(180deg, ${p.skyTop} 0%, ${p.horizon} 100%)`;
