import { describe, expect, it } from "vitest";
import { roofClutter } from "./roofs";

const b = (id: string, sizeM: number, floors = 4) => {
  const d = sizeM / 111_320;
  return {
    id,
    ring: [
      [101.5, 3.18],
      [101.5 + d, 3.18],
      [101.5 + d, 3.18 + d],
      [101.5, 3.18 + d],
      [101.5, 3.18],
    ] as [number, number][],
    height: floors * 3.2 + 1,
    minHeight: 0,
    kind: "residential",
    tone: "t0" as const,
    style: "grid" as const,
    floors,
    perimeterM: sizeM * 4,
    cols: 8,
    litSeed: 0.3,
  };
};

describe("roofClutter", () => {
  it("only on roofs above the area threshold, sitting on the roof, deterministic", () => {
    const items = roofClutter([b("small", 10), b("big", 40)], "s");
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(it.z).toBeCloseTo(4 * 3.2 + 1, 5);
    expect(roofClutter([b("small", 10), b("big", 40)], "s")).toEqual(items);
    expect(roofClutter([b("small", 10)], "s")).toEqual([]);
  });
  it("respects the cap", () => {
    const many = Array.from({ length: 500 }, (_, i) => b(`b${i}`, 40));
    expect(roofClutter(many, "s", { max: 100 }).length).toBe(100);
  });
  it("keeps items inside the roof outline", () => {
    for (const it of roofClutter([b("big", 40)], "s")) {
      expect(it.lon).toBeGreaterThan(101.5);
      expect(it.lon).toBeLessThan(101.5 + 40 / 111_320);
    }
  });
});
