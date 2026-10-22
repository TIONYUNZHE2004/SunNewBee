import type { MarathonResult } from "./closureSimModel";

/**
 * T-031 "Watch the marathon" as one cinematic shot list (one camera): the course draws itself,
 * the camera dives to the lead runner and follows the pack, cuts to one rerouted sample car on its
 * detour, then pulls back to the overview and the end card. Every function is pure in screen time
 * `t`, so the scrubber can seek anywhere. Paces and speeds are decoration, never measurements.
 */

export type ShotId = "reveal" | "dive" | "run" | "cut" | "car" | "pull";

/** Screen seconds per shot, in order. */
export const SHOTS: readonly { id: ShotId; s: number }[] = [
  { id: "reveal", s: 3 },
  { id: "dive", s: 2 },
  { id: "run", s: 18 },
  { id: "cut", s: 2 },
  { id: "car", s: 10 },
  { id: "pull", s: 3 },
];
export const TOTAL_S = SHOTS.reduce((a, s) => a + s.s, 0);

/** Captions for the controls (what the camera shows now). */
export const SHOT_CAPTION: Record<ShotId, string> = {
  reveal: "The proposed course",
  dive: "The lead runner",
  run: "The lead runner",
  cut: "A rerouted sample car",
  car: "A rerouted sample car",
  pull: "Summary",
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** Start time (screen s) of a shot. */
export function shotStart(id: ShotId): number {
  let at = 0;
  for (const s of SHOTS) {
    if (s.id === id) return at;
    at += s.s;
  }
  return at;
}

/** The shot at `t` and how far through it (0..1); past the end, the last shot at 1. */
export function shotAt(t: number): { id: ShotId; u: number } {
  let at = 0;
  for (const s of SHOTS) {
    if (t < at + s.s) return { id: s.id, u: clamp01((t - at) / s.s) };
    at += s.s;
  }
  return { id: "pull", u: 1 };
}

/** How much of the course ribbon has drawn itself (0..1). */
export const revealAt = (t: number) => clamp01(t / (SHOTS[0]?.s ?? 1));

const RUN_START = shotStart("run");
const RUN_S = SHOTS.find((s) => s.id === "run")?.s ?? 1;

/** Decorative pace of runner i relative to the lead (1 = the lead, slowest 0.975): a pack close behind, in the follow shot's frame. */
export const paceOf = (i: number) => (i === 0 ? 1 : 0.975 + 0.024 * ((i * 0.618034) % 1));

/** Fraction of the course runner `i` has run at `t`: the lead finishes as the run shot ends. */
export const runnerAt = (t: number, i: number) => clamp01(((t - RUN_START) * paceOf(i)) / RUN_S);

/** The lead runner's fraction of the course. */
export const leadAt = (t: number) => runnerAt(t, 0);

const CAR_START = shotStart("car");
const CAR_S = SHOTS.find((s) => s.id === "car")?.s ?? 1;
/** Fraction of its after-closure route the followed car has driven. */
export const carAt = (t: number) => clamp01((t - CAR_START) / CAR_S);

/** The followed sample car: the engine's first rerouted trip with both routes drawable. */
export function followedTrip(m: MarathonResult) {
  return (
    (m.animation.rerouted_trips ?? []).find(
      (tr) => tr.after_coordinates.length >= 2 && tr.before_coordinates.length >= 2,
    ) ?? null
  );
}

/** Named roads the course closes (unnamed stretches are not counted as roads). */
export function roadsClosed(m: MarathonResult): number {
  return new Set(m.course.roads.map((r) => r.name).filter((n) => !n.startsWith("unnamed path")))
    .size;
}

/**
 * The detour tag from the engine's numbers: the median extra distance (and minutes) of rerouted
 * sample trips. Minutes are distance/pace estimates, not congestion. Per-trip numbers are not
 * sent to the map, so the tag says "median".
 */
export function detourTag(m: MarathonResult): string | null {
  const metres = m.impact.extra_m_median;
  if (metres == null) return null;
  const mins = m.impact.extra_min_median;
  const min = mins == null ? "" : ` · +${mins} min at walking pace`;
  return `Detour (median of rerouted trips): +${metres} m${min}`;
}

/** Map tags for suggestion kinds that name a place to act at (the rest go to the end card). */
const PLACE_TAGS: Record<string, string> = {
  marshal: "Marshal suggested here",
  signpost: "Signpost suggested here",
  crossing_point: "Crossing point suggested here",
};
/** At most this many suggestion tags on the map at once. */
export const MAX_SUGGESTION_TAGS = 2;

/** The map tag for a suggestion kind, or null when the kind is not about one place. */
export const suggestionTag = (kind: string): string | null => PLACE_TAGS[kind] ?? null;

/**
 * Where a suggestion is about: the detour road its text names (the longest name that appears),
 * else null (it goes to the end card only).
 */
export function suggestionRoad(m: MarathonResult, text: string): string | null {
  const names = [...new Set(m.impact.detour_roads.map((r) => r.name))].sort(
    (a, b) => b.length - a.length,
  );
  return names.find((n) => text.includes(n)) ?? null;
}
