import { create } from "zustand";
import { registerDemo } from "../demo/demoHook";
import { useDevsim } from "../devsim/devsimStore";
import { reducedMotion } from "../scene/cesium/controls/cameraOps";
import type { CompareIntent } from "./compareTypes";
import { useJourney } from "./journeyStore";

/** Length of the compare playback (spec §5.4: reasons card until 45 s). */
export const COMPARE_TOTAL_S = 45;

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Where the compare renderer drew things this frame, CSS px of the map slot. Written by the 3D
 * renderer each frame (B8), read by the overlays (B10) and the demo hook. Null fields: not drawn
 * (behind the camera, or no such element).
 */
export interface CompareScreen {
  walkers: { fastest: ScreenPoint | null; recommended: ScreenPoint | null };
  /** Keyed by beat id (e.g. "tag-kerb"). */
  pois: Record<string, ScreenPoint | null>;
  /** The first unchecked stretch (the ticket flight's start). */
  unchecked: ScreenPoint | null;
  /** Both routes' screen box (AC-N7, after the merge). */
  routesBbox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Top edge of the reasons card (AC-N7), written by the overlay. */
  cardTop: number | null;
  /** The two halves while split; null after the merge. */
  viewports: { left: { x: number; w: number }; right: { x: number; w: number } } | null;
}

export interface CompareStore {
  payload: CompareIntent | null;
  /** Playback seconds in [0, COMPARE_TOTAL_S]. */
  t: number;
  playing: boolean;
  /** prefers-reduced-motion at load: the renderer cuts between beats instead of flying. */
  reduced: boolean;
  screen: CompareScreen | null;
  /** A new compare, paused at 0. Ends a shown trip and a Development Simulation (one at a time). */
  load: (payload: CompareIntent) => void;
  /** Play from t; from the end it starts again at 0. */
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  restart: () => void;
  clear: () => void;
  setScreen: (s: CompareScreen | null) => void;
  /** Frame tick: moves t by dt while playing; stops at the end. */
  advance: (dt: number) => void;
}

const empty = { payload: null, t: 0, playing: false, screen: null };

const clampT = (t: number) => Math.max(0, Math.min(COMPARE_TOTAL_S, Number.isFinite(t) ? t : 0));

export const useCompare = create<CompareStore>((set) => ({
  ...empty,
  reduced: false,
  load: (payload) => {
    if (useDevsim.getState().status !== "idle") useDevsim.getState().stop();
    if (useJourney.getState().plan) useJourney.getState().clear();
    set({ payload, t: 0, playing: false, screen: null, reduced: reducedMotion() });
  },
  play: () =>
    set((s) =>
      s.payload ? { playing: true, t: s.t >= COMPARE_TOTAL_S ? 0 : s.t } : { playing: false },
    ),
  pause: () => set({ playing: false }),
  seek: (t) => set((s) => (s.payload ? { t: clampT(t) } : {})),
  restart: () => set((s) => (s.payload ? { t: 0, playing: true } : {})),
  clear: () => set({ ...empty }),
  setScreen: (screen) => set({ screen }),
  advance: (dt) =>
    set((s) => {
      if (!s.payload || !s.playing || !(dt > 0)) return {};
      const t = s.t + dt;
      return t >= COMPARE_TOTAL_S ? { t: COMPARE_TOTAL_S, playing: false } : { t };
    }),
}));

/** The nav playback's part of `__tl.demo.state()`. */
export function compareDemoState(): Record<string, unknown> {
  const s = useCompare.getState();
  return {
    loaded: !!s.payload,
    t: s.t,
    playing: s.playing,
    total: COMPARE_TOTAL_S,
    reduced: s.reduced,
    routesBbox: s.screen?.routesBbox ?? null,
    cardTop: s.screen?.cardTop ?? null,
    viewports: s.screen?.viewports ?? null,
  };
}

/** Registers the compare playback as the hook's "nav" demo (done once at module load). */
export function registerCompareDemo(): () => void {
  const s = () => useCompare.getState();
  return registerDemo("nav", {
    seek: (t) => s().seek(t),
    play: () => s().play(),
    pause: () => s().pause(),
    state: compareDemoState,
  });
}

registerCompareDemo();
