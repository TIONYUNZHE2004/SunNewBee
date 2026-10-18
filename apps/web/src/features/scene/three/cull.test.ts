import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { cullFrustum, padFrustum, shadowPadM } from "./cull";

/** A camera at 800 m looking straight down the -z axis at the origin, 50 degree fov, square. */
function cam() {
  const c = new THREE.PerspectiveCamera(50, 1, 2, 30000);
  c.position.set(0, 0, 800);
  c.lookAt(0, 0, 0);
  c.updateProjectionMatrix();
  return c;
}
const box = (x: number) =>
  new THREE.Box3(new THREE.Vector3(x - 10, -10, -10), new THREE.Vector3(x + 10, 10, 10));

describe("padFrustum / cullFrustum (P4-I)", () => {
  it("a box just outside the view is culled unpadded and kept within the pad", () => {
    // Half width of the view at 800 m: 800 tan 25 deg = 373 m.
    const plain = cullFrustum(cam(), 0, new THREE.Frustum());
    expect(plain.intersectsBox(box(300))).toBe(true);
    expect(plain.intersectsBox(box(600))).toBe(false);
    const padded = cullFrustum(cam(), 400, new THREE.Frustum());
    expect(padded.intersectsBox(box(600))).toBe(true);
    // Far beyond the pad: still culled.
    expect(padded.intersectsBox(box(2000))).toBe(false);
  });

  it("pad 0 leaves the frustum unchanged", () => {
    const f = cullFrustum(cam(), 0, new THREE.Frustum());
    const before = f.planes.map((p) => p.constant);
    padFrustum(f, 0);
    expect(f.planes.map((p) => p.constant)).toEqual(before);
  });

  it("the shadow pad covers the shadow box corner plus the tallest caster; none without shadows", () => {
    expect(shadowPadM(false, 960)).toBe(0);
    expect(shadowPadM(true, 960)).toBeCloseTo(960 * Math.SQRT2 + 250);
    // Every shadow-box corner (target-centred, half 960) passes the padded test.
    const f = cullFrustum(cam(), shadowPadM(true, 960), new THREE.Frustum());
    for (const [x, y] of [
      [960, 960],
      [-960, 960],
      [960, -960],
      [-960, -960],
    ] as const)
      expect(f.containsPoint(new THREE.Vector3(x, y, 0))).toBe(true);
  });
});
