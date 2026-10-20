import { isDemoPreset } from "../demo/demoFlag";
import { collectProbe } from "./anchors";
import { useDevsim } from "./devsimStore";
import { stateAt } from "./timeline";
import type { Act, DevsimFacts, Probe, StateAt } from "./types";

/** `window.__devsim`, as the prototype's (spec §4, §5.3), plus `probe()` and `state()`. */
export interface DevsimHook {
  seek: (s: number) => void;
  play: () => void;
  pause: () => void;
  /** Screen seconds of the run (66), or 0 without a plan. */
  readonly total: number;
  readonly acts: Act[];
  readonly facts: DevsimFacts | null;
  /** Projected rects (3D part + DOM part) and flow samples at the current t (§10). */
  probe: () => Probe;
  /** Current screen time and the timeline state, or null without a plan. */
  state: () => (StateAt & { t: number; playing: boolean }) | null;
}

export function createDevsimHook(): DevsimHook {
  const s = () => useDevsim.getState();
  return {
    seek: (x) => s().seek(x),
    play: () => s().play(),
    pause: () => s().pause(),
    get total() {
      return s().plan?.total_s ?? 0;
    },
    get acts() {
      return s().plan?.acts ?? [];
    },
    get facts() {
      return s().plan?.facts ?? null;
    },
    probe: () => {
      const { plan, t } = s();
      const p = collectProbe(t);
      // without a 3D part the timeline's own window state is the truth (Q4)
      if (plan && p.windowsLitFraction === 0)
        p.windowsLitFraction = stateAt(t, plan).windowsLitFraction;
      return p;
    },
    state: () => {
      const { plan, t, playing } = s();
      return plan ? { ...stateAt(t, plan), t, playing } : null;
    },
  };
}

/** Exposes window.__devsim in dev and test builds and in the demo preset; never on a normal production load. */
export function installDevsimHook(
  opts: { dev: boolean; search?: string },
  target: { __devsim?: DevsimHook } = globalThis as unknown as { __devsim?: DevsimHook },
): boolean {
  if (!opts.dev && !isDemoPreset(opts.search)) return false;
  target.__devsim = createDevsimHook();
  return true;
}
