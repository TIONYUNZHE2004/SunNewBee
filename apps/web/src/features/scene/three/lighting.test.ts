import { describe, expect, it } from "vitest";
import {
  AO_PARAMS,
  BLOOM,
  blendPresets,
  ENV_IRRADIANCE,
  fitShadowCamera,
  hexLuminance,
  keyLightDir,
  LIGHT_LIMITS,
  LIGHT_PRESETS,
  type LightPreset,
  litLight,
  SHADOW,
  shadeLight,
  shadowFrame,
} from "./lighting";
import { CLAY_MIN_LUMINANCE, CLAY_PALETTE } from "./shared/clayTokens";

const THEMES = ["day", "dusk", "night"] as const;
const rad = (d: number) => (d * Math.PI) / 180;

describe("LIGHT_PRESETS", () => {
  it("orders sun intensity night < dusk < day", () => {
    expect(LIGHT_PRESETS.night.sunIntensity).toBeLessThan(LIGHT_PRESETS.dusk.sunIntensity);
    expect(LIGHT_PRESETS.dusk.sunIntensity).toBeLessThan(LIGHT_PRESETS.day.sunIntensity);
  });
  // Haze regression (final fix A): at noon the real sun is near the zenith and a pale lit surface
  // reaches ~1.4 linear luminance (sun 3/pi + hemi 0.5/pi + IBL 0.35), far over the 0.85 bloom
  // threshold, so the whole day scene bloomed into a cream wash. Morning checks (sun ~20 degrees)
  // never saw it. Bloom is for lit windows and lamps: it is off by day.
  it("blooms only where a sunlit white surface stays under the threshold (no day wash at noon)", () => {
    const maxElevationDeg = { day: 90, dusk: 8, night: 40 } as const;
    for (const theme of THEMES) {
      const p = LIGHT_PRESETS[theme];
      // A white Lambert face turned to the key light (colour-weighted lights); the room IBL is
      // taken at its upper bound 1, not the calibrated ENV_IRRADIANCE.
      const white =
        p.exposure *
        (litLight(p, rad(maxElevationDeg[theme])) + p.envIntensity * (1 - ENV_IRRADIANCE));
      if (p.bloom > 0) expect(white, theme).toBeLessThan(BLOOM.threshold);
    }
    expect(LIGHT_PRESETS.day.bloom).toBe(0);
    expect(LIGHT_PRESETS.dusk.bloom).toBeGreaterThan(0);
    expect(LIGHT_PRESETS.night.bloom).toBeGreaterThan(0);
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
  it("keeps the ambient light under the bloom threshold for every blend with bloom on", () => {
    for (const a of THEMES)
      for (const b of THEMES)
        for (const k of [0.25, 0.5, 0.75]) {
          const p = blendPresets(LIGHT_PRESETS[a], LIGHT_PRESETS[b], k);
          if (p.bloom > 0)
            expect(p.exposure * shadeLight(p, 1), `${a}-${b} ${k}`).toBeLessThan(BLOOM.threshold);
        }
  });
  it("fades bloom in continuously from day to night", () => {
    const p = blendPresets(LIGHT_PRESETS.day, LIGHT_PRESETS.night, 0.5);
    expect(p.bloom).toBeCloseTo(LIGHT_PRESETS.night.bloom / 2, 6);
  });
});

describe("B-T4 light model (AC-A9 / AC-B6 arithmetic; the GPU check is acceptance -g AC-B6)", () => {
  it("ties the darkest albedo to the clay floor and the road albedo to the major-road token", () => {
    expect(LIGHT_LIMITS.darkAlbedo).toBe(CLAY_MIN_LUMINANCE);
    expect(LIGHT_LIMITS.roadAlbedo).toBeCloseTo(hexLuminance(CLAY_PALETTE.road.major), 6);
    expect(CLAY_MIN_LUMINANCE).toBeGreaterThanOrEqual(0.15);
  });
  it("keeps the darkest albedo off near-black on a shade-side wall and roof in every mood", () => {
    const { darkAlbedo, aoKeep, minLuma } = LIGHT_LIMITS;
    for (const theme of THEMES) {
      const p = LIGHT_PRESETS[theme];
      for (const skyWeight of [0.5, 0.85])
        expect(
          p.exposure * darkAlbedo * aoKeep * shadeLight(p, skyWeight),
          `${theme} ${skyWeight}`,
        ).toBeGreaterThanOrEqual(minLuma);
    }
  });
  it("keeps graded asphalt in shade off near-black in every mood", () => {
    const { roadAlbedo, minLuma } = LIGHT_LIMITS;
    for (const theme of THEMES) {
      const p = LIGHT_PRESETS[theme];
      expect(
        p.exposure * roadAlbedo * p.roadGrade * shadeLight(p, 1),
        theme,
      ).toBeGreaterThanOrEqual(minLuma);
    }
  });
  it("keeps the darkest land cover in shade off near-black under the night grade", () => {
    const p = LIGHT_PRESETS.night;
    const forest = hexLuminance(CLAY_PALETTE.landcover.forest);
    expect(p.exposure * forest * p.groundGrade * shadeLight(p, 1)).toBeGreaterThanOrEqual(
      LIGHT_LIMITS.minLuma,
    );
  });
  it("keeps a white face lit from the zenith under clipped white by day (no cream wash)", () => {
    const p = LIGHT_PRESETS.day;
    expect(p.exposure * litLight(p, rad(90))).toBeLessThan(LIGHT_LIMITS.maxDayWhite);
  });
  it("lifts the day shade side to at least 40% of the sunlit side; sunlit faces barely change", () => {
    const p = LIGHT_PRESETS.day;
    const phaseA: LightPreset = {
      ...p,
      sunIntensity: 3,
      hemiSky: "#bfe0ff",
      hemiGround: "#8a7a5a",
      hemiIntensity: 0.5,
      envIntensity: 0.35,
    };
    const ratio = (q: LightPreset) => shadeLight(q, 0.5) / litLight(q, rad(60), 0.5);
    expect(ratio(p)).toBeGreaterThanOrEqual(0.4);
    expect(ratio(phaseA)).toBeLessThan(0.3);
    expect(litLight(p, rad(60)) / litLight(phaseA, rad(60))).toBeLessThan(1.25);
    expect(shadeLight(p, 0.5) / shadeLight(phaseA, 0.5)).toBeGreaterThan(1.8);
  });
  it("keeps the night ground well under 35% of the day ground (AC-A14)", () => {
    const ground = (p: LightPreset, el: number) =>
      p.exposure * p.groundGrade * litLight(p, rad(el));
    // A low morning sun is the hardest day case for the ratio.
    expect(ground(LIGHT_PRESETS.night, 40) / ground(LIGHT_PRESETS.day, 30)).toBeLessThan(0.3);
  });
  it("lifts the night fog and horizon off near-black, still a dark violet", () => {
    for (const c of [LIGHT_PRESETS.night.fog.color, LIGHT_PRESETS.night.background]) {
      expect(hexLuminance(c)).toBeGreaterThanOrEqual(0.03);
      expect(hexLuminance(c)).toBeLessThan(0.06);
    }
  });
  it("grades roads less than land cover at night and not at all by day", () => {
    expect(LIGHT_PRESETS.day.roadGrade).toBe(1);
    expect(LIGHT_PRESETS.night.roadGrade).toBeGreaterThan(LIGHT_PRESETS.night.groundGrade);
    expect(blendPresets(LIGHT_PRESETS.day, LIGHT_PRESETS.night, 0.5).roadGrade).toBeCloseTo(
      (LIGHT_PRESETS.day.roadGrade + LIGHT_PRESETS.night.roadGrade) / 2,
      6,
    );
  });
});

describe("shadowFrame (B-T4, after the prototype aimSun)", () => {
  it("is 70 m half size near the camera (street) and follows the range", () => {
    expect(SHADOW.minHalfM).toBe(70);
    expect(shadowFrame(30, 4096).halfSize).toBe(70);
    expect(shadowFrame(800, 4096).halfSize).toBeCloseTo(800 * SHADOW.rangeK, 6);
    expect(shadowFrame(1500, 4096).halfSize).toBeGreaterThan(shadowFrame(800, 4096).halfSize);
  });
  it("keeps full shadows to the fade start and none past the fade end (whole slab far out)", () => {
    expect(shadowFrame(30, 4096).strength).toBe(1);
    expect(shadowFrame(SHADOW.fadeStartM, 4096).strength).toBe(1);
    expect(shadowFrame(SHADOW.fadeEndM, 4096).strength).toBe(0);
    expect(shadowFrame(7000, 4096).strength).toBe(0);
    let last = 1;
    for (let r = SHADOW.fadeStartM; r <= SHADOW.fadeEndM; r += 100) {
      const s = shadowFrame(r, 4096).strength;
      expect(s).toBeLessThanOrEqual(last);
      last = s;
    }
  });
  it("keeps texels sharp where shadows show and scales the normal bias with the texel", () => {
    const near = shadowFrame(30, 4096);
    const mid = shadowFrame(800, 4096);
    expect((2 * near.halfSize) / 4096).toBeLessThan(0.05);
    expect((2 * mid.halfSize) / 4096).toBeLessThan(0.5);
    expect(mid.normalBias / near.normalBias).toBeCloseTo(mid.halfSize / near.halfSize, 6);
    expect(shadowFrame(800, 2048).normalBias).toBeCloseTo(2 * mid.normalBias, 6);
    expect(SHADOW.radius).toBeGreaterThan(1);
  });
  it("places the light along the key direction over the focus with the frame half size", () => {
    const d = keyLightDir("day", new Date("2026-03-20T05:21:00Z"), 3.1813, 101.5099);
    const c = fitShadowCamera([5, 7], shadowFrame(30, 4096).halfSize, d);
    expect(c.target).toEqual([5, 0, 7]);
    expect(c.halfSize).toBe(70);
  });
});

describe("AO_PARAMS (B-T4 GTAO tuning)", () => {
  it("widens the radius past the 0.25 m default and blends below full so AO never blackens", () => {
    expect(AO_PARAMS.radius).toBeGreaterThan(0.25);
    expect(AO_PARAMS.blendIntensity).toBeGreaterThan(0);
    expect(AO_PARAMS.blendIntensity).toBeLessThan(1);
  });
});
