import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { LIMITS, type Pose } from "./cameraRig";
import { createRig } from "./engine";

const bounds = { min: [-100, -100] as [number, number], max: [100, 100] as [number, number] };

function rig() {
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 10000);
  const target = new THREE.Vector3();
  const changed = vi.fn();
  const size = (): [number, number] => [100, 100];
  return { r: createRig({ camera, target, changed, size }, () => bounds), camera, target, changed };
}

const p: Pose = { target: [10, -20], rangeM: 500, pitchDeg: -45, headingDeg: 30 };

describe("createRig", () => {
  it("set() then get() round-trips the pose", () => {
    const { r, changed } = rig();
    r.set(p);
    const g = r.get();
    expect(g.target[0]).toBeCloseTo(10);
    expect(g.target[1]).toBeCloseTo(-20);
    expect(g.rangeM).toBeCloseTo(500);
    expect(g.pitchDeg).toBeCloseTo(-45);
    expect(g.headingDeg).toBeCloseTo(30);
    expect(changed).toHaveBeenCalled();
  });

  it("set() clamps to 30 m, -5 degrees and the bounds plus the centre offset", () => {
    const { r } = rig();
    r.set({ target: [1e6, 0], rangeM: 1, pitchDeg: 20, headingDeg: 0 });
    const g = r.get();
    expect(g.rangeM).toBeCloseTo(LIMITS.minRangeM);
    expect(g.pitchDeg).toBeCloseTo(LIMITS.maxPitchDeg);
    expect(g.target[0]).toBeCloseTo(100 + LIMITS.maxCentreOffsetM);
  });

  it("flyTo() clamps the goal and arrives after the duration (real time)", () => {
    const { r } = rig();
    r.set(p);
    r.flyTo({ ...p, rangeM: 1e9 }, 1000);
    expect(r.step(performance.now() + 500)).toBe(true);
    expect(r.step(performance.now() + 2000)).toBe(false);
    expect(r.get().rangeM).toBeCloseTo(LIMITS.maxRangeM);
  });

  it("set() cancels a running flight", () => {
    const { r } = rig();
    r.set(p);
    r.flyTo({ ...p, rangeM: 2000 }, 1000);
    r.set({ ...p, rangeM: 300 });
    expect(r.step(performance.now() + 2000)).toBe(false);
    expect(r.get().rangeM).toBeCloseTo(300);
  });

  it("pick() hits the ground under the screen centre and misses the sky", () => {
    const { r, camera } = rig();
    r.set({ target: [0, 0], rangeM: 500, pitchDeg: -10, headingDeg: 0 });
    const hit = r.pick({ x: 50, y: 50 });
    expect(hit?.[0]).toBeCloseTo(0);
    expect(hit?.[1]).toBeCloseTo(0);
    // The top edge looks 5 degrees above the horizon (vertical FOV 30).
    expect(r.pick({ x: 50, y: 0 })).toBeNull();
    expect(camera.position.y).toBeGreaterThan(0);
  });
});
