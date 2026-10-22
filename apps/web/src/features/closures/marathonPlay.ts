import { pointAlong } from "../whatif/rolloutModel";
import type { MarathonResult } from "./closureSimModel";

/**
 * T-028 "Watch the marathon": an illustrative playback of a proposed course. Runners move along the
 * engine's course line, sample cars along the engine's rerouted trips (`animation`), and a
 * simulated clock runs across the closure window. Display only: runner and car numbers, paces and
 * speeds are decoration, never crowd sizes, vehicle counts or delays.
 */

/** Screen seconds for the whole closure window. */
export const PLAY_S = 40;
/** Runners drawn (decorative; not a crowd size). */
export const RUNNERS = 24;
/** Screen seconds for one car to drive its detour (decorative speed). */
export const CAR_LOOP_S = 8;
/** Runners finish between these fractions of the window (decorative paces). */
const FINISH_FIRST = 0.45;
const FINISH_LAST = 0.85;

export const PLAY_LABEL = "Simulation · illustrative";
export const PLAY_NOTE =
  "Runners and cars are illustrative: not crowd sizes, vehicle counts or delays.";

/** Runner, car and before-route colours (an overlay legend, outside the clay city tokens). */
export const PLAY_STYLE = {
  runner: "#F5C518",
  runnerEdge: "#1A202C",
  car: "#2B6CB0",
  before: "#A0AEC0",
} as const;

type Coords = number[][];

/** The engine's closure window for the course (first closure), else null. */
export function playWindow(m: MarathonResult): { start: Date; end: Date } | null {
  const c = m.impact.event.closures[0];
  if (!c) return null;
  const start = new Date(c.starts_at);
  const end = new Date(c.ends_at);
  return Number.isFinite(start.getTime()) && end > start ? { start, end } : null;
}

const clock = new Intl.DateTimeFormat("en-MY", {
  timeZone: "Asia/Kuala_Lumpur",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** The simulated clock at screen time `t`, in Elmina time, e.g. "Mon 06:42"; null without a window. */
export function simClock(m: MarathonResult, t: number): string | null {
  const w = playWindow(m);
  if (!w) return null;
  const f = Math.min(Math.max(t / PLAY_S, 0), 1);
  return clock.format(new Date(w.start.getTime() + f * (w.end.getTime() - w.start.getTime())));
}

/** Deterministic 0..1 per index, so the playback looks the same every time. */
const spread = (i: number) => (((i * 0.618034) % 1) + 1) % 1;

/**
 * Runner positions (lon/lat) at screen time `t`: all start together at the course start and
 * finish by FINISH_LAST of the window; each keeps its own steady decorative pace.
 */
export function runnersAt(course: Coords, t: number, n = RUNNERS): [number, number][] {
  if (course.length < 2) return [];
  const f = Math.min(Math.max(t / PLAY_S, 0), 1);
  return Array.from({ length: n }, (_, i) => {
    const finish = FINISH_FIRST + spread(i) * (FINISH_LAST - FINISH_FIRST);
    return pointAlong(course, Math.min(f / finish, 1));
  });
}

/** One car per rerouted sample trip, driving its after-closure route on a loop; empty lines skip. */
export function carsAt(trips: MarathonResult["animation"]["rerouted_trips"] = [], t = 0) {
  return trips.flatMap((trip, i) =>
    trip.after_coordinates.length >= 2
      ? [pointAlong(trip.after_coordinates, (t / CAR_LOOP_S + spread(i + 7)) % 1)]
      : [],
  );
}

/** True when the result has a course line to play. */
export const canPlay = (m: MarathonResult) => m.animation.course_coordinates.length >= 2;
