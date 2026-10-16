import { describe, expect, it } from "vitest";
import { deltaE, hexToRgb, mixHex, rgbToHex } from "./colour";

describe("colour", () => {
  it("round-trips hex", () => {
    expect(rgbToHex(hexToRgb("#5b45a0"))).toBe("#5b45a0");
  });
  it("mixes linearly in sRGB", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#123456", "#abcdef", 0)).toBe("#123456");
    expect(mixHex("#123456", "#abcdef", 1)).toBe("#abcdef");
  });
  it("deltaE is 0 for equal colours and large for black vs white", () => {
    expect(deltaE("#336699", "#336699")).toBeCloseTo(0);
    expect(deltaE("#000000", "#ffffff")).toBeGreaterThan(99);
  });
});
