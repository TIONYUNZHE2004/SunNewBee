import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CityGTAOPass } from "./aoPass";
import { AO_PARAMS } from "./lighting";

afterEach(() => vi.restoreAllMocks());

describe("CityGTAOPass", () => {
  it("hides the skipped objects only while the AO pass renders, then restores them", () => {
    const scene = new THREE.Scene();
    const far = new THREE.Mesh();
    const near = new THREE.Mesh();
    const off = new THREE.Mesh();
    off.visible = false;
    scene.add(far, near, off);
    const seen: boolean[][] = [];
    vi.spyOn(GTAOPass.prototype, "render").mockImplementation(() => {
      seen.push([far.visible, near.visible, off.visible]);
    });
    const pass = new CityGTAOPass(scene, new THREE.PerspectiveCamera(), 4, 4, () => [far, off]);
    const r = {} as THREE.WebGLRenderer;
    const t = {} as THREE.WebGLRenderTarget;
    pass.render(r, t, t, 0, false);
    expect(seen).toEqual([[false, true, false]]);
    expect([far.visible, near.visible, off.visible]).toEqual([true, true, false]);
    pass.dispose();
  });

  it("restores visibility when the AO pass throws", () => {
    const far = new THREE.Mesh();
    vi.spyOn(GTAOPass.prototype, "render").mockImplementation(() => {
      throw new Error("gl");
    });
    const pass = new CityGTAOPass(new THREE.Scene(), new THREE.PerspectiveCamera(), 4, 4, () => [
      far,
    ]);
    const t = {} as THREE.WebGLRenderTarget;
    expect(() => pass.render({} as THREE.WebGLRenderer, t, t, 0, false)).toThrow("gl");
    expect(far.visible).toBe(true);
    pass.dispose();
  });
  it("applies the B-T4 AO parameters to the GTAO material and the blend", () => {
    const pass = new CityGTAOPass(new THREE.Scene(), new THREE.PerspectiveCamera(), 4, 4, () => []);
    pass.applyParams(AO_PARAMS);
    const u = pass.gtaoMaterial.uniforms;
    expect(u.radius?.value).toBe(AO_PARAMS.radius);
    expect(u.distanceExponent?.value).toBe(AO_PARAMS.distanceExponent);
    expect(u.thickness?.value).toBe(AO_PARAMS.thickness);
    expect(u.scale?.value).toBe(AO_PARAMS.scale);
    expect(pass.blendIntensity).toBe(AO_PARAMS.blendIntensity);
    pass.dispose();
  });
  it("applies params given to the constructor (the engine passes AO_PARAMS with the mood blend)", () => {
    const pass = new CityGTAOPass(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      4,
      4,
      () => [],
      {
        ...AO_PARAMS,
        blendIntensity: 0.45,
      },
    );
    expect(pass.gtaoMaterial.uniforms.radius?.value).toBe(AO_PARAMS.radius);
    expect(pass.blendIntensity).toBe(0.45);
    pass.dispose();
  });
});
