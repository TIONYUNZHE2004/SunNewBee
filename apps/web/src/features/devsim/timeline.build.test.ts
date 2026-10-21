import type { components } from "@tl/api-client";
import { describe, expect, it } from "vitest";
import { buildBeatsAt, hudAt } from "./buildModel";
import elmina from "./fixtures/plan.elmina.json";
import { buildPlayback, monthAt, planPlayback, scheduleAt } from "./schedulePlayback";
import {
  BUILD_CAM_KEYS,
  BUILD_T,
  buildFloorsAt,
  buildLitAt,
  cameraAt,
  isBuildPlan,
  stateAt,
} from "./timeline";
import type { DevelopmentPlan } from "./types";

const plan = elmina as unknown as DevelopmentPlan;
const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  for (let t = a; t <= b + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
};

describe("45 s building timeline (spec §6.3)", () => {
  it("the fixture is the C7 plan: 45 s, schedule and month keys", () => {
    expect(plan.total_s).toBe(45);
    expect(isBuildPlan(plan)).toBe(true);
    expect(plan.month_keys.length).toBeGreaterThanOrEqual(2);
    expect("end_card" in plan).toBe(false);
    // the API payload (generated schema) is assignable to the web's plan type (typecheck); the
    // reverse holds except `anchors.worker` and `labels.simulated`, optional for the legacy fixture
    const fromApi = (g: components["schemas"]["DevelopmentPlan"]): DevelopmentPlan => g;
    expect(fromApi(plan as unknown as components["schemas"]["DevelopmentPlan"]).total_s).toBe(45);
  });

  it("acts are the plan's: Brief 0–3, Construction 3–27, Handover 27–33, Daily Life 33–45", () => {
    expect(plan.acts.map((a) => [a.name, a.t0, a.t1])).toEqual([
      ["Brief", 0, 3],
      ["Construction", 3, 27],
      ["Handover", 27, 33],
      ["Daily Life", 33, 45],
    ]);
    expect(stateAt(1, plan).act).toBe("Brief");
    expect(stateAt(10, plan).act).toBe("Construction");
    expect(stateAt(30, plan).act).toBe("Handover");
    expect(stateAt(40, plan).act).toBe("Daily Life");
    expect(stateAt(45, plan).act).toBe("Daily Life");
  });

  it("bubbles show exactly in the plan's windows (AC-W8)", () => {
    for (const b of plan.bubbles) {
      const on = (t: number) => stateAt(t, plan).bubbles.some((x) => x.n === b.n);
      expect(on(b.t0 - 0.05), `${b.n} before`).toBe(false);
      expect(on(b.t0), `${b.n} start`).toBe(true);
      expect(on(b.t1 - 0.05), `${b.n} end`).toBe(true);
      expect(on(b.t1), `${b.n} after`).toBe(false);
    }
  });

  it("the month follows the plan's own month_keys (not a web-recomputed set)", () => {
    const pb = planPlayback(plan);
    expect(pb.keys).toEqual(plan.month_keys);
    for (const [t, m] of plan.month_keys) expect(monthAt(t, pb.keys)).toBeCloseTo(m, 6);
    // a plan whose keys differ from buildPlayback's still plays its own keys
    const own = {
      ...plan,
      month_keys: [
        [0, 0],
        [3, 0],
        [27, 20],
        [45, 20],
      ] as [number, number][],
    };
    expect(monthAt(15, planPlayback(own).keys)).toBeCloseTo(10, 6);
    expect(planPlayback(own).keys).not.toEqual(buildPlayback(plan.schedule).keys);
    // windows: the plan's banners
    const raya = plan.banners.find((b) => b.kind === "raya");
    if (raya) expect(pb.raya).toEqual([raya.t0, raya.t1]);
  });

  it("falls back to buildPlayback when the plan's keys are missing or not monotone", () => {
    const bad = {
      ...plan,
      month_keys: [
        [0, 5],
        [3, 0],
      ] as [number, number][],
    };
    expect(planPlayback(bad).keys).toEqual(buildPlayback(plan.schedule).keys);
    const none = { ...plan, month_keys: [] as [number, number][] };
    expect(planPlayback(none).keys).toEqual(buildPlayback(plan.schedule).keys);
  });

  it("the month holds through the Raya hold and advances after 23 s up to handover", () => {
    const pb = planPlayback(plan);
    if (pb.raya) {
      const m0 = monthAt(pb.raya[0], pb.keys);
      for (const t of range(pb.raya[0], pb.raya[1], 0.25))
        expect(monthAt(t, pb.keys)).toBeCloseTo(m0, 6);
    }
    expect(monthAt(26.9, pb.keys)).toBeGreaterThan(monthAt(23.1, pb.keys));
  });

  it("floors rise monotonically from the schedule and are all up at handover", () => {
    let prev = 0;
    for (const t of range(0, 45, 0.1)) {
      const f = stateAt(t, plan).floorsBuilt;
      expect(f, `t=${t}`).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(f).toBeLessThanOrEqual(plan.site.storeys);
      prev = f;
    }
    expect(stateAt(2.9, plan).floorsBuilt).toBe(0);
    expect(stateAt(27, plan).floorsBuilt).toBe(plan.site.storeys);
    // at a month's end the tower equals the schedule's count for that month
    const fbm = plan.schedule.floors_by_month;
    for (let i = 0; i < fbm.length; i++)
      expect(buildFloorsAt(plan, i + 0.999999)).toBeCloseTo(fbm[i] as number, 3);
  });

  it("HUD at t = 8, 21 and 30 s equals the schedule row of the month shown (AC-W2)", () => {
    for (const t of [8, 21, 30]) {
      const h = hudAt(plan, t);
      const m = monthAt(t, plan.month_keys);
      expect(h.at).toEqual(scheduleAt(plan.schedule, m));
      const i = h.at.monthIndex;
      expect(h.at.floors).toBe(plan.schedule.floors_by_month[i]);
      expect(h.at.costRm).toBe(plan.schedule.cost_by_month[i]);
      expect(h.at.daysLost).toBe(plan.schedule.days_lost_by_month[i]);
    }
  });

  it("lit windows: whole floors, monotonic, ≥ 0.85 by 33 s; occupancy = lit × homes (AC-W5)", () => {
    let prev = 0;
    const n = plan.site.storeys;
    for (const t of range(27, 45, 0.05)) {
      const s = stateAt(t, plan);
      expect(s.windowsLitFraction).toBeGreaterThanOrEqual(prev);
      expect(
        Math.abs(s.windowsLitFraction * n - Math.round(s.windowsLitFraction * n)),
      ).toBeLessThan(1e-9);
      expect(s.occupancy).toBe(Math.round(s.windowsLitFraction * plan.site.homes));
      prev = s.windowsLitFraction;
    }
    expect(stateAt(28, plan).windowsLitFraction).toBe(0);
    expect(stateAt(33, plan).windowsLitFraction).toBeGreaterThanOrEqual(0.85);
    expect(buildLitAt(33, n)).toBe(27 / 30);
  });

  it("site still in the Raya hold: no work; hoarding 3.5–28 s; lorries at handover", () => {
    const raya = plan.banners.find((b) => b.kind === "raya");
    if (raya) expect(stateAt((raya.t0 + raya.t1) / 2, plan).workersActive).toBe(false);
    expect(stateAt(8, plan).workersActive).toBe(true);
    expect(stateAt(3.4, plan).hoarding).toBe(false);
    expect(stateAt(3.5, plan).hoarding).toBe(true);
    expect(stateAt(28, plan).hoarding).toBe(false);
    expect(stateAt(26, plan).lorries).toBe(false);
    expect(stateAt(28, plan).lorries).toBe(true);
    expect(stateAt(34, plan).lorries).toBe(false);
    // the crane stands still through the hold
    if (raya) {
      const y0 = stateAt(raya.t0 + 0.1, plan).crane.slewRad;
      expect(stateAt(raya.t1 - 0.1, plan).crane.slewRad).toBeCloseTo(y0, 9);
    }
  });

  it("the Impact Brief from 33 s", () => {
    expect(stateAt(32.95, plan).brief).toBe(false);
    expect(stateAt(BUILD_T.brief, plan).brief).toBe(true);
    expect(stateAt(45, plan).brief).toBe(true);
  });

  it("daylight throughout (no day/night strobe over months)", () => {
    for (const t of range(0, 45, 0.5)) expect(stateAt(t, plan).sun.isNight).toBe(false);
  });

  it("camera keys are in time order and the camera is finite everywhere", () => {
    for (let i = 1; i < BUILD_CAM_KEYS.length; i++)
      expect((BUILD_CAM_KEYS[i] as { t: number }).t).toBeGreaterThan(
        (BUILD_CAM_KEYS[i - 1] as { t: number }).t,
      );
    expect(BUILD_CAM_KEYS.at(-1)?.t).toBe(45);
    for (const t of range(0, 45, 0.25)) {
      const c = cameraAt(t, plan);
      for (const v of [...c.target, ...c.offset]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("beat ids follow §6.3", () => {
    expect(buildBeatsAt(plan, 1)).toContain("brief-overview");
    expect(buildBeatsAt(plan, 5)).toEqual(
      expect.arrayContaining(["hoarding", "hoarding-card", "detour-tag", "construction"]),
    );
    expect(buildBeatsAt(plan, 12)).toContain("banner-raya");
    expect(buildBeatsAt(plan, 21)).toEqual(expect.arrayContaining(["banner-monsoon", "bubble-3"]));
    expect(buildBeatsAt(plan, 30)).toEqual(expect.arrayContaining(["move-in", "bubble-4"]));
    expect(buildBeatsAt(plan, 40)).toEqual(
      expect.arrayContaining(["impact-brief", "residents-button", "residents-panel-tap"]),
    );
  });
});
