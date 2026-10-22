import { pointAlong } from "../whatif/rolloutModel";
import type { MarathonResult } from "./closureSimModel";
import { carAt, runnerAt, TOTAL_S } from "./marathonCinematic";

/**
 * T-028 "Watch the marathon": an illustrative playback of a proposed course. Runners move along the
 * engine's course line, sample cars along the engine's rerouted trips (`animation`), and a
 * simulated clock runs across the closure window. Display only: runner and car numbers, paces and
 * speeds are decoration, never crowd sizes, vehicle counts or delays.
 */

/** Screen seconds for the whole closure window: the cinematic's length (T-031). */
export const PLAY_S = TOTAL_S;
/** Runners drawn (decorative; not a crowd size). */
export const RUNNERS = 24;
/** Screen seconds for one car to drive its detour (decorative speed). */
export const CAR_LOOP_S = 8;

export const PLAY_LABEL = "Simulation · illustrative";
export const PLAY_NOTE =
  "Runners, spectators and cars are illustrative: not crowd sizes, vehicle counts or delays.";

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
 * Runner positions (lon/lat) at screen time `t`: all wait at the start until the run shot, then
 * each keeps its own steady decorative pace (`runnerAt`); runner 0 is the lead.
 */
export function runnersAt(course: Coords, t: number, n = RUNNERS): [number, number][] {
  if (course.length < 2) return [];
  return Array.from({ length: n }, (_, i) => pointAlong(course, runnerAt(t, i)));
}

/**
 * Sample cars at `t`: the followed trip's car drives its after-closure route once in the car shot
 * (first in the list); the others loop on theirs. Trips without an after route are skipped.
 */
export function carsAt(trips: MarathonResult["animation"]["rerouted_trips"] = [], t = 0) {
  const followed = trips.find(
    (tr) => tr.after_coordinates.length >= 2 && tr.before_coordinates.length >= 2,
  );
  const rest = trips.filter((tr) => tr !== followed && tr.after_coordinates.length >= 2);
  return [
    ...(followed ? [pointAlong(followed.after_coordinates, carAt(t))] : []),
    ...rest.map((trip, i) =>
      pointAlong(trip.after_coordinates, (t / CAR_LOOP_S + spread(i + 7)) % 1),
    ),
  ];
}

/** True when the result has a course line to play. */
export const canPlay = (m: MarathonResult) => m.animation.course_coordinates.length >= 2;
