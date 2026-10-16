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
