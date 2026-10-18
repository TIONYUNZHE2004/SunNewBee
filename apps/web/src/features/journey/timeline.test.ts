import { describe, expect, it } from "vitest";
import demo from "./fixtures/demoPlan.json";
import {
  buildTimeline,
  COMPRESS,
  clockAt,
  DIVE_S,
  HOLD_MOVES,
  HOLD_SCREEN_S,
  type JourneyEvent,
  type JourneyPlan,
  PULL_S,
  stateAt,
} from "./timeline";

const plan = demo as unknown as JourneyPlan;

function ev(
  kind: JourneyEvent["kind"],
  at_m: number,
  hold_s: number,
  title: string = kind,
): JourneyEvent {
  return {
    kind,
    at_m,
    hold_s,
    title,
    body: "",
    demo: false,
    evidence_id: `ev-${kind}-${at_m}`,
    status: "unknown",
  };
}

function tiny(events: JourneyEvent[], extra: Partial<JourneyPlan> = {}): JourneyPlan {
  return {
    route_id: "rt-x",
    profile: "older_adult_rest",
    start_time: "09:00",
    pace_m_per_s: 1,
    polyline: [
      [101.5, 3.18],
      [101.501, 3.18],
    ],
    spans: [
      [0, 20, "PASS"],
      [20, 100, "UNKNOWN"],
    ],
    events,
    conditions: [],
    ...extra,
  };
}

/** The plan's own HUD values at the start of event i (independent of the timeline code). */
function planHud(p: JourneyPlan, i: number) {
  const e = p.events[i] as JourneyEvent;
  const before = p.events.slice(0, i);
  // stationary holds add their time; walking holds walk it (uncapped here); arrive adds none
  const stops = before.filter((x) => x.kind === "unknown" || x.kind === "rest");
  const sim = e.at_m / p.pace_m_per_s + stops.reduce((a, x) => a + x.hold_s, 0);
  const [h, m] = p.start_time.split(":").map(Number) as [number, number];
  const mins = (h * 60 + m + Math.floor(sim / 60)) % (24 * 60);
  const clock = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  const rests = p.events.slice(0, i + 1).filter((x) => x.kind === "rest").length;
  return { clock, distance: e.at_m, rests };
}

describe("the §6.4 constants", () => {
  it("dive 4 s, pull-back 5 s, 20x walk, one table of event screen holds", () => {
    expect(DIVE_S).toBe(4);
    expect(PULL_S).toBe(5);
    expect(COMPRESS).toBe(20);
    expect(HOLD_SCREEN_S).toEqual({
      verified: 3.2,
      unknown: 3.6,
      rest: 4.2,
      gap: 3.4,
      covered: 3.0,
      arrive: 3.2,
    });
  });
});

describe("buildTimeline on the §2 demo plan (AC-D7)", () => {
  const tl = buildTimeline(plan);

  it("is the real backend plan for the §2 route", () => {
    expect(plan.profile).toBe("older_adult_rest");
    expect(plan.events.map((e) => e.kind)).toEqual([
      "covered",
      "unknown",
      "gap",
      "unknown",
      "verified",
      "rest",
      "unknown",
      "rest",
      "rest",
      "arrive",
    ]);
  });

  it("phases tile the timeline and the total is their sum", () => {
    const sum = tl.phases.reduce((a, p) => a + (p.t1 - p.t0), 0);
    expect(tl.total).toBeCloseTo(sum, 9);
    expect(tl.phases[0]?.t0).toBe(0);
    for (let i = 1; i < tl.phases.length; i++)
      expect(tl.phases[i]?.t0).toBeCloseTo(tl.phases[i - 1]?.t1 as number, 9);
    expect(tl.phases.at(-1)?.t1).toBeCloseTo(tl.total, 9);
  });

  it("starts with a 4 s dive and ends with a 5 s pull-back that do not move the clock", () => {
    const [first, last] = [tl.phases[0], tl.phases.at(-1)];
    expect(first).toMatchObject({ kind: "dive", t0: 0, t1: 4, sim0: 0, sim1: 0, m0: 0, m1: 0 });
    expect(last?.kind).toBe("pull");
    expect((last?.t1 as number) - (last?.t0 as number)).toBeCloseTo(5, 9);
    expect(last?.sim1).toBe(last?.sim0);
  });

  it("walk phases run at 20x (±1%) and at the plan's pace", () => {
    const walks = tl.phases.filter((p) => p.kind === "walk");
    expect(walks.length).toBeGreaterThan(5);
    for (const w of walks) {
      expect(Math.abs((w.sim1 - w.sim0) / (w.t1 - w.t0) / 20 - 1)).toBeLessThan(0.01);
      expect((w.m1 - w.m0) / (w.sim1 - w.sim0)).toBeCloseTo(plan.pace_m_per_s, 6);
    }
  });

  it("one hold per plan event, in plan order, with §6.4 screen time and simulated time", () => {
    const holds = tl.phases.filter((p) => p.kind === "event");
    expect(holds.map((h) => h.event)).toEqual(plan.events);
    expect(holds.map((h) => h.eventIndex)).toEqual(plan.events.map((_, i) => i));
    for (const h of holds) {
      const e = h.event as JourneyEvent;
      expect(h.t1 - h.t0).toBeCloseTo(HOLD_SCREEN_S[e.kind], 9);
      // arrive stops the clock (§6.4 "—"); the others add the plan's hold_s
      expect(h.sim1 - h.sim0).toBeCloseTo(e.kind === "arrive" ? 0 : e.hold_s, 9);
      expect(h.m0).toBe(e.at_m);
      // verified / gap / covered: she keeps walking at her pace; unknown / rest / arrive: stands
      const moved = HOLD_MOVES.has(e.kind) ? e.hold_s * plan.pace_m_per_s : 0;
      expect(h.m1 - h.m0).toBeCloseTo(moved, 9);
    }
  });

  it("the plan's simulated holds match the §6.4 table", () => {
    const sim = { verified: 3, unknown: 8, rest: 60, gap: 3, covered: 3 } as const;
    for (const e of plan.events)
      if (e.kind !== "arrive") expect(e.hold_s).toBe(sim[e.kind as keyof typeof sim]);
  });

  it("the HUD at each event start equals the plan (clock to the minute, distance ±2 m, rests)", () => {
    const holds = tl.phases.filter((p) => p.kind === "event");
    holds.forEach((h, i) => {
      const s = stateAt(tl, h.t0);
      const want = planHud(plan, i);
      expect(s.phase.kind).toBe("event");
      expect(s.event).toBe(plan.events[i]);
      expect(s.clock).toBe(want.clock);
      expect(Math.abs(s.distance_m - want.distance)).toBeLessThanOrEqual(2);
      expect(s.restsTaken).toBe(want.rests);
    });
  });

  it("totals about 86 s for the demo route (spec §6.4) and inside the 80-100 s take (AC-D18)", () => {
    const walked = plan.events.filter((e) => HOLD_MOVES.has(e.kind)).length * 3; // sim s in holds
    const walkSim = (plan.events.at(-1) as JourneyEvent).at_m / plan.pace_m_per_s - walked;
    const holdScreen = plan.events.reduce((a, e) => a + HOLD_SCREEN_S[e.kind], 0);
    expect(tl.total).toBeCloseTo(4 + 5 + walkSim / 20 + holdScreen, 6);
    expect(tl.total).toBeGreaterThan(80);
    expect(tl.total).toBeLessThan(100);
  });

  it("ends at the destination with every rest taken and the clock stopped at arrival", () => {
    const end = stateAt(tl, tl.total);
    expect(end.phase.kind).toBe("pull");
    expect(end.distance_m).toBeCloseTo(963.5, 1);
    expect(end.restsTaken).toBe(3);
    const stops = plan.events.filter((e) => e.kind === "unknown" || e.kind === "rest");
    const sim = 963.5 / plan.pace_m_per_s + stops.reduce((a, e) => a + e.hold_s, 0);
    expect(end.simSeconds).toBeCloseTo(sim, 6);
    expect(end.clock).toBe(clockAt("09:00", sim));
  });

  it("does not pause minutes outdoors under the demo's reported (unchecked) roof", () => {
    expect(plan.events[0]).toMatchObject({ kind: "covered", status: "reported" });
    expect(tl.covered).toEqual([]);
    const end = stateAt(tl, tl.total);
    expect(end.outdoorsSeconds).toBeCloseTo(end.simSeconds, 9);
    expect(end.minutesOutdoors).toBe(Math.floor(end.simSeconds / 60));
  });
});

describe("stateAt", () => {
  const tl = buildTimeline(plan);

  it("clamps outside [0, total] and is monotonic in distance, clock and rests", () => {
    expect(stateAt(tl, -5)).toMatchObject({ distance_m: 0, simSeconds: 0, clock: "09:00" });
    expect(stateAt(tl, -5).phase.kind).toBe("dive");
    expect(stateAt(tl, tl.total + 10)).toEqual(stateAt(tl, tl.total));
    let prev = stateAt(tl, 0);
    for (let t = 0.1; t <= tl.total; t += 0.1) {
      const s = stateAt(tl, t);
      expect(s.distance_m).toBeGreaterThanOrEqual(prev.distance_m - 1e-9);
      expect(s.simSeconds).toBeGreaterThanOrEqual(prev.simSeconds - 1e-9);
      expect(s.outdoorsSeconds).toBeGreaterThanOrEqual(prev.outdoorsSeconds - 1e-9);
      expect(s.restsTaken).toBeGreaterThanOrEqual(prev.restsTaken);
      prev = s;
    }
  });

  it("interpolates inside a walk phase", () => {
    const w = tl.phases.find((p) => p.kind === "walk");
    if (!w) throw new Error("no walk");
    const s = stateAt(tl, (w.t0 + w.t1) / 2);
    expect(s.phase).toBe(w);
    expect(s.u).toBeCloseTo(0.5, 9);
    expect(s.distance_m).toBeCloseTo((w.m0 + w.m1) / 2, 6);
    expect(s.simSeconds).toBeCloseTo((w.sim0 + w.sim1) / 2, 6);
    expect(s.event).toBeUndefined();
  });

  it("is deterministic: seeking straight to t equals the same t again", () => {
    for (const t of [0, 3.9, 4, 17.25, 42, tl.total - 0.01])
      expect(stateAt(tl, t)).toEqual(stateAt(buildTimeline(plan), t));
  });
});

describe("buildTimeline on small plans", () => {
  it("events at the same at_m play back to back in plan order, with no walk between", () => {
    const p = tiny([
      ev("unknown", 50, 8, "Ramp"),
      ev("rest", 50, 60, "Bench"),
      ev("arrive", 100, 3),
    ]);
    const tl = buildTimeline(p);
    expect(tl.phases.map((x) => x.kind)).toEqual([
      "dive",
      "walk",
      "event",
      "event",
      "walk",
      "event",
      "pull",
    ]);
    expect(tl.phases.filter((x) => x.event).map((x) => x.event?.title)).toEqual([
      "Ramp",
      "Bench",
      "arrive",
    ]);
  });

  it("an event at 0 m starts right after the dive (no zero-length walk)", () => {
    const tl = buildTimeline(tiny([ev("covered", 0, 3), ev("arrive", 100, 3)]));
    expect(tl.phases.map((x) => x.kind)).toEqual(["dive", "event", "walk", "event", "pull"]);
  });

  it("a plan without events still dives, walks to the end of the spans and pulls back", () => {
    const tl = buildTimeline(tiny([]));
    expect(tl.phases.map((x) => x.kind)).toEqual(["dive", "walk", "pull"]);
    expect(stateAt(tl, tl.total).distance_m).toBe(100);
    expect(tl.total).toBeCloseTo(4 + 100 / 20 + 5, 9);
  });

  it("the clock wraps past midnight", () => {
    expect(clockAt("23:59", 61)).toBe("00:00");
    expect(clockAt("09:00", 59.9)).toBe("09:00");
    expect(clockAt("09:00", 60)).toBe("09:01");
  });

  it("rests count from the start of their hold", () => {
    const p = tiny([ev("rest", 30, 60), ev("arrive", 100, 3)]);
    const tl = buildTimeline(p);
    const hold = tl.phases.find((x) => x.event?.kind === "rest");
    if (!hold) throw new Error("no rest");
    expect(stateAt(tl, hold.t0 - 0.01).restsTaken).toBe(0);
    expect(stateAt(tl, hold.t0).restsTaken).toBe(1);
  });

  const roofed = (status: JourneyEvent["status"]) =>
    tiny([{ ...ev("covered", 20, 3), status }, ev("rest", 60, 60), ev("arrive", 100, 3)]);

  it("minutes outdoors pause under a verified covered span, on walks and holds alike", () => {
    // covered at 20 m on span [20, 100): only 0-20 m (20 s) is outdoors; the walking hold, the
    // rest at 60 m and the walks after it are under the roof; arrive adds no time
    const tl = buildTimeline(roofed("verified"));
    expect(tl.covered).toEqual([[20, 100]]);
    const end = stateAt(tl, tl.total);
    expect(end.simSeconds).toBeCloseTo(100 + 60, 9);
    expect(end.outdoorsSeconds).toBeCloseTo(20, 9);
  });

  it("a reported, stale or contested roof is not a checked fact: the counter keeps running", () => {
    for (const status of ["reported", "stale", "contested", "unknown"] as const) {
      const tl = buildTimeline(roofed(status));
      expect(tl.covered).toEqual([]);
      const end = stateAt(tl, tl.total);
      expect(end.outdoorsSeconds).toBeCloseTo(end.simSeconds, 9);
    }
  });

  it("a walking hold walks at her pace but never past the next event", () => {
    // pace 1 m/s: the verified hold would walk 3 m, the unknown is 1 m further on
    const p = tiny([
      ev("verified", 10, 3),
      ev("unknown", 11, 8),
      ev("gap", 50, 3),
      ev("arrive", 100, 3),
    ]);
    const tl = buildTimeline(p);
    const holds = tl.phases.filter((x) => x.kind === "event");
    expect(holds.map((h) => [h.m0, h.m1])).toEqual([
      [10, 11],
      [11, 11],
      [50, 53],
      [100, 100],
    ]);
    expect(tl.phases.map((x) => x.kind)).toEqual([
      "dive",
      "walk",
      "event",
      "event",
      "walk",
      "event",
      "walk",
      "event",
      "pull",
    ]);
    const unknown = holds[1];
    if (!unknown) throw new Error("no unknown");
    expect(stateAt(tl, unknown.t0).distance_m).toBe(11);
    // the walk after the gap hold starts where she got to
    expect(tl.phases[6]).toMatchObject({ kind: "walk", m0: 53, m1: 100 });
  });

  it("arrive stops the clock whatever the plan's hold_s", () => {
    const tl = buildTimeline(tiny([ev("arrive", 100, 3)]));
    const arrive = tl.phases.find((x) => x.event?.kind === "arrive");
    if (!arrive) throw new Error("no arrive");
    expect(arrive.sim1).toBe(arrive.sim0);
    expect(arrive.t1 - arrive.t0).toBeCloseTo(3.2, 9);
    expect(stateAt(tl, tl.total).simSeconds).toBeCloseTo(100, 9);
  });
});
