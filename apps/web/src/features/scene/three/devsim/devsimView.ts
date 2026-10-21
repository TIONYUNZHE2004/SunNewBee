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
export function devsimGrade(p: LightPreset, w: MoodWeights): LightPreset {
  const dark = w.night + 0.6 * w.dusk;
  return {
    ...p,
    exposure: p.exposure * (1 - 0.45 * dark),
    hemiIntensity: p.hemiIntensity * (1 - 0.35 * dark),
    envIntensity: p.envIntensity * (1 - 0.6 * dark),
    groundGrade: p.groundGrade * (1 - 0.3 * w.night),
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
