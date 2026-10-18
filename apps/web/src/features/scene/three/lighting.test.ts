import { describe, expect, it } from "vitest";
import { blendPresets, fitShadowCamera, keyLightDir, LIGHT_PRESETS } from "./lighting";

describe("LIGHT_PRESETS", () => {
  it("orders sun intensity night < dusk < day", () => {
    expect(LIGHT_PRESETS.night.sunIntensity).toBeLessThan(LIGHT_PRESETS.dusk.sunIntensity);
    expect(LIGHT_PRESETS.dusk.sunIntensity).toBeLessThan(LIGHT_PRESETS.day.sunIntensity);
  });
  it("keeps ambient (hemi + IBL) low so lit surfaces stay under the bloom threshold", () => {
    for (const p of Object.values(LIGHT_PRESETS))
      expect(p.hemiIntensity + p.envIntensity).toBeLessThanOrEqual(1);
  });
  it("lights windows only at dusk and night", () => {
    expect(LIGHT_PRESETS.day.windowEmissive).toBe(0);
    expect(LIGHT_PRESETS.dusk.windowEmissive).toBeGreaterThan(0);
    expect(LIGHT_PRESETS.night.windowEmissive).toBeGreaterThan(LIGHT_PRESETS.dusk.windowEmissive);
  });
});

describe("keyLightDir", () => {
  it("clamps the day sun to at least 10 degrees elevation", () => {
    const d = keyLightDir("day", new Date("2026-03-19T19:00:00Z"), 3.1813, 101.5099); // 03:00 MYT
    expect(d[1]).toBeGreaterThanOrEqual(Math.sin((10 * Math.PI) / 180) - 1e-9);
    expect(Math.hypot(...d)).toBeCloseTo(1, 6);
  });
  it("places dusk low in the west and the night moon in the east", () => {
    const now = new Date("2026-03-20T10:00:00Z");
    const dusk = keyLightDir("dusk", now, 3.18, 101.5);
    const night = keyLightDir("night", now, 3.18, 101.5);
    expect(dusk[0]).toBeLessThan(0);
    expect(night[0]).toBeGreaterThan(0);
  });
});

describe("fitShadowCamera", () => {
  it("targets the focus on the ground and sits along dir", () => {
    const d = keyLightDir("day", new Date("2026-03-20T05:21:00Z"), 3.1813, 101.5099);
    const c = fitShadowCamera([100, -50], 400, d);
    expect(c.target).toEqual([100, 0, -50]);
    const v = c.position.map((p, i) => p - (c.target[i] as number));
    const len = Math.hypot(...v);
    for (const [i, x] of v.entries()) expect(x / len).toBeCloseTo(d[i] as number, 6);
    expect(c.halfSize).toBeGreaterThanOrEqual(400);
    expect(c.far).toBeGreaterThan(c.near);
  });
});

describe("blendPresets", () => {
  it("keeps hemi + IBL <= 1 for every pair at 0.25, 0.5 and 0.75", () => {
    const all = Object.values(LIGHT_PRESETS);
    for (const a of all)
      for (const b of all)
        for (const k of [0.25, 0.5, 0.75]) {
          const p = blendPresets(a, b, k);
          expect(p.hemiIntensity + p.envIntensity).toBeLessThanOrEqual(1);
        }
  });
});
