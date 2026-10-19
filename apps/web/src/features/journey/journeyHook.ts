import { isDemoPreset } from "../demo/preset";
import {
  type CamMode,
  type HeroPose,
  type HeroProbe,
  type JourneyPart,
  journeyCamera,
  journeyHero,
  journeyShow,
  journeyStateOf,
  useJourney,
} from "./journeyStore";
import type { CameraProbe } from "./three/cameraProbe";
import type { JourneyPlan, JourneyState, Phase } from "./timeline";

export type HeroReport = Omit<HeroPose, "probe"> & Partial<HeroProbe>;

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
   * The hero as rendered by the 3D mount (D-T6): her route metre (`distance_m`, what the mini-map
   * dot shows), world position (local metres and lon/lat), yaw and current clip. Null when no hero
   * is drawn (no plan, or a renderer without one). `{ contacts: true }` adds her ground-contact
   * points (feet, walker leg tips) with the drawn ground height and band under each, and the rest
   * benches' seat corners (AC-D10).
   */
  hero: (opts?: { contacts?: boolean }) => HeroReport | null;
  /**
   * The journey camera now (D-T5, AC-D8 / AC-D9): driven or not, the hero's body box on screen and
   * in the 10 % margin frame, her distance, building lines of sight to her, the camera inside a
   * building, and the current hold's element on screen. Null without a 3D player.
   */
  camera: () => CameraProbe | null;
  /** Acceptance: hides (false) or shows a drawn part (`JourneyPart`); false without a 3D player. */
  show: (part: JourneyPart, visible: boolean) => boolean;
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
    hero: (opts) => {
      const p = journeyHero.current;
      if (!p || !s().plan) return null;
      const { probe, ...pose } = p;
      return opts?.contacts && probe ? { ...pose, ...probe() } : pose;
    },
    camera: () => (s().plan ? (journeyCamera.current?.() ?? null) : null),
    show: (part, visible) => {
      const f = journeyShow.current;
      if (!f) return false;
      f(part, visible);
      return true;
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
