import * as THREE from "three";
import type { StateAt } from "../../../devsim/types";
import type { Clearance, Vec3 } from "../clearance";
import type { LocalFrame } from "../frame";
import type { LightPreset } from "../lighting";
import type { MoodSource, MoodWeights } from "../mood";
import { ease, span } from "./ease";
import { inRing, type SiteGeom } from "./geom";

/**
 * Mood weights from the sim sun (spec §5.3 Lighting), on the prototype's palette (`PAL`): full day
 * from e 0.42, the dusk palette between e 0.14 and -0.06, full night by e -0.3; the same blend
 * `mood.ts` makes from the clock, so the sky, the lights, lit windows and street lights follow the
 * devsim clock (ADR 0011 override path). So 18:45 on Day 30 (e ~0.12) reads as dusk, not midday.
 */
export function devsimMoodWeights(sun: StateAt["sun"]): MoodWeights {
  const e = sun.elevation;
  const day = ease(span(e, 0.14, 0.42));
  const night = ease(span(-e, 0.06, 0.3));
  return { day, dusk: Math.max(0, 1 - day - night), night };
}

/**
 * The devsim grade on the blended preset: the city's dusk and night presets are tuned to keep the
 * whole township legible at the overview; the simulation's close beats need the prototype's deeper
 * evening and night so the lit windows, street lights, floodlights and the speakers read (Q3).
 * Display only.
 */
export function devsimGrade(p: LightPreset, w: MoodWeights, wet = 0): LightPreset {
  const dark = w.night + 0.6 * w.dusk;
  const graded: LightPreset = {
    ...p,
    exposure: p.exposure * (1 - 0.45 * dark),
    hemiIntensity: p.hemiIntensity * (1 - 0.35 * dark),
    envIntensity: p.envIntensity * (1 - 0.6 * dark),
    groundGrade: p.groundGrade * (1 - 0.3 * w.night),
  };
  return wet > 0 ? rainGrade(graded, wet) : graded;
}

/** How far the monsoon rain greys the sky and fog (saturation kept) and darkens them. */
const RAIN_DESAT = 0.8;
const RAIN_DARKEN = 0.12;
const _hsl = { h: 0, s: 0, l: 0 };
const _c = new THREE.Color();
const greyed = (hex: string, wet: number) => {
  _c.set(hex).getHSL(_hsl);
  _c.setHSL(_hsl.h, _hsl.s * (1 - RAIN_DESAT * wet), _hsl.l * (1 - RAIN_DARKEN * wet));
  return `#${_c.getHexString()}`;
};

/**
 * The monsoon set piece's grade (C9 step 5): the sky, background and fog turn toward grey at
 * their own lightness (so night stays night: ruling in the C9 report), the sun weakens and the fog
 * closes in a little. `wet` 0..1 (the set piece's rain level); 0 returns the preset unchanged.
 */
export function rainGrade(p: LightPreset, wet: number): LightPreset {
  const k = Math.max(0, Math.min(1, wet));
  if (k === 0) return p;
  return {
    ...p,
    background: greyed(p.background, k),
    skyTop: greyed(p.skyTop, k),
    hemiSky: greyed(p.hemiSky, k),
    sunIntensity: p.sunIntensity * (1 - 0.55 * k),
    exposure: p.exposure * (1 - 0.08 * k),
    fog: {
      ...p.fog,
      color: greyed(p.fog.color, k),
      nearK: p.fog.nearK * (1 - 0.35 * k),
      farK: p.fog.farK * (1 - 0.2 * k),
    },
  };
}

/** The key light's moment: the sim clock's time of day (phase01 x 24 h) as an Elmina Day source. */
export function devsimMoodSource(sun: StateAt["sun"]): MoodSource {
  const p = ((sun.phase01 % 1) + 1) % 1;
  return { kind: "day", t: p * 1440 };
}

/** Metres the camera keeps above the tower roof inside its footprint (+ pad). */
const TOWER_CLEAR_M = 3;

/** The prototype camera's vertical field of view (deg): the beats are its keyframes. */
export const DEVSIM_FOV_DEG = 38;

export interface DevsimCameraPose {
  position: [number, number, number];
  look: [number, number, number];
  /** Pinned, so the frame at t never depends on the rig pose before the run (seek determinism). */
  fovDeg: number;
}

/**
 * The devsim camera at a frame state (spec §4.4 beats via `StateAt.camera`): target [lon, lat, h]
 * and offset [east, north, up] to local metres, then clamped so it is never inside a building
 * (Q2): the city grid's floor (roof + clearance near a footprint) and the hypothetical tower's
 * drawn height. Only raised, never moved sideways.
 */
export function devsimCamera(
  s: StateAt,
  frame: LocalFrame,
  geom: SiteGeom,
  towerTopM: number,
  clearance: Clearance | null,
): DevsimCameraPose {
  const [lon, lat, h] = s.camera.target;
  const [tx, tz] = frame.toLocal(lon, lat);
  const [e, n, u] = s.camera.offset;
  const pos: Vec3 = [tx + e, h + u, tz - n];
  const look: [number, number, number] = [tx, h, tz];
  if (clearance) {
    const c = clearance.clearCameraPose(pos, look, { segment: false });
    pos[1] = Math.max(pos[1], c.position[1]);
  }
  if (towerTopM > 0) {
    const pad = geom.ring.map(([x, z]): [number, number] => {
      const dx = x - geom.centre[0];
      const dz = z - geom.centre[1];
      const l = Math.hypot(dx, dz) || 1;
      return [x + (dx / l) * 2, z + (dz / l) * 2];
    });
    if (inRing(pad, pos[0], pos[2])) pos[1] = Math.max(pos[1], towerTopM + TOWER_CLEAR_M);
  }
  return { position: [pos[0], pos[1], pos[2]], look, fovDeg: DEVSIM_FOV_DEG };
}

/**
 * AO fades out over this camera range (m) in the devsim (C10p ruling): the wide beats (the 760 m
 * opening, the 240-270 m construction beats, the 27-33 s move-in at 230-330 m) draw without the
 * GTAO pass, which re-draws every opaque mesh for its normal buffer (~75-85 draws and ~0.9 M
 * triangles there). The close beats (< 150 m: yard, Farid, the door, the queue, the park) keep it
 * full. A fade over 50 m, so a fly in or out never pops (the 32 -> 34.6 s fly crosses it in ~0.4 s).
 */
export const DEVSIM_AO_FADE_M = [170, 220] as const;

/** The devsim AO weight at a camera range: 1 up to 170 m, 0 from 220 m, smooth between. */
export function devsimAoWeight(rangeM: number): number {
  const [a, b] = DEVSIM_AO_FADE_M;
  return 1 - ease(span(rangeM, a, b));
}

/** The camera's range from its target (m) in a frame state (the beat offset). */
export const cameraRangeM = (s: StateAt): number => Math.hypot(...s.camera.offset);

/**
 * Small devsim props (scaffold tubes, the crane's load, move-in boxes and cars) cast shadows only
 * nearer than this (the AO cut-off): from farther their shadow is a pixel or two, and each caster is
 * one more draw in the shadow pass of the wide beats (C10p, C10 review minor 1).
 */
export const DEVSIM_SMALL_SHADOW_M = DEVSIM_AO_FADE_M[1];

/** Whether small devsim props cast shadows in this frame state. */
export const smallShadows = (s: StateAt): boolean => cameraRangeM(s) < DEVSIM_SMALL_SHADOW_M;
