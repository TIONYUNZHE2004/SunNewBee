import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { createDressingLayer } from "../dressing/dressingLayer";
import { createRoleMaterial, createRoleUniforms } from "./roleMaterial";
import {
  injectTreeCut,
  inTreeCut,
  patchDecorCut,
  setTreeCut,
  TREE_CUT_RADIUS_M,
  treeCutUniforms,
} from "./treeCut";

const compileShader = (m: THREE.Material) => {
  const lib = THREE.ShaderLib.physical;
  const shader = {
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
    uniforms: {} as Record<string, unknown>,
  };
  m.onBeforeCompile(shader as never, {} as never);
  return shader;
};

describe("decorative tree cut (gate AC-D17: no canopy over the hero)", () => {
  afterEach(() => setTreeCut(null));

  it("is off by default and switched by setTreeCut", () => {
    expect(treeCutUniforms.uTlTreeCutOn.value).toBe(0);
    setTreeCut({ a: [0, 10, 20], b: [0, 1.4, 0] });
    expect(treeCutUniforms.uTlTreeCutOn.value).toBe(1);
    expect(treeCutUniforms.uTlTreeCutA.value.toArray()).toEqual([0, 10, 20]);
    expect(treeCutUniforms.uTlTreeCutB.value.toArray()).toEqual([0, 1.4, 0]);
    setTreeCut(null);
    expect(treeCutUniforms.uTlTreeCutOn.value).toBe(0);
  });

  it("cuts only inside the capsule from the camera to her chest", () => {
    expect(inTreeCut([0, 5, 10])).toBe(false); // off
    setTreeCut({ a: [0, 10, 20], b: [0, 1.4, 0] });
    expect(inTreeCut([0, 5.7, 10])).toBe(true); // on the line of sight
    expect(inTreeCut([TREE_CUT_RADIUS_M + 0.5, 5.7, 10])).toBe(false); // beside it
    expect(inTreeCut([0, 1.4, -5])).toBe(false); // behind her
  });

  it("injects into a compiling shader with the shared uniforms", () => {
    const lib = THREE.ShaderLib.physical;
    const shader = {
      vertexShader: lib.vertexShader,
      fragmentShader: lib.fragmentShader,
      uniforms: {} as Record<string, unknown>,
    };
    expect(injectTreeCut(shader)).toBe(true);
    expect(shader.vertexShader).toContain("vTlTreeCut");
    expect(shader.fragmentShader).toContain("discard");
    expect(shader.uniforms.uTlTreeCutOn).toBe(treeCutUniforms.uTlTreeCutOn);
    expect(injectTreeCut({ vertexShader: "", fragmentShader: "", uniforms: {} })).toBe(false);
  });

  it("is built into decorative tree and car programs (no program change mid-trip), not buildings or people", () => {
    const uniforms = createRoleUniforms();
    for (const kind of ["tree", "parked", "vehicle"] as const) {
      const m = compileShader(createRoleMaterial({ instanced: true, uniforms, kind }));
      expect(m.fragmentShader, kind).toContain("uTlTreeCutOn");
      expect(m.uniforms.uTlTreeCutOn).toBe(treeCutUniforms.uTlTreeCutOn);
    }
    // a whole tree is cut (trunk included): the discard does not depend on the vertex role
    const tree = compileShader(createRoleMaterial({ instanced: true, uniforms, kind: "tree" }));
    expect(tree.fragmentShader).toContain("if ( uTlTreeCutOn > 0.5 ) {");
    for (const kind of ["person", "static"] as const) {
      const other = compileShader(createRoleMaterial({ instanced: true, uniforms, kind }));
      expect(other.fragmentShader).not.toContain("uTlTreeCutOn");
    }
  });
});

describe("decorative cut, 9.1 F2: the event's element line, props, dressing and crowd", () => {
  afterEach(() => setTreeCut(null));

  it("a second capsule runs from the camera to the event's element", () => {
    setTreeCut({ a: [0, 10, 20], b: [0, 1.4, 0], c: [20, 0.3, 0] });
    expect(treeCutUniforms.uTlTreeCutC2.value).toBe(1);
    expect(inTreeCut([10, 5.15, 10])).toBe(true); // on the camera-to-element line
    expect(inTreeCut([0, 5.7, 10])).toBe(true); // still on the camera-to-hero line
    setTreeCut({ a: [0, 10, 20], b: [0, 1.4, 0] });
    expect(treeCutUniforms.uTlTreeCutC2.value).toBe(0);
    expect(inTreeCut([10, 5.15, 10])).toBe(false);
  });

  it("patchDecorCut adds the cut once, keeps earlier hooks and gives its own program key", () => {
    const m = new THREE.MeshStandardMaterial();
    let earlier = 0;
    m.onBeforeCompile = () => {
      earlier++;
    };
    const key0 = m.customProgramCacheKey();
    patchDecorCut(m);
    patchDecorCut(m);
    const s = compileShader(m);
    expect(earlier).toBe(1);
    expect(s.fragmentShader.match(/uTlTreeCutOn > 0\.5/g)?.length).toBe(1);
    expect(m.customProgramCacheKey()).not.toBe(key0);
  });

  it("decorative dressing is cut, fact props never", () => {
    const layer = createDressingLayer();
    layer.setItems([
      { key: "f", model: "bench", x: 0, z: 0, yaw: 0, s: 1, sourceId: "osm-node-1" },
      { key: "d", model: "planter", x: 2, z: 0, yaw: 0, s: 1 },
    ]);
    layer.update([0, 0], 150);
    let facts = 0;
    let decor = 0;
    layer.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const cut = compileShader(mesh.material as THREE.Material).fragmentShader.includes(
        "uTlTreeCutOn",
      );
      if (mesh.userData.fact) {
        facts++;
        expect(cut, mesh.name).toBe(false);
      } else {
        decor++;
        expect(cut, mesh.name).toBe(true);
      }
    });
    expect(facts).toBeGreaterThan(0);
    expect(decor).toBeGreaterThan(0);
    layer.dispose();
  });
});
