/**
 * Construction set pieces (spec 2026-10-21 §6.2 Construction detail, §6.3; AC-W3, AC-W4): the one
 * place the 3D lane reads the C7 plan fields (`lorry_route`, `schedule`) and the one place their
 * screen times live. Pure maths, no Three.js.
 *
 * Two modes:
 * - "schedule": the 45 s building plan (C7: `schedule` + `month_keys`; `timeline.isBuildPlan`). The
 *   Hari Raya hold and the monsoon stretch come from `planPlayback(plan)` (fe `schedulePlayback.ts`:
 *   the plan's own month keys and banner windows, ruling R25), the piling rig and the lorry route
 *   from the spec §6.3 beats below.
 * - "legacy": today's 66 s plan (no schedule): no hold, no rain, the crane slews as the timeline
 *   says, the piling rig stands in the first seconds of Construction, the Handover lorries keep
 *   today's lane path. A plan with `lorry_route` but no schedule draws the route over Construction.
 */
import type { DevelopmentPlanExtras, LorryRoute, Schedule } from "../../../devsim/planTypes";
import { BUILD_BEATS, planPlayback } from "../../../devsim/schedulePlayback";
import { CON, isBuildPlan } from "../../../devsim/timeline";
import type { DevelopmentPlan, StateAt } from "../../../devsim/types";
import { ease, span } from "./ease";
import { stateAt } from "./state";

/** Spec §6.3 / brief C9 screen times (s) for the schedule mode, and the legacy stand-ins. */
export const SET_PIECE_S = {
  /** Piling rig on the footprint grid (AC-W4). */
  piling: [3.5, 8.5] as const,
  /** Lorry route ribbon and the construction lorries on it. */
  lorryRoute: [8.5, BUILD_BEATS.handover] as const,
  /** Move-in (spec §6.3 27-33 s; C10, AC-W5). */
  moveIn: {
    /** Moving lorries drive in to the entrance kerb (27-29.5 s) and park. */
    t0: BUILD_BEATS.handover,
    lorryGap: 0.25,
    lorryDrive: 2,
    lorriesUntil: 33.5,
    /** Boxes stack by the door over 29-31 s; cleared once everyone is in. */
    boxes: [29, 31] as const,
    boxesUntil: 34,
    /** Movers leave the lorries one by one and walk in through the door. */
    movers: { t0: 29, gap: 0.25, walk: 1.3 },
    /** Windows light 0 -> litTarget, monotonic, floor by floor. */
    lit: [28, 33] as const,
    litTarget: 0.9,
    /** Cars drive into the tower car park one by one. */
    cars: { t0: 30, gap: 0.35, drive: 0.6 },
    /** Children play at the nearest playground from here on. */
    kidsAt: 32.5,
  },
  /** Monsoon wet beats: every other 1.5 s inside the monsoon window (the 2nd, 4th ... beat). */
  wetBeat: 1.5,
  /** Rain fades in and out over this much of the monsoon window's ends. */
  rainFade: 0.5,
  /** The crane eases to and from a stop over this many seconds (outside the stop window). */
  craneRamp: 0.3,
  /** Legacy (66 s): the rig stands until the first floor rises (`timeline.ts` WORK_START). */
  legacyPiling: [CON[0], CON[0] + 1.2] as const,
  /** Legacy (66 s): today's Handover lorries (`site.ts` lorryPoses), movers and lit windows from
   * the timeline; the C10 extras (boxes, cars, children) shifted onto its Handover act. */
  legacyMoveIn: {
    t0: 33,
    lorryGap: 0.6,
    lorryDrive: 2.6,
    lorriesUntil: null,
    boxes: [34, 36] as const,
    boxesUntil: 44,
    movers: null,
    lit: null,
    litTarget: 0.9,
    cars: { t0: 35, gap: 0.35, drive: 0.6 },
    kidsAt: 37.5,
  },
} as const;

export interface MoveInTiming {
  t0: number;
  lorryGap: number;
  lorryDrive: number;
  /** Schedule mode: the lorries leave then; null: the timeline's `lorries` flag. */
  lorriesUntil: number | null;
  boxes: readonly [number, number];
  boxesUntil: number;
  /** Null: today's queue on the entrance path (`cast.ts` castAt). */
  movers: { t0: number; gap: number; walk: number } | null;
  /** Null: the timeline's `windowsLitFraction`. */
  lit: readonly [number, number] | null;
  litTarget: number;
  cars: { t0: number; gap: number; drive: number };
  kidsAt: number;
}

export interface SetPieceTiming {
  mode: "schedule" | "legacy";
  piling: readonly [number, number];
  /** The lorry route ribbon and construction traffic window; null without a route. */
  lorryRoute: readonly [number, number] | null;
  /** Hari Raya hold (site closed), schedule mode only. */
  raya: readonly [number, number] | null;
  /** Monsoon stretch (rain, wet beats), schedule mode only. */
  monsoon: readonly [number, number] | null;
  moveIn: MoveInTiming;
  total: number;
}

/** The C7 plan fields, read in one place (absent on today's plan). */
export function planExtras(plan: DevelopmentPlan): {
  lorryRoute: LorryRoute | null;
  schedule: Schedule | null;
  /** The nearest playground [lon, lat] (C10 children), else the park anchor. */
  playground: number[];
} {
  const x = plan as DevelopmentPlan & DevelopmentPlanExtras;
  const r = x.lorry_route;
  const pg = x.playground?.coord;
  return {
    lorryRoute: r && Array.isArray(r.path) && r.path.length >= 2 ? r : null,
    schedule: x.schedule ?? null,
    playground: pg && pg.length >= 2 ? pg : plan.anchors.park,
  };
}

const timingCache = new WeakMap<DevelopmentPlan, SetPieceTiming>();

export function setPieceTiming(plan: DevelopmentPlan): SetPieceTiming {
  const hit = timingCache.get(plan);
  if (hit) return hit;
  const { lorryRoute } = planExtras(plan);
  let out: SetPieceTiming;
  if (isBuildPlan(plan)) {
    const pb = planPlayback(plan);
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

// ---- move-in (C10) -----------------------------------------------------------------------------

/**
 * The lit-window share the tower shows at t (schedule mode): 0 before the window, then floor by
 * floor (whole floors of `storeys`) up to `litTarget` at its end, monotonic (AC-W5). After the
 * window it never drops below the target; the timeline's own share wins if higher. Legacy: the
 * timeline's share.
 */
export function litShareAt(
  tm: SetPieceTiming,
  t: number,
  storeys: number,
  timeline: number,
): number {
  const w = tm.moveIn.lit;
  if (!w) return timeline;
  const n = Math.max(1, storeys);
  const k = Math.floor(tm.moveIn.litTarget * ease(span(t, w[0], w[1])) * n + 1e-9) / n;
  return t >= w[1] ? Math.max(k, timeline) : k;
}

/** Homes occupied shown with the lit windows (HUD counter): lit share x homes, rounded. */
export function occupancyAt(lit: number, homes: number): number {
  return Math.round(Math.max(0, Math.min(1, lit)) * homes);
}

/** The move-in HUD numbers at t for a plan (the overlay's occupancy counter reads this). */
export function moveInCounter(
  plan: DevelopmentPlan,
  t: number,
): { litShare: number; occupancy: number } {
  const s = stateAt(t, plan);
  const lit = litShareAt(setPieceTiming(plan), t, plan.site.storeys, s.windowsLitFraction);
  return { litShare: lit, occupancy: occupancyAt(lit, plan.site.homes) };
}

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
  /** Move-in: lit share and occupied homes now, moving lorries on stage. */
  lit: number;
  occupancy: number;
  moveInLorries: boolean;
}

export function setPiecesAt(plan: DevelopmentPlan, t: number, s: StateAt): SetPiecesAt {
  const tm = setPieceTiming(plan);
  const hold = inWin(t, tm.raya);
  // schedule mode: the spec §6.3 windows alone (the C7 acts may be named or cut differently);
  // legacy: only while the 66 s timeline is in Construction behind the hoarding
  const building = tm.mode === "schedule" || (s.act === "Construction" && s.hoarding);
  const piling = building && inWin(t, tm.piling);
  const routeOn = inWin(t, tm.lorryRoute);
  const lit = litShareAt(tm, t, plan.site.storeys, s.windowsLitFraction);
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
    lit,
    occupancy: occupancyAt(lit, plan.site.homes),
    moveInLorries:
      tm.moveIn.lorriesUntil === null ? s.lorries : t >= tm.moveIn.t0 && t < tm.moveIn.lorriesUntil,
  };
}
