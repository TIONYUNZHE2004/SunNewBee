import { type CamMode, journeyStateOf, useJourney } from "./journeyStore";
import type { JourneyState, Phase } from "./timeline";

/** The prototype's test and recording hook (`window.__journey`), plus a read-only `state()`. */
export interface JourneyHook {
  seek: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  setCam: (mode: CamMode) => void;
  readonly phases: Phase[];
  readonly total: number;
  state: () => (JourneyState & { t: number; playing: boolean; camMode: CamMode }) | null;
}

/** The demo preset (?demo=1). The preset itself is A-T13; this reads the flag only. */
export function isDemoPreset(search: string = globalThis.location?.search ?? ""): boolean {
  return new URLSearchParams(search).get("demo") === "1";
}

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
