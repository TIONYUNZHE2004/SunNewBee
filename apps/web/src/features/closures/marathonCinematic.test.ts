import { describe, expect, it } from "vitest";
import { MARATHON } from "./fixtures";
import {
  carAt,
  detourTag,
  followedTrip,
  leadAt,
  paceOf,
  revealAt,
  roadsClosed,
  runnerAt,
  SHOTS,
  shotAt,
  shotStart,
  suggestionRoad,
  suggestionTag,
  TOTAL_S,
} from "./marathonCinematic";

const trip = {
  from_id: "a",
  to_id: "b",
  profile: "drive",
  before_coordinates: [
    [101.5, 3.1],
    [101.51, 3.1],
  ],
  after_coordinates: [
    [101.5, 3.1],
    [101.5, 3.11],
  ],
};
const withTrip = { ...MARATHON, animation: { ...MARATHON.animation, rerouted_trips: [trip] } };

describe("T-031 marathon cinematic timeline", () => {
  it("plays reveal, dive, run, cut, car, pull in order and holds the last frame", () => {
    expect(SHOTS.map((s) => s.id)).toEqual(["reveal", "dive", "run", "cut", "car", "pull"]);
    expect(TOTAL_S).toBe(38);
    expect(shotAt(0)).toEqual({ id: "reveal", u: 0 });
    expect(shotAt(shotStart("run") + 9).id).toBe("run");
    expect(shotAt(shotStart("run") + 9).u).toBeCloseTo(0.5);
    expect(shotAt(TOTAL_S + 5)).toEqual({ id: "pull", u: 1 });
    expect(revealAt(1.5)).toBeCloseTo(0.5);
    expect(revealAt(10)).toBe(1);
  });

  it("the lead finishes as the run shot ends; the pack runs close behind and finishes later", () => {
    const end = shotStart("cut");
    expect(leadAt(shotStart("run"))).toBe(0);
    expect(leadAt(end)).toBe(1);
    for (let i = 1; i < 30; i++) {
      expect(paceOf(i)).toBeLessThan(1);
      expect(runnerAt(end, i)).toBeLessThan(1);
      expect(runnerAt(end, i)).toBeGreaterThan(0.97);
      expect(runnerAt(TOTAL_S, i)).toBe(1);
    }
    expect(carAt(shotStart("car"))).toBe(0);
    expect(carAt(shotStart("pull"))).toBe(1);
  });

  it("numbers come from the engine: roads closed, the median detour, suggestion places", () => {
    expect(roadsClosed(MARATHON)).toBe(2);
    expect(detourTag(MARATHON)).toBe("Detour (median of rerouted trips): +82.5 m · +0.2 min");
    expect(
      detourTag({ ...MARATHON, impact: { ...MARATHON.impact, extra_m_median: null } }),
    ).toBeNull();
    expect(followedTrip(MARATHON)).toBeNull();
    expect(followedTrip(withTrip)).toBe(trip);
    expect(suggestionTag("marshal")).toBe("Marshal suggested here");
    expect(suggestionTag("reschedule")).toBeNull();
    expect(
      suggestionRoad(MARATHON, "Consider a marshal at Persiaran Tamarind: 4 sample trips"),
    ).toBe("Persiaran Tamarind");
    expect(suggestionRoad(MARATHON, "Review the timing")).toBeNull();
  });
});
