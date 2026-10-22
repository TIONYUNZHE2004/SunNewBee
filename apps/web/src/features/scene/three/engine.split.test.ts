// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// Split screen (demo polish B8). No WebGL: a fake renderer that logs every direct render, and recording post-processing stubs, so
// the test can tell which scenes go through the composer (prototype bug: sprites drawn through the
// post passes came out as black quads, spec §6.4).
const spy = vi.hoisted(() => ({
  log: [] as string[],
  scenes: [] as unknown[],
  passScenes: [] as unknown[],
  aoSkips: [] as (() => readonly unknown[])[],
  bokehSkips: [] as (() => readonly unknown[])[],
  renderer: null as null | {
    autoClear: boolean;
    shadowMap: { autoUpdate?: boolean; needsUpdate?: boolean };
  },
  cam: null as unknown,
  shadowAtComposer: [] as (boolean | undefined)[],
  drawn: [] as { x: number; aspect: number }[],
}));
vi.mock("three", async (orig) => {
  const t = await orig<typeof import("three")>();
  class FakeRenderer {
    toneMapping = 0;
    outputColorSpace = "";
    autoClear = true;
    shadowMap: { type: number; enabled: boolean; autoUpdate?: boolean; needsUpdate?: boolean } = {
      type: 0,
      enabled: false,
    };
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
    setViewport = vi.fn((x: number, y: number, w: number, h: number) =>
      spy.log.push(`viewport:${x},${y},${w},${h}`),
    );
    setScissor = vi.fn((x: number, y: number, w: number, h: number) =>
      spy.log.push(`scissor:${x},${y},${w},${h}`),
    );
    setScissorTest = vi.fn((on: boolean) => spy.log.push(`scissorTest:${on}`));
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
    setSize = vi.fn((w: number, h: number) => spy.log.push(`composerSize:${w}x${h}`));
    render = vi.fn(() => {
      spy.shadowAtComposer.push(spy.renderer?.shadowMap.needsUpdate);
      spy.log.push("composer");
      const c = spy.cam as null | { position: { x: number }; aspect: number };
      if (c) spy.drawn.push({ x: c.position.x, aspect: c.aspect });
    });
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
  spy.drawn.length = 0;
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const THREE = await import("three");
  const { createEngine } = await import("./engine");
  const e = createEngine(document.createElement("canvas"), "medium");
  e.resize(1440, 900);
  const cam = (x: number) => {
    const c = new THREE.PerspectiveCamera(50, 1, 2, 30000);
    c.position.set(x, 26, -42);
    c.lookAt(x, 0, 12);
    c.updateMatrixWorld(true);
    return { camera: c, look: new THREE.Vector3(x, 0, 12) };
  };
  const sv = { left: cam(-300), right: cam(300) };
  spy.cam = e.pickView().camera;
  return { e, sv, THREE };
}

afterEach(() => vi.unstubAllGlobals());

describe("Engine.setSplit (B8)", () => {
  it("draws both halves through the composer, each with its own camera, scissored, then restores", async () => {
    const { e, sv } = await setup();
    try {
      const main = e.pickView().camera as import("three").PerspectiveCamera;
      main.position.set(1, 2, 3);
      e.setSplit?.(sv);
      expect(spy.log).toContain("composerSize:720x900");
      expect(e.splitLayout?.()?.renderW).toBe(720);
      spy.log.length = 0;
      spy.drawn.length = 0;
      e.renderNow?.();
      const composers = spy.log.filter((l) => l === "composer");
      expect(composers).toHaveLength(2);
      expect(spy.drawn.map((d) => d.x)).toEqual([-300, 300]);
      for (const d of spy.drawn) expect(d.aspect).toBeCloseTo(720 / 900, 6);
      const seq = spy.log.filter((l) => /^(viewport|scissor|composer)/.test(l));
      expect(seq.slice(0, 7)).toEqual([
        "scissorTest:true",
        "viewport:0,0,720,900",
        "scissor:0,0,720,900",
        "composer",
        "viewport:720,0,720,900",
        "scissor:720,0,720,900",
        "composer",
      ]);
      expect(seq.slice(7)).toEqual([
        "scissorTest:false",
        "viewport:0,0,1440,900",
        "scissor:0,0,1440,900",
      ]);
      // the engine camera is back where the driver / rig left it, at the canvas aspect
      expect(main.aspect).toBeCloseTo(1440 / 900, 6);
    } finally {
      e.dispose();
    }
  });

  it("tells the split's owner which half it draws before each, and null after (V2 N-a)", async () => {
    const { e, sv } = await setup();
    try {
      const sides: (string | null)[] = [];
      e.setSplit?.({
        ...sv,
        beforeSide: (side) => {
          sides.push(side);
          if (side) spy.log.push(`side:${side}`);
        },
      });
      spy.log.length = 0;
      sides.length = 0;
      e.renderNow?.();
      expect(sides).toEqual(["left", "right", null]);
      const seq = spy.log.filter((l) => /^(side|composer)/.test(l));
      expect(seq).toEqual(["side:left", "composer", "side:right", "composer"]);
    } finally {
      e.dispose();
    }
  });

  it("the shadow map is drawn once per half (C10p L1): each composer render asks for it", async () => {
    const { e, sv } = await setup();
    try {
      expect(spy.renderer?.shadowMap.autoUpdate).toBe(false);
      e.setSplit?.(sv);
      spy.shadowAtComposer.length = 0;
      e.renderNow?.();
      // two halves, each with its own light placement: one redraw per composer render, never
      // a second one from the passes inside it (the flag drops after each render)
      expect(spy.shadowAtComposer).toEqual([true, true]);
      expect(spy.renderer?.shadowMap.needsUpdate).toBe(false);
      e.setSplit?.(null);
      spy.shadowAtComposer.length = 0;
      e.renderNow?.();
      expect(spy.shadowAtComposer).toEqual([true]);
    } finally {
      e.dispose();
    }
  });

  it("pickView returns the camera of the half under the pointer; null ends the split", async () => {
    const { e, sv } = await setup();
    try {
      e.setSplit?.(sv);
      expect(e.pickView({ x: 100, y: 400 }).camera.position.x).toBe(-300);
      expect(e.pickView({ x: 1000, y: 400 }).camera.position.x).toBe(300);
      expect(e.pickView({ x: 100, y: 400 }).size).toEqual([1440, 900]);
      spy.log.length = 0;
      e.setSplit?.(null);
      expect(spy.log).toContain("composerSize:1440x900");
      expect(e.splitLayout?.()).toBeNull();
      spy.log.length = 0;
      e.renderNow?.();
      expect(spy.log.filter((l) => l === "composer")).toHaveLength(1);
      expect(spy.log.some((l) => l.startsWith("scissorTest:true"))).toBe(false);
    } finally {
      e.dispose();
    }
  });

  it("resizing while split keeps two equal halves", async () => {
    const { e, sv } = await setup();
    try {
      e.setSplit?.(sv);
      e.resize(1281, 720);
      const l = e.splitLayout?.();
      expect(l).toBeTruthy();
      expect(Math.abs((l?.left.w ?? 0) - (l?.right.w ?? 0))).toBeLessThanOrEqual(1);
      expect(spy.log).toContain(`composerSize:${l?.renderW}x720`);
    } finally {
      e.dispose();
    }
  });
});
