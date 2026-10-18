import { describe, expect, it } from "vitest";
import { boundsGoal, type IntentSlice, intentGoal } from "./intents";

const EMPTY: IntentSlice = {
  route: null,
  focusRouteRequest: null,
  whatIf: null,
  focusPlaceId: null,
  camera: null,
};
const none = () => null;
// 1 km east at lat 3.0: 1 km ≈ 0.009014° of longitude.
const A: [number, number] = [101.5, 3.0];
const B: [number, number] = [101.5 + 1000 / 111_195.0 / Math.cos((3 * Math.PI) / 180), 3.0];
const route = (id: string, coordinates: [number, number][]) => ({
  id,
  geojson: { type: "LineString" as const, coordinates },
});

describe("intentGoal", () => {
  it("frames a new route at its midpoint with range 4 x radius", () => {
    // Radius from the midpoint is ~500 m, so range is ~2000 m.
    const g = intentGoal({ ...EMPTY, route: route("r1", [A, B]) }, EMPTY, none);
    expect(g).not.toBeNull();
    expect(g?.centre[0]).toBeCloseTo((A[0] + B[0]) / 2, 6);
    expect(g?.centre[1]).toBeCloseTo(3.0, 6);
    expect(Math.abs((g?.rangeM ?? 0) - 2000)).toBeLessThan(5);
  });

  it("floors a short route at 300 m", () => {
    const short: [number, number] = [A[0] + 10 / 111_195, A[1]];
    const g = intentGoal({ ...EMPTY, route: route("r1", [A, short]) }, EMPTY, none);
    expect(g?.rangeM).toBe(300);
  });

  it("focuses a known place at 400 m and ignores an unknown one", () => {
    const s = { ...EMPTY, focusPlaceId: "p1" };
    expect(intentGoal(s, EMPTY, (id) => (id === "p1" ? A : null))).toEqual({
      centre: A,
      rangeM: 400,
    });
    expect(intentGoal(s, EMPTY, none)).toBeNull();
  });

  it("uses a new camera as given", () => {
    const s = { ...EMPTY, camera: { center: A, rangeM: 1500 } };
    expect(intentGoal(s, EMPTY, none)).toEqual({ centre: A, rangeM: 1500 });
  });

  it("returns null for an identical state", () => {
    const s = { ...EMPTY, route: route("r1", [A, B]), camera: { center: A, rangeM: 9 } };
    expect(intentGoal(s, s, none)).toBeNull();
  });

  it("lets the route win over a camera change in the same update", () => {
    const s = { ...EMPTY, route: route("r1", [A, B]), camera: { center: A, rangeM: 1500 } };
    const g = intentGoal(s, EMPTY, none);
    expect(g?.rangeM).not.toBe(1500);
  });

  it("re-frames the route when focusRouteRequest equals route.id", () => {
    const r = route("r1", [A, B]);
    const prev = { ...EMPTY, route: r };
    const g = intentGoal({ ...prev, focusRouteRequest: "r1" }, prev, none);
    expect(Math.abs((g?.rangeM ?? 0) - 2000)).toBeLessThan(5);
    expect(intentGoal({ ...prev, focusRouteRequest: "other" }, prev, none)).toBeNull();
  });

  it("frames a new what-if diff", () => {
    const whatIf = {
      geojson: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { whatif: true, side: "after" },
            geometry: { type: "LineString", coordinates: [A, B] },
          },
        ],
      },
    };
    const g = intentGoal({ ...EMPTY, whatIf }, EMPTY, none);

    expect(Math.abs((g?.rangeM ?? 0) - 2000)).toBeLessThan(5);
  });
});

describe("boundsGoal", () => {
  it("returns null for no points", () => {
    expect(boundsGoal([])).toBeNull();
  });
});
