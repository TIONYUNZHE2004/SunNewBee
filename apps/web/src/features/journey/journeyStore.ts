import { create } from "zustand";
import {
  buildTimeline,
  type JourneyPlan,
  type JourneyState,
  stateAt,
  type Timeline,
} from "./timeline";

/** Camera modes of the journey player (spec §6.4, R-J4). */
export type CamMode = "follow" | "overview" | "free";

export interface JourneyStore {
  plan: JourneyPlan | null;
  timeline: Timeline | null;
  /** Screen seconds into the timeline, in [0, timeline.total]. */
  t: number;
  playing: boolean;
  camMode: CamMode;
  /** A new plan: its timeline, paused at the start (auto-play is the caller's choice). */
  load: (plan: JourneyPlan) => void;
  clear: () => void;
  /** Play from t; from the end it starts again at 0. */
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  restart: () => void;
  setCam: (m: CamMode) => void;
  /** Frame tick from the player: moves t by dt screen seconds while playing; stops at the end. */
  advance: (dt: number) => void;
  /**
   * Element ids with a verification request filed this session (`verification.requested` chat
   * events). A card says "verification request filed" only for these. Kept across load / clear:
   * a filed request stays filed.
   */
  vrElements: string[];
  noteVr: (elementId: string) => void;
}

const empty = { plan: null, timeline: null, t: 0, playing: false };

export const useJourney = create<JourneyStore>((set) => ({
  ...empty,
  camMode: "follow",
  vrElements: [],
  noteVr: (id) =>
    set((s) => (!id || s.vrElements.includes(id) ? {} : { vrElements: [...s.vrElements, id] })),
  load: (plan) => set({ plan, timeline: buildTimeline(plan), t: 0, playing: false }),
  clear: () => set({ ...empty, camMode: "follow" }),
  play: () =>
    set((s) =>
      s.timeline ? { playing: true, t: s.t >= s.timeline.total ? 0 : s.t } : { playing: false },
    ),
  pause: () => set({ playing: false }),
  seek: (t) =>
    set((s) =>
      s.timeline ? { t: Math.max(0, Math.min(s.timeline.total, Number.isFinite(t) ? t : 0)) } : {},
    ),
  restart: () => set((s) => (s.timeline ? { t: 0, playing: true } : {})),
  setCam: (camMode) => set({ camMode }),
  advance: (dt) =>
    set((s) => {
      if (!s.timeline || !s.playing || !(dt > 0)) return {};
      const t = s.t + dt;
      return t >= s.timeline.total ? { t: s.timeline.total, playing: false } : { t };
    }),
}));

/** HUD and playback state for the store's current t; null without a plan. */
export function journeyStateOf(s: Pick<JourneyStore, "timeline" | "t">): JourneyState | null {
  return s.timeline ? stateAt(s.timeline, s.t) : null;
}
