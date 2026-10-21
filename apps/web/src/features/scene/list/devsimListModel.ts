import { actAt } from "../../devsim/timeline";
import type { BubbleTone, DevelopmentPlan } from "../../devsim/types";

export type ActState = "done" | "on" | "todo";

export interface DevsimQuote {
  n: number;
  speaker: string;
  role: string;
  text: string;
  tag: string | null;
  tone: BubbleTone;
  /** The bubble is on screen at t. */
  speaking: boolean;
  /** The bubble's beat has started (t ≥ its start). */
  heard: boolean;
}

/**
 * Pure: the Development Simulation's text version for the List view / no-WebGL (spec §5.3): the
 * acts with their progress at t, and every bubble as a quote with its speaker, role and tag.
 * Copy is the plan's, verbatim.
 */
export function devsimListModel(
  plan: DevelopmentPlan,
  t: number,
): { acts: { name: string; state: ActState }[]; quotes: DevsimQuote[] } {
  const now = actAt(t, plan.acts);
  const atEnd = t >= plan.total_s;
  const acts = plan.acts.map((a) => ({
    name: a.name,
    state: (a === now && !atEnd ? "on" : a.t1 <= t ? "done" : "todo") as ActState,
  }));
  const quotes = [...plan.bubbles]
    .sort((a, b) => a.t0 - b.t0)
    .map((b) => {
      const c = plan.cast.find((x) => x.id === b.who);
      return {
        n: b.n,
        speaker: c?.name ?? b.who,
        role: c?.role ?? "",
        text: b.text,
        tag: b.tag ?? null,
        tone: b.tone,
        speaking: t >= b.t0 && t < b.t1,
        heard: t >= b.t0,
      };
    });
  return { acts, quotes };
}
