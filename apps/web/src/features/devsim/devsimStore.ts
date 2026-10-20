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
  /** A `development.play` intent: inlined plan (ready) or none yet (loading, the caller fetches it). */
  start: (plan: DevelopmentPlan | null, briefText: string) => void;
  setPlan: (plan: DevelopmentPlan) => void;
  setStatus: (status: DevsimStatus) => void;
  setT: (t: number) => void;
  play: () => void;
  pause: () => void;
  /** Clamped to [0, plan.total_s]; a no-op without a plan. */
  seek: (t: number) => void;
  /** Back to idle: no plan, t = 0, paused. */
  stop: () => void;
}

const idle = {
  plan: null,
  t: 0,
  playing: false,
  status: "idle" as DevsimStatus,
  briefText: null,
};

const clampT = (plan: DevelopmentPlan, t: number) =>
  Math.max(0, Math.min(plan.total_s, Number.isFinite(t) ? t : 0));

export const useDevsim = create<DevsimStore>((set) => ({
  ...idle,
  start: (plan, briefText) =>
    set({ plan, briefText, t: 0, playing: false, status: plan ? "ready" : "loading" }),
  setPlan: (plan) => set({ plan, t: 0, status: "ready" }),
  setStatus: (status) => set({ status }),
  setT: (t) => set((s) => (s.plan ? { t: clampT(s.plan, t) } : {})),
  play: () =>
    set((s) =>
      s.plan ? { playing: true, t: s.t >= s.plan.total_s ? 0 : s.t } : { playing: false },
    ),
  pause: () => set({ playing: false }),
  seek: (t) => set((s) => (s.plan ? { t: clampT(s.plan, t) } : {})),
  stop: () => set({ ...idle }),
}));
