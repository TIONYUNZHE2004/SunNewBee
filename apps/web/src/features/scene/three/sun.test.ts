import { describe, expect, it } from "vitest";
import { sunPosition, sunVector } from "./sun";

const LAT = 3.1813;
const LON = 101.5099;
const deg = (r: number) => (r * 180) / Math.PI;

describe("sunPosition", () => {
  it("is nearly overhead at equinox solar noon", () => {
    const p = sunPosition(new Date("2026-03-20T05:21:00Z"), LAT, LON);
    expect(deg(p.elevationRad)).toBeGreaterThan(80);
  });
  it("is just below the horizon before sunrise", () => {
    const p = sunPosition(new Date("2026-03-19T23:00:00Z"), LAT, LON);
    expect(deg(p.elevationRad)).toBeGreaterThan(-6);
    expect(deg(p.elevationRad)).toBeLessThan(0);
  });
  it("is north of the zenith at the June solstice", () => {
    const p = sunPosition(new Date("2026-06-21T05:20:00Z"), LAT, LON);
    const a = deg(p.azimuthRad);
    expect(Math.min(a, 360 - a)).toBeLessThan(30);
  });
});

describe("sunVector", () => {
  it("maps angles to the local frame (x east, y up, z -north)", () => {
    const close = (a: number[], b: number[]) => {
      for (const [i, v] of a.entries()) expect(v).toBeCloseTo(b[i] as number, 6);
    };
    close(sunVector(0, Math.PI / 2), [0, 1, 0]);
    close(sunVector(Math.PI / 2, 0), [1, 0, 0]);
    close(sunVector(0, 0), [0, 0, -1]);
  });
});
