import { describe, expect, it } from "vitest";
import { LIGHTING_GLSL, lightUniforms } from "./lighting";
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
    ])
      expect(u).toHaveProperty(name);
  });
});
