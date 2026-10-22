import { buildTimeline, type Timeline } from "../journey/timeline";
import type { FloodStory } from "./floodStoryData";

export const RIVER_BEAT_S = 6;
export const BUILDINGS_AT = RIVER_BEAT_S * 4;
export const RESIDENT_AT = BUILDINGS_AT + 10;
export const END_CARD_S = 8;
const smooth = (v: number) => {
  const k = Math.max(0, Math.min(1, v));
  return k * k * (3 - 2 * k);
};

export interface FloodTimeline {
  journey: Timeline | null;
  endAt: number;
  total: number;
}
export function floodTimeline(story: FloodStory): FloodTimeline {
  const journey = story.resident ? buildTimeline(story.resident.plan) : null;
  const endAt = RESIDENT_AT + (journey?.total ?? 5);
  return { journey, endAt, total: endAt + END_CARD_S };
}
export function floodStateAt(t: number, timeline: FloodTimeline) {
  const seconds = Math.max(0, Math.min(timeline.total, Number.isFinite(t) ? t : 0));
  const stage = Math.min(3, Math.floor(seconds / RIVER_BEAT_S));
  const transition = smooth((seconds - stage * RIVER_BEAT_S) / 2);
  const phase =
    seconds < BUILDINGS_AT
      ? "river"
      : seconds < RESIDENT_AT
        ? "buildings"
        : seconds < timeline.endAt
          ? "resident"
          : "end";
  return {
    seconds,
    stage,
    phase,
    // Art-direction travel, unrelated to ground elevation or a modelled local depth.
    rise: stage === 0 ? 0 : (stage - 1 + transition) / 3,
    fade: stage === 0 ? 1 : 0.18 + 0.82 * transition,
    journeyT: Math.max(0, Math.min(timeline.journey?.total ?? 0, seconds - RESIDENT_AT)),
  };
}
