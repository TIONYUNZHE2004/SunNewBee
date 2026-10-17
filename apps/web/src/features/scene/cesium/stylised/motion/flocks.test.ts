import { describe, expect, it } from "vitest";
import { cloudOffset, cloudSpots, flockLoops, loopPoint, wrapCentred } from "./flocks";

const AT = { lon: 101.51, lat: 3.18 };

describe("flocks", () => {
  it("loops are closed, 40-90 m up, deterministic", () => {
    const loops = flockLoops(AT, [[101.511, 3.181]], 4, "s");
    expect(loops).toHaveLength(4);
    expect(flockLoops(AT, [[101.511, 3.181]], 4, "s")).toEqual(loops);
    for (const l of loops) {
      expect(l.z).toBeGreaterThanOrEqual(40);
      expect(l.z).toBeLessThanOrEqual(90);
      const a = loopPoint(l, 0);
      const b = loopPoint(l, l.period);
      expect(b[0]).toBeCloseTo(a[0], 6);
      expect(b[1]).toBeCloseTo(a[1], 6);
    }
  });
  it("clouds sit 250-400 m up and drift with wrap-around", () => {
    for (const c of cloudSpots(8, "s", 4000)) {
      expect(c.z).toBeGreaterThanOrEqual(250);
      expect(c.z).toBeLessThanOrEqual(400);
    }
    const [dx] = cloudOffset(10_000, 3, 4000);
    expect(Math.abs(dx)).toBeLessThanOrEqual(4000);
  });
  it("loops circle the anchors (or `at` without anchors)", () => {
    const [l] = flockLoops(AT, [[101.511, 3.181]], 1, "s");
    expect(l!.cx).toBeCloseTo(0.001 * Math.cos((3.18 * Math.PI) / 180) * 111_320, 3);
    expect(l!.cy).toBeCloseTo(111.32, 3);
    const [c] = flockLoops(AT, [], 1, "s");
    expect([c!.cx, c!.cy]).toEqual([0, 0]);
  });
  it("wrapCentred keeps a position within [-extent/2, extent/2)", () => {
    expect(wrapCentred(2600, 5000)).toBe(-2400);
    expect(wrapCentred(-2600, 5000)).toBe(2400);
    expect(wrapCentred(100, 5000)).toBe(100);
  });
});
