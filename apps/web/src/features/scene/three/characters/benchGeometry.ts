import manifestJson from "../../../../../public/city/characters/manifest.json";
import {
  type Box,
  type HeroManifest,
  type HeroVariantSpec,
  parseHeroManifest,
  walkRate,
} from "../assets/heroManifest";

/**
 * The rigged hero's asset contract (C-T3), read from `public/city/characters/manifest.json`
 * through `heroManifest.ts`: the bench the sit clips are authored for, the display scale, the
 * clip lengths and the walk stride of the demo (walker) variant. The placeholder hero, its rest
 * bench and the driver's timing all come from here, so the rigged GLB drops in unchanged.
 *
 * Frame: glTF (y up), she faces +z with her back to the bench, origin = her root (fixed in every
 * clip, including sit_down / sit_idle / stand_up), true metres; displayed x displayScale (R-J3).
 */
const parsed = parseHeroManifest(manifestJson);
if (!parsed.manifest) throw new Error(`hero manifest invalid: ${parsed.problems.join(", ")}`);
export const HERO_MANIFEST: HeroManifest = parsed.manifest;

/** The demo variant (older_adult_rest -> walker); the driver's timing and stride follow it. */
export const HERO_SPEC: HeroVariantSpec = HERO_MANIFEST.variants.walker as HeroVariantSpec;

const [, sitHipY, sitHipZ] = HERO_SPEC.sitHips;

export const HERO_BENCH = {
  /** Seat top above the ground (manifest `bench.seatY`, H7: 0.45 m true). */
  seatHeightM: HERO_MANIFEST.bench.seatY,
  /** The seat's front edge, behind her root (manifest `bench.frontEdgeZ`). */
  frontEdgeZ: HERO_MANIFEST.bench.frontEdgeZ,
  /** Seat and backrest boxes in her frame (manifest `bench.seat` / `bench.back`). */
  seat: HERO_MANIFEST.bench.seat as Box,
  back: HERO_MANIFEST.bench.back as Box,
  /** Hips bone in sit_idle (manifest `sitHips`): how far back and how high the clips carry them. */
  hipTravelM: -sitHipZ,
  sitHipY,
} as const;

/** Clip lengths (s) of the demo variant: sit_down / stand_up 1.5 s, walk 0.9 s, look 3.6 s, … */
export const HERO_CLIP_S = Object.fromEntries(
  Object.entries(HERO_SPEC.clips).map(([k, v]) => [k, v.duration]),
) as Record<keyof HeroVariantSpec["clips"], number>;

/**
 * Walk clip rate (clip seconds per screen second) for a ground speed in scene metres per second at
 * the hero's display scale: `heroManifest.walkRate` (speed / (stride x scale) x walkDuration), the
 * rate at which the feet do not slide.
 */
export const heroWalkRate = (speed: number): number =>
  walkRate(HERO_SPEC, speed, HERO_MANIFEST.displayScale);
