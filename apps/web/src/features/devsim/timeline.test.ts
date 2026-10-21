import { describe, expect, it } from "vitest";
import provisional from "./fixtures/plan.provisional.json";
import {
  CAM_KEYS,
  CON,
  dayMinutes,
  dayness,
  END_CARD_AT,
  feedbackBeats,
  floorsAt,
  stateAt,
  sunAt,
} from "./timeline";
import type { DevelopmentPlan } from "./types";

const plan = provisional as unknown as DevelopmentPlan;
const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  for (let t = a; t < b - 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
};

// spec §4.2 / §4.3, the baseline
const SPEC_ACTS: [string, number, number][] = [
  ["Brief", 0, 4],
  ["Construction", 4, 32],
  ["Handover", 32, 44],
  ["Daily Life", 44, 63],
  ["Summary", 63, 66],
];
const SPEC_BUBBLES: [number, string, number, number, "pos" | "neg"][] = [
  [1, "halim", 18.4, 21.4, "neg"],
  [2, "farid", 23.4, 26.2, "neg"],
  [3, "meiling", 35.4, 38.2, "pos"],
  [4, "halim", 40.2, 43.2, "pos"],
  [5, "meiling", 47.6, 50.4, "neg"],
  [6, "zainab", 53.2, 56.2, "pos"],
  [7, "arjun", 58.6, 61.6, "pos"],
];

describe("AC-F1 acts and bubbles", () => {
  it("act boundaries equal spec §4.2 within ±0.5 s", () => {
    expect(plan.acts.map((a) => a.name)).toEqual(SPEC_ACTS.map((a) => a[0]));
    for (const [name, t0, t1] of SPEC_ACTS) {
      expect(stateAt(t0 + 0.6, plan).act).toBe(name);
      expect(stateAt(t1 - 0.6, plan).act).toBe(name);
    }
    expect(stateAt(66, plan).act).toBe("Summary");
  });

  it("bubble speakers, times and tones equal spec §4.3; texts equal the plan's", () => {
    for (const [n, who, t0, t1, tone] of SPEC_BUBBLES) {
      const b = plan.bubbles.find((x) => x.n === n);
      expect(b).toMatchObject({ who, tone });
      expect(Math.abs((b?.t0 ?? 0) - t0)).toBeLessThanOrEqual(0.5);
      expect(Math.abs((b?.t1 ?? 0) - t1)).toBeLessThanOrEqual(0.5);
      const shown = stateAt((t0 + t1) / 2, plan).bubbles;
      expect(shown).toEqual([{ n, who, text: b?.text, tag: b?.tag ?? null }]);
      expect(stateAt(t0 - 0.6, plan).bubbles.some((x) => x.n === n)).toBe(false);
      expect(stateAt(t1 + 0.6, plan).bubbles.some((x) => x.n === n)).toBe(false);
    }
  });

  it("no bubble is shown between beats", () => {
    for (const t of [0, 10, 22.5, 30, 45, 52, 57.5, 62, 65])
      expect(stateAt(t, plan).bubbles).toEqual([]);
  });

  it("the end card shows only in the Summary", () => {
    expect(stateAt(END_CARD_AT - 0.1, plan).endCard).toBe(false);
    expect(stateAt(END_CARD_AT, plan).endCard).toBe(true);
    expect(stateAt(66, plan).endCard).toBe(true);
  });
});

describe("AC-F2 clocks and cycles", () => {
  it("Construction has 10 day/night cycles", () => {
    let nights = 0;
    let prev = stateAt(CON[0], plan).sun.isNight;
    for (const t of range(CON[0], CON[1], 0.02)) {
      const n = stateAt(t, plan).sun.isNight;
      if (n && !prev) nights++;
      prev = n;
    }
    expect(nights).toBe(10);
  });

  it("the month counter runs 1 -> 24 through Construction, never backwards", () => {
    let last = 0;
    const seen = new Set<number>();
    for (const t of range(4, 32, 0.05)) {
      const m = stateAt(t, plan).simClock.month ?? 0;
      expect(m).toBeGreaterThanOrEqual(last);
      last = m;
      seen.add(m);
    }
    expect(Math.min(...seen)).toBe(1);
    expect(Math.max(...seen)).toBe(24);
    expect(stateAt(5, plan).simClock.label).toBe("Month 1 of 24");
    expect(stateAt(31.95, plan).simClock.label).toBe("Month 24 of 24");
  });

  it("Handover ends at sim dawn", () => {
    expect(stateAt(43.4, plan).sun.isNight).toBe(true);
    expect(stateAt(43.99, plan).sun.elevation).toBeGreaterThan(0);
    expect(stateAt(43.99, plan).sun.phase01).toBeCloseTo(0.25, 1);
    expect(stateAt(36, plan).simClock.label).toBe("Handover · week 1 of 2");
    expect(stateAt(43, plan).simClock.label).toBe("Handover · week 2 of 2");
  });

  it("Daily Life runs 07:00 -> about 19:40", () => {
    expect(stateAt(44, plan).simClock).toMatchObject({ label: "Day 30 · 07:00", hhmm: "07:00" });
    const end = dayMinutes(62.99);
    expect(end).toBeGreaterThan(19 * 60 + 30);
    expect(end).toBeLessThanOrEqual(19 * 60 + 41);
    let last = 0;
    for (const t of range(44, 63, 0.1)) {
      expect(dayMinutes(t)).toBeGreaterThanOrEqual(last);
      last = dayMinutes(t);
    }
    expect(stateAt(64, plan).simClock.label).toBe("First month");
    expect(stateAt(2, plan).simClock.label).toBe("—");
  });

  it("floors rise only by sim day and reach the storeys by t = 32", () => {
    const n = plan.site.storeys;
    expect(stateAt(3, plan).floorsBuilt).toBe(0);
    for (const t of range(4, 32, 0.02)) {
      const a = stateAt(t, plan);
      const b = stateAt(t + 0.02, plan);
      expect(b.floorsBuilt).toBeGreaterThanOrEqual(a.floorsBuilt);
      if (a.sun.isNight && b.sun.isNight) expect(b.floorsBuilt).toBe(a.floorsBuilt);
    }
    expect(floorsAt(31.9, n)).toBe(n);
    expect(stateAt(32, plan).floorsBuilt).toBe(n);
    expect(stateAt(18, plan).floorsBuilt).toBeGreaterThan(0);
    expect(stateAt(18, plan).floorsBuilt).toBeLessThan(n);
  });

  it("workers work by day only, in Construction", () => {
    for (const t of range(4, 31.6, 0.1)) {
      const s = stateAt(t, plan);
      expect(s.workersActive).toBe(!s.sun.isNight);
    }
    expect(stateAt(2, plan).workersActive).toBe(false);
    expect(stateAt(40, plan).workersActive).toBe(false);
  });
});

describe("occupancy, windows and feedback", () => {
  it("Q4: no windows lit before t = 32; they light floor by floor in Handover", () => {
    for (const t of range(0, 32, 0.25)) expect(stateAt(t, plan).windowsLitFraction).toBe(0);
    const n = plan.site.storeys;
    let last = 0;
    for (const t of range(32, 66, 0.25)) {
      const f = stateAt(t, plan).windowsLitFraction;
      expect(f).toBeGreaterThanOrEqual(last);
      expect(Math.abs(f * n - Math.round(f * n))).toBeLessThan(1e-9);
      last = f;
    }
    expect(stateAt(43.9, plan).windowsLitFraction).toBeGreaterThan(0.5);
  });

  it("occupancy climbs 0 -> 460 in Handover and to 488 of 500 by the end of Daily Life", () => {
    expect(stateAt(33, plan).occupancy).toBe(0);
    expect(stateAt(43.5, plan).occupancy).toBe(460);
    expect(stateAt(63, plan).occupancy).toBe(488);
    expect(stateAt(66, plan).occupancy).toBe(488);
  });

  it("AC-F5 (owner ruling): one envelope per end-card item; the counter goes 0 -> 1 -> 2 -> 3", () => {
    // item 1 after Halim's bubble 1, item 2 at 51.6 s (bubble 5), item 3 after Arjun's bubble 7
    expect(feedbackBeats(plan).map((b) => [b.item, b.afterBubble, b.t1])).toEqual([
      [0, 1, 22.6],
      [1, 5, 51.6],
      [2, 7, 62.8],
    ]);
    const count = (t: number) => stateAt(t, plan).feedbackCount;
    expect(count(18)).toBe(0);
    expect(count(21.3)).toBe(0);
    expect(stateAt(22, plan).envelope).toMatchObject({ from: 1 });
    expect(stateAt(22, plan).envelope?.progress).toBeGreaterThan(0);
    expect(count(22)).toBe(0);
    expect(count(22.6)).toBe(1);
    expect(stateAt(23, plan).envelope).toBeNull();
    expect(count(50.3)).toBe(1);
    expect(stateAt(51, plan).envelope).toMatchObject({ from: 5 });
    expect(count(51.6)).toBe(2);
    expect(count(61.5)).toBe(2);
    expect(stateAt(62.2, plan).envelope).toMatchObject({ from: 7 });
    expect(count(62.8)).toBe(3);
    // it ends equal to the end card's item count, which shows after the last envelope lands
    expect(count(END_CARD_AT)).toBe(plan.end_card.items.length);
    expect(count(66)).toBe(plan.end_card.items.length);
    for (const b of feedbackBeats(plan)) expect(b.t1).toBeLessThan(END_CARD_AT);
    // monotone: never steps back
    let prev = 0;
    for (const t of range(0, 66, 0.1)) {
      expect(count(t)).toBeGreaterThanOrEqual(prev);
      prev = count(t);
    }
  });

  it("AC-F5: without the detour item (spec §13) the counter drops it too", () => {
    const noDetour: DevelopmentPlan = {
      ...plan,
      end_card: { ...plan.end_card, items: plan.end_card.items.slice(1) },
    };
    expect(feedbackBeats(noDetour).map((b) => b.afterBubble)).toEqual([5, 7]);
    expect(stateAt(30, noDetour).feedbackCount).toBe(0);
    expect(stateAt(51.6, noDetour).feedbackCount).toBe(1);
    expect(stateAt(66, noDetour).feedbackCount).toBe(2);
  });

  it("hoarding stands through Construction and comes down early in Handover; lorries in Handover", () => {
    expect(stateAt(3, plan).hoarding).toBe(false);
    expect(stateAt(20, plan).hoarding).toBe(true);
    expect(stateAt(34, plan).hoarding).toBe(false);
    expect(stateAt(36, plan).lorries).toBe(true);
    expect(stateAt(46, plan).lorries).toBe(false);
    expect(stateAt(36, plan).movers.queueProgress).toBe(0);
    expect(stateAt(43, plan).movers.queueProgress).toBe(1);
  });
});

describe("flow curve (spec §7)", () => {
  it("fast-forward in Construction and Handover, normal speed in Daily Life", () => {
    expect(stateAt(10, plan).flow.timeScale).toBeGreaterThanOrEqual(6);
    expect(stateAt(38, plan).flow.timeScale).toBeGreaterThanOrEqual(6);
    expect(stateAt(50, plan).flow.timeScale).toBe(1);
    expect(stateAt(2, plan).flow.timeScale).toBe(1);
  });

  it("density by day is at least 2x density by night", () => {
    const days: number[][] = [];
    const nights: number[][] = [];
    for (const t of range(4, 44, 0.05)) {
      const s = stateAt(t, plan);
      const d = dayness(sunAt(t).e);
      if (d > 0.99) days.push([s.flow.peopleDensity, s.flow.vehicleDensity]);
      if (d < 0.01) nights.push([s.flow.peopleDensity, s.flow.vehicleDensity]);
    }
    expect(days.length).toBeGreaterThan(10);
    expect(nights.length).toBeGreaterThan(10);
    const minDay = [0, 1].map((k) => Math.min(...days.map((d) => d[k] as number)));
    const maxNight = [0, 1].map((k) => Math.max(...nights.map((d) => d[k] as number)));
    for (const k of [0, 1]) {
      expect(maxNight[k]).toBeGreaterThan(0); // sparse, not empty
      expect(minDay[k] as number).toBeGreaterThanOrEqual(2 * (maxNight[k] as number));
    }
  });

  it("Daily Life has a morning peak", () => {
    expect(stateAt(45, plan).flow.vehicleDensity).toBeGreaterThan(
      stateAt(54, plan).flow.vehicleDensity,
    );
  });
});

describe("camera", () => {
  it("ports the prototype's 22 keyframes over 0..66, plus F3's waypoint and cuts", () => {
    expect(CAM_KEYS).toHaveLength(26);
    expect(CAM_KEYS.filter((k) => k.cut).map((k) => k.t)).toEqual([27, 52.2, 57.4]);
    expect(CAM_KEYS[0]?.t).toBe(0);
    expect(CAM_KEYS[CAM_KEYS.length - 1]?.t).toBe(66);
  });

  it("frames the subjects of §4.4", () => {
    const near = (a: number[], b: number[], m: number) =>
      Math.hypot((a[0] as number) - (b[0] as number), (a[1] as number) - (b[1] as number)) *
        111000 <
      m;
    expect(near(stateAt(24, plan).camera.target, plan.anchors.farid, 2)).toBe(true);
    expect(near(stateAt(54, plan).camera.target, plan.anchors.park, 2)).toBe(true);
    expect(near(stateAt(60, plan).camera.target, plan.anchors.mall, 2)).toBe(true);
    expect(near(stateAt(37, plan).camera.target, plan.site.entrance.door, 10)).toBe(true);
    // the opening shot is high, the close shots are low
    expect(stateAt(0, plan).camera.offset[2]).toBeGreaterThan(400);
    expect(stateAt(24, plan).camera.offset[2]).toBeLessThan(30);
  });

  it("eases between keyframes without jumps, except at the cuts", () => {
    const cuts = CAM_KEYS.filter((k) => k.cut).map((k) => k.t);
    let prev = stateAt(0, plan).camera;
    for (const t of range(0.05, 66, 0.05)) {
      const c = stateAt(t, plan).camera;
      if (cuts.some((ct) => t >= ct && t - 0.05 < ct)) {
        prev = c;
        continue;
      }
      const d = Math.hypot(
        c.offset[0] - prev.offset[0],
        c.offset[1] - prev.offset[1],
        c.offset[2] - prev.offset[2],
      );
      expect(d).toBeLessThan(60);
      prev = c;
    }
  });
});

describe("determinism", () => {
  it("same t, same state; out-of-range t is clamped", () => {
    for (const t of [0, 7.3, 19, 33.33, 48.1, 65.9])
      expect(stateAt(t, plan)).toEqual(stateAt(t, plan));
    expect(stateAt(-5, plan)).toEqual(stateAt(0, plan));
    expect(stateAt(500, plan)).toEqual(stateAt(66, plan));
    expect(stateAt(Number.NaN, plan)).toEqual(stateAt(0, plan));
  });
});
