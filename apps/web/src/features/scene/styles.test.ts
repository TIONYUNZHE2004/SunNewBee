import { describe, expect, it } from "vitest";
import { CESIUM_DASH, statusStyle } from "./styles";

describe("statusStyle", () => {
  it("never relies on colour alone", () => {
    for (const s of ["ok", "unknown", "blocked", "flooded_likely", "flooded_possible"] as const) {
      expect(statusStyle(s).label.length).toBeGreaterThan(0);
    }
    expect(statusStyle("blocked").dotted).toBe(true);
    expect(statusStyle("ok").dotted).toBeFalsy();
    expect(statusStyle("unknown").dashed).toBe(true);
    expect(statusStyle("flooded_possible").dashed).toBe(true);
  });
});

describe("CESIUM_DASH", () => {
  it("covers every patterned status with a distinct pattern", () => {
    for (const s of ["blocked", "unknown", "flooded_possible"] as const)
      expect(CESIUM_DASH[s]).toBeDefined();
    expect(CESIUM_DASH.ok).toBeUndefined();
    expect(CESIUM_DASH.flooded_likely).toBeUndefined();
    const keys = Object.values(CESIUM_DASH).map((d) => `${d?.dashLength}:${d?.dashPattern}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("blocked is sparser than the dashed statuses", () => {
    const on = (n: number) => n.toString(2).split("1").length - 1;
    expect(on(CESIUM_DASH.blocked?.dashPattern ?? 0)).toBeLessThan(
      on(CESIUM_DASH.flooded_possible?.dashPattern ?? 0),
    );
  });
});
