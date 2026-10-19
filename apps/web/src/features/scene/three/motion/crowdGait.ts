import { hash01 } from "../assets/fit";

/**
 * Crowd gait timing (P5, C-T7). Decorative only: nothing here is a fact about the township.
 *
 * A walk clip plays in place and covers `stride` true metres of ground per cycle (crowd.json). The
 * figure is drawn `scale` times true size, so its feet cover `stride x scale` metres per cycle; for no
 * skating the cycle rate is `speed / (stride x scale)` cycles per second. The phase is integrated from
 * the distance travelled (not from time x a fixed rate), so speed easing and a changing display scale
 * both keep the feet planted.
 */

/** Below this ground speed (m/s) an agent counts as standing and plays its idle clip. */
export const IDLE_BELOW_MPS = 0.05;

export interface GaitClip {
  /** True metres per cycle (0 for idles). */
  stride: number;
  /** Clip seconds per cycle. */
  duration: number;
}

export function gaitCyclesPerSecond(speed: number, stride: number, scale: number): number {
  if (!(stride > 0) || !(scale > 0)) return 0;
  return speed / (stride * scale);
}

/** Clip seconds per real second (an AnimationAction's timeScale for the same cadence). */
export function gaitPlaybackRate(speed: number, clip: GaitClip, scale: number): number {
  return gaitCyclesPerSecond(speed, clip.stride, scale) * clip.duration;
}

/** Seeded start phase per agent in [0, 1), so neighbours never march in step. */
export function seedPhase(id: string): number {
  return hash01(id, "gait-phase");
}

export interface GaitState {
  /** Cycle phase in [0, 1). */
  phase: number;
  /** Distance travelled (m) at the last update. */
  dist: number;
  /** Whether the last update played the idle clip. */
  idle: boolean;
}

const wrap01 = (v: number) => v - Math.floor(v);

/**
 * The phase on first sight: a pure function of the agent id and the distance it has walked
 * (`wrap01(seedPhase(id) + dist / (stride x scale))`), so two runs (or a seek) give the same pose.
 */
export function gaitStartPhase(id: string, dist: number, walk: GaitClip, scale: number): number {
  const per = walk.stride * scale;
  return wrap01(seedPhase(id) + (per > 0 ? dist / per : 0));
}

/**
 * One update: `dist` is the agent's distance travelled now (m), `dtSec` the real time since the last
 * update, `scale` its display scale. Moving: the phase advances by distance / (stride x scale). Standing
 * (speed below IDLE_BELOW_MPS): the idle clip plays at its own rate. Mutates and returns `st`.
 */
export function advanceGait(
  st: GaitState,
  dist: number,
  dtSec: number,
  scale: number,
  walk: GaitClip,
  idle: GaitClip,
): GaitState {
  const dd = dist - st.dist;
  st.dist = dist;
  const moving = dtSec > 0 ? Math.abs(dd) / dtSec >= IDLE_BELOW_MPS : st.idle === false;
  if (moving && walk.stride > 0 && scale > 0) {
    st.phase = wrap01(st.phase + dd / (walk.stride * scale));
    st.idle = false;
  } else {
    if (dtSec > 0 && idle.duration > 0) st.phase = wrap01(st.phase + dtSec / idle.duration);
    st.idle = true;
  }
  return st;
}

/**
 * The two baked frames around `phase` for a clip baked as frames 0..n (frame n is the clip's end pose,
 * so the last segment interpolates n-1 -> n and the wrap to frame 0 is seamless) and the blend.
 */
export function framePair(phase: number, n: number): { f0: number; f1: number; t: number } {
  const ft = wrap01(phase) * n;
  const f0 = Math.min(n - 1, Math.floor(ft));
  return { f0, f1: f0 + 1, t: ft - f0 };
}
