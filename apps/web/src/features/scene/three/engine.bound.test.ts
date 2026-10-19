import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { fitFor } from "./cameraFit";
import { LIMITS } from "./cameraRig";
import { createRig } from "./engine";
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
