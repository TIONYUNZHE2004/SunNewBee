// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { MOTION_FRAME_MS, MOTION_SLACK_MS } from "./motion/motionClock";

// No WebGL here: a fake renderer, and a PMREM generator that fails part-way through construction.
const spy = vi.hoisted(() => ({
  rendererDispose: vi.fn(),
  contextLoss: vi.fn(),
  pmremDispose: vi.fn(),
  pmremFails: true,
  scenes: [] as unknown[],
  composerRender: vi.fn(),
  blooms: [] as { strength: number; enabled: boolean }[],
}));
vi.mock("three", async (orig) => {
  const t = await orig<typeof import("three")>();
  class FakeRenderer {
    toneMapping = 0;
    outputColorSpace = "";
    shadowMap = { type: 0, enabled: false };
    info = { autoReset: true, reset: vi.fn(), render: { calls: 0, triangles: 0 } };
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
    render = spy.composerRender;
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
  UnrealBloomPass: class {
    enabled = true;
    dispose = vi.fn();
    setSize = vi.fn();
    constructor(
      _res: unknown,
      public strength: number,
    ) {
      spy.blooms.push(this);
    }
  },
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

  it("bloom follows the mood: off by day (no noon wash), on at night, kept across a tier change", async () => {
    spy.pmremFails = false;
    spy.blooms.length = 0;
    try {
      const { createEngine } = await import("./engine");
      const { LIGHT_PRESETS } = await import("./lighting");
      const e = createEngine(document.createElement("canvas"), "medium");
      e.setLighting(LIGHT_PRESETS.day, [0, 1, 0]);
      const day = spy.blooms.at(-1);
      expect(day?.enabled).toBe(false);
      expect(day?.strength).toBe(0);
      e.setLighting(LIGHT_PRESETS.night, [0, 1, 0]);
      expect(spy.blooms.at(-1)?.enabled).toBe(true);
      expect(spy.blooms.at(-1)?.strength).toBe(LIGHT_PRESETS.night.bloom);
      e.setTier("high");
      expect(spy.blooms.at(-1)).not.toBe(day);
      expect(spy.blooms.at(-1)?.strength).toBe(LIGHT_PRESETS.night.bloom);
      expect(spy.blooms.at(-1)?.enabled).toBe(true);
      e.dispose();
    } finally {
      spy.pmremFails = true;
    }
  });
});

// Review Focus 3: no rAF loop survives while motion is not running; while it runs, the motion clock
// renders at most 30 frames a second. Fake timers and a hand-pumped rAF queue.
describe("engine motion clock", () => {
  type Frame = { id: number; cb: FrameRequestCallback };
  let queue: Frame[] = [];
  let requested = 0;
  let nextId = 1;
  const pump = () => {
    const due = queue;
    queue = [];
    for (const f of due) f.cb(performance.now());
  };
  /** Runs frames until the camera's damping has settled and nothing is queued. */
  const settle = () => {
    for (let i = 0; i < 100 && queue.length > 0; i++) {
      vi.advanceTimersByTime(16);
      pump();
    }
    expect(queue).toHaveLength(0);
  };

  async function setup(running: { on: boolean }) {
    spy.pmremFails = false;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
    queue = [];
    requested = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      requested++;
      const id = nextId++;
      queue.push({ id, cb });
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      queue = queue.filter((f) => f.id !== id);
    });
    const THREE = await import("three");
    const { createEngine } = await import("./engine");
    const e = createEngine(document.createElement("canvas"), "low");
    e.rig.set({ target: [0, 0], rangeM: 800, pitchDeg: -45, headingDeg: 0 });
    const ticks: number[] = [];
    const layer = {
      group: new THREE.Group(),
      tick: vi.fn((now: number) => ticks.push(now)),
      setOpacity: vi.fn(),
      dispose: vi.fn(),
    };
    e.setMotion(layer, () => running.on);
    return { e, layer, ticks };
  }
  const teardown = (e: { dispose(): void }) => {
    e.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    spy.pmremFails = true;
  };

  it("running() false: after the initial frame no rAF and no timer is scheduled", async () => {
    const { e, layer } = await setup({ on: false });
    try {
      settle(); // the initial frame(s): the camera pose settles
      const frames = e.frames;
      expect(frames).toBeGreaterThan(0);
      const after = requested;
      for (let i = 0; i < 20; i++) {
        vi.advanceTimersByTime(100);
        pump();
      }
      expect(requested).toBe(after);
      expect(queue).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(e.frames).toBe(frames);
      // At rest: static pose; the frames that did render ticked the layer at the frozen clock.
      expect(e.motion.uSway.value).toBe(0);
      expect(e.motion.uLimb.value).toBe(0);
      expect(layer.tick).toHaveBeenCalledTimes(frames);
      expect(new Set(layer.tick.mock.calls.map((c) => c[0])).size).toBe(1);
    } finally {
      teardown(e);
    }
  });

  it("running() true: motion frames are at least 33 ms apart, uTime is the clock in seconds", async () => {
    const running = { on: false };
    const { e, ticks } = await setup(running);
    try {
      settle();
      running.on = true;
      e.requestRender();
      const frameTimes: number[] = [];
      e.onFrame(() => frameTimes.push(performance.now()));
      for (let i = 0; i < 200; i++) {
        pump();
        vi.advanceTimersByTime(4);
      }
      expect(frameTimes.length).toBeGreaterThan(15);
      for (let i = 1; i < frameTimes.length; i++)
        expect((frameTimes[i] as number) - (frameTimes[i - 1] as number)).toBeGreaterThanOrEqual(
          MOTION_FRAME_MS - MOTION_SLACK_MS,
        );
      expect(new Set(ticks).size).toBeGreaterThan(15);
      expect(e.motion.uTime.value).toBeCloseTo((ticks.at(-1) as number) / 1000, 5);
      expect(e.motion.uSway.value).toBe(1);
      expect(e.motion.uLimb.value).toBe(1);

      // Stop: one more frame at most, then the loop idles.
      running.on = false;
      for (let i = 0; i < 20; i++) {
        pump();
        vi.advanceTimersByTime(40);
      }
      const n = e.frames;
      for (let i = 0; i < 20; i++) {
        pump();
        vi.advanceTimersByTime(40);
      }
      expect(e.frames).toBe(n);
      expect(queue).toHaveLength(0);
      expect(e.motion.uSway.value).toBe(0);

      // Start again: the caller asks for a frame and the clock resumes.
      running.on = true;
      e.requestRender();
      for (let i = 0; i < 50; i++) {
        pump();
        vi.advanceTimersByTime(4);
      }
      expect(e.frames).toBeGreaterThan(n + 3);
    } finally {
      teardown(e);
    }
  });

  it("vsync jitter: one render per motion tick, every ~2 vsyncs (about 30 fps)", async () => {
    const running = { on: false };
    const { e, ticks } = await setup(running);
    try {
      settle();
      running.on = true;
      e.requestRender();
      spy.composerRender.mockClear();
      ticks.length = 0;
      // rAF callbacks run only at vsyncs: 16.7 ms apart, jittered by up to 1.5 ms either way.
      const start = performance.now();
      for (let k = 1; k <= 180; k++) {
        const at = start + k * (1000 / 60) + Math.sin(k * 12.9898) * 1.5;
        vi.advanceTimersByTime(Math.max(0, at - performance.now()));
        pump();
      }
      const motionTicks = new Set(ticks);
      expect(motionTicks.size).toBe(ticks.length);
      expect(spy.composerRender).toHaveBeenCalledTimes(ticks.length);
      const times = [...motionTicks];
      const gaps = times.slice(1).map((t, i) => t - (times[i] as number));
      for (const g of gaps) {
        expect(g).toBeGreaterThan(29);
        expect(g).toBeLessThan(38);
      }
      // 3 s of vsyncs: about 90 motion frames (30 fps), not ~60 (20 fps with two renders each).
      expect(times.length).toBeGreaterThan(85);
      expect(times.length).toBeLessThanOrEqual(92);
    } finally {
      teardown(e);
    }
  });

  it("setMotion(null) stops the clock and disposes the layer", async () => {
    const { e, layer } = await setup({ on: true });
    try {
      settle();
      e.setMotion(null, () => true);
      expect(layer.dispose).toHaveBeenCalledTimes(1);
      pump();
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(40);
        pump();
      }
      expect(queue).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      teardown(e);
    }
  });

  it("setOverlays: lines in the overlay scene, ground tint in the main scene, pixel ratio pushed", async () => {
    const { e } = await setup({ on: false });
    try {
      const THREE = await import("three");
      const layer = {
        group: new THREE.Group(),
        groundGroup: new THREE.Group(),
        update: vi.fn(),
        setMetresPerPixel: vi.fn(),
        hasVisible: () => false,
        setResolution: vi.fn(),
        setPixelRatio: vi.fn(),
        setView: vi.fn(),
        attach: vi.fn(() => () => {}),
        dispose: vi.fn(),
      };
      e.setOverlays(layer);
      const scenes = spy.scenes as import("three").Scene[];
      const main = scenes.find((sc) => sc.children.includes(layer.groundGroup));
      expect(main).toBeTruthy();
      expect(main?.children.includes(layer.group)).toBe(false);
      expect(scenes.some((sc) => sc.children.includes(layer.group))).toBe(true);
      expect(layer.setPixelRatio).toHaveBeenCalled();
      e.setOverlays(null);
      expect(layer.groundGroup.parent).toBeNull();
      expect(layer.dispose).toHaveBeenCalledTimes(1);
    } finally {
      teardown(e);
    }
  });
});
