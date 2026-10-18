import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CityGTAOPass } from "./aoPass";

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
});
