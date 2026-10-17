import type { Tier } from "../cesium/stylised/quality";

export interface ThreeTierSpec {
  shadows: boolean;
  shadowMapSize: number;
  ao: boolean;
  bloom: boolean;
  maxPixelRatio: number;
}

/** Starting values; Phase 0 re-tunes them. */
export const THREE_TIERS: Record<Tier, ThreeTierSpec> = {
  high: { shadows: true, shadowMapSize: 4096, ao: true, bloom: true, maxPixelRatio: 2 },
  medium: { shadows: true, shadowMapSize: 2048, ao: true, bloom: true, maxPixelRatio: 1.25 },
  low: { shadows: false, shadowMapSize: 0, ao: false, bloom: false, maxPixelRatio: 1 },
};
