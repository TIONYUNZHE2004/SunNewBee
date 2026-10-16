import { describe, expect, it } from "vitest";
import { frustumXOffset, panelWidthPx, visibleViewport } from "./viewport";

describe("viewport", () => {
  it("panel width is clamp(360, 30vw, 440)", () => {
    expect(panelWidthPx(1000)).toBe(360);
    expect(panelWidthPx(1300)).toBe(390);
    expect(panelWidthPx(2000)).toBe(440);
  });
  it("visible map area excludes the open panel and its inset", () => {
    expect(visibleViewport(1440, 432, true)).toEqual({
      left: 0,
      right: 1440 - 432 - 32,
      centerX: (1440 - 432 - 32) / 2,
    });
    expect(visibleViewport(1440, 432, false)).toEqual({ left: 0, right: 1440, centerX: 720 });
  });
  it("frustum offset is zero with no shift and scales with the shift", () => {
    expect(frustumXOffset(0, 1440, 1, Math.PI / 3, 900)).toBe(0);
    const a = frustumXOffset(100, 1440, 1, Math.PI / 3, 900);
    const b = frustumXOffset(200, 1440, 1, Math.PI / 3, 900);
    expect(b).toBeCloseTo(a * 2);
  });
});
