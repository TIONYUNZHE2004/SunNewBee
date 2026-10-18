import { describe, expect, it } from "vitest";
import { sketchPath } from "./RouteSketch";

describe("sketchPath", () => {
  it("fits the line inside the box with the margin, north up", () => {
    const p = sketchPath(
      [
        [101.5, 3.1],
        [101.501, 3.101],
      ],
      320,
      132,
      14,
    );
    expect(p).not.toBeNull();
    const [sx, sy] = p!.start;
    const [ex, ey] = p!.end;
    for (const v of [sx, ex]) expect(v).toBeGreaterThanOrEqual(14 - 0.1);
    for (const v of [sy, ey]) expect(v).toBeLessThanOrEqual(132 - 14 + 0.1);
    expect(ey).toBeLessThan(sy); // going north draws upward
    expect(ex).toBeGreaterThan(sx);
    expect(p!.d.startsWith("M")).toBe(true);
  });
  it("is null for fewer than two points", () => {
    expect(sketchPath([[101.5, 3.1]], 320, 132)).toBeNull();
  });
  it("handles a straight east-west line without dividing by zero", () => {
    const p = sketchPath(
      [
        [101.5, 3.1],
        [101.51, 3.1],
      ],
      320,
      132,
    );
    expect(p!.d).not.toMatch(/NaN|Infinity/);
  });
});
