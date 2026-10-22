import { create } from "zustand";
import { useScene } from "../scene/sceneStore";
import type { MarathonResult } from "./closureSimModel";
import { PLAY_S } from "./marathonPlay";

/** "Watch the marathon" playback state (follows the devsim store): screen time in [0, PLAY_S]. */
export interface MarathonPlayStore {
  result: MarathonResult | null;
  t: number;
  playing: boolean;
  /** Starts the playback of `m` from t = 0. */
  start: (m: MarathonResult) => void;
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  /** Frame tick: moves t by dt screen seconds while playing; stops at the end. */
  advance: (dt: number) => void;
  stop: () => void;
}

const clamp = (t: number) => Math.max(0, Math.min(PLAY_S, Number.isFinite(t) ? t : 0));

export const useMarathonPlay = create<MarathonPlayStore>((set) => ({
  result: null,
  t: 0,
  playing: false,
  start: (result) => {
    // the city's ambient cars give way to the playback's own (T-031 shared switch)
    useScene.getState().setAmbientTraffic(false);
    set({ result, t: 0, playing: true });
  },
  play: () =>
    set((s) => (s.result ? { playing: true, t: s.t >= PLAY_S ? 0 : s.t } : { playing: false })),
  pause: () => set({ playing: false }),
  seek: (t) => set((s) => (s.result ? { t: clamp(t) } : {})),
  advance: (dt) =>
    set((s) => {
      if (!s.result || !s.playing || !(dt > 0)) return {};
      const t = s.t + dt;
      return t >= PLAY_S ? { t: PLAY_S, playing: false } : { t };
    }),
  stop: () => {
    useScene.getState().setAmbientTraffic(true);
    set({ result: null, t: 0, playing: false });
  },
}));
