import { isDemoPreset } from "../demo/preset";
import { type CamMode, journeyStateOf, useJourney } from "./journeyStore";
import type { JourneyPlan, JourneyState, Phase } from "./timeline";

/** The prototype's test and recording hook (`window.__journey`), plus a read-only `state()`. */
export interface JourneyHook {
  seek: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  setCam: (mode: CamMode) => void;
  readonly phases: Phase[];
  readonly total: number;
  /** The loaded plan (read only), null without one. */
  readonly plan: JourneyPlan | null;
  /**
   * The hero's position along the route in plan metres (AC-D12 mini-map check), null without a
   * plan. Until D-T6 renders a hero this is the timeline's `distance_m` at t; D-T6 replaces it with
   * the rendered hero's position (the metre `routePath` places her at, `layer.path.pointAt`).
   */
  hero: () => { distance_m: number } | null;
  state: () => (JourneyState & { t: number; playing: boolean; camMode: CamMode }) | null;
}

// One parser for ?demo=1: the demo preset's (A-T13). Re-exported for existing importers.
export { isDemoPreset };

export function createJourneyHook(): JourneyHook {
  const s = () => useJourney.getState();
  return {
    seek: (seconds) => s().seek(seconds),
    play: () => s().play(),
    pause: () => s().pause(),
    setCam: (m) => s().setCam(m),
    get phases() {
      return s().timeline?.phases ?? [];
    },
    get total() {
      return s().timeline?.total ?? 0;
    },
    get plan() {
      return s().plan;
    },
    hero: () => {
      const st = journeyStateOf(s());
      return st ? { distance_m: st.distance_m } : null;
    },
    state: () => {
      const st = journeyStateOf(s());
      return st ? { ...st, t: s().t, playing: s().playing, camMode: s().camMode } : null;
    },
  };
}

/** Exposes window.__journey in dev builds and in the demo preset; never on a normal production load. */
export function installJourneyHook(
  opts: { dev: boolean; search?: string },
  target: { __journey?: JourneyHook } = window as unknown as { __journey?: JourneyHook },
): boolean {
  if (!opts.dev && !isDemoPreset(opts.search)) return false;
  target.__journey = createJourneyHook();
  return true;
}
