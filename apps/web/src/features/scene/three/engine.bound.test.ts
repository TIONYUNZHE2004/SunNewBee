import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { fitFor } from "./cameraFit";
import { LIMITS, type Pose, wrap180 } from "./cameraRig";
import { createRig, FIT_LAND_MS } from "./engine";
import { createFrame } from "./frame";
import { boundaryOf, insideBoundary } from "./ground/boundary";

/**
 * A-T5: the engine rig keeps the camera bound to the slab, for set() and for camera moves made
 * outside the rig (MapControls drags and wheel zoom), through constrain() in the frame tick.
 */
const frame = createFrame([101.5, 3.18]);
// A 2.4 km x 4 km rectangle (long axis north-south), around the origin.
const ring = [
  [-1200, -2000],
  [1200, -2000],
  [1200, 2000],
  [-1200, 2000],
  [-1200, -2000],
].map(([x, z]) => frame.toLonLat(x as number, z as number));
const B = boundaryOf({ type: "Polygon", coordinates: [ring] }, frame)!;
const fit = fitFor(B);
const bounds = { min: [-1200, -2000] as [number, number], max: [1200, 2000] as [number, number] };

function rig() {
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 30000);
  const target = new THREE.Vector3();
  const changed = vi.fn();
  const teleported = vi.fn();
  const r = createRig(
    { camera, target, changed, size: () => [100, 100], teleported },
    () => bounds,
    () => fit,
  );
  return { r, camera, target, changed, teleported };
}

describe("createRig with a slab fit (A-T5)", () => {
  it("set() keeps the target inside the outline", () => {
    const { r } = rig();
    r.set({ target: [9000, -9000], rangeM: 500, pitchDeg: -45, headingDeg: 0 });
    const g = r.get().target;
    expect(insideBoundary(B, g[0], g[1])).toBe(true);
  });

  it("constrain() pulls a target dragged off the slab back inside, without a teleport", () => {
    const { r, camera, target, teleported } = rig();
    r.set({ target: [0, 0], rangeM: 500, pitchDeg: -45, headingDeg: 0 });
    teleported.mockClear();
    // A MapControls pan moves camera and target together, past the east edge.
    const d = new THREE.Vector3(4000, 0, 0);
    camera.position.add(d);
    target.add(d);
    expect(r.constrain()).toBe(true);
    const g = r.get();
    expect(insideBoundary(B, g.target[0], g.target[1])).toBe(true);
    expect(g.target[0]).toBeGreaterThan(1190);
    expect(g.rangeM).toBeCloseTo(500);
    expect(teleported).not.toHaveBeenCalled();
    // Already inside: nothing to do.
    expect(r.constrain()).toBe(false);
  });

  it("constrain() applies the long-range rules to a wheel zoom out to max range", () => {
    const { r, camera, target } = rig();
    r.set({ target: [800, 1500], rangeM: 1000, pitchDeg: -10, headingDeg: 90 });
    // Dolly straight out to max range (as the wheel does), keeping the shallow angle.
    const off = camera.position.clone().sub(target).setLength(LIMITS.maxRangeM);
    camera.position.copy(target).add(off);
    r.constrain();
    const g = r.get();
    expect(g.rangeM).toBeCloseTo(LIMITS.maxRangeM);
    expect(g.pitchDeg).toBeLessThanOrEqual(-45 + 1e-6);
    expect(Math.hypot(g.target[0] - fit.centre[0], g.target[1] - fit.centre[1])).toBeLessThan(
      Math.abs(fit.shiftM) + 1,
    );
  });
});

describe("the fit landing (A-T5 fix round 2): no one-frame snap", () => {
  /** A rig whose fit is null until `land()` (as while the engine computes it in idle slices). */
  function lateRig() {
    const camera = new THREE.PerspectiveCamera(30, 1, 1, 30000);
    const target = new THREE.Vector3();
    let current: typeof fit | null = null;
    const r = createRig(
      { camera, target, changed: vi.fn(), size: () => [100, 100] },
      () => bounds,
      () => current,
    );
    return {
      r,
      land: () => {
        current = fit;
      },
    };
  }
  const pre: Pose = { target: [3000, 0], rangeM: 7000, pitchDeg: -20, headingDeg: 0 };
  const step = (a: Pose, b: Pose) => ({
    target: Math.hypot(a.target[0] - b.target[0], a.target[1] - b.target[1]),
    pitch: Math.abs(a.pitchDeg - b.pitchDeg),
    heading: Math.abs(wrap180(a.headingDeg - b.headingDeg)),
  });

  it("without the landing, the first constrain after the fit would jump in one frame", () => {
    const { r, land } = lateRig();
    r.set(pre); // plain clamp: target outside the outline, shallow pitch at 7 km are allowed
    const before = r.get();
    land();
    r.constrain();
    const s = step(before, r.get());
    expect(s.target + s.pitch * 50).toBeGreaterThan(500); // a visible snap
  });

  it("landFit eases into the clamped pose over the landing; every frame steps a little", () => {
    const { r, land } = lateRig();
    r.set(pre);
    land();
    r.landFit(FIT_LAND_MS);
    const t0 = performance.now();
    let prev = r.get();
    let worst = { target: 0, pitch: 0, heading: 0 };
    const weights: number[] = [];
    for (let f = 1; f <= Math.ceil(FIT_LAND_MS / 16) + 2; f++) {
      const now = t0 + f * 16;
      r.step(now);
      r.constrain(); // the tick calls it every frame: it must hold off while landing
      weights.push(r.landingWeight(now));
      const cur = r.get();
      const s = step(prev, cur);
      worst = {
        target: Math.max(worst.target, s.target),
        pitch: Math.max(worst.pitch, s.pitch),
        heading: Math.max(worst.heading, s.heading),
      };
      prev = cur;
    }
    // ~57 frames for the whole move: no frame takes more than a few percent of it.
    expect(worst.target).toBeLessThan(150);
    expect(worst.pitch).toBeLessThan(2);
    expect(worst.heading).toBeLessThan(2);
    expect(r.flying()).toBe(false);
    // Lands exactly on the fit's clamp, and constrain has nothing left to do.
    const end = r.get();
    expect(insideBoundary(B, end.target[0], end.target[1])).toBe(true);
    expect(r.constrain()).toBe(false);
    // The field-of-view weight rises 0 -> 1 monotonically.
    expect(weights[0]).toBeLessThan(0.05);
    expect(weights[weights.length - 1]).toBe(1);
    for (let i = 1; i < weights.length; i++)
      expect(weights[i]!).toBeGreaterThanOrEqual(weights[i - 1]!);
  });

  it("a flight already running when the fit lands is not snapped (holdConstrain)", () => {
    const { r, land } = lateRig();
    r.set(pre);
    r.flyTo({ ...pre, target: [0, 0], rangeM: 7900 }, 1000);
    land();
    r.holdConstrain();
    const t0 = performance.now();
    r.step(t0 + 16);
    const a = r.get();
    expect(r.constrain()).toBe(false);
    expect(r.get()).toEqual(a);
  });
});
