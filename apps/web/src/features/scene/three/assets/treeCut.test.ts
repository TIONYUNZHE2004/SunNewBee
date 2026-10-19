import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { createRoleMaterial, createRoleUniforms } from "./roleMaterial";
import {
  injectTreeCut,
  inTreeCut,
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

  it("is built into the tree program only (no program change mid-trip), not buildings or people", () => {
    const uniforms = createRoleUniforms();
    const tree = compileShader(createRoleMaterial({ instanced: true, uniforms, kind: "tree" }));
    expect(tree.fragmentShader).toContain("uTlTreeCutOn");
    expect(tree.uniforms.uTlTreeCutOn).toBe(treeCutUniforms.uTlTreeCutOn);
    for (const kind of ["person", "static"] as const) {
      const other = compileShader(createRoleMaterial({ instanced: true, uniforms, kind }));
      expect(other.fragmentShader).not.toContain("uTlTreeCutOn");
    }
  });
});
