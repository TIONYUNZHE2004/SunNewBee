import type { DevelopmentPlan, StateAt } from "../../../devsim/types";
// The timeline (FE lane, features/devsim/timeline.ts) is the authority for timing.
import { stateAt as stateAtImpl } from "../../../devsim/timeline";

/** The devsim frame state at screen time t: the only way the 3D lane reads the timeline. */
export function stateAt(t: number, plan: DevelopmentPlan): StateAt {
  return stateAtImpl(t, plan);
}

const FLOW_STEP_S = 0.05;
const flowCache = new WeakMap<DevelopmentPlan, Float64Array>();

/**
 * Flow seconds at screen time t: the integral of `flow.timeScale` from 0 to t (sampled every 50 ms,
 * linear in between), so the decorative people and cars run `timeScale` times faster in the
 * fast-forward and their positions stay a pure function of t (a seek restores the same frame).
 */
export function flowSeconds(t: number, plan: DevelopmentPlan): number {
  let table = flowCache.get(plan);
  if (!table) {
    const n = Math.ceil(plan.total_s / FLOW_STEP_S) + 2;
    table = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const mid = (i - 0.5) * FLOW_STEP_S;
      table[i] = (table[i - 1] as number) + stateAt(mid, plan).flow.timeScale * FLOW_STEP_S;
    }
    flowCache.set(plan, table);
  }
  const x = Math.max(0, Math.min(plan.total_s, Number.isFinite(t) ? t : 0)) / FLOW_STEP_S;
  const i = Math.min(table.length - 2, Math.floor(x));
  const a = table[i] as number;
  const b = table[i + 1] as number;
  return a + (b - a) * (x - i);
}
