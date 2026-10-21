import { create } from "zustand";
import type { DevelopmentPlan } from "./types";

export type DevsimStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

export interface DevsimStore {
  plan: DevelopmentPlan | null;
  /** Screen seconds into the simulation, in [0, plan.total_s]. */
  t: number;
  playing: boolean;
  status: DevsimStatus;
  briefText: string | null;
  /**
   * CSS px the 3D view's look point moves left while the Impact Brief is on screen (spec §6.2: the
   * tower stays clear of the panel). Written by the overlay, applied by the engine's view offset.
   */
  viewShiftPx: number;
  setViewShift: (px: number) => void;
  /** A `development.play` intent: inlined plan (ready) or none yet (loading, the caller fetches it). */
  start: (plan: DevelopmentPlan | null, briefText: string) => void;
  setPlan: (plan: DevelopmentPlan) => void;
  setStatus: (status: DevsimStatus) => void;
  setT: (t: number) => void;
  play: () => void;
  pause: () => void;
  /** Clamped to [0, plan.total_s]; a no-op without a plan. */
  seek: (t: number) => void;
  /** Back to t = 0 and playing (no-op without a plan). */
  restart: () => void;
  /** Frame tick from the driver: moves t by dt screen seconds while playing; stops at the end. */
  advance: (dt: number) => void;
  /** Back to idle: no plan, t = 0, paused. */
  stop: () => void;
}

const idle = {
  plan: null,
  t: 0,
  playing: false,
  status: "idle" as DevsimStatus,
  briefText: null,
  viewShiftPx: 0,
};

const clampT = (plan: DevelopmentPlan, t: number) =>
  Math.max(0, Math.min(plan.total_s, Number.isFinite(t) ? t : 0));

export const useDevsim = create<DevsimStore>((set) => ({
  ...idle,
  start: (plan, briefText) =>
    set({ plan, briefText, t: 0, playing: false, status: plan ? "ready" : "loading" }),
  setPlan: (plan) => set({ plan, t: 0, status: "ready" }),
  setStatus: (status) => set({ status }),
  setViewShift: (px) =>
    set((s) => {
      const v = Number.isFinite(px) ? Math.max(0, Math.round(px)) : 0;
      return v === s.viewShiftPx ? {} : { viewShiftPx: v };
    }),
  setT: (t) => set((s) => (s.plan ? { t: clampT(s.plan, t) } : {})),
  play: () =>
    set((s) =>
      s.plan ? { playing: true, t: s.t >= s.plan.total_s ? 0 : s.t } : { playing: false },
    ),
  pause: () => set({ playing: false }),
  seek: (t) => set((s) => (s.plan ? { t: clampT(s.plan, t) } : {})),
  restart: () => set((s) => (s.plan ? { t: 0, playing: true } : {})),
  advance: (dt) =>
    set((s) => {
      if (!s.plan || !s.playing || !(dt > 0)) return {};
      const t = s.t + dt;
      return t >= s.plan.total_s ? { t: s.plan.total_s, playing: false } : { t };
    }),
  stop: () => set({ ...idle }),
}));
