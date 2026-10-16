import { afterEach, describe, expect, it, vi } from "vitest";
import { paletteFor } from "./palette";
import { applyPostFx, saveRenderSettings, skyCss } from "./postfx";
import { TIERS } from "./quality";

function viewer() {
  const stage = () => ({ enabled: false, uniforms: {} as Record<string, number> });
  return {
    shadows: false,
    resolutionScale: 1,
    useBrowserRecommendedResolution: true,
    scene: {
      postProcessStages: { fxaa: stage(), ambientOcclusion: stage(), bloom: stage() },
      shadowMap: { softShadows: false, size: 0, maximumDistance: 0, darkness: 0 },
      requestRender: vi.fn(),
    },
  };
}
const C = {};

describe("saveRenderSettings", () => {
  it("restores every render setting the stylised city changes (switch to Realistic)", () => {
    const v = viewer();
    v.scene.postProcessStages.fxaa.enabled = false;
    v.scene.postProcessStages.ambientOcclusion.enabled = true;
    v.scene.shadowMap = { softShadows: false, size: 1024, maximumDistance: 5000, darkness: 0.3 };
    const before = structuredClone({ ...v, scene: { ...v.scene, requestRender: undefined } });
    const restore = saveRenderSettings(v as never);
    applyPostFx(C as never, v as never, paletteFor("dusk"), TIERS.high);
    expect(v.useBrowserRecommendedResolution).toBe(false);
    restore();
    expect(v.useBrowserRecommendedResolution).toBe(true);
    expect(v.resolutionScale).toBe(before.resolutionScale);
    expect(v.shadows).toBe(before.shadows);
    const s = v.scene.postProcessStages;
    expect([s.fxaa.enabled, s.bloom.enabled, s.ambientOcclusion.enabled]).toEqual([
      false,
      false,
      true,
    ]);
    expect(v.scene.shadowMap).toEqual(before.scene.shadowMap);
    expect(v.scene.requestRender).toHaveBeenCalled();
  });
});

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
    expect(v.scene.postProcessStages.ambientOcclusion.enabled).toBe(false); // off even at high
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
  it("uses the tuned bloom uniforms", () => {
    const v = viewer();
    applyPostFx(C as never, v as never, paletteFor("dusk"), TIERS.high);
    expect(v.scene.postProcessStages.bloom.uniforms).toMatchObject({
      contrast: 119,
      brightness: -0.85,
      delta: 1,
      sigma: 2,
      stepSize: 1,
      glowOnly: false,
    });
  });
  describe("pixel ratio", () => {
    afterEach(() => vi.unstubAllGlobals());
    it("caps the device pixel ratio per tier on a 2x display", () => {
      vi.stubGlobal("devicePixelRatio", 2);
      const v = viewer();
      applyPostFx(C as never, v as never, paletteFor("day"), TIERS.high);
      expect(v.resolutionScale).toBe(1);
      expect(v.useBrowserRecommendedResolution).toBe(false);
      applyPostFx(C as never, v as never, paletteFor("day"), TIERS.medium);
      expect(v.resolutionScale).toBe(0.75);
      applyPostFx(C as never, v as never, paletteFor("day"), TIERS.low);
      expect(v.resolutionScale).toBe(0.5);
    });
  });
});
