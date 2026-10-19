// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// No WebGL: a fake renderer that logs every direct render, and recording post-processing stubs, so
// the test can tell which scenes go through the composer (prototype bug: sprites drawn through the
// post passes came out as black quads, spec §6.4).
const spy = vi.hoisted(() => ({
  log: [] as string[],
  scenes: [] as unknown[],
  passScenes: [] as unknown[],
  aoSkips: [] as (() => readonly unknown[])[],
  renderer: null as null | { autoClear: boolean },
}));
vi.mock("three", async (orig) => {
  const t = await orig<typeof import("three")>();
  class FakeRenderer {
    toneMapping = 0;
    outputColorSpace = "";
    autoClear = true;
    shadowMap = { type: 0, enabled: false };
    info = { autoReset: true, reset: vi.fn(), render: { calls: 0, triangles: 0 } };
    debug: { onShaderError: unknown } = { onShaderError: null };
    toneMappingExposure = 1;
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    getContext = vi.fn(() => ({}));
    dispose = vi.fn();
    forceContextLoss = vi.fn();
    setRenderTarget = vi.fn((rt: unknown) =>
      spy.log.push(`target:${rt === null ? "screen" : "rt"}`),
    );
    clearDepth = vi.fn(() => spy.log.push("clearDepth"));
    render = vi.fn((scene: { name: string }) =>
      spy.log.push(`render:${scene.name || "?"}:autoClear=${this.autoClear}`),
    );
    constructor() {
      spy.renderer = this;
    }
  }
  class Pmrem {
    fromScene() {
      return { texture: new t.Texture(), dispose: vi.fn() };
    }
    dispose = vi.fn();
  }
  class RecScene extends t.Scene {
    constructor() {
      super();
      spy.scenes.push(this);
    }
  }
  return { ...t, Scene: RecScene, WebGLRenderer: FakeRenderer, PMREMGenerator: Pmrem };
});
vi.mock("three/addons/postprocessing/EffectComposer.js", () => ({
  EffectComposer: class {
    readBuffer = {};
    setPixelRatio = vi.fn();
    addPass = vi.fn();
    setSize = vi.fn();
    render = vi.fn(() => spy.log.push("composer"));
    dispose = vi.fn();
  },
}));
const stubPass = () =>
  class {
    dispose = vi.fn();
    setSize = vi.fn();
    enabled = true;
    clear = true;
  };
vi.mock("three/addons/postprocessing/RenderPass.js", () => ({
  RenderPass: class {
    dispose = vi.fn();
    setSize = vi.fn();
    enabled = true;
    clear = true;
    constructor(scene: unknown) {
      spy.passScenes.push(scene);
    }
  },
}));
vi.mock("three/addons/postprocessing/OutputPass.js", () => ({ OutputPass: stubPass() }));
vi.mock("three/addons/postprocessing/UnrealBloomPass.js", () => ({
  UnrealBloomPass: class {
    enabled = true;
    strength = 0;
    dispose = vi.fn();
    setSize = vi.fn();
  },
}));
vi.mock("./aoPass", () => ({
  CityGTAOPass: class {
    dispose = vi.fn();
    setSize = vi.fn();
    constructor(_s: unknown, _c: unknown, _w: number, _h: number, skip: () => readonly unknown[]) {
      spy.aoSkips.push(skip);
    }
  },
}));

async function setup() {
  spy.log.length = 0;
  spy.scenes.length = 0;
  spy.passScenes.length = 0;
  spy.aoSkips.length = 0;
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const THREE = await import("three");
  const { createEngine } = await import("./engine");
  const e = createEngine(document.createElement("canvas"), "high");
  e.resize(1440, 900);
  const markers = new THREE.Scene();
  markers.name = "journey-markers";
  markers.add(new THREE.Sprite());
  const ribbon = new THREE.Group();
  ribbon.name = "journey-ribbon";
  const layer = {
    ribbon,
    markers,
    setResolution: vi.fn(),
    setMetresPerPixel: vi.fn(),
    dispose: vi.fn(),
  };
  return { e, layer, THREE };
}

afterEach(() => vi.unstubAllGlobals());

describe("Engine.setJourney", () => {
  it("the ribbon joins the main scene and is left out of the AO G-buffer", async () => {
    const { e, layer } = await setup();
    try {
      e.setJourney(layer);
      const main = spy.scenes[0] as import("three").Scene;
      expect(main.children).toContain(layer.ribbon);
      expect(spy.aoSkips.length).toBeGreaterThan(0);
      expect(spy.aoSkips.at(-1)?.()).toContain(layer.ribbon);
    } finally {
      e.dispose();
    }
  });

  it("markers are never handed to the composer: rendered straight to the screen after it", async () => {
    const { e, layer } = await setup();
    try {
      e.setJourney(layer);
      e.setTier("medium"); // rebuilds the pass chain with the journey loaded
      spy.log.length = 0;
      e.renderNow?.();
      expect(spy.passScenes).not.toContain(layer.markers);
      for (const s of spy.passScenes)
        expect((s as import("three").Object3D).children).not.toContain(layer.markers.children[0]);
      const at = spy.log.indexOf("composer");
      expect(at).toBeGreaterThanOrEqual(0);
      expect(spy.log.slice(at + 1)).toEqual([
        "target:screen",
        "clearDepth",
        "render:journey-markers:autoClear=false",
      ]);
      expect(spy.renderer?.autoClear).toBe(true); // restored
    } finally {
      e.dispose();
    }
  });

  it("no journey: no extra render; resize and frames reach the layer; null disposes it", async () => {
    const { e, layer } = await setup();
    try {
      spy.log.length = 0;
      e.renderNow?.();
      expect(spy.log.filter((l) => l.startsWith("render:"))).toEqual([]);
      e.setJourney(layer);
      expect(layer.setResolution).toHaveBeenLastCalledWith(1440, 900);
      e.resize(800, 600);
      expect(layer.setResolution).toHaveBeenLastCalledWith(800, 600);
      e.renderNow?.();
      expect(layer.setMetresPerPixel).toHaveBeenCalled();
      e.setJourney(null);
      expect(layer.dispose).toHaveBeenCalledTimes(1);
      expect(layer.ribbon.parent).toBeNull();
      spy.log.length = 0;
      e.renderNow?.();
      expect(spy.log.filter((l) => l.startsWith("render:"))).toEqual([]);
    } finally {
      e.dispose();
    }
  });

  it("dispose of the engine disposes a loaded journey layer", async () => {
    const { e, layer } = await setup();
    e.setJourney(layer);
    e.dispose();
    expect(layer.dispose).toHaveBeenCalledTimes(1);
  });
});
