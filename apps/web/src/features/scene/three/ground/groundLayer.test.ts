import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GROUND_BANDS } from "./bands";
import { cityGroundMeshes } from "./cityGround";
import { createGroundDecorLayer } from "./groundDecor";
import { createGroundLayer } from "./groundLayer";
import { STALL_COLOUR } from "./lotLayer";
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

  it("names each mesh's band (the acceptance harness finds road surfaces by it)", () => {
    const layer = createGroundLayer([ribbon("major"), ribbon("major", true)], lc(), "high");
    expect(meshes(layer.group).map((m) => m.userData.groundBand)).toEqual([
      "landcover",
      "roads",
      "markings",
    ]);
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

  it("exactly 6 ground draws: land cover, ground decor, parks, water, roads, markings (ruling P4-X)", () => {
    expect(Object.keys(GROUND_BANDS)).toHaveLength(6);
    // Streamed: land cover (1), road surface + markings with the stall lines folded in (2).
    const land = createGroundLayer([], lc(), "high");
    const roads = createGroundLayer(
      [ribbon("major"), ribbon("footway"), ribbon("major", true), ribbon("other", true)],
      new THREE.BufferGeometry(),
      "high",
      undefined,
      [new Float32Array([5, 5, 0, 15, 5, Math.PI / 2])],
    );
    // Verges and construction ground (tracks + gravel tint) in ONE ground-decor mesh.
    const decor = createGroundDecorLayer({
      strips: [new Float32Array([0, 0.07, 0, 0, 0.07, 1, 1, 0.07, 0])],
      tracks: [new Float32Array([0, 20, 40, 20])],
      gravel: [
        {
          id: "s",
          poly: [
            [
              [0, 10],
              [50, 10],
              [50, 40],
              [0, 40],
            ],
          ],
        },
      ],
    })!;
    const streamed = [land, roads, decor].flatMap((l) => meshes(l.group));
    expect(streamed).toHaveLength(4);
    // The engine's city-level parks and base-water meshes (one each, engine.setCity) make the other two.
    const city = cityGroundMeshes(
      new THREE.BufferGeometry(),
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial(),
    );
    const orders = [...streamed, city.parks, city.water].map((m) => m.renderOrder);
    expect(orders).toHaveLength(6);
    expect(new Set(orders)).toEqual(new Set(Object.values(GROUND_BANDS).map((b) => b.order)));
  });

  it("stall lines ride the road-markings mesh (same band, own colour); no stalls, no change", () => {
    const stalls = new Float32Array([5, 5, 0, 15, 5, Math.PI / 2]);
    const plain = createGroundLayer([ribbon("major", true)], lc(), "high");
    const withStalls = createGroundLayer([ribbon("major", true)], lc(), "high", undefined, [
      stalls,
    ]);
    expect(meshes(withStalls.group)).toHaveLength(meshes(plain.group).length);
    const marks = meshes(withStalls.group).find(
      (m) => m.renderOrder === GROUND_BANDS.markings.order,
    )!;
    // 1 dashed-mark triangle + 2 stalls x 6 stall-line triangles.
    expect(marks.geometry.index!.count / 3).toBe(1 + 12);
    const c = marks.geometry.getAttribute("color");
    const stallC = new THREE.Color(STALL_COLOUR);
    expect([c.getX(3), c.getY(3), c.getZ(3)]).toEqual(
      [stallC.r, stallC.g, stallC.b].map(Math.fround),
    );
    // Stalls only, no road markings: the markings mesh still exists (stalls are markings).
    const only = createGroundLayer([], new THREE.BufferGeometry(), "high", undefined, [stalls]);
    expect(meshes(only.group).map((m) => m.renderOrder)).toEqual([GROUND_BANDS.markings.order]);
    // Low draws no markings, stall lines included.
    expect(
      meshes(createGroundLayer([], new THREE.BufferGeometry(), "low", undefined, [stalls]).group),
    ).toHaveLength(0);
  });
});
