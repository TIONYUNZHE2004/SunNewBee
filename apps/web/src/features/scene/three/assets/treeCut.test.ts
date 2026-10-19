import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { createDressingLayer } from "../dressing/dressingLayer";
import { createRoleMaterial, createRoleUniforms } from "./roleMaterial";
import {
  injectTreeCut,
  inTreeCut,
  NEAR_CUT_M,
  NEAR_FADE_M,
  NEAR_INSTANCE_M,
  nearRadius,
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

describe("decorative cut, ITER2: near the camera (foreground canopies, giant heads)", () => {
  afterEach(() => setTreeCut(null));

  it("a decorative fragment within NEAR_CUT_M of the camera is cut, beyond the fade band it is drawn", () => {
    // the camera at (0, 4.2, -10), her chest at the origin; a canopy off to the side of the line
    expect(inTreeCut([4, 4, -8])).toBe(false); // off
    setTreeCut({ a: [0, 4.2, -10], b: [0, 1.4, 0] });
    expect(inTreeCut([4, 4, -8])).toBe(true); // 4.5 m from the camera, 4 m off the line of sight
    expect(inTreeCut([NEAR_CUT_M + NEAR_FADE_M + 0.5, 4.2, -10])).toBe(false);
    // a whole instanced tree whose trunk stands within NEAR_INSTANCE_M of the camera (its canopy
    // reaching beyond NEAR_CUT_M is cut too, never a hollow half)
    expect(inTreeCut([9, 6, -10], [5, 0, -12])).toBe(true);
    expect(inTreeCut([9, 6, -10], [9, 0, -12])).toBe(false);
  });

  it("a farther hold camera cuts half the way to her; a close one never reaches her", () => {
    // the crossing hold: the camera ~22 m from her, a foreground canopy 9 m from the camera
    setTreeCut({ a: [0, 10, -20], b: [0, 1.4, 0] });
    expect(inTreeCut([5, 6, -13])).toBe(true);
    expect(inTreeCut([5, 2, -3])).toBe(false); // by her
    expect(treeCutUniforms.uTlNearR.value).toBeCloseTo(nearRadius(Math.hypot(8.6, 20)), 5);
    // a close camera (4 m): the cut stays well short of her
    expect(nearRadius(4)).toBeLessThan(3);
    expect(nearRadius(10.5)).toBe(NEAR_CUT_M);
  });

  it("the shader carries the near-camera cut, the screen-door band and the instance-origin test", () => {
    const shader = {
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
      uniforms: {} as Record<string, unknown>,
    };
    injectTreeCut(shader);
    expect(shader.vertexShader).toContain("vTlCutOrigin = ( modelMatrix * tlCutO ).xyz;");
    expect(shader.fragmentShader).toContain("if ( tlNear < uTlNearR ) discard;");
    expect(shader.fragmentShader).toContain("gl_FragCoord.xy");
    expect(shader.fragmentShader).toContain(
      "distance( vTlCutOrigin.xz, uTlTreeCutA.xz ) < uTlNearInst",
    );
    expect(shader.uniforms.uTlNearR).toBe(treeCutUniforms.uTlNearR);
    setTreeCut({ a: [0, 4.2, -10], b: [0, 1.4, 0] });
    expect(treeCutUniforms.uTlNearR.value).toBe(NEAR_CUT_M);
    expect(treeCutUniforms.uTlNearInst.value).toBe(NEAR_INSTANCE_M);
  });
});
