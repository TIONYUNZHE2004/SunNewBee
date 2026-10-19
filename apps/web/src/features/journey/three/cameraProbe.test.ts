import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createClearance } from "../../scene/three/clearance";
import { probeCamera } from "./cameraProbe";

/**
 * Final F1: the journey hero is a slot group left at the scene origin while `setPose` moves the
 * model inside it. The probe must judge the footprint under her body, not under the slot origin.
 */
describe("probeCamera: the footprint under her", () => {
  const square = (cx: number, cz: number, h: number): [number, number][] => [
    [cx - h, cz - h],
    [cx + h, cz - h],
    [cx + h, cz + h],
    [cx - h, cz + h],
  ];
  const slotWithBodyAt = (x: number, z: number) => {
    const slot = new THREE.Group(); // stays at (0, 0, 0)
    const model = new THREE.Group();
    model.position.set(x, 0, z);
    model.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.5).translate(0, 0.8, 0)));
    slot.add(model);
    return slot;
  };
  const probe = (hero: THREE.Object3D, obstacles: Parameters<typeof createClearance>[0]) => {
    const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 1000);
    camera.position.set(18, 4, 55);
    camera.lookAt(18, 1, 64);
    return probeCamera({
      camera,
      driven: true,
      cameraT: null,
      canvas: [1440, 900],
      frame: { w: 1440, h: 900 },
      hero,
      roots: [],
      clearance: createClearance(obstacles),
      element: null,
    });
  };

  it("a building around the slot origin is not under her", () => {
    const p = probe(slotWithBodyAt(18, 64), [{ id: "origin", ring: square(0, 0, 20), topM: 9 }]);
    expect(p.heroInFootprint).toBe(false);
    expect(p.heroFootprintIds).toEqual([]);
  });

  it("a building around her body is", () => {
    const p = probe(slotWithBodyAt(18, 64), [{ id: "here", ring: square(18, 64, 5), topM: 9 }]);
    expect(p.heroInFootprint).toBe(true);
    expect(p.heroFootprintIds).toEqual(["here"]);
  });
});
