import * as THREE from "three";
import type { Theme } from "../../../ui/theme";
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
   * (`nearK`, `farK`): the township view fades out only where the ground is far, never near the
   * target. Mood-driven: night closes in slightly. Fog colour is never a saturated blue, so it
   * cannot tint roofs into the water hue band (mood.test.ts).
   */
  fog: { color: string; near: number; far: number; nearK: number; farK: number };
  /** Albedo multiplier on ground and road materials: 1 by day, lower at night (not on base water). */
  groundGrade: number;
  /** 0 by day, > 0 at dusk and night. */
  windowEmissive: number;
  /** Bloom strength; 0 turns the pass off. Off by day: see BLOOM. */
  bloom: number;
}

/**
 * Bloom is for lit windows and lamps. At noon the real sun is near the zenith and a pale sunlit
 * surface reaches ~1.4 linear luminance (sun 3/pi + hemi 0.5/pi + IBL 0.35), well over the
 * threshold, so a day bloom washed the whole scene to cream (final fix A; morning checks missed it).
 */
export const BLOOM = { radius: 0.4, threshold: 0.85 };

/**
 * Starting colours from the reference image; the owner tunes them in Phase 3. Ambient (hemi + room
 * IBL) stays low: at hemi 0.9 + IBL 1 every lit surface passed the bloom threshold and the day
 * scene bloomed into a white blur (Task 7 browser check).
 */
export const LIGHT_PRESETS: Record<Theme, LightPreset> = {
  day: {
    sunColor: "#fff1d6",
    sunIntensity: 3,
    hemiSky: "#bfe0ff",
    hemiGround: "#8a7a5a",
    hemiIntensity: 0.5,
    envIntensity: 0.35,
    exposure: 1,
    background: "#dfe5e7",
    skyTop: "#5f9fe0",
    fog: { color: "#dfe5e7", near: 600, far: 3500, nearK: 1, farK: 1.2 },
    groundGrade: 1,
    windowEmissive: 0,
    bloom: 0,
  },
  dusk: {
    sunColor: "#ff9a6a",
    sunIntensity: 1.6,
    hemiSky: "#ffb48a",
    hemiGround: "#5a4060",
    hemiIntensity: 0.4,
    envIntensity: 0.3,
    exposure: 1,
    background: "#e8a589",
    skyTop: "#5a4f8c",
    fog: { color: "#e8a589", near: 500, far: 3000, nearK: 0.95, farK: 1.2 },
    groundGrade: 0.9,
    windowEmissive: 0.8,
    bloom: 0.6,
  },
  night: {
    sunColor: "#9fb4ff",
    sunIntensity: 0.5,
    hemiSky: "#2a2350",
    hemiGround: "#14122c",
    hemiIntensity: 0.35,
    envIntensity: 0.15,
    exposure: 1.1,
    background: "#1a1640",
    skyTop: "#06050f",
    fog: { color: "#1a1640", near: 400, far: 2500, nearK: 0.9, farK: 1.15 },
    groundGrade: 0.72,
    windowEmissive: 1.6,
    bloom: 0.6,
  },
};

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
    windowEmissive: mix(a.windowEmissive, b.windowEmissive, k),
    bloom: mix(a.bloom, b.bloom, k),
  };
}
