import { describe, expect, it, vi } from "vitest";
import { paletteFor } from "./palette";
import { applyPostFx, skyCss } from "./postfx";
import { TIERS } from "./quality";

function viewer() {
  const stage = () => ({ enabled: false, uniforms: {} as Record<string, number> });
  return {
    shadows: false,
    resolutionScale: 1,
    scene: {
      postProcessStages: { fxaa: stage(), ambientOcclusion: stage(), bloom: stage() },
      shadowMap: { softShadows: false, size: 0, maximumDistance: 0, darkness: 0 },
      requestRender: vi.fn(),
    },
  };
}
const C = {};

describe("applyPostFx", () => {
  it("high tier at dusk: soft shadows, AO, bloom, FXAA", () => {
    const v = viewer();
    applyPostFx(C as never, v as never, paletteFor("dusk"), TIERS.high);
    expect(v.shadows).toBe(true);
    expect(v.scene.shadowMap).toMatchObject({
      softShadows: true,
      size: 2048,
      maximumDistance: 3000,
    });
    expect(v.scene.postProcessStages.ambientOcclusion.enabled).toBe(true);
    expect(v.scene.postProcessStages.bloom.enabled).toBe(true);
    expect(v.scene.postProcessStages.fxaa.enabled).toBe(true);
  });
  it("night never casts shadows; day never blooms; low tier disables everything costly", () => {
    const v = viewer();
    applyPostFx(C as never, v as never, paletteFor("night"), TIERS.high);
    expect(v.shadows).toBe(false);
    applyPostFx(C as never, v as never, paletteFor("day"), TIERS.high);
    expect(v.scene.postProcessStages.bloom.enabled).toBe(false);
    applyPostFx(C as never, v as never, paletteFor("dusk"), TIERS.low);
    expect(v.shadows).toBe(false);
    expect(v.scene.postProcessStages.ambientOcclusion.enabled).toBe(false);
    expect(v.scene.postProcessStages.bloom.enabled).toBe(false);
  });
  it("skyCss is a vertical gradient from the palette", () => {
    const p = paletteFor("dusk");
    expect(skyCss(p)).toBe(`linear-gradient(180deg, ${p.skyTop} 0%, ${p.horizon} 100%)`);
  });
});
