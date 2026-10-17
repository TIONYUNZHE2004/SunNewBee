import { describe, expect, it } from "vitest";
import { createFrame } from "./frame";
import { lineToLocal, ROUTE_LIFT_M } from "./routeLine";

const frame = createFrame([101.5, 3.0]);

describe("lineToLocal", () => {
  it("emits xyz triplets lifted by ROUTE_LIFT_M", () => {
    const out = lineToLocal(
      [
        [101.5, 3.0],
        [101.501, 3.0],
        [101.502, 3.001],
      ],
      frame,
    );
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(9);
    for (const i of [1, 4, 7]) expect(out[i]).toBeCloseTo(ROUTE_LIFT_M, 6);
  });

  it("drops non-finite points", () => {
    const out = lineToLocal(
      [
        [101.5, 3.0],
        [Number.NaN, 3.0],
        [101.502, 3.0],
      ],
      frame,
    );
    expect(out.length).toBe(6);
  });

  it("returns empty for fewer than two points", () => {
    expect(lineToLocal([[101.5, 3.0]], frame).length).toBe(0);
  });
});
