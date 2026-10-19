import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import { createMotionUniforms, createRoleUniforms } from "../assets/roleMaterial";
import {
  createMotionClock,
  createMotionDriver,
  DECOR_FADE_MS,
  decorativeOpacity,
  MOTION_FALLBACK_FPS,
  MOTION_FRAME_MS,
  MOTION_SLACK_MS,
  type MotionMode,
  motionModeFor,
  motionRunning,
  resetMotionSession,
} from "./motionClock";
import { createMotionLayer } from "./motionLayer";

describe("motionRunning", () => {
  it("runs only when enabled, not reduced, visible and on screen (full truth table)", () => {
    for (const enabled of [false, true])
      for (const reduced of [false, true])
        for (const visible of [false, true])
          for (const onScreen of [false, true])
            expect(motionRunning({ enabled, reduced, visible, onScreen })).toBe(
              enabled && !reduced && visible && onScreen,
            );
  });
});

describe("decorativeOpacity", () => {
  it("fades 1 -> 0 within 1000 ms (± one tick), monotone", () => {
    let o = 1;
    let t = 0;
    let prev = o;
    while (o > 0 && t < 5000) {
      o = decorativeOpacity(o, 0, MOTION_FRAME_MS);
      t += MOTION_FRAME_MS;
      expect(o).toBeLessThanOrEqual(prev);
      prev = o;
    }
    expect(o).toBe(0);
    expect(Math.abs(t - DECOR_FADE_MS)).toBeLessThanOrEqual(MOTION_FRAME_MS + 1e-6);
  });
  it("fades back 0 -> 1 the same way, never overshoots, holds at the target", () => {
    expect(decorativeOpacity(0, 1, 500)).toBeCloseTo(0.5);
    expect(decorativeOpacity(0.9, 1, 500)).toBe(1);
    expect(decorativeOpacity(0.1, 0, 500)).toBe(0);
    expect(decorativeOpacity(1, 1, 33)).toBe(1);
    expect(decorativeOpacity(0.4, 0, 0)).toBe(0.4);
  });
});

describe("createMotionDriver", () => {
  const night = { day: 0, dusk: 0, night: 1 };
  const day = { day: 1, dusk: 0, night: 0 };
  const setup = (running = true) => {
    const role = createRoleUniforms();
    const ambient = { tick: vi.fn() };
    const state = { running };
    const d = createMotionDriver({
      role,
      ambient: () => ambient,
      running: () => state.running,
    });
    const agents = {
      group: new THREE.Group(),
      tick: vi.fn(),
      setOpacity: vi.fn(),
      setDensity: vi.fn(),
      dispose: vi.fn(),
    };
    d.setAgents(agents);
    return { d, role, ambient, agents, state };
  };
  const cam = new THREE.Vector3();

  it("each tick drives ambient, agents and flicker (1 by night while running)", () => {
    const { d, role, ambient, agents } = setup();
    d.setWeights(night);
    d.tick(1000, cam);
    expect(ambient.tick).toHaveBeenLastCalledWith(1000, night);
    expect(agents.tick).toHaveBeenLastCalledWith(1000, cam, undefined);
    expect(role.uFlicker.value).toBe(1);
    d.setWeights(day);
    d.tick(1033, cam);
    expect(role.uFlicker.value).toBe(0);
  });

  it("the Day/Rollout target fades the agents over 1 s; rest() turns flicker off", () => {
    const { d, role, agents } = setup();
    d.setWeights(night);
    d.tick(0, cam);
    d.setTarget(0);
    expect(d.target).toBe(0);
    d.tick(500, cam);
    expect(d.opacity).toBeCloseTo(0.5);
    d.tick(1000, cam);
    expect(d.opacity).toBe(0);
    expect(agents.setOpacity).toHaveBeenLastCalledWith(0);
    d.rest();
    expect(role.uFlicker.value).toBe(0);
  });

  it("while stopped a target change applies at once and the mood still reaches the ambient", () => {
    const { d, agents, ambient } = setup(false);
    d.tick(700, cam);
    d.setTarget(0);
    expect(d.opacity).toBe(0);
    expect(agents.setOpacity).toHaveBeenLastCalledWith(0);
    d.setWeights(night);
    expect(ambient.tick).toHaveBeenLastCalledWith(700, night);
  });

  it("motion stopping mid-fade snaps to the target (no half-visible agents while stopped)", () => {
    const { d, agents, state } = setup();
    d.tick(0, cam);
    d.setTarget(0);
    d.tick(500, cam);
    expect(d.opacity).toBeCloseTo(0.5);
    state.running = false;
    d.rest();
    expect(d.opacity).toBe(0);
    expect(agents.setOpacity).toHaveBeenLastCalledWith(0);
    // The stopped frames that still render (frozen clock) keep it there.
    d.tick(500, cam);
    expect(d.opacity).toBe(0);
  });

  it("the reverse: a fade-in caught by a stop shows the agents fully", () => {
    const { d, state } = setup();
    d.tick(0, cam);
    d.setTarget(0);
    d.tick(1000, cam);
    expect(d.opacity).toBe(0);
    d.setTarget(1);
    d.tick(1400, cam);
    expect(d.opacity).toBeCloseTo(0.4);
    state.running = false;
    // A stopped frame alone (before rest) also settles it.
    d.tick(1400, cam);
    expect(d.opacity).toBe(1);
  });

  it("with a real agent layer: stop mid-fade hides the agent meshes", () => {
    const state = { running: true };
    const d = createMotionDriver({
      role: createRoleUniforms(),
      ambient: () => null,
      running: () => state.running,
    });
    const lib: AssetLibrary = {
      geometry: () => new THREE.BoxGeometry(1, 1.7, 1),
      has: () => true,
      gpuBytes: () => 0,
      failed: [],
      dispose() {},
    };
    const spec = {
      group: "kit" as const,
      file: "x.glb",
      bytes: 1,
      repeat: "none" as const,
      frontage: "long" as const,
      fit: { xz: [0.5, 2], y: [0.5, 2] } as { xz: [number, number]; y: [number, number] },
      decorative: true,
      placement: null,
      jitter: {},
      variantByGroup: {},
      palettes: {},
      variants: {
        v: {
          size: [1, 1.7, 1] as [number, number, number],
          lods: [{ node: "n", tris: 12, maxM: 300 }],
        },
      },
    };
    const m: Manifest = {
      version: 1,
      as_of: "",
      precinctGroups: [],
      assets: { people: spec },
      landmarks: {},
    };
    const layer = createMotionLayer(
      [
        {
          id: "a",
          kind: "person",
          variant: "v",
          path: new Float32Array([0, 0, 10, 0]),
          length: 10,
          speed: 1,
          offset: 0,
        },
      ],
      lib,
      m,
      createRoleUniforms(),
      createMotionUniforms(),
    );
    d.setAgents(layer);
    const c = new THREE.Vector3(0, 20, 0);
    d.tick(0, c);
    d.setTarget(0);
    d.tick(500, c);
    expect(layer.group.visible).toBe(true);
    state.running = false;
    d.rest();
    expect(d.opacity).toBe(0);
    expect(layer.group.visible).toBe(false);
  });

  it("density follows the mood weights; setAgents replaces and disposes", () => {
    const { d, agents } = setup();
    d.setWeights(night);
    expect(agents.setDensity).toHaveBeenLastCalledWith(night);
    d.setAgents(null);
    expect(agents.dispose).toHaveBeenCalledTimes(1);
    expect(d.group.children).toHaveLength(0);
  });

  it("the group is decorative", () => {
    const { d } = setup();
    expect(d.group.userData.decorative).toBe(true);
    expect(createMotionUniforms().uSway.value).toBe(1);
  });
});

describe("createMotionClock (P4: display rate, one-shot 30 fps fallback)", () => {
  beforeEach(() => resetMotionSession());

  it("display mode is the default: every live rAF is a motion tick and the next wake is the next rAF", () => {
    const c = createMotionClock();
    expect(c.mode).toBe<MotionMode>("display");
    // A fake rAF loop at 60 Hz driven only by the clock's own wake requests.
    let rafs = 0;
    let ticks = 0;
    let now = 1000;
    let pending = true;
    for (let i = 0; i < 120 && pending; i++) {
      pending = false;
      rafs++;
      if (c.frame(now, true)) ticks++;
      expect(c.at).toBe(now);
      const wake = c.nextWakeMs(now, true);
      if (wake === 0) pending = true;
      now += 1000 / 60;
    }
    expect(rafs).toBe(120);
    expect(ticks).toBe(rafs);
  });

  it("running false schedules nothing and freezes the clock (P3 Review Focus 3)", () => {
    const c = createMotionClock();
    c.frame(1000, true);
    expect(c.frame(1016, false)).toBe(false);
    expect(c.at).toBe(1000);
    expect(c.nextWakeMs(1016, false)).toBeNull();
    const slow = createMotionClock({ mode: "30fps" });
    expect(slow.frame(5, false)).toBe(false);
    expect(slow.nextWakeMs(5, false)).toBeNull();
  });

  it("30fps mode keeps the P3 cadence: due at once on (re)start, then every MOTION_FRAME_MS - slack", () => {
    const c = createMotionClock({ mode: "30fps" });
    expect(c.frame(0, true)).toBe(true);
    expect(c.nextWakeMs(0, true)).toBeCloseTo(MOTION_FRAME_MS - MOTION_SLACK_MS);
    expect(c.frame(16, true)).toBe(false);
    expect(c.at).toBe(0);
    expect(c.nextWakeMs(16, true)).toBeCloseTo(MOTION_FRAME_MS - MOTION_SLACK_MS - 16);
    expect(c.frame(30, true)).toBe(true);
    // A stop then a restart: due at once again.
    c.frame(40, false);
    expect(c.frame(41, true)).toBe(true);
  });

  it("falls back to 30 fps once after a slow median during motion, for the session", () => {
    expect(MOTION_FALLBACK_FPS).toBe(45);
    const c = createMotionClock();
    // Fast frames (60 fps) for 4 s: no change.
    let now = 0;
    for (let i = 0; i < 240; i++, now += 1000 / 60) c.frame(now, true);
    expect(c.mode).toBe("display");
    // Slow frames (30 fps) for a full window: falls back.
    const changes: MotionMode[] = [];
    c.onModeChange((m) => changes.push(m));
    for (let i = 0; i < 120; i++, now += 1000 / 30) c.frame(now, true);
    expect(c.mode).toBe("30fps");
    expect(changes).toEqual(["30fps"]);
    // Fast again: it stays at 30 fps (once per session), and a new clock starts at 30 fps too.
    for (let i = 0; i < 400; i++, now += 1000 / 120) c.frame(now, true);
    expect(c.mode).toBe("30fps");
    expect(changes).toEqual(["30fps"]);
    expect(createMotionClock().mode).toBe("30fps");
  });

  it("slow frames while motion is stopped never trigger the fallback; reportFrameMedian is the external hook", () => {
    const c = createMotionClock();
    let now = 0;
    for (let i = 0; i < 200; i++, now += 100) c.frame(now, false);
    expect(c.mode).toBe("display");
    expect(c.reportFrameMedian(20)).toBe(false); // last frame was not live
    c.frame(now, true);
    expect(c.reportFrameMedian(50)).toBe(false);
    expect(c.reportFrameMedian(44)).toBe(true);
    expect(c.mode).toBe("30fps");
    expect(c.reportFrameMedian(10)).toBe(false); // only once
  });

  it("an idle gap (stop, then restart) is not counted as one slow frame", () => {
    const c = createMotionClock();
    let now = 0;
    for (let k = 0; k < 40; k++) {
      c.frame(now, true);
      now += 1000 / 60;
      c.frame(now, true);
      now += 1000; // stopped for a second
      c.frame(now, false);
      now += 16;
    }
    expect(c.mode).toBe("display");
  });

  it("motionModeFor: display at High and Medium, null (motion off) at Low", () => {
    expect(motionModeFor("high")).toBe("display");
    expect(motionModeFor("medium")).toBe("display");
    expect(motionModeFor("low")).toBeNull();
  });
});
