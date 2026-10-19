// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClearance } from "./clearance";

// Building clearance at engine level (A-T7 review r2): MapControls calls update() inside its
// pointer handlers, between engine ticks. The lift must never leak into the base pose there.
// No WebGL: a fake renderer and composer, a hand-pumped rAF queue (as in engine.create.test.ts).
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
    dispose = vi.fn();
    forceContextLoss = vi.fn();
  }
  class Pmrem {
    fromScene() {
      return { texture: new t.Texture(), dispose: vi.fn() };
    }
    dispose = vi.fn();
  }
  return { ...t, WebGLRenderer: FakeRenderer, PMREMGenerator: Pmrem };
});
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
    enabled = true;
    dispose = vi.fn();
    setSize = vi.fn();
  };
vi.mock("three/addons/postprocessing/RenderPass.js", () => ({ RenderPass: stubPass() }));
vi.mock("three/addons/postprocessing/OutputPass.js", () => ({ OutputPass: stubPass() }));
vi.mock("three/addons/postprocessing/UnrealBloomPass.js", () => ({
  UnrealBloomPass: stubPass(),
}));
vi.mock("./aoPass", () => ({ CityGTAOPass: stubPass() }));

type Frame = { id: number; cb: FrameRequestCallback };
let queue: Frame[] = [];
let nextId = 1;
const pump = () => {
  const due = queue;
  queue = [];
  for (const f of due) f.cb(performance.now());
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function pointer(type: string, x: number, y: number) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
  Object.assign(e, { pointerId: 1, pointerType: "mouse" });
  return e;
}

async function setup() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  queue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    queue = queue.filter((f) => f.id !== id);
  });
  const { createEngine } = await import("./engine");
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  Object.defineProperty(canvas, "clientWidth", { value: 800 });
  Object.defineProperty(canvas, "clientHeight", { value: 600 });
  Object.assign(canvas, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    // MapControls pans by raycasting the cursor through the canvas rect (jsdom's is empty).
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
    }),
  });
  const e = createEngine(canvas, "low");
  e.resize(800, 600);
  // One 100 m slab over everything the drag can reach: the camera is always over a roof.
  const c = createClearance([
    {
      id: "slab",
      ring: [
        [-2000, -2000],
        [2000, -2000],
        [2000, 2000],
        [-2000, 2000],
      ],
      topM: 100,
    },
  ]);
  e.setClearance?.(c);
  // The real renderer updates the camera's world matrix every render; the fake one does not.
  e.onFrame(() => e.pickView().camera.updateMatrixWorld());
  // Base camera height: 60 * sin(20 deg) = 20.5 m, under the 102 m floor.
  e.rig.set({ target: [0, 0], rangeM: 60, pitchDeg: -20, headingDeg: 0 });
  e.pickView().camera.updateMatrixWorld();
  const frame = () => {
    vi.advanceTimersByTime(16);
    pump();
  };
  return { e, canvas, frame };
}

describe("engine building clearance", () => {
  it("a pointer-drag pan while lifted never ratchets the base up; every render is base + lift", async () => {
    const { e, canvas, frame } = await setup();
    const rendered: number[] = [];
    e.onFrame(() => rendered.push(e.pickView().camera.position.y));
    frame();
    const baseY0 = e.rig.get().rangeM * Math.sin((-e.rig.get().pitchDeg * Math.PI) / 180);
    expect(baseY0).toBeCloseTo(60 * Math.sin((20 * Math.PI) / 180), 3);
    expect(rendered.at(-1)).toBeCloseTo(102, 3);

    canvas.dispatchEvent(pointer("pointerdown", 400, 300));
    for (let i = 1; i <= 30; i++) {
      // Several handler updates between ticks, as a fast mouse produces.
      document.dispatchEvent(pointer("pointermove", 400 + i * 6, 300 + i * 2));
      document.dispatchEvent(pointer("pointermove", 400 + i * 6 + 3, 300 + i * 2 + 1));
      frame();
    }
    document.dispatchEvent(pointer("pointerup", 590, 362));
    for (let i = 0; i < 60; i++) frame();

    const p = e.rig.get();
    const baseY = p.rangeM * Math.sin((-p.pitchDeg * Math.PI) / 180);
    // The pan really moved the camera.
    expect(Math.hypot(p.target[0], p.target[1])).toBeGreaterThan(1);
    // The base never rose (ground-plane pan keeps the height).
    expect(baseY).toBeLessThanOrEqual(baseY0 + 0.05);
    // Every rendered frame is base + lift: on the floor, never above it (no ratchet into the sky).
    for (const y of rendered) {
      expect(y).toBeGreaterThanOrEqual(102 - 1e-6);
      expect(y).toBeLessThanOrEqual(102 + 0.05);
    }
    e.dispose();
  });

  it("a wheel zoom while lifted changes the base range only (no lift folded in)", async () => {
    const { e, canvas, frame } = await setup();
    frame();
    const r0 = e.rig.get().rangeM;
    for (let i = 0; i < 5; i++) {
      canvas.dispatchEvent(
        Object.assign(new WheelEvent("wheel", { deltaY: 100, clientX: 400, clientY: 300 }), {}),
      );
      frame();
    }
    for (let i = 0; i < 60; i++) frame();
    const p = e.rig.get();
    // Zooming out by 5 notches: the range grows by the zoom factor only, and the pitch is the base
    // pitch (-20), not the lifted one (about -60).
    expect(p.rangeM).toBeGreaterThan(r0);
    expect(p.pitchDeg).toBeCloseTo(-20, 0);
    e.dispose();
  });
});
