import { describe, expect, it } from "vitest";
import { NEUTRAL_COLOURS } from "../fallbackStyle";
import {
  CORNER_INSET_M,
  type FacadeSpec,
  facadeFor,
  facadeInstances,
  storeysFor,
  TOP_CLEAR_M,
  WALL_OFFSET_M,
} from "./facadePlan";

const spec = (over: Partial<FacadeSpec> = {}): FacadeSpec => ({
  buildingId: "b1",
  storeys: 3,
  windowStyle: 0,
  bayM: 3.0,
  groundFloor: "plain",
  palette: NEUTRAL_COLOURS,
  ...over,
});

/** A w x d rectangle in the local (x, z) frame, counter-clockwise from above (north = -z). */
const rect = (w: number, d: number, x0 = 0, z0 = 0): Array<[number, number]> => [
  [x0, z0],
  [x0 + w, z0],
  [x0 + w, z0 - d],
  [x0, z0 - d],
];

const UNIT: Array<[number, number]> = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

/** The four corners (x, y, z) of each unit quad (+-0.5 in x and y, z = 0) under each mat4. */
function corners(mats: Float32Array): number[][][] {
  const out: number[][][] = [];
  for (let o = 0; o < mats.length; o += 16) {
    const e = mats.subarray(o, o + 16);
    out.push(
      UNIT.map(([u, v]) => [
        e[0]! * u + e[4]! * v + e[12]!,
        e[1]! * u + e[5]! * v + e[13]!,
        e[2]! * u + e[6]! * v + e[14]!,
      ]),
    );
  }
  return out;
}

/** Distance of point p from the infinite vertical plane through wall edge a->b. */
function planeDist(p: number[], a: [number, number], b: [number, number]): number {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = -(b[1] - a[1]) / len;
  const nz = (b[0] - a[0]) / len;
  return Math.abs((p[0]! - a[0]) * nx + (p[2]! - a[1]) * nz);
}

describe("storeysFor / facadeFor storeys", () => {
  it("gives a 9.6 m building exactly 3 storeys", () => {
    expect(storeysFor(9.6)).toBe(3);
    expect(facadeFor({ id: "a", heightM: 9.6 }, null).storeys).toBe(3);
  });
  it("gives a 3.0 m building 1 storey", () => {
    expect(storeysFor(3.0)).toBe(1);
    expect(facadeFor({ id: "a", heightM: 3.0 }, null).storeys).toBe(1);
  });
  it("never gives fewer than one storey", () => {
    expect(storeysFor(0.5)).toBe(1);
    expect(storeysFor(Number.NaN)).toBe(1);
  });
});

describe("facadeFor", () => {
  it("keeps bayM within 3.0-4.5 m and a valid style for every kind", () => {
    for (const kind of [
      "residential",
      "commercial",
      "office",
      "industrial",
      "civic",
      "x",
      undefined,
    ])
      for (let i = 0; i < 50; i++) {
        const s = facadeFor({ id: `w/${i}`, heightM: 3 + i, kind }, null);
        expect(s.bayM).toBeGreaterThanOrEqual(3.0);
        expect(s.bayM).toBeLessThanOrEqual(4.5);
        expect([0, 1, 2, 3]).toContain(s.windowStyle);
        expect(["shop", "plain", "garage"]).toContain(s.groundFloor);
      }
  });
  it("is deterministic per id", () => {
    const b = { id: "way/123", heightM: 12.4, kind: "commercial", archetype: "shop_office" };
    expect(facadeFor(b, null)).toEqual(facadeFor({ ...b }, null));
    const many = new Set(
      Array.from({ length: 40 }, (_, i) => {
        const s = facadeFor({ id: `way/${i}`, heightM: 9 }, null);
        return `${s.windowStyle}:${s.bayM.toFixed(3)}:${s.groundFloor}`;
      }),
    );
    expect(many.size).toBeGreaterThan(1);
  });
  it("gives shop_office a shop ground floor", () => {
    expect(facadeFor({ id: "s", heightM: 9.6, archetype: "shop_office" }, null).groundFloor).toBe(
      "shop",
    );
  });
  it("uses the neutral palette without a manifest", () => {
    expect(facadeFor({ id: "n", heightM: 6 }, null).palette).toEqual(NEUTRAL_COLOURS);
  });
});

describe("facadeInstances", () => {
  it("keeps every window between minHeightM + 0.3 and heightM - 0.5", () => {
    const cases: Array<[number, number]> = [
      [9.6, 0],
      [3.0, 0],
      [4.9, 0],
      [31.7, 0],
      [12, 8.7],
      [2.2, 0],
      [60, 3],
    ];
    let seen = 0;
    for (const [h, minH] of cases) {
      for (const windowStyle of [0, 1, 2, 3] as const) {
        const s = spec({ storeys: storeysFor(h), windowStyle, groundFloor: "shop" });
        const out = facadeInstances(rect(20, 12), h, minH, s);
        for (const q of [...corners(out.windows), ...corners(out.shopfronts)])
          for (const p of q) {
            seen++;
            expect(p[1]!).toBeLessThanOrEqual(h - TOP_CLEAR_M + 1e-5);
            expect(p[1]!).toBeGreaterThanOrEqual(minH + 0.3 - 1e-5);
          }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("keeps quads within 0.06 m of their wall plane, 0.05 m out, inside the corner insets", () => {
    const ring = rect(14, 9, 5, -3);
    const out = facadeInstances(ring, 12.8, 0, spec({ storeys: 4, groundFloor: "shop" }));
    const all = [...corners(out.windows), ...corners(out.shopfronts)];
    expect(all.length).toBeGreaterThan(0);
    for (const q of all) {
      let best = Number.POSITIVE_INFINITY;
      let edge = -1;
      for (let i = 0; i < ring.length; i++) {
        const d = Math.max(...q.map((p) => planeDist(p, ring[i]!, ring[(i + 1) % ring.length]!)));
        if (d < best) {
          best = d;
          edge = i;
        }
      }
      expect(best).toBeLessThanOrEqual(0.06);
      expect(best).toBeGreaterThanOrEqual(WALL_OFFSET_M - 1e-4);
      const a = ring[edge]!;
      const b = ring[(edge + 1) % ring.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (const p of q) {
        const t = ((p[0]! - a[0]) * (b[0] - a[0]) + (p[2]! - a[1]) * (b[1] - a[1])) / len;
        expect(t).toBeGreaterThanOrEqual(CORNER_INSET_M - 1e-4);
        expect(t).toBeLessThanOrEqual(len - CORNER_INSET_M + 1e-4);
      }
    }
  });

  it("puts quads outside the footprint whichever way the ring winds", () => {
    const cw = [...rect(10, 10)].reverse();
    for (const ring of [rect(10, 10), cw]) {
      const out = facadeInstances(ring, 6.4, 0, spec({ storeys: 2 }));
      expect(out.count).toBeGreaterThan(0);
      for (let o = 0; o < out.windows.length; o += 16) {
        const x = out.windows[o + 12]!;
        const z = out.windows[o + 14]!;
        const inside = x > 0 && x < 10 && z < 0 && z > -10;
        expect(inside).toBe(false);
      }
    }
  });

  it("gives a 6 m wall floor((6 - 1.2)/bayM) windows per storey", () => {
    for (const bayM of [3.0, 3.5, 4.5, 2.0, 1.5]) {
      // Two 6 m walls; the 1 m ends are too short for any window.
      const ring: Array<[number, number]> = [
        [0, 0],
        [6, 0],
        [6, -1],
        [0, -1],
      ];
      const storeys = 3;
      const out = facadeInstances(ring, 9.6, 0, spec({ storeys, bayM, groundFloor: "plain" }));
      const perStorey = Math.floor((6 - 1.2) / bayM);
      expect(out.count).toBe(perStorey * storeys * 2);
      expect(out.windows.length).toBe(out.count * 16);
    }
  });

  it("replaces ground-floor windows with shopfronts on a shop ground floor", () => {
    const plain = facadeInstances(rect(20, 12), 9.6, 0, spec({ groundFloor: "plain" }));
    const shop = facadeInstances(rect(20, 12), 9.6, 0, spec({ groundFloor: "shop" }));
    const garage = facadeInstances(rect(20, 12), 9.6, 0, spec({ groundFloor: "garage" }));
    expect(plain.shopfronts.length).toBe(0);
    expect(shop.shopfronts.length).toBeGreaterThan(0);
    expect(shop.count).toBe((plain.count * 2) / 3);
    expect(garage.count).toBe((plain.count * 2) / 3);
    expect(garage.shopfronts.length).toBe(0);
  });

  it("gives no shopfronts to a raised part (minHeightM above grade)", () => {
    const out = facadeInstances(rect(20, 12), 20, 8, spec({ storeys: 6, groundFloor: "shop" }));
    expect(out.shopfronts.length).toBe(0);
    expect(out.count).toBeGreaterThan(0);
  });

  it("is deterministic and tolerates a closed ring and bad input", () => {
    const r = rect(18, 11);
    const a = facadeInstances(r, 15, 0, spec({ storeys: 5 }));
    const b = facadeInstances([...r, r[0]!], 15, 0, spec({ storeys: 5 }));
    const c = facadeInstances(rect(18, 11), 15, 0, spec({ storeys: 5 }));
    expect(Array.from(b.windows)).toEqual(Array.from(a.windows));
    expect(Array.from(c.windows)).toEqual(Array.from(a.windows));
    expect(facadeInstances([], 10, 0, spec()).count).toBe(0);
    expect(facadeInstances(r, 0.5, 0, spec()).count).toBe(0);
    const bad: Array<[number, number]> = [
      [0, 0],
      [Number.NaN, 1],
      [2, 2],
    ];
    expect(facadeInstances(bad, 10, 0, spec()).count).toBe(0);
  });

  it("never draws more storeys of windows than the height allows", () => {
    // The spec says 10 storeys but the wall is 6.4 m: at most 2 rows.
    const out = facadeInstances(rect(10, 10), 6.4, 0, spec({ storeys: 10, bayM: 3.0 }));
    const rows = new Set<number>();
    for (let o = 0; o < out.windows.length; o += 16)
      rows.add(Math.round(out.windows[o + 13]! * 100));
    expect(rows.size).toBeGreaterThan(0);
    expect(rows.size).toBeLessThanOrEqual(2);
  });
});
