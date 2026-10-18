import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import { createMotionUniforms, createRoleUniforms } from "../assets/roleMaterial";
import {
  createMotionDriver,
  DECOR_FADE_MS,
  decorativeOpacity,
  MOTION_FRAME_MS,
  motionRunning,
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
