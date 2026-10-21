import type { StateAt } from "../../../devsim/types";
import type { Clearance, Vec3 } from "../clearance";
import type { LocalFrame } from "../frame";
import type { MoodSource, MoodWeights } from "../mood";
import { ease, span } from "./ease";
import { inRing, type SiteGeom } from "./geom";

/**
 * Mood weights from the sim sun (spec §5.3 Lighting): day while the sun is up, dusk around the
 * horizon, night once it is well below; the same blend `mood.ts` makes from the clock, so the sky,
 * the lights, lit windows and street lights follow the devsim clock (ADR 0011 override path).
 */
export function devsimMoodWeights(sun: StateAt["sun"]): MoodWeights {
  const e = sun.elevation;
  const day = ease(span(e, -0.08, 0.22));
  const deep = ease(span(-e, 0.08, 0.3));
  const rest = 1 - day;
  return { day, dusk: rest * (1 - deep), night: rest * deep };
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
