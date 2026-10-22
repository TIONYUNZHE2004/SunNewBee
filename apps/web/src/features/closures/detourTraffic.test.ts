import { describe, expect, it } from "vitest";
import {
  alongLoop,
  BAND_CARS,
  BAND_SPEED_MPS,
  DETOUR_CARS_NOTE,
  detourCars,
  detourLines,
  MAX_DETOUR_CARS,
} from "./detourTraffic";
import { MARATHON } from "./fixtures";

// fixture detour roads: Persiaran Tamarind seg-bc (high), Jalan Dillenia seg-cd (low),
// Persiaran Tamarind seg-de (medium)
const edges = [
  {
    id: "seg-bc",
    coords: [
      [101.5, 3.1],
      [101.501, 3.1],
    ],
  },
  {
    id: "seg-cd",
    coords: [
      [101.6, 3.1],
      [101.601, 3.1],
    ],
  },
];

describe("T-031 detour traffic by pressure band", () => {
  it("draws each mapped detour road's stretches with the engine's band", () => {
    const lines = detourLines(MARATHON, edges);
    expect(lines.map((l) => [l.band, l.road])).toEqual([
      ["high", 0],
      ["low", 1],
    ]); // seg-de has no geometry on this map: not drawn
    expect(lines[0]?.length).toBeCloseTo(111, 0);
  });

  it("many slow cars under high pressure, few faster ones under low", () => {
    const lines = detourLines(MARATHON, edges);
    const cars = detourCars(MARATHON, lines);
    const byLine = (i: number) => cars.filter((c) => c.line === i);
    expect(byLine(0)).toHaveLength(BAND_CARS.high);
    expect(byLine(1)).toHaveLength(BAND_CARS.low);
    expect(BAND_CARS.high).toBeGreaterThan(BAND_CARS.medium);
    expect(BAND_CARS.medium).toBeGreaterThan(BAND_CARS.low);
    expect(byLine(0)[0]?.speed).toBe(BAND_SPEED_MPS.high);
    expect(BAND_SPEED_MPS.high).toBeLessThan(BAND_SPEED_MPS.low);
    expect(cars.length).toBeLessThanOrEqual(MAX_DETOUR_CARS);
    expect(DETOUR_CARS_NOTE).toBe("Cars are illustrative, not vehicle counts or delays.");
  });

  it("a car loops along its stretch", () => {
    const [l] = detourLines(MARATHON, edges);
    if (!l) throw new Error("no line");
    expect(alongLoop(l, 0)).toEqual([101.5, 3.1]);
    expect(alongLoop(l, l.length / 2)[0]).toBeCloseTo(101.5005, 6);
    expect(alongLoop(l, l.length + 1)[0]).toBeCloseTo(alongLoop(l, 1)[0], 9);
  });
});
