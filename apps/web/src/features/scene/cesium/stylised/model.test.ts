import { describe, expect, it } from "vitest";
import {
  type Building,
  classKey,
  groupByClass,
  hashUnit,
  scatterTrees,
  toBuildings,
  treesToPoints,
} from "./model";

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
  it("hashUnit spreads sequential keys over [0,1) (only the last character differs)", () => {
    const us = Array.from({ length: 200 }, (_, n) => hashUnit(`elmina:street:${n}`, "car"));
    const below = (x: number) => us.filter((u) => u < x).length / us.length;
    expect(below(0.25)).toBeGreaterThan(0.15);
    expect(below(0.25)).toBeLessThan(0.35);
    expect(below(0.5)).toBeGreaterThan(0.4);
    expect(below(0.5)).toBeLessThan(0.6);
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

const park: [number, number][] = [
  [101.5, 3.18],
  [101.502, 3.18],
  [101.502, 3.182],
  [101.5, 3.182],
  [101.5, 3.18],
];
const inside = (x: number, y: number, ring: [number, number][]) => {
  let r = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
};

describe("scatterTrees", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = scatterTrees([park], "s", 50);
    expect(a.length).toBeGreaterThan(0);
    expect(scatterTrees([park], "s", 50)).toEqual(a);
    expect(scatterTrees([park], "t", 50)).not.toEqual(a);
  });
  it("keeps every point inside the ring, within the density cap, heights 4..8", () => {
    const L = [
      [101.5, 3.18],
      [101.503, 3.18],
      [101.503, 3.181],
      [101.501, 3.181],
      [101.501, 3.183],
      [101.5, 3.183],
      [101.5, 3.18],
    ] as [number, number][];
    const pts = scatterTrees([L], "s", 80);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(inside(p.lon, p.lat, L)).toBe(true);
      expect(p.h).toBeGreaterThanOrEqual(4);
      expect(p.h).toBeLessThan(8);
    }
    // the bounding box area is an upper bound on the L-shaped ring's area
    const kx = 111_320 * Math.cos((3.18 * Math.PI) / 180);
    const bboxHa = (0.003 * kx * 0.003 * 111_320) / 10_000;
    expect(pts.length).toBeLessThanOrEqual(Math.floor(bboxHa * 80));
  });
  it("places nothing for degenerate rings, non-finite coords or zero density", () => {
    expect(scatterTrees([[[101.5, 3.18]]], "s", 50)).toEqual([]);
    const collinear: [number, number][] = [
      [101.5, 3.18],
      [101.5001, 3.18],
      [101.5002, 3.18],
    ];
    expect(scatterTrees([collinear], "s", 50)).toEqual([]);
    const nan: [number, number][] = [
      [Number.NaN, 3.18],
      [101.5, 3.18],
      [101.5, 3.19],
    ];
    expect(scatterTrees([nan], "s", 50)).toEqual([]);
    expect(scatterTrees([park], "s", 0)).toEqual([]);
  });
});

describe("treesToPoints", () => {
  const pt = (id: string, c: unknown, props: Record<string, unknown> = {}) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: c },
    properties: { id, ...props },
  });
  it("drops non-points and non-finite coords", () => {
    const r = treesToPoints({
      features: [
        pt("a", [101.5, 3.18]),
        pt("nan", [Number.NaN, 3.18]),
        pt("inf", [101.5, Number.POSITIVE_INFINITY]),
        pt("str", ["101.5", "3.18"]),
        pt("short", [101.5]),
        { type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: {} },
        null,
      ],
    });
    expect(r.map((t) => t.id)).toEqual(["a"]);
    expect(treesToPoints(undefined)).toEqual([]);
  });
  it("hashes a stable height in [4,8] when height_m is missing, else uses it", () => {
    const fc = {
      features: [
        pt("a", [101.5, 3.18]),
        pt("b", [101.5, 3.18], { height_m: 11 }),
        pt("c", [101.5, 3.18], { height_m: -2 }),
      ],
    };
    const r = treesToPoints(fc);
    expect(treesToPoints(fc)).toEqual(r);
    for (const i of [0, 2]) {
      expect(r[i]!.h).toBeGreaterThanOrEqual(4);
      expect(r[i]!.h).toBeLessThanOrEqual(8);
    }
    expect(r[1]!.h).toBe(11);
  });
});

describe("holes, column bins and tones", () => {
  it("ignores holes: only the outer ring is used", () => {
    const outer = sq(101.5, 3.18)[0]!;
    const hole = [
      [101.50005, 3.18005],
      [101.50015, 3.18005],
      [101.50015, 3.18015],
      [101.50005, 3.18005],
    ];
    const a = toBuildings({ features: [f("h", [outer, hole])] }).buildings[0]!;
    const b = toBuildings({ features: [f("h", [outer])] }).buildings[0]!;
    expect(a.ring).toEqual(outer);
    expect(a.perimeterM).toBe(b.perimeterM);
  });
  it("bins columns up in classKey", () => {
    const mk = (cols: number): Building => ({
      id: "x",
      ring: [],
      height: 9,
      minHeight: 0,
      kind: "building",
      tone: "warm",
      floors: 3,
      perimeterM: cols * 3.5,
      cols,
      litSeed: 0,
    });
    expect(classKey(mk(8))).toBe("3x8");
    expect(classKey(mk(9))).toBe("3x12");
    expect(classKey(mk(33))).toBe("3x48");
    expect(classKey(mk(128))).toBe("3x128");
    expect(classKey(mk(4))).toBe("3x8");
  });
  it("assigns tones deterministically from the id hash thresholds", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `b${i}`);
    const run = () =>
      toBuildings({ features: ids.map((id) => f(id, sq(101.5, 3.18))) }).buildings.map(
        (b) => b.tone,
      );
    const tones = run();
    expect(run()).toEqual(tones);
    ids.forEach((id, i) => {
      const t = hashUnit(id, "tone");
      expect(tones[i]).toBe(t < 0.45 ? "warm" : t < 0.8 ? "cool" : "rose");
    });
    expect(new Set(tones)).toEqual(new Set(["warm", "cool", "rose"]));
  });
});
