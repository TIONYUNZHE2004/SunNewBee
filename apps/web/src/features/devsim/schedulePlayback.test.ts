import { describe, expect, it } from "vitest";
import estimates from "./fixtures/estimates.preC7.elmina.json";
import type { Schedule } from "./planTypes";
import {
  BUILD_BEATS,
  buildPlayback,
  daysLostByMonth,
  handoverMonth,
  monthAt,
  monthOf,
  scheduleAt,
} from "./schedulePlayback";

const elmina = estimates.schedule as unknown as Schedule;

/** A hand-built schedule in the prototype's order: Raya (month 2.5) before the monsoon (10–14). */
function protoSchedule(): Schedule {
  const months = Array.from({ length: 24 }, (_, i) => {
    const y = 2027 + Math.floor(i / 12);
    return `${y}-${String((i % 12) + 1).padStart(2, "0")}`;
  });
  return {
    ...elmina,
    start: "2027-01-04",
    handover: "2028-12-16",
    months_total: 24,
    months,
    floors_by_month: months.map((_, i) => Math.min(30, Math.max(0, (i - 4) * 3))),
    cost_by_month: months.map((_, i) => (i + 1) * 5_000_000),
    holidays_lost: ["2027-05-17", "2027-12-25"],
    raya_set_piece: { date: "2027-03-17", month_index: 2, days: 10 },
    monsoon_set_piece: {
      start_month: "2027-11",
      end_month: "2028-03",
      months: [10, 11, 12, 13, 14].map((i) => ({
        month: months[i] as string,
        month_index: i,
        wet_days: 12,
        days_lost: 2.5,
      })),
    },
  };
}

const increasing = (keys: readonly (readonly [number, number])[]) =>
  keys.every(
    (k, i) =>
      i === 0 ||
      (k[0] >= (keys[i - 1] as readonly [number, number])[0] &&
        k[1] >= (keys[i - 1] as readonly [number, number])[1]),
  );

describe("buildPlayback, baseline order (spec §6.3)", () => {
  const s = protoSchedule();
  const p = buildPlayback(s);

  it("uses the spec windows", () => {
    expect(p.mode).toBe("baseline");
    expect(p.raya).toEqual([11, 13]);
    expect(p.monsoon).toEqual([18.5, 23]);
    expect(increasing(p.keys)).toBe(true);
  });

  it("month 0 until 3 s, holds at Hari Raya 11–13 s, monsoon start→end over 18.5–23 s", () => {
    expect(monthAt(0, p.keys)).toBe(0);
    expect(monthAt(3, p.keys)).toBe(0);
    const r = monthOf(s, "2027-03-17");
    expect(monthAt(11, p.keys)).toBeCloseTo(r, 6);
    expect(monthAt(12, p.keys)).toBeCloseTo(r, 6);
    expect(monthAt(13, p.keys)).toBeCloseTo(r, 6);
    expect(monthAt(18.5, p.keys)).toBe(10);
    expect(monthAt(23, p.keys)).toBe(15);
  });

  it("monsoon months play slower than the stretch before them", () => {
    const before = (10 - monthOf(s, "2027-03-17")) / (18.5 - 13);
    const during = 5 / (23 - 18.5);
    expect(during).toBeLessThan(before);
  });

  it("reaches the handover month at 27 s and stays there to the end", () => {
    const h = handoverMonth(s);
    expect(Math.floor(h)).toBe(s.months_total - 1);
    expect(monthAt(27, p.keys)).toBeCloseTo(h, 6);
    expect(monthAt(BUILD_BEATS.end, p.keys)).toBeCloseTo(h, 6);
    expect(monthAt(60, p.keys)).toBeCloseTo(h, 6);
  });
});

describe("buildPlayback, Elmina data order (Raya inside the monsoon)", () => {
  const p = buildPlayback(elmina);
  const raya = monthOf(elmina, elmina.raya_set_piece?.date as string);

  it("falls back to windows derived from the data, still monotone, still 3 → 27 s", () => {
    expect(p.mode).toBe("data-order");
    expect(increasing(p.keys)).toBe(true);
    expect(monthAt(3, p.keys)).toBe(0);
    expect(monthAt(27, p.keys)).toBeCloseTo(handoverMonth(elmina), 6);
  });

  it("the hold is 2 s at the Raya date, inside the slow monsoon window", () => {
    const [a, b] = p.raya as [number, number];
    expect(b - a).toBeCloseTo(2, 6);
    expect(monthAt(a, p.keys)).toBeCloseTo(raya, 6);
    expect(monthAt((a + b) / 2, p.keys)).toBeCloseTo(raya, 6);
    const [m0, m1] = p.monsoon as [number, number];
    expect(m0).toBeLessThan(a);
    expect(m1).toBeGreaterThan(b);
    expect(monthAt(m0, p.keys)).toBeCloseTo(10, 6);
    expect(monthAt(m1, p.keys)).toBeCloseTo(15, 6);
  });

  it("a monsoon month takes twice as long as an ordinary month", () => {
    const [m0] = p.monsoon as [number, number];
    const ordinary = m0 - 3; // 10 ordinary months
    const [a] = p.raya as [number, number];
    const monsoonPart = a - m0; // 10 -> Raya date, slow
    expect(monsoonPart / (raya - 10)).toBeCloseTo((2 * ordinary) / 10, 6);
  });
});

describe("scheduleAt and days lost (AC-W2 values)", () => {
  const lost = daysLostByMonth(elmina);

  it("days lost add up to holidays + Raya shutdown + rain", () => {
    const total =
      elmina.holiday_days_lost + (elmina.raya_set_piece?.days ?? 0) + elmina.rain_days_lost;
    expect(Math.round(lost[lost.length - 1] as number)).toBe(total);
    expect(lost.every((d, i) => i === 0 || d >= (lost[i - 1] as number))).toBe(true);
    expect(lost[8]).toBe(0); // foundation: nothing lost
  });

  it("reads the plan row of the month shown, never interpolated", () => {
    const at = scheduleAt(elmina, 13.9, lost);
    expect(at.monthIndex).toBe(13);
    expect(at.ym).toBe("2028-02");
    expect(at.floors).toBe(elmina.floors_by_month[13]);
    expect(at.costRm).toBe(elmina.cost_by_month[13]);
    expect(at.daysLost).toBe(lost[13]);
  });

  it("clamps to the schedule", () => {
    expect(scheduleAt(elmina, -1).monthIndex).toBe(0);
    const end = scheduleAt(elmina, 99);
    expect(end.monthIndex).toBe(elmina.months_total - 1);
    expect(end.floors).toBe(elmina.storeys);
    expect(end.costRm).toBe(elmina.cost_total_rm);
  });
});

describe("R25: monsoon set piece after Raya, reaching the handover month", () => {
  // C7 picks the first band that starts after Raya and before handover: Nov 2028–Mar 2029 here,
  // and the handover (2029-03-21, month 26.65) falls inside it.
  const s: Schedule = {
    ...elmina,
    monsoon_set_piece: {
      start_month: "2028-11",
      end_month: "2029-03",
      months: [22, 23, 24, 25, 26].map((i) => ({
        month: elmina.months[i] as string,
        month_index: i,
        wet_days: 12,
        days_lost: 0,
      })),
    },
  };
  const p = buildPlayback(s);
  const h = handoverMonth(s);

  it("stays on the baseline spec windows, the band end clamped to the handover point", () => {
    expect(h).toBeLessThan(27);
    expect(p.mode).toBe("baseline");
    expect(p.raya).toEqual([11, 13]);
    expect(p.monsoon).toEqual([18.5, 23]);
    expect(increasing(p.keys)).toBe(true);
    expect(monthAt(12, p.keys)).toBeCloseTo(monthOf(s, "2028-02-27"), 6);
    expect(monthAt(18.5, p.keys)).toBe(22);
    expect(monthAt(23, p.keys)).toBeCloseTo(h, 6);
    expect(monthAt(27, p.keys)).toBeCloseTo(h, 6);
  });
});

describe("days_lost_by_month from the plan (C7)", () => {
  it("is preferred when present and the right length; the derivation is the fallback", () => {
    const sent = elmina.months.map((_, i) => i * 2);
    expect(daysLostByMonth({ ...elmina, days_lost_by_month: sent })).toEqual(sent);
    expect(scheduleAt({ ...elmina, days_lost_by_month: sent }, 13.5).daysLost).toBe(26);
    expect(daysLostByMonth({ ...elmina, days_lost_by_month: [1, 2] })).toEqual(
      daysLostByMonth(elmina),
    );
    expect(daysLostByMonth({ ...elmina, days_lost_by_month: null })).toEqual(
      daysLostByMonth(elmina),
    );
  });
});
