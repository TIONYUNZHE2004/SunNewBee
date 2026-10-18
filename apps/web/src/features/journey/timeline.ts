/**
 * Journey playback timeline (spec 2026-10-19 resident journey §6.4, AC-D7).
 *
 * Pure maths: a `JourneyPlan` from the backend becomes screen-time phases (dive, walks, one hold
 * per plan event, pull-back) and `stateAt` gives the HUD values at any screen time. The renderer
 * only plays this; it never invents events, distances or times. Ported from the prototype's
 * `phases` / `stateAt` (docs/03-product/prototypes/resident-journey/index.html) with two changes:
 * holds never move the hero along the route (so the HUD at each event start equals the plan:
 * distance = `at_m`, clock = start + at_m / pace + earlier holds), and the covered stretch comes
 * from the plan's span under the covered event rather than a hard-coded 8 m.
 */
import type { components } from "@tl/api-client";

export type JourneyPlan = components["schemas"]["JourneyPlan"];
export type JourneyEvent = components["schemas"]["JourneyEvent"];
export type JourneyEventKind = JourneyEvent["kind"];

/** Screen seconds of the opening dive from the overview to the hero. */
export const DIVE_S = 4;
/** Screen seconds of the closing pull-back. */
export const PULL_S = 5;
/** Walk compression: simulated seconds per screen second (1 trip minute = 3 s on screen). */
export const COMPRESS = 20;
/** Screen seconds each event kind holds (§6.4). Simulated time comes from the plan's `hold_s`. */
export const HOLD_SCREEN_S: Readonly<Record<JourneyEventKind, number>> = {
  verified: 3.2,
  unknown: 3.6,
  rest: 4.2,
  gap: 3.4,
  covered: 3.0,
  arrive: 3.2,
};

export type PhaseKind = "dive" | "walk" | "event" | "pull";

export interface Phase {
  kind: PhaseKind;
  /** Screen seconds, [t0, t1). */
  t0: number;
  t1: number;
  /** Simulated seconds since the start time. */
  sim0: number;
  sim1: number;
  /** Metres along the route. */
  m0: number;
  m1: number;
  /** The plan event this hold shows (event phases only). */
  event?: JourneyEvent;
  eventIndex?: number;
  /** Simulated seconds outdoors at the phase start (not under a covered span). */
  out0: number;
  /** Rest holds started before this phase. */
  rests0: number;
}

export interface Timeline {
  plan: JourneyPlan;
  phases: Phase[];
  /** Screen seconds: the sum of the phases. */
  total: number;
  /** Route intervals [from_m, to_m) under a covered event (minutes outdoors pause there). */
  covered: [number, number][];
}

export interface JourneyState {
  phase: Phase;
  phaseIndex: number;
  /** 0..1 progress through the phase. */
  u: number;
  distance_m: number;
  simSeconds: number;
  /** "HH:MM": the plan's start time plus the simulated seconds, to the minute. */
  clock: string;
  /** Rest holds started so far (a rest counts from the start of its hold). */
  restsTaken: number;
  outdoorsSeconds: number;
  minutesOutdoors: number;
  event?: JourneyEvent;
  eventIndex?: number;
}

const EPS_M = 0.01;

/** "HH:MM" + simulated seconds, floored to the minute, wrapping at midnight. */
export function clockAt(startTime: string, simSeconds: number): string {
  const [h, m] = startTime.split(":").map(Number);
  const mins = ((((h ?? 0) * 60 + (m ?? 0) + Math.floor(simSeconds / 60)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/** The plan span starting where each covered event starts: the stretch under that roof. */
function coveredIntervals(plan: JourneyPlan): [number, number][] {
  const out: [number, number][] = [];
  for (const e of plan.events) {
    if (e.kind !== "covered") continue;
    const span = plan.spans.find(([a, b]) => Math.abs(a - e.at_m) < 0.05 && b > a);
    if (span) out.push([span[0], span[1]]);
  }
  return out;
}

const isCovered = (cov: [number, number][], m: number) => cov.some(([a, b]) => m >= a && m < b);

/** Metres of [a, b] under cover. */
function coveredLength(cov: [number, number][], a: number, b: number): number {
  let s = 0;
  for (const [c0, c1] of cov) s += Math.max(0, Math.min(b, c1) - Math.max(a, c0));
  return s;
}

/** Simulated outdoor seconds gained over part of a phase, from its start to progress u. */
function outdoorsIn(p: Phase, u: number, cov: [number, number][], pace: number): number {
  const sim = (p.sim1 - p.sim0) * u;
  if (p.kind === "walk") {
    const m = p.m0 + (p.m1 - p.m0) * u;
    return sim - coveredLength(cov, p.m0, m) / pace;
  }
  return isCovered(cov, p.m0) ? 0 : sim;
}

/** Phases for a plan: dive, then for each event a walk to it (if it is further on) and its hold,
 * a final walk to the route end if no event is there, then the pull-back. */
export function buildTimeline(plan: JourneyPlan): Timeline {
  const pace = plan.pace_m_per_s;
  const covered = coveredIntervals(plan);
  const phases: Phase[] = [];
  let t = 0;
  let sim = 0;
  let m = 0;
  let out = 0;
  let rests = 0;
  const push = (p: Omit<Phase, "t0" | "t1" | "out0" | "rests0">, dur: number) => {
    const ph: Phase = { ...p, t0: t, t1: t + dur, out0: out, rests0: rests };
    phases.push(ph);
    out += outdoorsIn(ph, 1, covered, pace);
    t += dur;
    sim = ph.sim1;
    m = ph.m1;
  };
  const walkTo = (to: number) => {
    if (to <= m + EPS_M) return;
    const dSim = (to - m) / pace;
    push({ kind: "walk", sim0: sim, sim1: sim + dSim, m0: m, m1: to }, dSim / COMPRESS);
  };

  push({ kind: "dive", sim0: 0, sim1: 0, m0: 0, m1: 0 }, DIVE_S);
  plan.events.forEach((event, eventIndex) => {
    walkTo(event.at_m);
    const at = Math.max(m, event.at_m);
    push(
      { kind: "event", sim0: sim, sim1: sim + event.hold_s, m0: at, m1: at, event, eventIndex },
      HOLD_SCREEN_S[event.kind],
    );
    if (event.kind === "rest") rests += 1;
  });
  const end = plan.spans.at(-1)?.[1] ?? m;
  if (!plan.events.some((e) => e.kind === "arrive")) walkTo(end);
  push({ kind: "pull", sim0: sim, sim1: sim, m0: m, m1: m }, PULL_S);
  return { plan, phases, total: t, covered };
}

function phaseIndexAt(tl: Timeline, t: number): number {
  const ps = tl.phases;
  let lo = 0;
  let hi = ps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((ps[mid] as Phase).t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** HUD and playback state at screen time t (clamped to [0, total]). */
export function stateAt(tl: Timeline, t: number): JourneyState {
  const tc = Math.max(0, Math.min(tl.total, Number.isFinite(t) ? t : 0));
  const phaseIndex = phaseIndexAt(tl, tc);
  const phase = tl.phases[phaseIndex] as Phase;
  const dur = phase.t1 - phase.t0;
  const u = dur > 0 ? Math.min(1, (tc - phase.t0) / dur) : 1;
  const simSeconds = phase.sim0 + (phase.sim1 - phase.sim0) * u;
  const outdoorsSeconds = phase.out0 + outdoorsIn(phase, u, tl.covered, tl.plan.pace_m_per_s);
  const restsTaken = phase.rests0 + (phase.event?.kind === "rest" ? 1 : 0);
  const s: JourneyState = {
    phase,
    phaseIndex,
    u,
    distance_m: phase.m0 + (phase.m1 - phase.m0) * u,
    simSeconds,
    clock: clockAt(tl.plan.start_time, simSeconds),
    restsTaken,
    outdoorsSeconds,
    minutesOutdoors: Math.floor(Math.max(0, outdoorsSeconds) / 60),
  };
  if (phase.event) {
    s.event = phase.event;
    s.eventIndex = phase.eventIndex;
  }
  return s;
}
