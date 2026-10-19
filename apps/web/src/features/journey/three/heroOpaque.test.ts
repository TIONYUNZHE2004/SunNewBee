import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createGlbHero } from "../../scene/three/characters/glbHero";
import { HERO_RENDER_ORDER } from "../../scene/three/characters/hero";
import { createDressingLayer } from "../../scene/three/dressing/dressingLayer";
import { applyCutaway } from "./cutaway";
import { RIBBON_ORDER } from "./journeyLayer";

/** The shader a material compiles to (its onBeforeCompile chain run on the physical program). */
function compiled(m: THREE.Material) {
  const lib = THREE.ShaderLib.physical;
  const shader = {
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
    uniforms: {} as Record<string, unknown>,
  };
  m.onBeforeCompile(shader as never, {} as never);
  return shader;
}

const materialsOf = (root: THREE.Object3D) => {
  const out = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) out.add(x);
  });
  return [...out];
};

describe("the hero is never see-through (gate: ribbon ghost and cut patches)", () => {
  it("the cutaway never patches the hero, her walker and ring, or fact props", () => {
    const hero = createGlbHero(); // test mode: the placeholder (body, walker, ring)
    const dressing = createDressingLayer();
    // a fact bench (mapped seating place) beside her
    dressing.setItems([
      { key: "b", model: "bench", x: 0, z: 0, yaw: 0, s: 1, sourceId: "osm-node-1" },
    ]);
    dressing.update([0, 0], 150);
    expect(materialsOf(dressing.group).length).toBeGreaterThan(0);
    const root = new THREE.Group();
    root.add(hero.object3d, dressing.group);
    // a building next to them (the whitelist works by tag: only this one is patched)
    const building = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    building.userData.pick = { kind: "building" };
    root.add(building);
    expect(applyCutaway([root])).toBe(1);
    // fact props only: decorative dressing carries the decorative occluder cut by design (9.1 F2)
    const facts: THREE.Object3D[] = [];
    dressing.group.traverse((o) => {
      if (o.userData.fact) facts.push(o);
    });
    const factMats = facts.flatMap((o) => materialsOf(o));
    expect(factMats.length).toBeGreaterThan(0);
    for (const m of [...materialsOf(hero.object3d), ...factMats]) {
      const s = compiled(m);
      expect(s.fragmentShader, m.name).not.toContain("uTlCutOn");
      expect(s.fragmentShader, m.name).not.toContain("uTlTreeCutOn");
      expect(m.opacity).toBe(1);
    }
    expect(compiled(building.material).fragmentShader).toContain("uTlCutOn");
    hero.dispose();
  });

  it("her body draws after the ribbon and its ghost, fully opaque with depth write", () => {
    const hero = createGlbHero();
    let bodies = 0;
    hero.object3d.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || o.userData.heroPart === "ring") return;
      bodies++;
      expect(m.renderOrder).toBe(HERO_RENDER_ORDER);
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        expect(mat.opacity).toBe(1);
        expect(mat.depthWrite).toBe(true);
        expect(mat.transparent).toBe(true); // late list: after the ribbon ghost (order 21)
      }
    });
    expect(bodies).toBeGreaterThan(0);
    expect(HERO_RENDER_ORDER).toBeGreaterThan(RIBBON_ORDER + 1);
    hero.dispose();
  });
});
