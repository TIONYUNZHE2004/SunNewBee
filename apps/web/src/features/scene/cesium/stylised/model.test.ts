import { describe, expect, it } from "vitest";
import { classKey, groupByClass, hashUnit, toBuildings } from "./model";

const sq = (x: number, y: number, d = 0.0003) => [
  [
    [x, y],
    [x + d, y],
    [x + d, y + d],
    [x, y + d],
    [x, y],
  ],
];
const f = (id: string, coords: unknown, props: Record<string, unknown> = {}) => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: coords },
  properties: { id, ...props },
});

describe("toBuildings", () => {
  it("parses height, floors, perimeter and is deterministic", () => {
    const fc = { features: [f("b1", sq(101.5, 3.18), { height_m: 12.8 })] };
    const a = toBuildings(fc).buildings[0]!;
    const b = toBuildings(fc).buildings[0]!;
    expect(a).toEqual(b);
    expect(a.height).toBe(12.8);
    expect(a.floors).toBe(4);
    expect(a.perimeterM).toBeGreaterThan(100);
    expect(a.cols).toBeGreaterThanOrEqual(4);
  });
  it("skips and counts invalid features instead of throwing", () => {
    const fc = {
      features: [
        f("p", [
          [
            [101.5, 3.18],
            [101.5, 3.18],
            [101.5, 3.18],
          ],
        ]),
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [101.5, 3.18] },
          properties: { id: "pt" },
        },
        f("nan", [
          [
            [Number.NaN, 3.18],
            [101.5, 3.18],
            [101.5, 3.19],
            [Number.NaN, 3.18],
          ],
        ]),
        f("ok", sq(101.5, 3.18)),
        null,
      ],
    };
    const r = toBuildings(fc as never);
    expect(r.buildings.map((b) => b.id)).toEqual(["ok"]);
    expect(r.skipped).toBe(4);
    expect(toBuildings(null).buildings).toEqual([]);
  });
  it("defaults a missing/invalid height and clamps minHeight below height", () => {
    const r = toBuildings({
      features: [
        f("a", sq(101.5, 3.18)),
        f("b", sq(101.5, 3.18), { height_m: -3, min_height_m: 99 }),
      ],
    });
    expect(r.buildings[0]!.height).toBe(9);
    expect(r.buildings[1]!.height).toBe(9);
    expect(r.buildings[1]!.minHeight).toBeLessThan(r.buildings[1]!.height);
  });
});

describe("grouping and hashing", () => {
  it("hashUnit is stable, in [0,1) and salt-sensitive", () => {
    expect(hashUnit("x")).toBe(hashUnit("x"));
    expect(hashUnit("x", "a")).not.toBe(hashUnit("x", "b"));
    for (const id of ["a", "b", "c", "building-123"]) {
      const u = hashUnit(id);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
  it("classKey bins up and groupByClass keeps every building once", () => {
    const bs = toBuildings({
      features: [
        f("a", sq(101.5, 3.18), { height_m: 6 }),
        f("b", sq(101.51, 3.18), { height_m: 40 }),
      ],
    }).buildings;
    const g = groupByClass(bs);
    expect([...g.values()].flat().length).toBe(2);
    expect(classKey(bs[0]!)).not.toBe(classKey(bs[1]!));
  });
});
