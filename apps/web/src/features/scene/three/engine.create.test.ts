// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMotionClock,
  MOTION_FRAME_MS,
  MOTION_SLACK_MS,
  resetMotionSession,
} from "./motion/motionClock";

// No WebGL here: a fake renderer, and a PMREM generator that fails part-way through construction.
const spy = vi.hoisted(() => ({
  rendererDispose: vi.fn(),
  contextLoss: vi.fn(),
  pmremDispose: vi.fn(),
  pmremFails: true,
  scenes: [] as unknown[],
  composerRender: vi.fn(),
  blooms: [] as { strength: number; enabled: boolean }[],
  aoSkips: [] as (() => readonly unknown[])[],
  /** The last fake renderer built (its `info.programs` stands in for three's program cache). */
  renderer: null as null | { info: { programs?: { usedTimes: number }[] } },
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
    constructor() {
      spy.renderer = this as unknown as { info: { programs?: { usedTimes: number }[] } };
    }
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
vi.mock("./aoPass", () => ({
  CityGTAOPass: class {
    dispose = vi.fn();
    setSize = vi.fn();
    constructor(_s: unknown, _c: unknown, _w: number, _h: number, skip: () => readonly unknown[]) {
      spy.aoSkips.push(skip);
    }
  },
}));

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
      expect(fog.far).toBeGreaterThanOrEqual(8000);
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

// Review Focus 3: no rAF loop survives while motion is not running. While it runs, the motion clock
// ticks once per rAF at High/Medium (display rate, P4), and at most 30 times a second after the
// slow-device fallback. At Low motion is off (ruling P4-S). Fake timers and a hand-pumped rAF queue.
describe("engine motion clock", () => {
  // The 45 fps fallback is per page session (module level): every test starts at display rate.
  beforeEach(() => resetMotionSession());
  /** Forces the session's 30 fps fallback: 3.5 s of live frames at 33 fps through a motion clock. */
  const force30fps = () => {
    const c = createMotionClock();
    for (let t = 0; t <= 3500; t += 30) c.frame(t, true);
    expect(c.mode).toBe("30fps");
  };
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

  async function setup(running: { on: boolean }, tier: "low" | "medium" = "low") {
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
    const e = createEngine(document.createElement("canvas"), tier);
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

  it("renderNow renders one frame synchronously and cancels the pending one (test-only)", async () => {
    const { e } = await setup({ on: false });
    try {
      settle();
      const n = e.frames;
      const seen: number[] = [];
      e.onFrame(() => seen.push(e.frames));
      e.requestRender();
      expect(queue).toHaveLength(1);
      e.renderNow?.();
      expect(e.frames).toBe(n + 1);
      expect(seen).toEqual([n + 1]);
      expect(queue).toHaveLength(0);
    } finally {
      teardown(e);
    }
  });

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

  it("running() true in 30 fps mode (forced fallback): motion frames are at least 33 ms apart, uTime is the clock in seconds", async () => {
    force30fps();
    const running = { on: false };
    const { e, ticks } = await setup(running, "medium");
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

  it("vsync jitter in 30 fps mode (forced fallback): one render per motion tick, every ~2 vsyncs (about 30 fps)", async () => {
    force30fps();
    const running = { on: false };
    const { e, ticks } = await setup(running, "medium");
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

  /** Pumps `n` vsyncs `stepMs` apart (one rAF callback each). */
  const vsyncs = (n: number, stepMs = 1000 / 60) => {
    for (let k = 0; k < n; k++) {
      vi.advanceTimersByTime(stepMs);
      pump();
    }
  };
  const setVisibility = (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  it("display mode (Medium): one motion tick and one render per rAF, no motion timer, real-time ticks", async () => {
    const running = { on: false };
    const { e, ticks } = await setup(running, "medium");
    try {
      settle();
      running.on = true;
      e.requestRender();
      pump(); // the restart frame
      spy.composerRender.mockClear();
      ticks.length = 0;
      let rafs = 0;
      for (let k = 0; k < 120; k++) {
        vi.advanceTimersByTime(1000 / 60);
        expect(queue).toHaveLength(1); // exactly one rAF pending: the next motion tick
        expect(vi.getTimerCount()).toBe(0); // display mode never arms the 30 fps timer
        rafs++;
        pump();
      }
      expect(ticks).toHaveLength(rafs);
      expect(new Set(ticks).size).toBe(rafs);
      expect(spy.composerRender).toHaveBeenCalledTimes(rafs);
      // Real time, not frame count: tick gaps are the vsync gaps.
      for (let i = 1; i < ticks.length; i++)
        expect((ticks[i] as number) - (ticks[i - 1] as number)).toBeCloseTo(1000 / 60, 3);
      expect(e.motion.uTime.value).toBeCloseTo((ticks.at(-1) as number) / 1000, 5);
      expect(e.motion.uSway.value).toBe(1);

      // Stop: one final frame, then no rAF and no timer.
      running.on = false;
      e.requestRender();
      vsyncs(5);
      const n = e.frames;
      const after = requested;
      vsyncs(30);
      expect(e.frames).toBe(n);
      expect(requested).toBe(after);
      expect(queue).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(e.motion.uSway.value).toBe(0);
    } finally {
      teardown(e);
    }
  });

  it("forced fallback: a < 45 fps median during motion switches to the 30 fps cadence for the session", async () => {
    const running = { on: false };
    const first = await setup(running, "medium");
    try {
      settle();
      running.on = true;
      first.e.requestRender();
      // 3.5 s of live frames 30 ms apart (33 fps): below the 45 fps fallback.
      vsyncs(117, 30);
      const frameTimes: number[] = [];
      first.e.onFrame(() => frameTimes.push(performance.now()));
      for (let i = 0; i < 200; i++) {
        pump();
        vi.advanceTimersByTime(4);
      }
      expect(frameTimes.length).toBeGreaterThan(15);
      for (let i = 1; i < frameTimes.length; i++)
        expect((frameTimes[i] as number) - (frameTimes[i - 1] as number)).toBeGreaterThanOrEqual(
          MOTION_FRAME_MS - MOTION_SLACK_MS,
        );
    } finally {
      teardown(first.e);
    }
    // The session fell back: a new engine (still Medium) starts at 30 fps.
    const again = { on: false };
    const second = await setup(again, "medium");
    try {
      settle();
      again.on = true;
      second.e.requestRender();
      second.ticks.length = 0;
      vsyncs(60); // 1 s of 60 Hz vsyncs
      expect(second.ticks.length).toBeGreaterThan(25);
      expect(second.ticks.length).toBeLessThanOrEqual(32);
    } finally {
      teardown(second.e);
    }
  });

  it("resume after a stop or a hidden tab: agents continue where they stopped, no jump by the stopped time", async () => {
    const running = { on: false };
    const { e, ticks } = await setup(running, "medium");
    try {
      settle();
      running.on = true;
      e.requestRender();
      vsyncs(60);
      const beforeStop = ticks.at(-1) as number;

      // Motion toggled off for 10 s, then on again.
      running.on = false;
      e.requestRender();
      vsyncs(5);
      vi.advanceTimersByTime(10_000);
      running.on = true;
      e.requestRender();
      ticks.length = 0;
      vsyncs(30);
      // The resumed clock starts where it stopped (within one vsync), then runs in real time.
      expect((ticks[0] as number) - beforeStop).toBeLessThan(1000 / 60 + 1);
      expect((ticks.at(-1) as number) - (ticks[0] as number)).toBeCloseTo(
        (ticks.length - 1) * (1000 / 60),
        3,
      );
      expect(e.motion.uTime.value).toBeCloseTo((ticks.at(-1) as number) / 1000, 5);

      // Tab hidden for 20 s with running() still true (the React gate may lag the event).
      const beforeHide = ticks.at(-1) as number;
      setVisibility("hidden");
      expect(queue).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(20_000);
      setVisibility("visible");
      ticks.length = 0;
      vsyncs(10);
      expect((ticks[0] as number) - beforeHide).toBeLessThan(1000 / 60 + 1);
    } finally {
      setVisibility("visible");
      teardown(e);
    }
  });

  it("a new motion layer while stopped keeps the motion time: no jump when motion resumes", async () => {
    const running = { on: false };
    const { e, ticks } = await setup(running, "medium");
    try {
      settle();
      running.on = true;
      e.requestRender();
      vsyncs(30);
      const beforeStop = ticks.at(-1) as number;
      running.on = false;
      e.requestRender();
      vsyncs(3);
      vi.advanceTimersByTime(5_000);
      const THREE = await import("three");
      const next: number[] = [];
      const layer = {
        group: new THREE.Group(),
        tick: vi.fn((now: number) => next.push(now)),
        setOpacity: vi.fn(),
        dispose: vi.fn(),
      };
      e.setMotion(layer, () => running.on);
      vsyncs(3);
      running.on = true;
      e.requestRender();
      next.length = 0;
      vsyncs(10);
      expect((next[0] as number) - beforeStop).toBeLessThan(1000 / 60 + 1);
    } finally {
      teardown(e);
    }
  });

  it("Low: motion is off (ruling P4-S), so running() true schedules no rAF and no timer", async () => {
    const running = { on: true };
    const { e, layer } = await setup(running, "low");
    try {
      settle();
      const frames = e.frames;
      const after = requested;
      e.requestRender(); // one frame on demand, then idle again
      vsyncs(30);
      expect(e.frames).toBe(frames + 1);
      expect(requested).toBe(after + 1);
      expect(queue).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(e.motion.uSway.value).toBe(0);
      expect(e.motion.uLimb.value).toBe(0);
      expect(new Set(layer.tick.mock.calls.map((c) => c[0])).size).toBe(1);
      // Medium turns it on (display rate); back to Low stops it after one frame.
      e.setTier("medium");
      e.requestRender();
      vsyncs(10);
      expect(queue).toHaveLength(1);
      expect(e.motion.uSway.value).toBe(1);
      e.setTier("low");
      vsyncs(3);
      const n = e.frames;
      vsyncs(20);
      expect(e.frames).toBe(n);
      expect(queue).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(e.motion.uSway.value).toBe(0);
    } finally {
      teardown(e);
    }
  });

  it("setMotion(null) stops the clock and disposes the layer", async () => {
    const { e, layer } = await setup({ on: true }, "medium");
    try {
      vsyncs(10); // display rate: the loop is running
      expect(queue).toHaveLength(1);
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

  it("setOverlays: markers in the overlay scene; lines and ground tint in the main scene (AO-skipped); pixel ratio pushed", async () => {
    spy.aoSkips.length = 0;
    const { e } = await setup({ on: false }, "medium");
    try {
      const THREE = await import("three");
      const layer = {
        group: new THREE.Group(),
        lineGroup: new THREE.Group(),
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
      expect(main?.children.includes(layer.lineGroup)).toBe(true);
      expect(scenes.some((sc) => sc.children.includes(layer.group))).toBe(true);
      expect(layer.setPixelRatio).toHaveBeenCalled();
      // The AO G-buffer leaves out the line batches and the flood tint.
      const skip = spy.aoSkips.at(-1);
      expect(skip).toBeTruthy();
      const skipped = skip?.() ?? [];
      expect(skipped).toContain(layer.lineGroup);
      expect(skipped).toContain(layer.groundGroup);
      e.setOverlays(null);
      expect(layer.groundGroup.parent).toBeNull();
      expect(layer.lineGroup.parent).toBeNull();
      expect(layer.dispose).toHaveBeenCalledTimes(1);
    } finally {
      teardown(e);
    }
  });
  it("times the first render after a streamed layer swap as tl:stream-upload, once per swap", async () => {
    const { e } = await setup({ on: false });
    try {
      const THREE = await import("three");
      settle();
      const p = performance as Performance & { measure: (...a: unknown[]) => unknown };
      const measure = vi.fn();
      const orig = p.measure;
      p.measure = measure;
      const uploads = () => measure.mock.calls.filter(([n]) => n === "tl:stream-upload").length;
      try {
        e.setDecor("roads", { group: new THREE.Group(), dispose: vi.fn() });
        settle();
        expect(uploads()).toBe(1);
        e.requestRender();
        settle();
        expect(uploads()).toBe(1);
        e.markSwap();
        settle();
        expect(uploads()).toBe(2);
        // Clearing a slot uploads nothing.
        e.setDecor("roads", null);
        settle();
        expect(uploads()).toBe(2);
      } finally {
        p.measure = orig;
      }
    } finally {
      teardown(e);
    }
  });

  it("pins every compiled shader program once, so a streamed layer's programs outlive its disposal", async () => {
    const { e } = await setup({ on: false });
    try {
      const info = spy.renderer?.info as { programs?: { usedTimes: number }[] };
      const p1 = { usedTimes: 1 };
      const p2 = { usedTimes: 2 };
      info.programs = [p1];
      e.requestRender();
      settle();
      expect(p1.usedTimes).toBe(2);
      info.programs = [p1, p2];
      e.requestRender();
      settle();
      e.requestRender();
      settle();
      // Each pinned exactly once.
      expect(p1.usedTimes).toBe(2);
      expect(p2.usedTimes).toBe(3);
    } finally {
      teardown(e);
    }
  });

  it("a replaced decor layer is disposed only after the next render; a layer waits for compileAsync before it shows", async () => {
    const { e } = await setup({ on: false });
    const THREE = await import("three");
    const proto = THREE.WebGLRenderer.prototype as unknown as {
      compileAsync?: unknown;
      getRenderTarget?: unknown;
      setRenderTarget?: unknown;
    };
    try {
      settle();
      const scenes = spy.scenes as import("three").Scene[];
      const holds = (g: import("three").Object3D) => scenes.some((sc) => sc.children.includes(g));
      const a = { group: new THREE.Group(), dispose: vi.fn() };
      e.setDecor("roads", a);
      expect(holds(a.group)).toBe(true);
      const b = { group: new THREE.Group(), dispose: vi.fn() };
      e.setDecor("roads", b);
      // Swapped at once (no compileAsync on this renderer), the old one disposed after a render.
      expect(holds(a.group)).toBe(false);
      expect(a.dispose).not.toHaveBeenCalled();
      settle();
      expect(a.dispose).toHaveBeenCalledTimes(1);
      // With compileAsync: shown when its programs are ready; the old layer stays until then.
      let resolve: () => void = () => {};
      proto.compileAsync = vi.fn(() => new Promise<void>((r) => (resolve = r)));
      proto.getRenderTarget = () => null;
      const targets: unknown[] = [];
      proto.setRenderTarget = (t: unknown) => targets.push(t);
      const c = { group: new THREE.Group(), dispose: vi.fn() };
      e.setDecor("roads", c);
      expect(holds(c.group)).toBe(false);
      expect(holds(b.group)).toBe(true);
      // Compiled for the composer's buffer (the scene pass target), then the target restored.
      expect(targets).toHaveLength(2);
      expect(targets[0]).not.toBeNull();
      expect(targets[1]).toBeNull();
      // A newer layer supersedes the waiting one, which is disposed and never shown.
      const first = resolve;
      const d = { group: new THREE.Group(), dispose: vi.fn() };
      e.setDecor("roads", d);
      expect(c.dispose).toHaveBeenCalledTimes(1);
      first();
      resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(holds(c.group)).toBe(false);
      expect(holds(d.group)).toBe(true);
      expect(holds(b.group)).toBe(false);
      settle();
      expect(b.dispose).toHaveBeenCalledTimes(1);
      expect(d.dispose).not.toHaveBeenCalled();
    } finally {
      delete proto.compileAsync;
      delete proto.getRenderTarget;
      delete proto.setRenderTarget;
      teardown(e);
    }
  });

  it("a compileAsync that throws still shows the layer, and warns once", async () => {
    const { e } = await setup({ on: false });
    const THREE = await import("three");
    const proto = THREE.WebGLRenderer.prototype as unknown as {
      compileAsync?: unknown;
      getRenderTarget?: unknown;
      setRenderTarget?: unknown;
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      settle();
      const scenes = spy.scenes as import("three").Scene[];
      const holds = (g: import("three").Object3D) => scenes.some((sc) => sc.children.includes(g));
      proto.compileAsync = vi.fn(() => {
        throw new Error("boom");
      });
      proto.getRenderTarget = () => null;
      const targets: unknown[] = [];
      proto.setRenderTarget = (t: unknown) => targets.push(t);
      const a = { group: new THREE.Group(), dispose: vi.fn() };
      e.setDecor("roads", a);
      await Promise.resolve();
      await Promise.resolve();
      expect(holds(a.group)).toBe(true);
      expect(targets[targets.length - 1]).toBeNull();
      const b = { group: new THREE.Group(), dispose: vi.fn() };
      e.setDecor("roads", b);
      await Promise.resolve();
      await Promise.resolve();
      expect(holds(b.group)).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      delete proto.compileAsync;
      delete proto.getRenderTarget;
      delete proto.setRenderTarget;
      teardown(e);
    }
  });

  it("setDecor('ambient'): the birds go into the main scene, never the overlay scene", async () => {
    const { e } = await setup({ on: false });
    try {
      const THREE = await import("three");
      const overlay = {
        group: new THREE.Group(),
        lineGroup: new THREE.Group(),
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
      const birds = { group: new THREE.Group(), dispose: vi.fn() };
      e.setOverlays(overlay);
      e.setDecor("ambient", birds);
      const scenes = spy.scenes as import("three").Scene[];
      const overlayScene = scenes.find((sc) => sc.children.includes(overlay.group));
      const mainScene = scenes.find((sc) => sc.children.includes(overlay.groundGroup));
      expect(overlayScene).toBeTruthy();
      expect(mainScene).toBeTruthy();
      expect(mainScene?.children.includes(birds.group)).toBe(true);
      expect(overlayScene?.children.includes(birds.group)).toBe(false);
    } finally {
      teardown(e);
    }
  });
  describe("LOD ticks (Task 4)", () => {
    it("onLodTick fires on the next frame with the orbit target and range; 'more' keeps ticking 250 ms apart, then stops", async () => {
      const { e } = await setup({ on: false });
      try {
        settle();
        const ticks: { x: number; z: number; rangeM: number; at: number }[] = [];
        let more = 3;
        e.onLodTick((t) => {
          ticks.push({ x: t.target.x, z: t.target.z, rangeM: t.rangeM, at: t.nowMs });
          return more-- > 0;
        });
        for (let i = 0; i < 200; i++) {
          vi.advanceTimersByTime(16);
          pump();
        }
        expect(ticks).toHaveLength(4);
        expect(ticks[0]!.x).toBeCloseTo(0);
        expect(ticks[0]!.z).toBeCloseTo(0);
        expect(ticks[0]!.rangeM).toBeCloseTo(800, 0);
        for (let i = 1; i < ticks.length; i++)
          expect(ticks[i]!.at - ticks[i - 1]!.at).toBeGreaterThanOrEqual(250);
        // Idle again: no frame, no timer.
        expect(queue).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
        // requestLodTick asks for one more.
        e.requestLodTick();
        settle();
        expect(ticks).toHaveLength(5);
      } finally {
        teardown(e);
      }
    });

    it("flying the rig across 10 tiles never plans more than one tile per frame (real streamer)", async () => {
      const { createStreamer } = await import("./stream/streamer");
      const { e } = await setup({ on: false });
      try {
        settle();
        let planned = 0;
        const s = createStreamer(() => {
          planned++;
          return { kits: new Map(), lamps: [], agents: [], signs: [], ribbons: [] };
        });
        e.onLodTick((t) => s.update(t.target, t.rangeM).pending);
        const perFrame: number[] = [];
        e.onFrame(() => {
          perFrame.push(planned);
        });
        e.rig.flyTo({ target: [2500, 0], rangeM: 800, pitchDeg: -45, headingDeg: 0 }, 3000);
        for (let i = 0; i < 400; i++) {
          vi.advanceTimersByTime(16);
          pump();
        }
        const deltas = perFrame.map((n, i) => n - (i > 0 ? (perFrame[i - 1] as number) : 0));
        expect(Math.max(...deltas)).toBeLessThanOrEqual(1);
        expect(planned).toBeGreaterThan(10);
      } finally {
        teardown(e);
      }
    });

    it("assets.update gets the view frustum, padded for shadow casters at Medium", async () => {
      const { e } = await setup({ on: false }, "medium");
      try {
        const THREE = await import("three");
        const update = vi.fn();
        e.setAssets({
          group: new THREE.Group(),
          update,
          aoExcluded: () => [],
          stats: () => ({
            instances: 0,
            meshes: 0,
            visibleMeshes: 0,
            gpuBytes: 0,
            visitedPerTick: 0,
          }),
          setKits: vi.fn(),
          kitSteps: () => ({ steps: [], commit: vi.fn(), cancel: vi.fn() }),
          dispose: vi.fn(),
        });
        settle();
        expect(update).toHaveBeenCalled();
        const [cam, f] = update.mock.calls.at(-1) as [
          import("three").Vector3,
          import("three").Frustum,
        ];
        expect(cam).toBeInstanceOf(THREE.Vector3);
        expect(f).toBeInstanceOf(THREE.Frustum);
        // 500 m behind the camera is outside the view but inside the shadow pad (800 m x 1.2 x
        // sqrt 2 + 250 m = 1.6 km); 5 km behind is culled.
        const back = cam.clone().normalize();
        expect(f.containsPoint(cam.clone().add(back.clone().multiplyScalar(500)))).toBe(true);
        expect(f.containsPoint(cam.clone().add(back.clone().multiplyScalar(5000)))).toBe(false);
      } finally {
        teardown(e);
      }
    });
  });
});
