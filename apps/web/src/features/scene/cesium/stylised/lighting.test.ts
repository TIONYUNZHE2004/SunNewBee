import { describe, expect, it } from "vitest";
import { CLOUD_GLSL, LIGHTING_GLSL, LIT_COLOR_SOURCE, lightUniforms } from "./lighting";
import { paletteFor } from "./palette";

const C = {
  Color: { fromCssColorString: (css: string) => ({ css }) },
  Cartesian3: class {
    constructor(
      public x = 0,
      public y = 0,
      public z = 0,
    ) {}
  },
};

describe("lighting", () => {
  it("declares tl_light and tl_fog", () => {
    expect(LIGHTING_GLSL).toMatch(/vec3 tl_light\(vec3 normalEC\)/);
    expect(LIGHTING_GLSL).toMatch(/vec3 tl_fog\(vec3 c, vec3 positionToEyeEC\)/);
  });
  it("uniforms carry the palette's key, fill, bounce, horizon and unit vectors", () => {
    const p = paletteFor("dusk");
    const u = lightUniforms(C as never, p, { lon: 101.51, lat: 3.18 }) as Record<string, any>;
    expect(u.keyColor).toEqual({ css: p.light.key });
    expect(u.fillColor).toEqual({ css: p.light.fill });
    expect(u.bounceColor).toEqual({ css: p.light.bounce });
    expect(u.horizonColor).toEqual({ css: p.horizon });
    expect(Math.hypot(u.keyWC.x, u.keyWC.y, u.keyWC.z)).toBeCloseTo(1);
    expect(Math.hypot(u.upWC.x, u.upWC.y, u.upWC.z)).toBeCloseTo(1);
  });
  it("supplies a uniform for every free name the GLSL reads", () => {
    const u = lightUniforms(C as never, paletteFor("day"), { lon: 101.51, lat: 3.18 });
    for (const name of [
      "keyColor",
      "fillColor",
      "bounceColor",
      "horizonColor",
      "keyWC",
      "upWC",
      "keyIntensity",
      "ambient",
      "fogDensity",
      "time",
      "cloudShadow",
      "cloudOrigin",
    ])
      expect(u).toHaveProperty(name);
  });
  it("declares tl_cloud in the shared GLSL, reading time, cloudShadow and cloudOrigin", () => {
    expect(CLOUD_GLSL).toMatch(/float tl_cloud\(vec3 positionWC\)/);
    expect(LIGHTING_GLSL).toContain(CLOUD_GLSL);
    for (const name of ["time", "cloudShadow", "cloudOrigin"])
      expect(CLOUD_GLSL).toMatch(new RegExp(`\\b${name}\\b`));
  });
  it("cloud shadows are 0.15 deep by day and dusk, off at night; time defaults to 0", () => {
    const at = { lon: 101.51, lat: 3.18 };
    const day = lightUniforms(C as never, paletteFor("day"), at) as Record<string, any>;
    expect(day.cloudShadow).toBe(0.15);
    expect(day.time).toBe(0);
    expect(lightUniforms(C as never, paletteFor("dusk"), at).cloudShadow).toBe(0.15);
    expect(lightUniforms(C as never, paletteFor("night"), at).cloudShadow).toBe(0);
    expect(lightUniforms(C as never, paletteFor("day"), at, 12.5).time).toBe(12.5);
    // cloudOrigin: the ECEF position of `at` (an Earth-radius vector).
    const o = day.cloudOrigin;
    expect(Math.hypot(o.x, o.y, o.z)).toBeGreaterThan(6.3e6);
  });
  it("lit colour source darkens the diffuse under a passing cloud", () => {
    expect(LIT_COLOR_SOURCE).toMatch(/tl_cloud\(positionWC\)/);
    expect(LIT_COLOR_SOURCE).toContain(
      "vec3 positionWC = (czm_inverseView * vec4(-materialInput.positionToEyeEC, 1.0)).xyz;",
    );
  });
  it("lit colour source lifts the light towards white so props stay readable at night", () => {
    expect(LIT_COLOR_SOURCE).toMatch(
      /mix\(tl_light\(materialInput\.normalEC\),\s*vec3\(1\.0\),\s*0\.35\)/,
    );
  });
});
