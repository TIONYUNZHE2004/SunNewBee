/**
 * The U-turn detector behind AC-L1 / AC-L4 (demo polish A1): per agent, a short history of its
 * facing; a heading change above REVERSAL_RAD within REVERSAL_WINDOW_S counts as a reversal, unless
 * a sample in that window was at a real dead end (the caller says which samples are). A respawn (a
 * fading agent's new lap) or a gap in the samples clears the history. Pure; display tests only.
 */

/** A heading change above this (150 deg) is a reversal. */
export const REVERSAL_RAD = (150 * Math.PI) / 180;
/** ... when it happens within this long (s). */
export const REVERSAL_WINDOW_S = 2;
/** Samples further apart than this (s) restart the history (the agent was not drawn). */
const GAP_S = 0.5;
/** History resolution (s): samples closer than this to the last kept one are not stored. */
const STEP_S = 0.05;

const TAU = Math.PI * 2;
const wrapPi = (v: number) => v - TAU * Math.floor((v + Math.PI) / TAU);

export interface ReversalWatch {
  /**
   * One sample of the agent's facing at time `t` (s). `deadEnd`: the agent is at a real dead end
   * now. `lap`: its respawn count (a change clears the history). Returns true when this sample
   * completes a reversal that no dead-end sample excuses (the history is then cleared, so one
   * reversal counts once).
   */
  push(t: number, yaw: number, deadEnd: boolean, lap: number): boolean;
}

export function createReversalWatch(): ReversalWatch {
  const ts: number[] = [];
  const ys: number[] = [];
  const de: boolean[] = [];
  let lastLap = Number.NaN;
  const clear = () => {
    ts.length = 0;
    ys.length = 0;
    de.length = 0;
  };
  return {
    push(t, yaw, deadEnd, lap) {
      const n = ts.length;
      if (
        lap !== lastLap ||
        (n > 0 && (t - (ts[n - 1] as number) > GAP_S || t < (ts[n - 1] as number)))
      )
        clear();
      lastLap = lap;
      // drop samples older than the window
      let drop = 0;
      while (drop < ts.length && t - (ts[drop] as number) > REVERSAL_WINDOW_S) drop++;
      if (drop > 0) {
        ts.splice(0, drop);
        ys.splice(0, drop);
        de.splice(0, drop);
      }
      // any dead-end sample in the window (or now) excuses every reversal through it
      let excused = deadEnd;
      for (let i = 0; i < de.length && !excused; i++) if (de[i]) excused = true;
      if (!excused)
        for (let i = 0; i < ys.length; i++)
          if (Math.abs(wrapPi(yaw - (ys[i] as number))) > REVERSAL_RAD) {
            clear();
            return true;
          }
      const m = ts.length;
      if (m === 0 || t - (ts[m - 1] as number) >= STEP_S || deadEnd) {
        ts.push(t);
        ys.push(yaw);
        de.push(deadEnd);
      }
      return false;
    },
  };
}

/** A sample this close to one of the agent's planned dead ends (m) is "at a dead end". */
export const DEAD_END_NEAR_M = 9;

/** Whether (x, z) lies within DEAD_END_NEAR_M of one of `deadEnds` (xz pairs). */
export function nearDeadEnd(deadEnds: Float32Array | undefined, x: number, z: number): boolean {
  if (!deadEnds) return false;
  for (let i = 0; i < deadEnds.length; i += 2)
    if (Math.hypot((deadEnds[i] as number) - x, (deadEnds[i + 1] as number) - z) <= DEAD_END_NEAR_M)
      return true;
  return false;
}

/**
 * The in-app counter behind `__tlAcceptance.uturns()` (AC-L4): off until started; while on, the
 * motion layer feeds every drawn agent's tangent facing each tick. Test hook only (dev / acceptance
 * builds read it); it changes nothing that is drawn.
 */
export interface UturnReport {
  on: boolean;
  /** Mid-edge reversals counted since the start (AC-L4 wants 0). */
  reversals: number;
  /** Seconds of motion time watched. */
  seconds: number;
  ticks: number;
  /** Drawn vehicles / people per tick: min and median over the watch. */
  vehicles: { min: number; median: number };
  people: { min: number; median: number };
  /** Distinct agents sampled. */
  agents: number;
  /** The first few reversals: agent id, motion time, position. */
  examples: string[];
}

const watchState = {
  on: false,
  reversals: 0,
  t0: Number.NaN,
  t1: Number.NaN,
  vehicles: [] as number[],
  people: [] as number[],
  watches: new Map<string, ReversalWatch>(),
  examples: [] as string[],
  tickV: 0,
  tickP: 0,
};

/** Starts (or restarts) the counter from zero. */
export function startUturnWatch(): void {
  watchState.on = true;
  watchState.reversals = 0;
  watchState.t0 = Number.NaN;
  watchState.t1 = Number.NaN;
  watchState.vehicles = [];
  watchState.people = [];
  watchState.watches = new Map();
  watchState.examples = [];
}

/** Whether the motion layer should feed the counter. */
export const uturnWatchOn = (): boolean => watchState.on;

/** Called by the motion layer at the start of a tick. */
export function uturnTickBegin(t: number): void {
  if (!watchState.on) return;
  if (Number.isNaN(watchState.t0)) watchState.t0 = t;
  watchState.t1 = t;
  watchState.tickV = 0;
  watchState.tickP = 0;
}

/** One drawn agent this tick. */
export function uturnSample(
  id: string,
  kind: "vehicle" | "person",
  t: number,
  x: number,
  z: number,
  yaw: number,
  deadEnd: boolean,
  lap: number,
): void {
  if (!watchState.on) return;
  if (kind === "vehicle") watchState.tickV++;
  else watchState.tickP++;
  let w = watchState.watches.get(id);
  if (!w) {
    w = createReversalWatch();
    watchState.watches.set(id, w);
  }
  if (w.push(t, yaw, deadEnd, lap)) {
    watchState.reversals++;
    if (watchState.examples.length < 10)
      watchState.examples.push(`${id} t=${t.toFixed(2)} (${x.toFixed(1)}, ${z.toFixed(1)})`);
  }
}

/** Called by the motion layer at the end of a tick. */
export function uturnTickEnd(): void {
  if (!watchState.on) return;
  watchState.vehicles.push(watchState.tickV);
  watchState.people.push(watchState.tickP);
}

const stat = (l: number[]) => {
  if (l.length === 0) return { min: 0, median: 0 };
  const s = [...l].sort((a, b) => a - b);
  return { min: s[0] as number, median: s[Math.floor(s.length / 2)] as number };
};

export function readUturnWatch(): UturnReport {
  const s = watchState;
  return {
    on: s.on,
    reversals: s.reversals,
    seconds: Number.isNaN(s.t0) ? 0 : s.t1 - s.t0,
    ticks: s.vehicles.length,
    vehicles: stat(s.vehicles),
    people: stat(s.people),
    agents: s.watches.size,
    examples: [...s.examples],
  };
}
