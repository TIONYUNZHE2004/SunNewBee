import { readFileSync } from "node:fs";
import * as THREE from "three";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import { createMotionUniforms, createRoleUniforms } from "../assets/roleMaterial";
import { bokehDepthMeshes, CityBokehPass } from "../tiltShift";
import type { Agent } from "./agents";
import type { CrowdKit } from "./crowdBake";
import { loadCrowdKit } from "./crowdKit";
import { createMotionLayer } from "./motionLayer";

/**
 * AC-L12 (demo polish A3): crowd people and vehicles write depth with their animated pose in the
 * bokeh pass. Every agent mesh (InstancedMesh) and crowd mesh (BatchedMesh) carries a depth twin
 * (`userData.bokehDepth`); the crowd's twin runs the same skinning vertex stage as its colour
 * material (never the bind pose); CityBokehPass makes them wear the twins for its depth render.
 */
const pub = (p: string) => new URL(`../../../../../public${p}`, import.meta.url);
const readBuf = (p: string) => {
  const b = readFileSync(pub(p.split("?")[0] as string));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
let kit: CrowdKit;
beforeAll(async () => {
  kit = await loadCrowdKit({
    fetchJson: async (u) => JSON.parse(readFileSync(pub(u), "utf8")),
    loadGlb: async (u) => readBuf(u),
  });
}, 30_000);

const kitSpec = () => ({
  group: "kit" as const,
  file: "x.glb",
  bytes: 1,
  repeat: "none" as const,
  frontage: "long" as const,
  fit: { xz: [0.5, 2], y: [0.5, 2] } as { xz: [number, number]; y: [number, number] },
  decorative: true,
  placement: null,
  jitter: {},
  variantByGroup: {},
  palettes: { default: [["#112233", "#445566", "#778899"]] as [string, string, string][] },
  variants: {
    v: {
      size: [1, 1.5, 4] as [number, number, number],
      lods: [
        { node: "c0", tris: 12, maxM: 150 },
        { node: "c1", tris: 12, maxM: 1500 },
      ],
    },
  },
});
const manifest = (): Manifest => ({
  version: 1,
  as_of: "",
  precinctGroups: [],
  assets: { vehicles: kitSpec() },
  landmarks: {},
});
const lib: AssetLibrary = {
  geometry: () => new THREE.BoxGeometry(1, 1.5, 4),
  has: () => true,
  gpuBytes: () => 0,
  failed: [],
  dispose() {},
};
const agent = (id: string, kind: Agent["kind"], z: number): Agent => ({
  id,
  kind,
  variant: kind === "vehicle" ? "v" : "a",
  path: new Float32Array([0, z, 100, z]),
  length: 100,
  speed: kind === "vehicle" ? 10 : 1.3,
  offset: 10,
});

const layer = () =>
  createMotionLayer(
    [agent("car", "vehicle", 0), agent("p1", "person", 5), agent("p2", "person", 8)],
    lib,
    manifest(),
    createRoleUniforms(),
    createMotionUniforms(),
    { crowd: kit },
  );

/** The depth shader `material` compiles to (onBeforeCompile applied to three's depth shader). */
function compiledDepth(material: THREE.Material) {
  const lib = THREE.ShaderLib.depth;
  const shader = {
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(lib.uniforms),
  };
  material.onBeforeCompile(shader as never, {} as never);
  return shader;
}

describe("AC-L12: agents and crowd write depth in their drawn pose", () => {
  afterEach(() => vi.restoreAllMocks());

  it("every agent and crowd mesh carries an RGBA depth twin the override cannot replace", () => {
    const l = layer();
    const meshes: THREE.Mesh[] = [];
    l.group.traverse((o) => {
      const m = o as THREE.Mesh & { isInstancedMesh?: boolean; isBatchedMesh?: boolean };
      // agent kits (motion__*) and the crowd; the night beams are flat road decals (no twin)
      if ((m.isInstancedMesh && m.name.startsWith("motion__")) || m.isBatchedMesh) meshes.push(m);
    });
    expect(meshes.some((m) => (m as { isInstancedMesh?: boolean }).isInstancedMesh)).toBe(true);
    expect(meshes.filter((m) => (m as { isBatchedMesh?: boolean }).isBatchedMesh)).toHaveLength(2);
    for (const m of meshes) {
      const d = m.userData.bokehDepth as THREE.MeshDepthMaterial;
      expect(d, m.name).toBeInstanceOf(THREE.MeshDepthMaterial);
      expect(d.depthPacking).toBe(THREE.RGBADepthPacking);
      expect(d.allowOverride).toBe(false);
    }
    expect(bokehDepthMeshes([l.group])).toHaveLength(meshes.length);
    l.dispose();
  });

  it("the crowd's depth twin skins every vertex from the baked animation (no bind pose)", () => {
    const l = layer();
    const crowd = l.crowd as NonNullable<typeof l.crowd>;
    const d = crowd.meshes[0].userData.bokehDepth as THREE.Material;
    expect(crowd.meshes[1].userData.bokehDepth).toBe(d);
    const s = compiledDepth(d);
    expect(s.vertexShader).toContain("texelFetch(tlCrowdAnim");
    expect(s.vertexShader).toContain("transformed = vec3(dot(tlR0");
    expect(s.vertexShader).not.toContain("#include <skinning_vertex>");
    expect(s.fragmentShader).toContain("if (vTlFade < 0.5) discard;");
    expect(Object.keys(s.uniforms)).toEqual(
      expect.arrayContaining(["tlCrowdAnim", "tlCrowdInst", "tlCrowdFade"]),
    );
    // agents: instance matrices (three's instancing) and the fade discard
    const car = bokehDepthMeshes([l.group]).find(
      (t) => !(t.mesh as { isBatchedMesh?: boolean }).isBatchedMesh,
    )!;
    const c = compiledDepth(car.depth);
    expect(c.vertexShader).toContain("attribute float iFade;");
    expect(c.fragmentShader).toContain("if (vTlFade < 0.5) discard;");
    l.dispose();
  });

  it("CityBokehPass draws them with their twins in its depth render, then restores them", () => {
    const l = layer();
    const scene = new THREE.Scene();
    scene.add(l.group);
    const twins = bokehDepthMeshes([l.group]);
    const colour = twins.map((t) => t.mesh.material);
    let during: unknown[] = [];
    vi.spyOn(BokehPass.prototype, "render").mockImplementation(() => {
      during = twins.map((t) => t.mesh.material);
    });
    const pass = new CityBokehPass(
      scene,
      new THREE.PerspectiveCamera(),
      () => [],
      () => [l.group],
    );
    const rt = {} as THREE.WebGLRenderTarget;
    pass.render({} as THREE.WebGLRenderer, rt, rt, 0, false);
    expect(during).toEqual(twins.map((t) => t.depth));
    expect(twins.map((t) => t.mesh.material)).toEqual(colour);
    // the motion group itself stays drawn in the depth render (not skipped)
    expect(l.group.visible).toBe(true);
    pass.dispose();
    l.dispose();
  });
});
