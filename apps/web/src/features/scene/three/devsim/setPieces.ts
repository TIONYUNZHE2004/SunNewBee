/**
 * Construction set pieces (spec 2026-10-21 §6.2 Construction detail, §6.3; AC-W3, AC-W4): the one
 * place the 3D lane reads the C7 plan fields (`lorry_route`, `schedule`) and the one place their
 * screen times live. Pure maths, no Three.js.
 *
 * Two modes:
 * - "schedule": the plan carries `schedule` (C7, 45 s timeline). The Hari Raya hold and the monsoon
 *   stretch come from `buildPlayback(schedule)` (fe `schedulePlayback.ts`, ruling R25 windows), the
 *   piling rig and the lorry route from the spec §6.3 beats below.
 * - "legacy": today's 66 s plan (no schedule): no hold, no rain, the crane slews as the timeline
 *   says, the piling rig stands in the first seconds of Construction, the Handover lorries keep
 *   today's lane path. A plan with `lorry_route` but no schedule draws the route over Construction.
 */
import type { DevelopmentPlanExtras, LorryRoute, Schedule } from "../../../devsim/planTypes";
import { BUILD_BEATS, buildPlayback } from "../../../devsim/schedulePlayback";
import { CON } from "../../../devsim/timeline";
import type { DevelopmentPlan, StateAt } from "../../../devsim/types";
import { ease } from "./ease";
import { stateAt } from "./state";

/** Spec §6.3 / brief C9 screen times (s) for the schedule mode, and the legacy stand-ins. */
export const SET_PIECE_S = {
  /** Piling rig on the footprint grid (AC-W4). */
  piling: [3.5, 8.5] as const,
  /** Lorry route ribbon and the construction lorries on it. */
  lorryRoute: [8.5, BUILD_BEATS.handover] as const,
  /** Move-in lorries start along the route (Handover). */
  moveIn: BUILD_BEATS.handover,
  /** Monsoon wet beats: every other 1.5 s inside the monsoon window (the 2nd, 4th ... beat). */
  wetBeat: 1.5,
  /** Rain fades in and out over this much of the monsoon window's ends. */
  rainFade: 0.5,
  /** The crane eases to and from a stop over this many seconds (outside the stop window). */
  craneRamp: 0.3,
  /** Legacy (66 s): the rig stands until the first floor rises (`timeline.ts` WORK_START). */
  legacyPiling: [CON[0], CON[0] + 1.2] as const,
  /** Legacy (66 s): today's Handover lorries (`site.ts` lorryPoses). */
  legacyMoveIn: 33,
} as const;

export interface SetPieceTiming {
  mode: "schedule" | "legacy";
  piling: readonly [number, number];
  /** The lorry route ribbon and construction traffic window; null without a route. */
  lorryRoute: readonly [number, number] | null;
  /** Hari Raya hold (site closed), schedule mode only. */
  raya: readonly [number, number] | null;
  /** Monsoon stretch (rain, wet beats), schedule mode only. */
  monsoon: readonly [number, number] | null;
  moveIn: number;
  total: number;
}

/** The C7 plan fields, read in one place (absent on today's plan). */
export function planExtras(plan: DevelopmentPlan): {
  lorryRoute: LorryRoute | null;
  schedule: Schedule | null;
} {
  const x = plan as DevelopmentPlan & DevelopmentPlanExtras;
  const r = x.lorry_route;
  return {
    lorryRoute: r && Array.isArray(r.path) && r.path.length >= 2 ? r : null,
    schedule: x.schedule ?? null,
  };
}

const timingCache = new WeakMap<DevelopmentPlan, SetPieceTiming>();

export function setPieceTiming(plan: DevelopmentPlan): SetPieceTiming {
  const hit = timingCache.get(plan);
  if (hit) return hit;
  const { lorryRoute, schedule } = planExtras(plan);
  let out: SetPieceTiming;
  if (schedule) {
    const pb = buildPlayback(schedule);
    out = {
      mode: "schedule",
      piling: SET_PIECE_S.piling,
      lorryRoute: lorryRoute ? SET_PIECE_S.lorryRoute : null,
      raya: pb.raya,
      monsoon: pb.monsoon,
      moveIn: SET_PIECE_S.moveIn,
      total: plan.total_s,
    };
  } else {
    out = {
      mode: "legacy",
      piling: SET_PIECE_S.legacyPiling,
      lorryRoute: lorryRoute ? [CON[0], CON[1]] : null,
      raya: null,
      monsoon: null,
      moveIn: SET_PIECE_S.legacyMoveIn,
      total: plan.total_s,
    };
  }
  timingCache.set(plan, out);
  return out;
}

const inWin = (t: number, w: readonly [number, number] | null) => !!w && t >= w[0] && t < w[1];
/** Seconds from t to the window (0 inside it). */
const distWin = (t: number, w: readonly [number, number] | null) =>
  !w ? Number.POSITIVE_INFINITY : t < w[0] ? w[0] - t : t >= w[1] ? t - w[1] : 0;

/** True on a monsoon wet beat (the crane stands still): the odd 1.5 s beats of the window. */
export function wetBeatAt(tm: SetPieceTiming, t: number): boolean {
  if (!inWin(t, tm.monsoon) || !tm.monsoon) return false;
  return Math.floor((t - tm.monsoon[0]) / SET_PIECE_S.wetBeat) % 2 === 1;
}

/** The wet beat windows inside the monsoon window. */
export function wetBeats(tm: SetPieceTiming): [number, number][] {
  const m = tm.monsoon;
  if (!m) return [];
  const out: [number, number][] = [];
  for (let a = m[0] + SET_PIECE_S.wetBeat; a < m[1]; a += SET_PIECE_S.wetBeat * 2)
    out.push([a, Math.min(m[1], a + SET_PIECE_S.wetBeat)]);
  return out;
}

/** Rain level 0..1: on through the monsoon window (faded at its ends), never in the Raya hold (R25). */
export function rainAt(tm: SetPieceTiming, t: number): number {
  const m = tm.monsoon;
  if (!m || !inWin(t, m) || inWin(t, tm.raya)) return 0;
  const f = SET_PIECE_S.rainFade;
  return ease(Math.min((t - m[0]) / f, (m[1] - t) / f, 1));
}

/** Rain level at t for a plan (the mood grade reads this). */
export const planRainAt = (plan: DevelopmentPlan, t: number) => rainAt(setPieceTiming(plan), t);

// ---- crane -------------------------------------------------------------------------------------

const CRANE_STEP = 0.02;
interface CraneTable {
  yaw: Float64Array;
  rate: Float64Array;
}
const craneCache = new WeakMap<DevelopmentPlan, CraneTable>();

/** The crane's stops: the Raya hold and each wet beat. */
function stops(tm: SetPieceTiming): [number, number][] {
  const out = wetBeats(tm);
  if (tm.raya) out.push([tm.raya[0], tm.raya[1]]);
  return out;
}

/** 0 inside a stop, easing to 1 within `craneRamp` s of it (before and after). */
function stopFactor(t: number, st: readonly [number, number][]): number {
  let d = Number.POSITIVE_INFINITY;
  for (const w of st) d = Math.min(d, distWin(t, w));
  return d === 0 ? 0 : ease(Math.min(1, d / SET_PIECE_S.craneRamp));
}

/**
 * Crane slew table (pure function of the plan): schedule mode integrates work (the timeline's work
 * hours, `workersActive`, times the stop factor) into the prototype slew `sin(w·0.9)·1.3 + 0.6`, so
 * the jib stands still in the Raya hold and on wet beats; legacy mode samples the timeline's own
 * `crane.slewRad`. The rate (velocity) drives the load's swing.
 */
function craneTable(plan: DevelopmentPlan): CraneTable {
  const hit = craneCache.get(plan);
  if (hit) return hit;
  const tm = setPieceTiming(plan);
  const st = stops(tm);
  const n = Math.ceil(plan.total_s / CRANE_STEP) + 2;
  const yaw = new Float64Array(n);
  const rate = new Float64Array(n);
  let w = 0;
  for (let i = 0; i < n; i++) {
    const t = i * CRANE_STEP;
    const s = stateAt(Math.min(t, plan.total_s), plan);
    if (tm.mode === "schedule") {
      const r = (s.workersActive ? 1 : 0) * stopFactor(t, st);
      yaw[i] = Math.sin(w * 0.9) * 1.3 + 0.6;
      rate[i] = r;
      w += r * CRANE_STEP;
    } else {
      yaw[i] = s.crane.slewRad;
      rate[i] = s.workersActive ? 1 : 0;
    }
  }
  const out = { yaw, rate };
  craneCache.set(plan, out);
  return out;
}

export interface CraneAt {
  /** Jib yaw (rad, about +y). */
  yaw: number;
  /** Slew velocity (rad per screen s). */
  vel: number;
  /** True when the crane is not slewing at all (a stop, night, or before/after Construction). */
  stopped: boolean;
}

export function craneAt(plan: DevelopmentPlan, t: number, s?: StateAt): CraneAt {
  const tab = craneTable(plan);
  const n = tab.yaw.length;
  const x = Math.max(0, Math.min(plan.total_s, Number.isFinite(t) ? t : 0)) / CRANE_STEP;
  const i = Math.min(n - 2, Math.floor(x));
  const u = x - i;
  const a = tab.yaw[i] as number;
  const b = tab.yaw[i + 1] as number;
  const legacy = setPieceTiming(plan).mode === "legacy";
  const yaw = legacy && s ? s.crane.slewRad : a + (b - a) * u;
  const vel = (b - a) / CRANE_STEP;
  const r = Math.max(tab.rate[i] as number, tab.rate[i + 1] as number);
  return { yaw, vel, stopped: r === 0 || Math.abs(vel) < 1e-9 };
}

// ---- per frame ---------------------------------------------------------------------------------

export interface SetPiecesAt {
  timing: SetPieceTiming;
  /** Hari Raya hold: site closed (crane frozen, hook parked, workers and lorries gone). */
  hold: boolean;
  monsoon: boolean;
  wetBeat: boolean;
  /** Rain level 0..1. */
  rain: number;
  /** Piling rig on stage, and its progress 0..1 over the window. */
  piling: boolean;
  pilingU: number;
  /** Lorry route ribbon drawn. */
  routeOn: boolean;
  /** Construction lorries and mixers drive the route. */
  traffic: boolean;
  crane: CraneAt;
}

export function setPiecesAt(plan: DevelopmentPlan, t: number, s: StateAt): SetPiecesAt {
  const tm = setPieceTiming(plan);
  const hold = inWin(t, tm.raya);
  // schedule mode: the spec §6.3 windows alone (the C7 acts may be named or cut differently);
  // legacy: only while the 66 s timeline is in Construction behind the hoarding
  const building = tm.mode === "schedule" || (s.act === "Construction" && s.hoarding);
  const piling = building && inWin(t, tm.piling);
  const routeOn = inWin(t, tm.lorryRoute);
  return {
    timing: tm,
    hold,
    monsoon: inWin(t, tm.monsoon),
    wetBeat: wetBeatAt(tm, t),
    rain: rainAt(tm, t),
    piling,
    pilingU: piling ? (t - tm.piling[0]) / (tm.piling[1] - tm.piling[0]) : 0,
    routeOn,
    traffic: routeOn && !hold && building,
    crane: craneAt(plan, t, s),
  };
}
