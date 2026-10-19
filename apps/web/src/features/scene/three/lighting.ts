import * as THREE from "three";
import type { Theme } from "../../../ui/theme";
import { CLAY_MIN_LUMINANCE, CLAY_PALETTE } from "./shared/clayTokens";
import { sunPosition, sunVector } from "./sun";

export interface LightPreset {
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  envIntensity: number;
  exposure: number;
  background: string;
  /** Sky zenith colour; the horizon end of the sky gradient is `fog.color`, so far ground blends into it. */
  skyTop: string;
  /**
   * Fog distances in metres (floors for close cameras) and as multiples of the camera range
   * (`nearK`, `farK`). At the 7 km overview the farthest Elmina boundary vertex is 1.39x the range
   * away (9.73 km, `mood.test.ts` derives it from boundary.geojson); `farK` 1.45 keeps it below full
   * fog (about 90%) so the diorama slab edge (A-T4) is not swallowed, while the top of the frame
   * (about 1.28x) is at about 76%. Mood-driven: night closes in slightly. Fog colour is never a saturated blue, so it
   * cannot tint roofs into the water hue band (mood.test.ts).
   */
  fog: { color: string; near: number; far: number; nearK: number; farK: number };
  /**
   * Albedo multiplier on ground materials (land cover, parks, the base plane, the slab): 1 by day,
   * lower at night. Land-cover water is darkened with the rest of the ground (hue-preserving); only
   * the separate base `water` band is exempt.
   */
  groundGrade: number;
  /**
   * Albedo multiplier on road ribbons and markings (B-T4). Separate from `groundGrade` because
   * asphalt is the darkest large surface (luminance ~0.15): the night fill lifts the scene so nothing
   * reads near-black (AC-B6) while the light land cover is graded down harder, keeping the night
   * ground at <= 35% of the day ground (AC-A14).
   */
  roadGrade: number;
  /** 0 by day, > 0 at dusk and night. */
  windowEmissive: number;
  /** Bloom strength; 0 turns the pass off. Off by day: see BLOOM. */
  bloom: number;
  /**
   * GTAO blend (0 = no AO, 1 = full), B-T4. Night is lit almost only by ambient, so the same AO
   * darkens a larger share of the light: the night blend is lower so contact shade never blackens.
   */
  aoBlend: number;
}

/**
 * Bloom is for lit windows and lamps. At noon the real sun is near the zenith and a pale sunlit
 * surface reaches ~1.4 linear luminance (sun 3/pi + hemi 0.5/pi + IBL 0.35), well over the
 * threshold, so a day bloom washed the whole scene to cream (final fix A; morning checks missed it).
 */
export const BLOOM = { radius: 0.4, threshold: 0.85 };

/**
 * Mood keyframes (B-T4 light and grade; A-T11 fog and sky; the owner tunes them).
 *
 * Toy-diorama light after the prototype (hemisphere fill 1.35, sun 2.4): a warm key light with soft
 * PCF shadows and a strong, warm-bounce hemisphere fill, so a shade-side face gets about half the
 * light of a sunlit one instead of a quarter. The Phase A presets (hemi 0.5 + room IBL 0.35, sun 3)
 * left roof slopes facing away from the sun lit by ambient only (~0.25), so any albedo under ~0.12
 * fell below 0.03 luminance (AC-A9, A-T8 report). The fill goes up and the sun down by about the
 * same amount on a lit face, so sunlit faces stay near where they were (no cream wash) while shade
 * lifts. Day bloom stays off (a sunlit pale face is over the bloom threshold at noon: BLOOM).
 *
 * Night stays dark (fix round 1: the first B-T4 night, hemisphere 1.8 x a periwinkle sky, washed
 * the buildings out to ~68% of day). The hemisphere is a dim indigo (sky luminance ~0.1 x 0.8), the
 * moon gives shape, and the lifts are targeted: roads keep their albedo (`roadGrade` 1, the darkest
 * large surface), land cover is graded (`groundGrade`) so the night ground stays <= 35% of the day
 * ground (AC-A14), the GTAO blend is lower (`aoBlend`), and fog, horizon and zenith are lifted to
 * >= 0.03 luminance so sky pixels never read near-black (AC-B6).
 *
 * lighting.test.ts checks the light arithmetic (`shadeLight` / `litLight` against LIGHT_LIMITS).
 */
export const LIGHT_PRESETS: Record<Theme, LightPreset> = {
  day: {
    sunColor: "#fff1d6",
    sunIntensity: 2.4,
    hemiSky: "#e6f4ff",
    hemiGround: "#e8d8b6",
    hemiIntensity: 1.1,
    envIntensity: 0.55,
    exposure: 1,
    background: "#dfe5e7",
    skyTop: "#5f9fe0",
    fog: { color: "#dfe5e7", near: 600, far: 3500, nearK: 0.7, farK: 1.45 },
    groundGrade: 1,
    roadGrade: 1,
    windowEmissive: 0,
    bloom: 0,
    aoBlend: 0.6,
  },
  dusk: {
    sunColor: "#ff9a6a",
    sunIntensity: 1.6,
    hemiSky: "#ffb48a",
    hemiGround: "#5a4060",
    hemiIntensity: 0.8,
    envIntensity: 0.45,
    exposure: 1,
    background: "#e8a589",
    skyTop: "#5a4f8c",
    fog: { color: "#e8a589", near: 500, far: 3000, nearK: 0.7, farK: 1.45 },
    groundGrade: 0.9,
    roadGrade: 0.95,
    windowEmissive: 0.8,
    bloom: 0.6,
    aoBlend: 0.6,
  },
  night: {
    sunColor: "#9fb4ff",
    sunIntensity: 0.6,
    hemiSky: "#4d5592",
    hemiGround: "#2a2350",
    hemiIntensity: 0.8,
    envIntensity: 0.4,
    exposure: 1.1,
    background: "#2e2b62",
    skyTop: "#2c2b6e",
    fog: { color: "#2e2b62", near: 400, far: 2500, nearK: 0.7, farK: 1.45 },
    groundGrade: 0.36,
    roadGrade: 1,
    windowEmissive: 1.6,
    bloom: 0.6,
    aoBlend: 0.45,
  },
};

/** Relative luminance (linear, Rec. 709) of an sRGB hex colour. */
export function hexLuminance(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * Light model of the presets in three.js units (physically based lights): a Lambert surface of
 * albedo `a` renders about `a * light`, where the key light adds
 * `sunIntensity * lum(sunColor) * cos / pi`, the hemisphere `hemiIntensity * lum(mix) / pi` and the
 * room IBL about `ENV_IRRADIANCE * envIntensity`. ENV_IRRADIANCE is calibrated from the A-T8
 * measurement (north walls ~0.22 linear at albedo 0.86 under hemi 0.5 + IBL 0.35).
 */
export const ENV_IRRADIANCE = 0.52;

/** Light on a face the key light does not reach; `skyWeight` 1 faces up, 0.5 is a vertical wall. */
export function shadeLight(p: LightPreset, skyWeight = 0.5): number {
  const g = hexLuminance(p.hemiGround);
  const hemi = g + (hexLuminance(p.hemiSky) - g) * skyWeight;
  return (p.hemiIntensity * hemi) / Math.PI + ENV_IRRADIANCE * p.envIntensity;
}

/** Light on a face turned to a key light at `elevationRad` (`skyWeight` as in `shadeLight`). */
export function litLight(p: LightPreset, elevationRad: number, skyWeight = 1): number {
  const key = p.sunIntensity * hexLuminance(p.sunColor) * Math.max(0, Math.sin(elevationRad));
  return key / Math.PI + shadeLight(p, skyWeight);
}

/**
 * What the presets are tested against (lighting.test.ts, AC-A9 / AC-B6 by arithmetic; the GPU check
 * is `acceptance -g "AC-A9|AC-B6"`):
 * - the darkest building albedo (`darkAlbedo` = CLAY_MIN_LUMINANCE) on a shade-side wall, at the AO
 *   a shade face typically keeps (`aoKeep`: baked AO x GTAO), renders >= `minLuma` in every mood;
 * - major-road asphalt (`roadAlbedo`) in shade, graded by `roadGrade`, likewise;
 * - by day a white face lit from the zenith stays under `maxDayWhite` before tone mapping: Neutral
 *   maps 1.4 to about 0.94, short of clipped white, and the scene does not wash to cream.
 */
export const LIGHT_LIMITS = {
  minLuma: 0.035,
  darkAlbedo: CLAY_MIN_LUMINANCE,
  roadAlbedo: hexLuminance(CLAY_PALETTE.road.major),
  aoKeep: 0.8,
  maxDayWhite: 1.4,
} as const;

/**
 * Shadow frame (B-T4, after the prototype's `aimSun`): the shadow box follows the camera focus with
 * a half size of camera range x `rangeK`, never under `minHalfM` (about 70 m at street level, a few
 * cm per texel). Far out, the whole ~21 km2 slab cannot fit one sharp map, so shadows fade out
 * between `fadeStartM` and `fadeEndM` of camera range (strength 1 to 0, the shadow's `intensity`);
 * at strength 0 the engine stops updating the map. PCF soft shadows: kernel `radius` in texels;
 * `normalBias` scales with the texel size so acne does not come back as the box grows, capped at
 * `maxNormalBiasM`.
 */
export const SHADOW = {
  minHalfM: 70,
  rangeK: 1.2,
  fadeStartM: 2200,
  fadeEndM: 4000,
  radius: 3,
  bias: -0.0004,
  normalBiasTexels: 1.5,
  /** Cap (m): past it a large box (Medium map, far camera) would detach shadows from their casters. */
  maxNormalBiasM: 0.5,
} as const;

export interface ShadowFrame {
  /** Half size of the orthographic shadow box (m). */
  halfSize: number;
  /** Shadow strength 0..1 (fades out at range). */
  strength: number;
  /** Normal bias (m) for this box and map size. */
  normalBias: number;
}

/** The shadow box for a camera `rangeM` from its focus and a `mapSize`-texel shadow map. */
export function shadowFrame(rangeM: number, mapSize: number): ShadowFrame {
  const halfSize = Math.max(SHADOW.minHalfM, rangeM * SHADOW.rangeK);
  const x = Math.min(
    1,
    Math.max(0, (rangeM - SHADOW.fadeStartM) / (SHADOW.fadeEndM - SHADOW.fadeStartM)),
  );
  const strength = 1 - x * x * (3 - 2 * x);
  const texel = (2 * halfSize) / Math.max(1, mapSize);
  const normalBias = Math.min(SHADOW.maxNormalBiasM, texel * SHADOW.normalBiasTexels);
  return { halfSize, strength, normalBias };
}

/**
 * GTAO (screen-space AO) parameters, B-T4. three's defaults (radius 0.25 m, full blend) only caught
 * creases but darkened them fully; at the link-house bookmark GTAO added ~0.6 points of near-black
 * building pixels (3.66% with, 3.08% without). A wider radius gives the clay contact shadows under
 * eaves and at wall feet; the blend is capped so AO shades but never blackens.
 */
export const AO_PARAMS = {
  radius: 0.6,
  distanceExponent: 1.2,
  thickness: 1.5,
  scale: 1,
  /** Day blend; each mood sets its own (`LightPreset.aoBlend`). */
  blendIntensity: 0.6,
} as const;

const MIN_SUN_ELEVATION = 10 * (Math.PI / 180);
const deg = Math.PI / 180;

/**
 * Unit direction pointing TOWARD the light (scene to sun or moon), local frame.
 * Day: the real sun clamped to >= 10 degrees. Dusk: azimuth 285, elevation 8. Night: moon at azimuth 120, elevation 40.
 */
export function keyLightDir(
  theme: Theme,
  now: Date,
  lat: number,
  lon: number,
): [number, number, number] {
  if (theme === "dusk") return sunVector(285 * deg, 8 * deg);
  if (theme === "night") return sunVector(120 * deg, 40 * deg);
  const p = sunPosition(now, lat, lon);
  return sunVector(p.azimuthRad, Math.max(p.elevationRad, MIN_SUN_ELEVATION));
}

const SHADOW_DISTANCE_M = 1500;

/** The light sits at target + dir * distance, looking at the target on the ground. */
export function fitShadowCamera(
  focus: [number, number],
  radiusM: number,
  dir: [number, number, number],
): {
  position: [number, number, number];
  target: [number, number, number];
  halfSize: number;
  near: number;
  far: number;
} {
  const target: [number, number, number] = [focus[0], 0, focus[1]];
  const dist = Math.max(SHADOW_DISTANCE_M, radiusM * 3);
  return {
    position: [target[0] + dir[0] * dist, target[1] + dir[1] * dist, target[2] + dir[2] * dist],
    target,
    halfSize: radiusM,
    near: 1,
    far: dist + radiusM * 2,
  };
}

const mixColour = (a: string, b: string, k: number): string => {
  const c = new THREE.Color(a);
  return `#${c.lerp(new THREE.Color(b), k).getHexString()}`;
};
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** Lerp every field; colours mix in linear space (THREE.Color working space). k <= 0 gives a, k >= 1 gives b. */
export function blendPresets(a: LightPreset, b: LightPreset, k: number): LightPreset {
  if (k <= 0) return a;
  if (k >= 1) return b;
  return {
    sunColor: mixColour(a.sunColor, b.sunColor, k),
    sunIntensity: mix(a.sunIntensity, b.sunIntensity, k),
    hemiSky: mixColour(a.hemiSky, b.hemiSky, k),
    hemiGround: mixColour(a.hemiGround, b.hemiGround, k),
    hemiIntensity: mix(a.hemiIntensity, b.hemiIntensity, k),
    envIntensity: mix(a.envIntensity, b.envIntensity, k),
    exposure: mix(a.exposure, b.exposure, k),
    background: mixColour(a.background, b.background, k),
    skyTop: mixColour(a.skyTop, b.skyTop, k),
    fog: {
      color: mixColour(a.fog.color, b.fog.color, k),
      near: mix(a.fog.near, b.fog.near, k),
      far: mix(a.fog.far, b.fog.far, k),
      nearK: mix(a.fog.nearK, b.fog.nearK, k),
      farK: mix(a.fog.farK, b.fog.farK, k),
    },
    groundGrade: mix(a.groundGrade, b.groundGrade, k),
    roadGrade: mix(a.roadGrade, b.roadGrade, k),
    windowEmissive: mix(a.windowEmissive, b.windowEmissive, k),
    bloom: mix(a.bloom, b.bloom, k),
    aoBlend: mix(a.aoBlend, b.aoBlend, k),
  };
}
