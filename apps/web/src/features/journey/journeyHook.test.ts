import { beforeEach, describe, expect, it } from "vitest";
import demo from "./fixtures/demoPlan.json";
import {
  createJourneyHook,
  installJourneyHook,
  isDemoPreset,
  type JourneyHook,
} from "./journeyHook";
import { useJourney } from "./journeyStore";
import type { JourneyPlan } from "./timeline";

const plan = demo as unknown as JourneyPlan;

describe("window.__journey", () => {
  beforeEach(() => {
    useJourney.getState().clear();
    useJourney.getState().load(plan);
  });

  it("has the prototype API shape", () => {
    const h = createJourneyHook();
    expect(Object.keys(h).sort()).toEqual(
      ["pause", "phases", "play", "seek", "setCam", "state", "total"].sort(),
    );
    expect(h.phases.length).toBeGreaterThan(10);
    expect(h.total).toBeGreaterThan(80);
    expect(h.total).toBeLessThan(100);
  });

  it("drives the store and reports state", () => {
    const h = createJourneyHook();
    h.seek(30);
    h.setCam("overview");
    h.play();
    const st = h.state();
    expect(st).toMatchObject({ t: 30, playing: true, camMode: "overview" });
    expect(st?.clock).toBe("09:04");
    h.pause();
    expect(h.state()?.playing).toBe(false);
  });

  it("state is null and total 0 without a plan", () => {
    useJourney.getState().clear();
    const h = createJourneyHook();
    expect(h.state()).toBeNull();
    expect(h.total).toBe(0);
    expect(h.phases).toEqual([]);
  });

  it("is installed in dev or the demo preset, not on a normal production load", () => {
    const t1: { __journey?: JourneyHook } = {};
    expect(installJourneyHook({ dev: false, search: "" }, t1)).toBe(false);
    expect(t1.__journey).toBeUndefined();
    expect(installJourneyHook({ dev: false, search: "?demo=0" }, t1)).toBe(false);
    expect(installJourneyHook({ dev: false, search: "?demo=1" }, t1)).toBe(true);
    const t2: { __journey?: JourneyHook } = {};
    expect(installJourneyHook({ dev: true, search: "" }, t2)).toBe(true);
    expect(t2.__journey).toBeDefined();
    expect(isDemoPreset("?x=1&demo=1")).toBe(true);
  });

  it("scrub parity through the hook: seek(t) equals a straight play to t", () => {
    const h = createJourneyHook();
    for (const frac of [0.13, 0.5, 0.91]) {
      const target = h.total * frac;
      h.seek(target);
      const scrubbed = h.state();
      useJourney.getState().restart();
      for (let i = 0; i < Math.round(target * 10); i++) useJourney.getState().advance(0.1);
      const played = h.state();
      expect(scrubbed?.phaseIndex).toBe(played?.phaseIndex);
      expect(scrubbed?.clock).toBe(played?.clock);
      expect(scrubbed?.restsTaken).toBe(played?.restsTaken);
      expect(scrubbed?.distance_m).toBeCloseTo(played?.distance_m ?? 0, 0);
    }
  });
});
