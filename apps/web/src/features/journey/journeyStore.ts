import { create } from "zustand";
import type { HeroClip, HeroContact } from "../scene/three/characters/hero";
import type { FiledVr } from "./cardContent";
import {
  buildTimeline,
  type JourneyPlan,
  type JourneyState,
  stateAt,
  type Timeline,
} from "./timeline";

/**
 * The hero as rendered (D-T6): written by the 3D mount each time it poses her, null when no hero is
 * drawn. The crowd keep-out (C-T8) reads `x`/`z` here and never the journey events.
 */
export interface HeroPose {
  /** The route metre she belongs to (the mini-map dot); at a rest she sits beside this point. */
  distance_m: number;
  /** Local scene metres (x east, z = -north); y is the ground height under her. */
  x: number;
  y: number;
  z: number;
  lon: number;
  lat: number;
  yaw: number;
  clip: HeroClip;
  clipTime: number;
  walkRate: number;
  /** Test probe: her ground-contact points with the drawn ground height under each (AC-D10). */
  probe?: () => (HeroContact & { groundY: number; onFootway: boolean })[];
}

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
   * Verification requests filed this session (`verification.requested` chat events), by element
   * and attribute. A card says "verification request filed" only for a match (`vrFiledFor`). Kept
   * across load / clear: a filed request stays filed.
   */
  vrs: FiledVr[];
  noteVr: (elementId: string, attribute: string) => void;
  /** The rendered hero (see `HeroPose`); null without one. */
  hero: HeroPose | null;
  setHero: (p: HeroPose | null) => void;
}

const empty = { plan: null, timeline: null, t: 0, playing: false, hero: null };

export const useJourney = create<JourneyStore>((set) => ({
  ...empty,
  camMode: "follow",
  vrs: [],
  setHero: (hero) => set({ hero }),
  noteVr: (element_id, attribute) =>
    set((s) =>
      !element_id || s.vrs.some((v) => v.element_id === element_id && v.attribute === attribute)
        ? {}
        : { vrs: [...s.vrs, { element_id, attribute }] },
    ),
  load: (plan) => set({ plan, timeline: buildTimeline(plan), t: 0, playing: false, hero: null }),
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
