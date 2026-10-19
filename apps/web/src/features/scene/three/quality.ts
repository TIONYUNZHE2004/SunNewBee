import type { Tier } from "../shared/quality";

export interface ThreeTierSpec {
  shadows: boolean;
  shadowMapSize: number;
  ao: boolean;
  bloom: boolean;
  /** Tilt-shift depth of field (B-T5): High only; the FX toggle and reduced motion also gate it. */
  dof: boolean;
  maxPixelRatio: number;
}

/** Starting values; Phase 0 re-tunes them. */
export const THREE_TIERS: Record<Tier, ThreeTierSpec> = {
  high: { shadows: true, shadowMapSize: 4096, ao: true, bloom: true, dof: true, maxPixelRatio: 2 },
  medium: {
    shadows: true,
    shadowMapSize: 2048,
    ao: true,
    bloom: true,
    dof: false,
    maxPixelRatio: 1.25,
  },
  low: { shadows: false, shadowMapSize: 0, ao: false, bloom: false, dof: false, maxPixelRatio: 1 },
};
