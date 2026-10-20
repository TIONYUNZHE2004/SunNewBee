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
  bokehSkips: [] as (() => readonly unknown[])[],
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

vi.mock("./tiltShift", async (orig) => {
  const t = await orig<typeof import("./tiltShift")>();
  return {
    ...t,
    CityBokehPass: class {
      enabled = true;
      dispose = vi.fn();
      setSize = vi.fn();
      aim = vi.fn();
      uniforms = {};
      constructor(_s: unknown, _c: unknown, skip: () => readonly unknown[]) {
        spy.bokehSkips.push(skip);
      }
    },
  };
});

async function setup() {
  spy.log.length = 0;
  spy.scenes.length = 0;
  spy.passScenes.length = 0;
  spy.aoSkips.length = 0;
  spy.bokehSkips.length = 0;
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

function devsimDouble(THREE: typeof import("three")) {
  const group = new THREE.Group();
  group.name = "devsim";
  return { group, beforeRender: vi.fn(), dispose: vi.fn() };
}

describe("Engine.setDevsim", () => {
  it("the layer joins the main scene and is posed every frame before the render", async () => {
    const { e, THREE } = await setup();
    try {
      const l = devsimDouble(THREE);
      e.setDevsim?.(l);
      const main = spy.scenes[0] as import("three").Scene;
      expect(main.children).toContain(l.group);
      spy.log.length = 0;
      l.beforeRender.mockImplementation(() => spy.log.push("devsim"));
      e.renderNow?.();
      expect(l.beforeRender).toHaveBeenCalledTimes(1);
      const [cam, size] = l.beforeRender.mock.calls[0] as [import("three").Camera, number[]];
      expect((cam as import("three").PerspectiveCamera).isPerspectiveCamera).toBe(true);
      expect(size).toEqual([1440, 900]);
      // posed before the composer draws the frame
      expect(spy.log.indexOf("devsim")).toBeLessThan(spy.log.indexOf("composer"));
    } finally {
      e.dispose();
    }
  });

  it("null removes and disposes it; a replacement disposes the previous one once", async () => {
    const { e, THREE } = await setup();
    try {
      const a = devsimDouble(THREE);
      const b = devsimDouble(THREE);
      e.setDevsim?.(a);
      e.setDevsim?.(a); // same layer: no-op
      expect(a.dispose).not.toHaveBeenCalled();
      e.setDevsim?.(b);
      expect(a.dispose).toHaveBeenCalledTimes(1);
      expect(a.group.parent).toBeNull();
      e.setDevsim?.(null);
      expect(b.dispose).toHaveBeenCalledTimes(1);
      expect(b.group.parent).toBeNull();
      b.beforeRender.mockClear();
      e.renderNow?.();
      expect(b.beforeRender).not.toHaveBeenCalled();
    } finally {
      e.dispose();
    }
  });

  it("dispose of the engine disposes a loaded layer; a layer set after dispose is disposed", async () => {
    const { e, THREE } = await setup();
    const a = devsimDouble(THREE);
    e.setDevsim?.(a);
    e.dispose();
    expect(a.dispose).toHaveBeenCalledTimes(1);
    const late = devsimDouble(THREE);
    e.setDevsim?.(late);
    expect(late.dispose).toHaveBeenCalledTimes(1);
  });
});
