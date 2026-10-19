import { describe, expect, it } from "vitest";
import demo from "../../../journey/fixtures/demoPlan.json";
import { createRoutePath } from "../../../journey/routePath";
import { buildTimeline, type JourneyPlan, type Phase } from "../../../journey/timeline";
import { createFrame } from "../frame";
import {
  HERO_REF_PACE_MPS,
  type HeroPathHelpers,
  heroStateAt,
  REST_TIMING,
  restSchedule,
  SEAT_OFFSET_M,
  seatFor,
  WALK_PHASE_RATE,
} from "./heroDriver";

const plan = demo as unknown as JourneyPlan;
const frame = createFrame([101.5135, 3.18]);
const path = createRoutePath(plan, (lon, lat) => frame.toLocal(lon, lat));
const tl = buildTimeline(plan);
const helpers: HeroPathHelpers = {
  pointAt: path.pointAt,
  seatOf: (i) => {
    const e = plan.events[i];
    return e?.kind === "rest" ? seatFor(path.pointAt, e.at_m, null) : null;
  },
};

const mid = (p: Phase) => (p.t0 + p.t1) / 2;
const holds = (kind: string) => tl.phases.filter((p) => p.event?.kind === kind);
const dist = (a: { x: number; z: number }, b: [number, number] | { x: number; z: number }) =>
  Array.isArray(b) ? Math.hypot(a.x - b[0], a.z - b[1]) : Math.hypot(a.x - b.x, a.z - b.z);

describe("heroStateAt: clip per phase", () => {
  it("walk phases play walk on the route at the timeline distance", () => {
    for (const p of tl.phases.filter((q) => q.kind === "walk")) {
      const s = heroStateAt(tl, mid(p), helpers);
      expect(s.clip).toBe("walk");
      expect(s.distance_m).toBeCloseTo((p.m0 + p.m1) / 2, 6);
      expect(dist(s, path.pointAt(s.distance_m))).toBeLessThan(1e-6);
      expect(s.walkRate).toBeGreaterThan(0);
    }
  });

  it("verified, covered and gap holds are a slow walk (she moves; slower cycle than a walk phase)", () => {
    const walkRate = heroStateAt(
      tl,
      mid(tl.phases.find((p) => p.kind === "walk") as Phase),
      helpers,
    ).walkRate;
    for (const kind of ["verified", "covered", "gap"]) {
      for (const p of holds(kind)) {
        expect(p.m1).toBeGreaterThan(p.m0);
        const a = heroStateAt(tl, p.t0 + 0.2, helpers);
        const b = heroStateAt(tl, p.t1 - 0.2, helpers);
        expect(a.clip).toBe("walk");
        expect(b.clip).toBe("walk");
        expect(b.distance_m).toBeGreaterThan(a.distance_m);
        expect(a.walkRate).toBeLessThan(walkRate);
      }
    }
  });

  it("unknown holds stop and look", () => {
    const us = holds("unknown");
    expect(us.length).toBe(3);
    for (const p of us) {
      const a = heroStateAt(tl, p.t0 + 0.05, helpers);
      const b = heroStateAt(tl, p.t1 - 0.05, helpers);
      for (const s of [a, b]) {
        expect(s.clip).toBe("look");
        expect(s.walkRate).toBe(0);
        expect(s.distance_m).toBeCloseTo(p.m0, 6);
      }
      expect(dist(a, b)).toBeLessThan(1e-9);
      expect(b.clipTime).toBeCloseTo(p.t1 - 0.05 - p.t0, 6);
    }
  });

  it("arrive, the dive and the pull-back are idle", () => {
    for (const p of [
      ...holds("arrive"),
      ...tl.phases.filter((q) => q.kind !== "walk" && !q.event),
    ]) {
      const s = heroStateAt(tl, mid(p), helpers);
      expect(s.clip).toBe("idle");
      expect(s.walkRate).toBe(0);
    }
    const end = heroStateAt(tl, tl.total, helpers);
    expect(end.clip).toBe("idle");
    expect(end.distance_m).toBeCloseTo(963.5, 1);
  });
});

describe("heroStateAt: rest choreography", () => {
  const rests = holds("rest");

  it("has the demo's three rests", () => expect(rests.length).toBe(3));

  it("walks to the bench, sits down (<= 1.5 s), sits for the hold, stands up (<= 1.5 s), walks back", () => {
    expect(REST_TIMING.sitDownS).toBeLessThanOrEqual(1.5);
    expect(REST_TIMING.standUpS).toBeLessThanOrEqual(1.5);
    for (const p of rests) {
      const sch = restSchedule(p.t1 - p.t0);
      expect(sch.sitDown[1] - sch.sitDown[0]).toBeLessThanOrEqual(1.5);
      expect(sch.standUp[1] - sch.standUp[0]).toBeLessThanOrEqual(1.5);
      expect(sch.sitIdle[1] - sch.sitIdle[0]).toBeGreaterThan(0.5);
      const at = (u: number) => heroStateAt(tl, p.t0 + u, helpers);
      const seq = [
        [(sch.approach[0] + sch.approach[1]) / 2, "walk"],
        [(sch.sitDown[0] + sch.sitDown[1]) / 2, "sit_down"],
        [(sch.sitIdle[0] + sch.sitIdle[1]) / 2, "sit_idle"],
        [(sch.standUp[0] + sch.standUp[1]) / 2, "stand_up"],
        [(sch.back[0] + sch.back[1]) / 2, "walk"],
      ] as const;
      for (const [u, clip] of seq) expect(at(u).clip, `${p.event?.title} at +${u}`).toBe(clip);
      // the hold's route metre never changes (the mini-map dot stays on the route)
      for (const [u] of seq) expect(at(u).distance_m).toBeCloseTo(p.m0, 6);
    }
  });

  it("goes from the route point to the seat and back to the route point", () => {
    for (const p of rests) {
      const seat = helpers.seatOf?.(p.eventIndex as number);
      expect(seat).toBeTruthy();
      const s = seat as NonNullable<typeof seat>;
      const sch = restSchedule(p.t1 - p.t0);
      const route = path.pointAt(p.m0);
      expect(dist(heroStateAt(tl, p.t0, helpers), route)).toBeLessThan(1e-6);
      const sitting = heroStateAt(tl, p.t0 + (sch.sitIdle[0] + sch.sitIdle[1]) / 2, helpers);
      expect(dist(sitting, s)).toBeLessThan(1e-6);
      expect(dist(sitting, route)).toBeCloseTo(SEAT_OFFSET_M, 3);
      // seated she faces the route (model front is +z, yaw = atan2(dx, dz))
      const face = Math.atan2(route[0] - s.x, route[1] - s.z);
      expect(
        Math.abs(Math.atan2(Math.sin(sitting.yaw - face), Math.cos(sitting.yaw - face))),
      ).toBeLessThan(0.1);
      const halfway = heroStateAt(tl, p.t0 + (sch.approach[0] + sch.approach[1]) / 2, helpers);
      expect(dist(halfway, route)).toBeGreaterThan(0.2);
      expect(dist(halfway, s)).toBeGreaterThan(0.2);
      expect(dist(heroStateAt(tl, p.t1 - 1e-6, helpers), route)).toBeLessThan(1e-3);
    }
  });

  it("uses the bench place when it is a sensible distance off the route, else a side offset", () => {
    const p = path.pointAt(638);
    const off = seatFor(path.pointAt, 638, [p[0] + 3, p[1]]);
    expect(dist(off, [p[0] + 3, p[1]])).toBeLessThan(1e-9);
    const onRoute = seatFor(path.pointAt, 638, [p[0] + 0.2, p[1]]);
    expect(dist(onRoute, p)).toBeCloseTo(SEAT_OFFSET_M, 6);
    // the offset goes to the bench's side of the route
    const side = seatFor(path.pointAt, 638, null);
    const mirrored = { x: 2 * p[0] - side.x, z: 2 * p[1] - side.z };
    const toward = seatFor(path.pointAt, 638, [
      p[0] + (mirrored.x - p[0]) * 0.1,
      p[1] + (mirrored.z - p[1]) * 0.1,
    ]);
    expect(dist(toward, mirrored)).toBeLessThan(1e-6);
    const far = seatFor(path.pointAt, 638, [p[0] + 200, p[1]]);
    expect(dist(far, p)).toBeCloseTo(SEAT_OFFSET_M, 6);
  });

  it("a rest without a seat helper still sits at the side offset", () => {
    const p = rests[0] as Phase;
    const sch = restSchedule(p.t1 - p.t0);
    const s = heroStateAt(tl, p.t0 + (sch.sitIdle[0] + sch.sitIdle[1]) / 2, {
      pointAt: path.pointAt,
    });
    expect(s.clip).toBe("sit_idle");
    expect(dist(s, path.pointAt(p.m0))).toBeCloseTo(SEAT_OFFSET_M, 3);
  });

  it("short holds compress the choreography but keep every beat", () => {
    const sch = restSchedule(2);
    expect(sch.approach[0]).toBe(0);
    expect(sch.back[1]).toBeCloseTo(2, 9);
    for (const k of ["approach", "sitDown", "sitIdle", "standUp", "back"] as const)
      expect(sch[k][1]).toBeGreaterThan(sch[k][0]);
  });
});

describe("heroStateAt: scrub determinism and continuity", () => {
  it("the same t gives the same state, whatever was asked before", () => {
    const ts = Array.from({ length: 300 }, (_, i) => (i * tl.total) / 299);
    const forward = ts.map((t) => heroStateAt(tl, t, helpers));
    const shuffled = [...ts]
      .reverse()
      .map((t) => heroStateAt(tl, t, helpers))
      .reverse();
    expect(shuffled).toEqual(forward);
  });

  it("positions are continuous at 10 Hz (no teleport bigger than the walk-phase step)", () => {
    let prev = heroStateAt(tl, 0, helpers);
    let maxSpeed = 0;
    for (let t = 0.1; t <= tl.total; t += 0.1) {
      const s = heroStateAt(tl, t, helpers);
      maxSpeed = Math.max(maxSpeed, dist(s, prev) / 0.1);
      prev = s;
    }
    // walk phases run at pace x 20 on screen (~23 m/s); nothing faster than that
    expect(maxSpeed).toBeLessThan(plan.pace_m_per_s * 20 * 1.2);
  });

  it("yaw is smoothed: no jump bigger than 60 deg between 10 Hz samples", () => {
    let prev = heroStateAt(tl, 0, helpers).yaw;
    for (let t = 0.1; t <= tl.total; t += 0.1) {
      const y = heroStateAt(tl, t, helpers).yaw;
      expect(Math.abs(Math.atan2(Math.sin(y - prev), Math.cos(y - prev)))).toBeLessThan(
        Math.PI / 3,
      );
      prev = y;
    }
  });

  it("the walk clip time runs on across walk phases and slow holds (no reset at a boundary)", () => {
    // covered hold (slow walk) -> walk phase
    const cov = holds("covered")[0] as Phase;
    const before = heroStateAt(tl, cov.t1 - 1e-4, helpers);
    const after = heroStateAt(tl, cov.t1 + 1e-4, helpers);
    expect(before.clip).toBe("walk");
    expect(after.clip).toBe("walk");
    expect(Math.abs(after.clipTime - before.clipTime)).toBeLessThan(0.01);
    // walk phase -> verified hold (slow walk)
    const holdV = holds("verified")[0] as Phase;
    const a = heroStateAt(tl, holdV.t0 - 1e-4, helpers);
    const b = heroStateAt(tl, holdV.t0 + 1e-4, helpers);
    expect(a.clip).toBe("walk");
    expect(b.clip).toBe("walk");
    expect(Math.abs(b.clipTime - a.clipTime)).toBeLessThan(0.01);
  });
});

describe("walk rate is tied to the pace", () => {
  const scaled = (k: number) => {
    const p = { ...plan, pace_m_per_s: plan.pace_m_per_s * k } as JourneyPlan;
    return buildTimeline(p);
  };
  it("walk phases: rate = pace / reference pace x the walk-phase factor", () => {
    for (const k of [0.5, 1, 1.5]) {
      const t2 = scaled(k);
      const p = t2.phases.find((q) => q.kind === "walk") as Phase;
      const s = heroStateAt(t2, mid(p), helpers);
      expect(s.walkRate).toBeCloseTo(
        ((plan.pace_m_per_s * k) / HERO_REF_PACE_MPS) * WALK_PHASE_RATE,
        6,
      );
    }
  });
  it("slow holds: rate = the on-screen speed / reference pace (proportional to the pace)", () => {
    const r = [0.5, 1].map((k) => {
      const t2 = scaled(k);
      return heroStateAt(
        t2,
        mid(t2.phases.find((q) => q.event?.kind === "verified") as Phase),
        helpers,
      ).walkRate;
    });
    expect((r[1] as number) / (r[0] as number)).toBeCloseTo(2, 3);
  });
});
