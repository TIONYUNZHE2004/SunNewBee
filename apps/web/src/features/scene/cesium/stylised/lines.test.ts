import { describe, expect, it } from "vitest";
import { dashSegments, offsetLine } from "./lines";

const M = 111_320;

describe("offsetLine", () => {
  it("moves an eastward line north for a positive (left) offset", () => {
    const out = offsetLine(
      [
        [101.5, 3.18],
        [101.51, 3.18],
      ],
      5,
    );
    expect(out).toHaveLength(2);
    for (const [, lat] of out) expect((lat - 3.18) * M).toBeCloseTo(5, 1);
  });
  it("keeps a corner joined (miter) without exploding on sharp turns", () => {
    const out = offsetLine(
      [
        [101.5, 3.18],
        [101.501, 3.18],
        [101.5, 3.1801],
      ],
      3,
    );
    expect(out).toHaveLength(3);
    for (const [lon, lat] of out) {
      expect(Math.abs(lon - 101.5) * M).toBeLessThan(200);
      expect(Math.abs(lat - 3.18) * M).toBeLessThan(200);
    }
  });
});

describe("offsetLine edge cases", () => {
  const E: [number, number][] = [
    [101.5, 3.18],
    [101.505, 3.18],
    [101.51, 3.18],
  ];
  it("a duplicated middle vertex gives the same offsets as without it", () => {
    const withDup = offsetLine([E[0]!, E[1]!, E[1]!, E[2]!], 4);
    const without = offsetLine(E, 4);
    expect(withDup).toEqual(without);
    for (const [, lat] of withDup) expect((lat - 3.18) * M).toBeCloseTo(4, 1);
  });
  it("a negative offset moves an eastward line south", () => {
    for (const [, lat] of offsetLine(E, -5)) expect((lat - 3.18) * M).toBeCloseTo(-5, 1);
  });
  it("a degenerate start does not collapse the offset", () => {
    const out = offsetLine([E[0]!, E[0]!, E[2]!], 5);
    expect((out[0]![1] - 3.18) * M).toBeCloseTo(5, 1);
  });
  it("pins the miter factor on a 90 degree turn (about m * sqrt 2 from the vertex)", () => {
    const k = M * Math.cos((3.18 * Math.PI) / 180);
    const corner: [number, number] = [101.5 + 100 / k, 3.18];
    const out = offsetLine([[101.5, 3.18], corner, [corner[0], 3.18 + 100 / M]], 10);
    const d = Math.hypot((out[1]![0] - corner[0]) * k, (out[1]![1] - corner[1]) * M);
    expect(d).toBeGreaterThan(10 * Math.SQRT2 * 0.95);
    expect(d).toBeLessThan(10 * Math.SQRT2 * 1.05);
  });
});

describe("dashSegments across vertices", () => {
  const k = M * Math.cos((3.18 * Math.PI) / 180);
  const len = (d: [number, number][]) => {
    let t = 0;
    for (let i = 1; i < d.length; i++)
      t += Math.hypot((d[i]![0] - d[i - 1]![0]) * k, (d[i]![1] - d[i - 1]![1]) * M);
    return t;
  };
  const pt = (m: number): [number, number] => [101.5 + m / k, 3.18];
  it("keeps every dash 3 m long, including the one spanning the 10 m vertex", () => {
    const d = dashSegments([pt(0), pt(10), pt(20)], 3, 6);
    expect(d.length).toBe(2); // [0,3] and [9,12]
    for (const dash of d) expect(len(dash)).toBeCloseTo(3, 1);
    expect(d[1]!.length).toBe(3); // includes the vertex
  });
  it("ignores zero-length segments", () => {
    const d = dashSegments([pt(0), pt(10), pt(10), pt(20)], 3, 6);
    expect(d.length).toBe(2);
    for (const dash of d) expect(len(dash)).toBeCloseTo(3, 1);
  });
  it("returns [] for one point or a line shorter than a dash", () => {
    expect(dashSegments([pt(0)], 3, 6)).toEqual([]);
    expect(dashSegments([pt(0), pt(2)], 3, 6)).toEqual([]);
  });
});

describe("dashSegments", () => {
  it("cuts a 90 m line into 3 m dashes every 9 m", () => {
    const k = M * Math.cos((3.18 * Math.PI) / 180);
    const line: [number, number][] = [
      [101.5, 3.18],
      [101.5 + 90 / k, 3.18],
    ];
    const d = dashSegments(line, 3, 6);
    expect(d.length).toBe(10);
    const [a, b] = d[0]!;
    const len = Math.hypot((b![0] - a![0]) * k, (b![1] - a![1]) * M);
    expect(len).toBeCloseTo(3, 1);
  });
});
