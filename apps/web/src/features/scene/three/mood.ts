import * as THREE from "three";
import type { Theme } from "../../../ui/theme";
import { blendPresets, keyLightDir, LIGHT_PRESETS, type LightPreset } from "./lighting";

export type MoodSource =
  | { kind: "day"; t: number }
  | { kind: "pinned"; theme: Theme }
  | { kind: "clock"; now: Date };
export type MoodWeights = { day: number; dusk: number; night: number };

/** Elmina Day playback beats a pinned theme, which beats the real clock. */
export function moodSource(s: {
  dayOn: boolean;
  dayT: number;
  choice: "auto" | Theme;
  now: Date;
}): MoodSource {
  if (s.dayOn) return { kind: "day", t: s.dayT };
  if (s.choice !== "auto") return { kind: "pinned", theme: s.choice };
  return { kind: "clock", now: s.now };
}

const KL_OFFSET_MIN = 8 * 60;
const DAY_MIN = 24 * 60;

/** Minutes after midnight, Asia/Kuala_Lumpur (UTC+8, no DST). */
export function klMinutes(now: Date): number {
  return (((now.getTime() / 60000 + KL_OFFSET_MIN) % DAY_MIN) + DAY_MIN) % DAY_MIN;
}

const ramp = (m: number, a: number, b: number) => Math.min(1, Math.max(0, (m - a) / (b - a)));

/** Continuous weights over the day/dusk/night keyframes: linear ramps night to day 06:30-07:30,
 *  day to dusk 18:15-19:15, dusk to night 19:15-20:00. Pinned is one-hot. */
export function moodWeights(src: MoodSource): MoodWeights {
  if (src.kind === "pinned")
    return { day: 0, dusk: 0, night: 0, [src.theme]: 1 } as unknown as MoodWeights;
  const raw = src.kind === "day" ? src.t : klMinutes(src.now);
  const m = ((raw % DAY_MIN) + DAY_MIN) % DAY_MIN;
  if (m < 6.5 * 60) return { day: 0, dusk: 0, night: 1 };
  if (m < 7.5 * 60) {
    const k = ramp(m, 6.5 * 60, 7.5 * 60);
    return { day: k, dusk: 0, night: 1 - k };
  }
  if (m < 18.25 * 60) return { day: 1, dusk: 0, night: 0 };
  if (m < 19.25 * 60) {
    const k = ramp(m, 18.25 * 60, 19.25 * 60);
    return { day: 1 - k, dusk: k, night: 0 };
  }
  if (m < 20 * 60) {
    const k = ramp(m, 19.25 * 60, 20 * 60);
    return { day: 0, dusk: 1 - k, night: k };
  }
  return { day: 0, dusk: 0, night: 1 };
}

const THEMES: Theme[] = ["day", "dusk", "night"];

export function dominant(w: MoodWeights): Theme {
  return THEMES.reduce((best, t) => (w[t] > w[best] ? t : best), "day" as Theme);
}

/** Blend of the keyframes; a one-hot weight returns the keyframe object itself. */
export function moodPreset(w: MoodWeights): LightPreset {
  let acc: LightPreset | null = null;
  let accW = 0;
  for (const t of THEMES) {
    if (w[t] <= 0) continue;
    if (!acc) {
      acc = LIGHT_PRESETS[t];
      accW = w[t];
    } else {
      acc = blendPresets(acc, LIGHT_PRESETS[t], w[t] / (accW + w[t]));
      accW += w[t];
    }
  }
  return acc ?? LIGHT_PRESETS.day;
}

/** Window glow = night 1.6 + dusk 0.8 (LightPreset.windowEmissive); lit share 0.35 to 0.58 (Cesium litFrac);
 *  light-role glow 0.2 at dusk, 1.0 at night. */
export function glowFor(w: MoodWeights): {
  uWindowGlow: number;
  uLitShare: number;
  uLightGlow: number;
} {
  return {
    uWindowGlow:
      w.day * LIGHT_PRESETS.day.windowEmissive +
      w.dusk * LIGHT_PRESETS.dusk.windowEmissive +
      w.night * LIGHT_PRESETS.night.windowEmissive,
    uLitShare: 0.35 + 0.23 * w.night,
    uLightGlow: 0.2 * w.dusk + 1.0 * w.night,
  };
}

/**
 * Fog scales with camera range (the preset's `nearK` / `farK` multiples, floored by its metres) so
 * the fog ramps over 0.7x to 1.45x the range: the far ground blends into the fog colour while the
 * farthest Elmina boundary vertex (1.39x the range at the overview) stays short of full fog.
 */
export function fogFor(
  p: LightPreset,
  rangeM: number,
  reachM = 0,
): { color: string; near: number; far: number } {
  const near = Math.max(p.fog.near, p.fog.nearK * rangeM);
  // A slab reach (A-T5, `cameraFit.ts` fogReachM): the farthest outline vertex sits at
  // FOG_REACH_SHARE of the ramp, so a long outline's far edge is hazed, not swallowed.
  const reach = reachM > near ? near + (reachM - near) / FOG_REACH_SHARE : 0;
  return {
    color: p.fog.color,
    near,
    far: Math.max(p.fog.far, p.fog.farK * rangeM, reach),
  };
}

/** Where along the fog ramp (0 near, 1 far) the slab's farthest outline vertex sits at long range. */
export const FOG_REACH_SHARE = 0.9;

/** The moment the key light is computed for: the day clock mapped onto today's KL date, else now. */
export function lightDate(src: MoodSource, now: Date): Date {
  if (src.kind !== "day") return src.kind === "clock" ? src.now : now;
  const midnightKl =
    Math.floor((now.getTime() + KL_OFFSET_MIN * 60000) / (DAY_MIN * 60000)) * DAY_MIN * 60000 -
    KL_OFFSET_MIN * 60000;
  return new Date(midnightKl + src.t * 60000);
}

/**
 * Key light direction: the normalised weighted sum of the three keyframe directions (day = the
 * real sun, or the day clock on today's date), so it never snaps when the dominant keyframe flips.
 * A near-zero sum (opposed directions) falls back to the dominant keyframe.
 */
export function moodKeyDir(
  src: MoodSource,
  w: MoodWeights,
  now: Date,
  lat: number,
  lon: number,
): [number, number, number] {
  const when = lightDate(src, now);
  const sum: [number, number, number] = [0, 0, 0];
  for (const t of THEMES) {
    if (w[t] <= 0) continue;
    const d = keyLightDir(t, when, lat, lon);
    for (let i = 0; i < 3; i++) sum[i] = (sum[i] as number) + w[t] * (d[i] as number);
  }
  const len = Math.hypot(...sum);
  if (len < 0.2) return keyLightDir(dominant(w), when, lat, lon);
  return [sum[0] / len, sum[1] / len, sum[2] / len];
}

/** Mutates the scene's one Fog (creating it once). */
export function applyFog(scene: THREE.Scene, p: LightPreset, rangeM: number, reachM = 0): void {
  const f = fogFor(p, rangeM, reachM);
  if (!(scene.fog instanceof THREE.Fog)) scene.fog = new THREE.Fog(f.color, f.near, f.far);
  else {
    scene.fog.color.set(f.color);
    scene.fog.near = f.near;
    scene.fog.far = f.far;
  }
}

export function mixWeights(a: MoodWeights, b: MoodWeights, k: number): MoodWeights {
  return {
    day: a.day + (b.day - a.day) * k,
    dusk: a.dusk + (b.dusk - a.dusk) * k,
    night: a.night + (b.night - a.night) * k,
  };
}
