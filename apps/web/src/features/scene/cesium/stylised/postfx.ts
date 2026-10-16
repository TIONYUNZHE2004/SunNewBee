import type * as Cesium from "cesium";
import type { Palette } from "./palette";
import type { TierSpec } from "./quality";

type Stage = { enabled: boolean; uniforms: Record<string, number | boolean> };
export interface FxViewer {
  shadows: boolean;
  resolutionScale: number;
  useBrowserRecommendedResolution: boolean;
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

  // Always off: Cesium's HBAO draws black buildings and streaks on this flat scene (see TIERS).
  s.ambientOcclusion.enabled = false;

  const bloom = s.bloom;
  bloom.enabled = p.bloom && tier.bloom;
  Object.assign(bloom.uniforms, {
    glowOnly: false,
    contrast: 119,
    brightness: -0.85,
    delta: 1.0,
    sigma: 2.0,
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
  // Otherwise Cesium's pixel ratio is resolutionScale alone (CSS pixels) and HiDPI renders soft.
  viewer.useBrowserRecommendedResolution = false;
  viewer.resolutionScale = Math.min(dpr, tier.maxPixelRatio) / dpr;
  scene.requestRender();
}

export const skyCss = (p: Palette) => `linear-gradient(180deg, ${p.skyTop} 0%, ${p.horizon} 100%)`;
