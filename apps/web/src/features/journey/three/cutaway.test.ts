import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { createClearance } from "../../scene/three/clearance";
import { HERO_CHEST_Y } from "../../scene/three/journey/followRig";
import { meshBlocks } from "./cameraProbe";
import {
  applyCutaway,
  CUT_RADIUS_M,
  cutFor,
  cutUniforms,
  inCut,
  injectCutaway,
  NO_CUT,
  patchCutaway,
  SIGHT_CUT_RADIUS_M,
  setCut,
  sightCut,
} from "./cutaway";

const grid = createClearance([
  {
    id: "harmoni-1",
    ring: [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ],
    topM: 30,
  },
]);

/** A closed 20 x 30 x 20 m box drawn as a building (pick kind building), as the city mesh. */
function building(): THREE.Scene {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(20, 30, 20).translate(0, 15, 0),
    new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }),
  );
  m.userData.pick = { kind: "building" };
  m.raycast = () => {}; // decorative / unpickable, as the drawn city: the probe calls Mesh.raycast
  const s = new THREE.Scene();
  s.add(m);
  s.updateMatrixWorld(true);
  return s;
}

afterEach(() => setCut(NO_CUT));

describe("building cutaway around the hero (D-T5 ruling, display only)", () => {
  it("is on only while she stands inside a drawn building", () => {
    expect(cutFor([0, 0], [30, 40, 0], grid).on).toBe(true);
    expect(cutFor([15, 0], [30, 40, 0], grid).on).toBe(false);
    expect(cutFor(null, [30, 40, 0], grid).on).toBe(false);
    expect(cutFor([0, 0], [30, 40, 0], null).on).toBe(false);
  });

  it("cuts a capsule from the camera to her chest", () => {
    const c = cutFor([0, 0], [30, 40, 0], grid);
    expect(inCut(c, [8, 11.69, 0])).toBe(true); // on the line, inside her building
    expect(inCut(c, [15, 20.7, 0])).toBe(false); // on the line, outside her building
    expect(inCut(c, [0, 1.4 + CUT_RADIUS_M - 0.1, 0])).toBe(true); // around her
    expect(inCut(c, [-9, 5, 9])).toBe(false); // the far walls stay
    expect(inCut(NO_CUT, [15, 20.7, 0])).toBe(false);
  });

  it("a ray to her through the walls counts as hidden without the cut and as clear with it", () => {
    const roots = [building()];
    const cam: [number, number, number] = [25, 12, 5];
    const chest: [number, number, number] = [0, 1.4, 0];
    expect(meshBlocks(roots, cam, chest)).toBe(true);
    setCut(cutFor([0, 0], cam, grid));
    expect(meshBlocks(roots, cam, chest)).toBe(false);
    // a ray elsewhere through the box is still blocked (only the capsule is cut)
    expect(meshBlocks(roots, [25, 12, 5], [-25, 12, 5])).toBe(true);
  });

  it("cuts only the building she stands in: a second building on the line stays drawn", () => {
    // her building (harmoni-1, -10..10) and a neighbour (x 14..18) between it and the camera
    const two = createClearance([
      {
        id: "harmoni-1",
        ring: [
          [-10, -10],
          [10, -10],
          [10, 10],
          [-10, 10],
        ],
        topM: 30,
      },
      {
        id: "neighbour",
        ring: [
          [14, -4],
          [18, -4],
          [18, 4],
          [14, 4],
        ],
        topM: 20,
      },
    ]);
    const cam: [number, number, number] = [30, 6, 0];
    const c = cutFor([0, 0], cam, two);
    expect(c.max[0]).toBeCloseTo(10 + 0.3); // her building's box only
    expect(inCut(c, [10, 4.5, 0])).toBe(true); // her building's wall on the line
    expect(inCut(c, [16, 5, 0])).toBe(false); // the neighbour's wall on the same line
    const nb = new THREE.Mesh(
      new THREE.BoxGeometry(4, 20, 8).translate(16, 10, 0),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }),
    );
    nb.userData.pick = { kind: "building" };
    const roots = [building()];
    roots[0]?.add(nb);
    roots[0]?.updateMatrixWorld(true);
    setCut(c);
    expect(meshBlocks(roots, cam, [0, 1.4, 0])).toBe(true); // the neighbour still hides her
    expect(cutUniforms.uTlCutMax.value.y).toBeCloseTo(30.3);
  });

  it("sets the shared shader uniforms", () => {
    setCut(cutFor([0, 0], [30, 40, 0], grid));
    expect(cutUniforms.uTlCutOn.value).toBe(1);
    expect(cutUniforms.uTlCutB.value.toArray()).toEqual([0, 1.4, 0]);
    expect(cutUniforms.uTlCutR.value).toBe(CUT_RADIUS_M);
    setCut(NO_CUT);
    expect(cutUniforms.uTlCutOn.value).toBe(0);
  });

  it("injects the discard into the standard shader and patches each material once", () => {
    const shader = THREE.ShaderLib.standard;
    const out = injectCutaway(shader.vertexShader, shader.fragmentShader);
    expect(out?.vertex).toContain("vTlCut = ( modelMatrix * tlCutWp ).xyz;");
    expect(out?.vertex).toContain("instanceMatrix * tlCutWp");
    expect(out?.fragment).toContain("discard");
    expect(injectCutaway("void main() {}", "void main() {}")).toBeNull();

    const m = new THREE.MeshStandardMaterial();
    let prior = 0;
    m.onBeforeCompile = () => {
      prior++;
    };
    expect(patchCutaway(m)).toBe(true);
    expect(patchCutaway(m)).toBe(false);
    const sh = {
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(sh, {} as THREE.WebGLRenderer);
    expect(prior).toBe(1); // the earlier hook still runs
    expect(sh.uniforms).toHaveProperty("uTlCutOn");
    expect(sh.fragmentShader).toContain("uTlCutR");
    expect(m.customProgramCacheKey()).toContain("tl-cut");
    expect(applyCutaway([building()])).toBe(1);
  });
});

describe("compare split sight-line cut (any building between a half's camera and its walker)", () => {
  const cut = sightCut([0, 26, -42], [0, 0]);

  it("cuts a fragment of any building on the line from the camera to the walker", () => {
    expect(inCut(cut, [0, 13, -21])).toBe(true);
    expect(inCut(cut, [1000, 13, -21])).toBe(false);
  });

  it("aims at the walker's chest and keeps its radius", () => {
    expect(cut.b).toEqual([0, HERO_CHEST_Y, 0]);
    expect(cut.r).toBe(SIGHT_CUT_RADIUS_M);
    // a building beside the walker, off the sight line, stays drawn
    expect(inCut(cut, [10, 2, 0])).toBe(false);
  });
});
