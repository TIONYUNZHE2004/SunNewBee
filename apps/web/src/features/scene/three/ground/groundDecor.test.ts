import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Site } from "../props/construction";
import { GRAVEL_TINT, TRACK_COLOUR } from "../props/construction";
import { CONSTRUCTION_Y, GROUND_BANDS, VERGE_Y } from "./bands";
import { createGroundDecorLayer } from "./groundDecor";
import { LANDCOVER_COLOURS } from "./landcover";

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
const site: Site = {
  id: "0.0",
  poly: [
    [
      [0, 0],
      [100, 0],
      [100, 80],
      [0, 80],
    ],
  ],
};
const tracks = new Float32Array([10, 40, 90, 40]);
const strips = (...p: Float32Array[]) => ({ strips: p, tracks: [], gravel: [] });
const colourAt = (m: THREE.Mesh, v: number) => {
  const c = m.geometry.getAttribute("color");
  return [c.getX(v), c.getY(v), c.getZ(v)];
};
const rgb = (hex: string) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b].map(Math.fround);
};

describe("createGroundDecorLayer (verges + construction ground, one draw)", () => {
  it("merges every tile's strips into ONE decorative, unpickable mesh in the decor band", () => {
    const layer = createGroundDecorLayer(strips(piece(0), piece(10), piece(20)))!;
    const meshes = layer.group.children as THREE.Mesh[];
    expect(meshes).toHaveLength(1);
    const m = meshes[0]!;
    expect(m.geometry.getAttribute("position").count).toBe(18);
    expect(m.renderOrder).toBe(GROUND_BANDS.decor.order);
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
    expect(colourAt(m, 0)).toEqual(rgb(LANDCOVER_COLOURS.grass!));
    const mat = m.material as THREE.MeshStandardMaterial;
    expect(mat.polygonOffsetFactor).toBe(GROUND_BANDS.decor.offset);
    // Painted in triangle order, like land cover: parks, water and roads draw over it.
    expect(mat.depthWrite).toBe(false);
    // Strips keep the verge lift, below the roads.
    expect(m.geometry.getAttribute("position").getY(0)).toBeCloseTo(0.07, 6);
  });

  it("carries the construction ground in the same mesh: gravel, then tracks, then verges, each at its lift", () => {
    const layer = createGroundDecorLayer({
      strips: [piece(200)],
      tracks: [tracks],
      gravel: [site],
    })!;
    const meshes = layer.group.children as THREE.Mesh[];
    expect(meshes).toHaveLength(1);
    const m = meshes[0]!;
    const p = m.geometry.getAttribute("position");
    // Gravel (2 triangles), one track quad (2), one verge piece (2).
    expect(p.count).toBe(18);
    expect(p.getY(0)).toBeCloseTo(CONSTRUCTION_Y, 6);
    expect(p.getY(6)).toBeCloseTo(CONSTRUCTION_Y, 6);
    expect(p.getY(12)).toBeCloseTo(VERGE_Y, 6);
    expect(colourAt(m, 0)).toEqual(rgb(GRAVEL_TINT));
    expect(colourAt(m, 6)).toEqual(rgb(TRACK_COLOUR));
    expect(colourAt(m, 12)).toEqual(rgb(LANDCOVER_COLOURS.grass!));
    const ray = new THREE.Raycaster(new THREE.Vector3(50, 10, 40), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(layer.group, true)).toEqual([]);
    // Construction ground alone still draws (no verges needed).
    expect(createGroundDecorLayer({ strips: [], tracks: [], gravel: [site] })).not.toBeNull();
  });

  it("takes the ground detail when given the motion clock", () => {
    const layer = createGroundDecorLayer(strips(piece(0)), { value: 0 })!;
    const mat = (layer.group.children[0] as THREE.Mesh).material as THREE.Material;
    expect(mat.customProgramCacheKey()).toContain("_groundDetail");
  });

  it("returns null when there is nothing to draw, and dispose frees the geometry", () => {
    expect(createGroundDecorLayer(strips())).toBeNull();
    expect(createGroundDecorLayer(strips(new Float32Array(0)))).toBeNull();
    const layer = createGroundDecorLayer(strips(piece(0)))!;
    const geo = (layer.group.children[0] as THREE.Mesh).geometry;
    let freed = false;
    geo.addEventListener("dispose", () => {
      freed = true;
    });
    layer.dispose();
    expect(freed).toBe(true);
  });
});
