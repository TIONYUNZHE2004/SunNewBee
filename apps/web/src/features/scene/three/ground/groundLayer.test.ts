import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GROUND_BANDS } from "./bands";
import { createGroundLayer } from "./groundLayer";
import type { Ribbon } from "./ribbons";

const ribbon = (kind: Ribbon["kind"], marking = false): Ribbon => ({
  kind,
  marking,
  positions: new Float32Array([0, 0.08, 0, 1, 0.08, 0, 0, 0.08, 1]),
  indices: new Uint32Array([0, 1, 2]),
});
const lc = () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  return g;
};
const meshes = (g: THREE.Group) =>
  g.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);

describe("createGroundLayer", () => {
  it("meshes are decorative, unpickable, receive shadows and do not cast", () => {
    const layer = createGroundLayer(
      [ribbon("major"), ribbon("residential"), ribbon("major", true)],
      lc(),
      "medium",
    );
    const ms = meshes(layer.group);
    expect(ms.length).toBeGreaterThanOrEqual(3);
    expect(ms.length).toBeLessThanOrEqual(6);
    const hits: THREE.Intersection[] = [];
    for (const m of ms) {
      expect(m.userData.decorative).toBe(true);
      expect(m.receiveShadow).toBe(true);
      expect(m.castShadow).toBe(false);
      m.raycast(new THREE.Raycaster(), hits);
    }
    expect(hits).toHaveLength(0);
  });

  it("merges all roads into one mesh and markings into another (3 draws)", () => {
    const layer = createGroundLayer(
      [ribbon("major"), ribbon("footway"), ribbon("other"), ribbon("major", true)],
      lc(),
      "high",
    );
    expect(meshes(layer.group)).toHaveLength(3);
  });

  it("land cover paints in triangle order: no depth write (no class z-fight); roads still write depth", () => {
    const layer = createGroundLayer([ribbon("major"), ribbon("major", true)], lc(), "high");
    const [land, roads, marks] = meshes(layer.group).map((m) => m.material as THREE.Material);
    expect(land!.depthWrite).toBe(false);
    expect(land!.depthTest).toBe(true);
    expect(roads!.depthWrite).toBe(true);
    expect(marks!.depthWrite).toBe(true);
  });

  it("the low tier skips the dashed markings", () => {
    const layer = createGroundLayer([ribbon("major"), ribbon("major", true)], lc(), "low");
    expect(meshes(layer.group)).toHaveLength(2);
  });

  it("dispose frees geometries and materials", () => {
    const g = lc();
    let geo = 0;
    g.addEventListener("dispose", () => geo++);
    const layer = createGroundLayer([ribbon("major")], g, "medium");
    let mat = 0;
    const ms = meshes(layer.group);
    for (const m of ms) (m.material as THREE.Material).addEventListener("dispose", () => mat++);
    layer.dispose();
    expect(geo).toBe(1);
    expect(mat).toBe(ms.length);
  });

  it("land cover takes the ground detail (after the shimmer, on the shared clock); roads do not", () => {
    const uTime = { value: 0 };
    const layer = createGroundLayer([ribbon("major")], lc(), "medium", uTime);
    const [land, roads] = meshes(layer.group).map((m) => m.material as THREE.Material);
    expect(land!.customProgramCacheKey()).toMatch(/_shimmer_water-only_groundDetail$/);
    expect(roads!.customProgramCacheKey()).not.toContain("_groundDetail");
    // The patch binds the shared clock.
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: ["void main() {", "#include <begin_vertex>", "}"].join("\n"),
      fragmentShader: ["void main() {", "#include <color_fragment>", "}"].join("\n"),
    };
    land!.onBeforeCompile(shader as never, {} as never);
    expect(shader.uniforms.uTime).toBe(uTime);
    expect(shader.fragmentShader).toContain("tlVNoise");
  });

  it("keeps the detail at Low too (a shader term, no geometry)", () => {
    const layer = createGroundLayer([], lc(), "low", { value: 0 });
    const land = meshes(layer.group)[0]!.material as THREE.Material;
    expect(land.customProgramCacheKey()).toContain("_groundDetail");
  });

  it("ground draws stay <= 6: one mesh per band, six bands (land cover, parks, water, verges, roads, markings)", () => {
    expect(Object.keys(GROUND_BANDS)).toHaveLength(6);
    const layer = createGroundLayer(
      [ribbon("major"), ribbon("footway"), ribbon("major", true), ribbon("other", true)],
      lc(),
      "high",
    );
    const orders = meshes(layer.group).map((m) => m.renderOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });
});
