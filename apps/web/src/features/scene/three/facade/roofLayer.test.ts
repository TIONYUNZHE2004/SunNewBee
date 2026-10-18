import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createRoleUniforms } from "../assets/roleMaterial";
import { NEUTRAL_COLOURS } from "../fallbackStyle";
import { createRoofLayer } from "./roofLayer";
import { roofDressing } from "./roofPlan";

const item = (id: string, x0: number) => ({
  id,
  dressing: roofDressing(
    {
      id,
      ring: [
        [x0, 0],
        [x0 + 60, 0],
        [x0 + 60, -30],
        [x0, -30],
      ],
      heightM: 12,
      archetype: "factory",
    },
    NEUTRAL_COLOURS,
  ),
});
const items = [item("a", 0), item("b", 100)];

describe("createRoofLayer", () => {
  it("draws at most 3 instanced meshes", () => {
    const layer = createRoofLayer(items, createRoleUniforms(), "medium");
    expect(layer.group.children.length).toBeGreaterThan(0);
    expect(layer.group.children.length).toBeLessThanOrEqual(3);
    for (const m of layer.group.children) expect(m).toBeInstanceOf(THREE.InstancedMesh);
    layer.dispose();
  });

  it("is decorative and its raycast returns nothing", () => {
    const layer = createRoofLayer(items, createRoleUniforms(), "high");
    expect(layer.group.userData.decorative).toBe(true);
    layer.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(10, 50, -15), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(layer.group, true)).toEqual([]);
    layer.group.traverse((o) => {
      if (o === layer.group) return;
      expect(o.userData.decorative).toBe(true);
      expect(o.castShadow).toBe(false);
    });
    layer.dispose();
  });

  it("is empty at Low and with no items", () => {
    expect(createRoofLayer(items, createRoleUniforms(), "low").group.children).toHaveLength(0);
    expect(createRoofLayer([], createRoleUniforms(), "high").group.children).toHaveLength(0);
  });

  it("disposes", () => {
    const layer = createRoofLayer(items, createRoleUniforms(), "high");
    layer.dispose();
    expect(layer.group.children).toHaveLength(0);
  });
});
