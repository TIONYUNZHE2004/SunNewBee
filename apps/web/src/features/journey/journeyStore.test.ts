import { beforeEach, describe, expect, it } from "vitest";
import demo from "./fixtures/demoPlan.json";
import { journeyStateOf, useJourney } from "./journeyStore";
import type { JourneyPlan } from "./timeline";

const plan = demo as unknown as JourneyPlan;
const j = () => useJourney.getState();

describe("journeyStore", () => {
  beforeEach(() => j().clear());

  it("starts empty, paused, in follow mode", () => {
    expect(j()).toMatchObject({
      plan: null,
      timeline: null,
      t: 0,
      playing: false,
      camMode: "follow",
    });
    expect(journeyStateOf(j())).toBeNull();
  });

  it("load builds the timeline at t = 0 without auto-playing", () => {
    j().play();
    j().load(plan);
    const s = j();
    expect(s.plan).toBe(plan);
    expect(s.timeline?.phases.length).toBeGreaterThan(10);
    expect(s).toMatchObject({ t: 0, playing: false });
    expect(journeyStateOf(s)?.clock).toBe("09:00");
  });

  it("play, pause and advance move t only while playing and stop at the end", () => {
    j().load(plan);
    j().advance(1);
    expect(j().t).toBe(0);
    j().play();
    j().advance(1.5);
    expect(j().t).toBeCloseTo(1.5, 9);
    j().pause();
    j().advance(1);
    expect(j().t).toBeCloseTo(1.5, 9);
    j().play();
    j().advance(1e6);
    expect(j().t).toBe(j().timeline?.total);
    expect(j().playing).toBe(false);
  });

  it("play at the end starts again from 0", () => {
    j().load(plan);
    j().seek(1e6);
    j().play();
    expect(j()).toMatchObject({ t: 0, playing: true });
  });

  it("seek clamps to [0, total] and matches a straight play to that time", () => {
    j().load(plan);
    j().seek(-3);
    expect(j().t).toBe(0);
    j().seek(42);
    const seeked = journeyStateOf(j());
    j().restart();
    expect(j()).toMatchObject({ t: 0, playing: true });
    for (let i = 0; i < 420; i++) j().advance(0.1);
    expect(journeyStateOf(j())?.clock).toBe(seeked?.clock);
    expect(journeyStateOf(j())?.distance_m).toBeCloseTo(seeked?.distance_m as number, 6);
  });

  it("setCam switches follow / overview / free", () => {
    for (const m of ["overview", "free", "follow"] as const) {
      j().setCam(m);
      expect(j().camMode).toBe(m);
    }
  });

  it("does nothing without a plan", () => {
    j().play();
    j().seek(5);
    j().advance(1);
    expect(j()).toMatchObject({ t: 0, playing: false });
  });
});
