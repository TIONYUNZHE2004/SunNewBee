/**
 * Building timeline: playback seconds -> project month, and the ESTIMATE values at a month
 * (spec 2026-10-21 §6.2, §6.3; AC-W1, AC-W2). Pure maths, no React, no Three.js.
 *
 * PRE-C7: written beside `timeline.ts` (the 66 s acts) and swapped in when C7 sends `schedule` on
 * the plan with `total_s = 45`. It follows the prototype's `KEYS` shape (hold at Hari Raya, slower
 * through the monsoon) recomputed from the real schedule. Months are fractional: month m is m
 * months after the start of the start month, so month index `floor(m)` is the calendar month shown.
 */
import type { Schedule } from "./planTypes";

/** Spec §6.3 beat times (screen s). */
export const BUILD_BEATS = {
  /** Months start advancing (month 0). */
  monthsFrom: 3,
  /** Hari Raya hold (the month stands still). */
  raya: [11, 13] as readonly [number, number],
  /** Slow monsoon stretch. */
  monsoon: [18.5, 23] as readonly [number, number],
  /** The handover month is reached. */
  handover: 27,
  /** End of the building timeline (spec: `total_s = 45`). */
  end: 45,
} as const;
export type BuildBeats = typeof BUILD_BEATS;

/** A month key: at screen second t the project is at month m. */
export type MonthKey = readonly [t: number, m: number];

export interface SchedulePlayback {
  keys: MonthKey[];
  /** Screen window of the Hari Raya hold, or null when the schedule has no Raya set piece. */
  raya: [number, number] | null;
  /** Screen window of the slow monsoon stretch, or null when there is no monsoon set piece. */
  monsoon: [number, number] | null;
  /**
   * "baseline": the spec §6.3 windows (Raya before the monsoon stretch).
   * "data-order": the schedule puts Hari Raya inside or after the monsoon set piece, so the spec
   * windows cannot be monotone; the windows are derived from the data instead (ruling in the C8
   * report, to be settled with C7).
   */
  mode: "baseline" | "data-order";
}

/** How much slower a monsoon month plays than an ordinary month in the data-order fallback. */
export const MONSOON_SLOW = 2;

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Fractional month of an ISO date relative to the schedule's start month. */
export function monthOf(schedule: Schedule, iso: string): number {
  const [sy, sm] = schedule.start.split("-").map(Number) as [number, number];
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return (y - sy) * 12 + (m - sm) + (d - 1) / daysIn(y, m);
}

/** Month index ("YYYY-MM" position) of an ISO date. */
export function monthIndexOf(schedule: Schedule, iso: string): number {
  return Math.floor(monthOf(schedule, iso));
}

/** The handover point: inside the last month, at the handover date. */
export function handoverMonth(schedule: Schedule): number {
  return Math.min(monthOf(schedule, schedule.handover), schedule.months_total - 1e-6);
}

export function buildPlayback(
  schedule: Schedule,
  beats: BuildBeats = BUILD_BEATS,
): SchedulePlayback {
  const h = handoverMonth(schedule);
  const raya = schedule.raya_set_piece ? monthOf(schedule, schedule.raya_set_piece.date) : null;
  const mp = schedule.monsoon_set_piece;
  const mon =
    mp && mp.months.length > 0
      ? ([
          (mp.months[0] as { month_index: number }).month_index,
          (mp.months[mp.months.length - 1] as { month_index: number }).month_index + 1,
        ] as [number, number])
      : null;
  const t0 = beats.monthsFrom;
  const head: MonthKey[] = [
    [0, 0],
    [t0, 0],
  ];
  const tail: MonthKey[] = [
    [beats.handover, h],
    [beats.end, h],
  ];

  // Baseline: Raya hold, then the monsoon stretch, in the spec's windows.
  const rayaOk = raya === null || raya < (mon ? mon[0] : h);
  const monOk = mon === null || mon[1] <= h;
  if (rayaOk && monOk) {
    const keys: MonthKey[] = [...head];
    if (raya !== null) keys.push([beats.raya[0], raya], [beats.raya[1], raya]);
    if (mon) keys.push([beats.monsoon[0], mon[0]], [beats.monsoon[1], mon[1]]);
    keys.push(...tail);
    return {
      keys,
      raya: raya === null ? null : [beats.raya[0], beats.raya[1]],
      monsoon: mon ? [beats.monsoon[0], beats.monsoon[1]] : null,
      mode: "baseline",
    };
  }

  // Data order: months advance over [monthsFrom, handover] minus the hold, monsoon months slower.
  const hold = raya === null ? 0 : beats.raya[1] - beats.raya[0];
  const weight = (a: number, b: number) => {
    if (b <= a) return 0;
    if (!mon) return b - a;
    const inside = Math.max(0, Math.min(b, mon[1]) - Math.max(a, mon[0]));
    return b - a - inside + inside * MONSOON_SLOW;
  };
  const secPerUnit = (beats.handover - t0 - hold) / weight(0, h);
  const stops = [...new Set([0, h, ...(mon ?? []), ...(raya === null ? [] : [raya])])]
    .filter((m) => m >= 0 && m <= h)
    .sort((a, b) => a - b);
  const keys: MonthKey[] = [...head];
  let t = t0;
  let rayaWin: [number, number] | null = null;
  let monWin: [number, number] | null = null;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1] as number;
    const b = stops[i] as number;
    t += weight(a, b) * secPerUnit;
    if (mon && b === mon[0]) monWin = [t, t];
    keys.push([t, b]);
    if (raya !== null && b === raya) {
      rayaWin = [t, t + hold];
      t += hold;
      keys.push([t, b]);
    }
    if (mon && b === mon[1] && monWin) monWin[1] = t;
  }
  if (mon && mon[0] === 0) monWin = [t0, (monWin ?? [t0, t0])[1]];
  if (mon && mon[1] > h && monWin) monWin[1] = beats.handover;
  keys.push([beats.end, h]);
  return { keys, raya: rayaWin, monsoon: monWin, mode: "data-order" };
}

/** Project month at screen second t (piecewise linear through the keys). */
export function monthAt(t: number, keys: readonly MonthKey[]): number {
  const first = keys[0];
  if (!first || t <= first[0]) return first ? first[1] : 0;
  for (let i = 1; i < keys.length; i++) {
    const [b, mb] = keys[i] as MonthKey;
    if (t <= b) {
      const [a, ma] = keys[i - 1] as MonthKey;
      return b === a ? mb : ma + (mb - ma) * ((t - a) / (b - a));
    }
  }
  return (keys[keys.length - 1] as MonthKey)[1];
}

/** Month index (calendar month shown) at month m, clamped to the schedule. */
export function monthIndex(schedule: Schedule, m: number): number {
  return Math.max(0, Math.min(schedule.months_total - 1, Math.floor(m)));
}

/**
 * Cumulative working days lost by the end of each month: holidays on structure working days, the
 * one Hari Raya shutdown (counted in its month) and monsoon rain (the set piece's months).
 */
export function daysLostByMonth(schedule: Schedule): number[] {
  const per = new Array<number>(schedule.months_total).fill(0);
  const add = (i: number, d: number) => {
    if (i >= 0 && i < per.length) per[i] = (per[i] as number) + d;
  };
  for (const d of schedule.holidays_lost) add(monthIndexOf(schedule, d), 1);
  if (schedule.raya_set_piece)
    add(schedule.raya_set_piece.month_index, schedule.raya_set_piece.days);
  for (const m of schedule.monsoon_set_piece?.months ?? []) add(m.month_index, m.days_lost);
  let run = 0;
  return per.map((d) => {
    run += d;
    return run;
  });
}

export interface ScheduleAt {
  /** Fractional month (now-marker position). */
  month: number;
  /** Calendar month shown (0-based index into `schedule.months`). */
  monthIndex: number;
  /** "YYYY-MM". */
  ym: string;
  /** Floors topped out by the end of that month. */
  floors: number;
  /** Cumulative ESTIMATE spend by the end of that month (RM). */
  costRm: number;
  /** Cumulative working days lost by the end of that month. */
  daysLost: number;
}

/**
 * The HUD values at fractional month m: the plan's numbers for the calendar month shown (end of
 * month values, not interpolated, so the HUD always equals a schedule row; AC-W2).
 */
export function scheduleAt(
  schedule: Schedule,
  m: number,
  lost: readonly number[] = daysLostByMonth(schedule),
): ScheduleAt {
  const i = monthIndex(schedule, m);
  return {
    month: Math.max(0, Math.min(schedule.months_total, m)),
    monthIndex: i,
    ym: schedule.months[i] ?? "",
    floors: schedule.floors_by_month[i] ?? 0,
    costRm: schedule.cost_by_month[i] ?? 0,
    daysLost: lost[i] ?? 0,
  };
}
