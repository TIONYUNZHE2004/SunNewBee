// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// No WebGL here: a fake renderer, and a PMREM generator that fails part-way through construction.
const spy = vi.hoisted(() => ({
  rendererDispose: vi.fn(),
  contextLoss: vi.fn(),
  pmremDispose: vi.fn(),
  pmremFails: true,
  scenes: [] as unknown[],
}));
vi.mock("three", async (orig) => {
  const t = await orig<typeof import("three")>();
  class FakeRenderer {
    toneMapping = 0;
    outputColorSpace = "";
    shadowMap = { type: 0, enabled: false };
    info = { autoReset: true };
    debug: { onShaderError: unknown } = { onShaderError: null };
    toneMappingExposure = 1;
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    getContext = vi.fn(() => ({}));
    dispose = spy.rendererDispose;
    forceContextLoss = spy.contextLoss;
  }
  class FailingPmrem {
    fromScene() {
      if (spy.pmremFails) throw new Error("PMREM failed");
      return { texture: new t.Texture(), dispose: vi.fn() };
    }
    dispose = spy.pmremDispose;
  }
  class RecScene extends t.Scene {
    constructor() {
      super();
      spy.scenes.push(this);
    }
  }
  return { ...t, Scene: RecScene, WebGLRenderer: FakeRenderer, PMREMGenerator: FailingPmrem };
});

// The post-processing chain needs a real GL context; the fog test only needs the engine's own state.
vi.mock("three/addons/postprocessing/EffectComposer.js", () => ({
  EffectComposer: class {
    setPixelRatio = vi.fn();
    addPass = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
  },
}));
const stubPass = () =>
  class {
    dispose = vi.fn();
    setSize = vi.fn();
  };
vi.mock("three/addons/postprocessing/RenderPass.js", () => ({ RenderPass: stubPass() }));
vi.mock("three/addons/postprocessing/OutputPass.js", () => ({ OutputPass: stubPass() }));
vi.mock("three/addons/postprocessing/UnrealBloomPass.js", () => ({
  UnrealBloomPass: stubPass(),
}));
vi.mock("./aoPass", () => ({ CityGTAOPass: stubPass() }));

describe("createEngine", () => {
  it("a failure after the renderer exists releases what was made, loses the context and rethrows", async () => {
    const { createEngine } = await import("./engine");
    const canvas = document.createElement("canvas");
    const remove = vi.spyOn(canvas, "removeEventListener");
    expect(() => createEngine(canvas, "medium")).toThrow("PMREM failed");
    expect(spy.pmremDispose).toHaveBeenCalledTimes(1);
    expect(spy.rendererDispose).toHaveBeenCalledTimes(1);
    expect(spy.contextLoss).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("webglcontextlost", expect.any(Function));
  });

  it("setLighting and setFogRange mutate one Fog instead of replacing it", async () => {
    spy.pmremFails = false;
    spy.scenes.length = 0;
    try {
      const { createEngine } = await import("./engine");
      const { LIGHT_PRESETS } = await import("./lighting");
      const e = createEngine(document.createElement("canvas"), "low");
      const scene = spy.scenes[0] as import("three").Scene;
      e.setLighting(LIGHT_PRESETS.day, [0, 1, 0]);
      const fog = scene.fog as import("three").Fog;
      expect(fog).toBeTruthy();
      e.setLighting(LIGHT_PRESETS.night, [0, 1, 0]);
      expect(scene.fog).toBe(fog);
      e.setFogRange(7000);
      expect(scene.fog).toBe(fog);
      expect(fog.far).toBeGreaterThanOrEqual(15400);
      e.dispose();
    } finally {
      spy.pmremFails = true;
    }
  });
});
