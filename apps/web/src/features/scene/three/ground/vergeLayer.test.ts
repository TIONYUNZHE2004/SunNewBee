import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GROUND_BANDS, VERGE_Y } from "./bands";
import { LANDCOVER_COLOURS } from "./landcover";
import { createVergeLayer } from "./vergeLayer";

/** One 2 m strip piece (two triangles) at x0. */
const piece = (x0: number) =>
  new Float32Array([
    x0,
    VERGE_Y,
    3,
    x0 + 2,
    VERGE_Y,
    3,
    x0,
    VERGE_Y,
    4.5,
    x0 + 2,
    VERGE_Y,
    3,
    x0 + 2,
    VERGE_Y,
    4.5,
    x0,
    VERGE_Y,
    4.5,
  ]);

describe("createVergeLayer", () => {
  it("merges every tile's strips into ONE decorative, unpickable mesh in the verges band", () => {
    const layer = createVergeLayer([piece(0), piece(10), piece(20)])!;
    const meshes = layer.group.children as THREE.Mesh[];
    expect(meshes).toHaveLength(1);
    const m = meshes[0]!;
    expect(m.geometry.getAttribute("position").count).toBe(18);
    expect(m.renderOrder).toBe(GROUND_BANDS.verges.order);
    expect(m.renderOrder).toBe(3.5);
    expect(m.userData.decorative).toBe(true);
    expect(layer.group.userData.decorative).toBe(true);
    expect(m.castShadow).toBe(false);
    expect(m.receiveShadow).toBe(true);
    const hits: THREE.Intersection[] = [];
    m.raycast(
      new THREE.Raycaster(new THREE.Vector3(1, 10, 3.5), new THREE.Vector3(0, -1, 0)),
      hits,
    );
    expect(hits).toHaveLength(0);
    // Grass, through the vertex colours the ground detail reads.
    const c = m.geometry.getAttribute("color");
    const grass = new THREE.Color(LANDCOVER_COLOURS.grass);
    expect([c.getX(0), c.getY(0), c.getZ(0)]).toEqual([grass.r, grass.g, grass.b].map(Math.fround));
    const mat = m.material as THREE.MeshStandardMaterial;
    expect(mat.polygonOffsetFactor).toBe(GROUND_BANDS.verges.offset);
    // Strips sit at the verge lift, below the roads.
    expect(m.geometry.getAttribute("position").getY(0)).toBeCloseTo(0.07, 6);
  });

  it("takes the ground detail when given the motion clock", () => {
    const layer = createVergeLayer([piece(0)], { value: 0 })!;
    const mat = (layer.group.children[0] as THREE.Mesh).material as THREE.Material;
    expect(mat.customProgramCacheKey()).toContain("_groundDetail");
  });

  it("returns null when there are no strips, and dispose frees the geometry", () => {
    expect(createVergeLayer([])).toBeNull();
    expect(createVergeLayer([new Float32Array(0)])).toBeNull();
    const layer = createVergeLayer([piece(0)])!;
    const geo = (layer.group.children[0] as THREE.Mesh).geometry;
    let freed = false;
    geo.addEventListener("dispose", () => {
      freed = true;
    });
    layer.dispose();
    expect(freed).toBe(true);
  });
});
