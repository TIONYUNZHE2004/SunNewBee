import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createMotionUniforms, createRoleUniforms } from "../assets/roleMaterial";
import { NEUTRAL_COLOURS } from "../fallbackStyle";
import { createFacadeLayer } from "./facadeLayer";
import type { FacadeSpec } from "./facadePlan";

const spec = (id: string, windowStyle: 0 | 1 | 2 | 3): FacadeSpec => ({
  buildingId: id,
  storeys: 3,
  windowStyle,
  bayM: 3.2,
  groundFloor: "shop",
  palette: NEUTRAL_COLOURS,
});
const rect = (x0: number, w: number): Array<[number, number]> => [
  [x0, 0],
  [x0 + w, 0],
  [x0 + w, -12],
  [x0, -12],
];
const STYLES = [0, 1, 2, 3, 0, 1, 2, 3] as const;
const buildings = STYLES.map((s, i) => ({
  ring: rect(i * 30, 20),
  heightM: 9.6,
  minHeightM: 0,
  spec: spec(`b${i}`, s),
}));
/** A ray from the south straight at the first building's south wall (z = 0), 4 m up. */
const ray = () => new THREE.Raycaster(new THREE.Vector3(10, 4, 50), new THREE.Vector3(0, 0, -1));

describe("createFacadeLayer", () => {
  it("draws at most 4 window meshes + 1 shopfront mesh, all instanced", () => {
    const layer = createFacadeLayer(buildings, createRoleUniforms(), "medium");
    const meshes = layer.group.children;
    expect(meshes).toHaveLength(5);
    for (const m of meshes) expect(m).toBeInstanceOf(THREE.InstancedMesh);
    expect(meshes.filter((m) => m.name === "facade_shopfronts")).toHaveLength(1);
    layer.dispose();
  });

  it("is decorative and its raycast returns nothing", () => {
    const layer = createFacadeLayer(buildings, createRoleUniforms(), "high");
    expect(layer.group.userData.decorative).toBe(true);
    layer.group.updateMatrixWorld(true);
    expect(ray().intersectObject(layer.group, true)).toEqual([]);
    let children = 0;
    layer.group.traverse((o) => {
      if (o === layer.group) return;
      children++;
      expect(o.userData.decorative).toBe(true);
      expect(o.userData.pick).toBeUndefined();
      expect(o.castShadow).toBe(false);
    });
    expect(children).toBeGreaterThan(0);
    layer.dispose();
  });

  it("leaves the building beneath pickable (the facade adds no hit in front of it)", () => {
    const layer = createFacadeLayer(buildings, createRoleUniforms(), "high");
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(20, 9.6), new THREE.MeshBasicMaterial());
    wall.position.set(10, 4.8, 0);
    wall.userData.pick = { kind: "building" };
    const scene = new THREE.Scene();
    scene.add(layer.group, wall);
    scene.updateMatrixWorld(true);
    const hits = ray().intersectObjects(scene.children, true);
    expect(hits[0]?.object).toBe(wall);
    layer.dispose();
  });

  it("is empty at Low", () => {
    const layer = createFacadeLayer(buildings, createRoleUniforms(), "low");
    expect(layer.group.children).toHaveLength(0);
    let meshes = 0;
    layer.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(0);
    layer.dispose();
  });

  it("lights windows through the shared role uniforms (glass role, per-instance seed)", () => {
    const uniforms = createRoleUniforms();
    const motion = createMotionUniforms();
    const layer = createFacadeLayer(buildings, uniforms, "medium", motion);
    const mesh = layer.group.children[0] as THREE.InstancedMesh;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.name).toBe("tl_role");
    expect(mat.vertexColors).toBe(true);
    // Vertex colour: AO 1, role 3 (glass); the instance colour carries the lit seed in b.
    const col = mesh.geometry.getAttribute("color");
    expect(col.getX(0)).toBe(1);
    expect(Math.floor(col.getY(0) * 7 + 0.5)).toBe(3);
    expect(mesh.instanceColor).not.toBeNull();
    const seeds = new Set<number>();
    for (let i = 0; i < mesh.count; i++) {
      expect(mesh.instanceColor!.getX(i)).toBe(1);
      expect(mesh.instanceColor!.getY(i)).toBe(1);
      const b = mesh.instanceColor!.getZ(i);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(1);
      seeds.add(Math.round(b * 1000));
    }
    expect(seeds.size).toBeGreaterThan(Math.min(10, mesh.count / 2));
    // The material's shader receives the very same uniform objects the archetypes use.
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    mat.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.uWindowGlow).toBe(uniforms.uWindowGlow);
    expect(shader.uniforms.uLitShare).toBe(uniforms.uLitShare);
    expect(shader.uniforms.uFlicker).toBe(uniforms.uFlicker);
    expect(shader.uniforms.uTime).toBe(motion.uTime);
    expect(shader.fragmentShader).toContain("uLitShare");
    layer.dispose();
  });

  it("is deterministic and disposes its GPU resources", () => {
    const a = createFacadeLayer(buildings, createRoleUniforms(), "medium");
    const b = createFacadeLayer(buildings, createRoleUniforms(), "medium");
    const arr = (l: typeof a) =>
      l.group.children.map((m) => Array.from((m as THREE.InstancedMesh).instanceMatrix.array));
    expect(arr(a)).toEqual(arr(b));
    let geos = 0;
    let mats = 0;
    const n = a.group.children.length;
    for (const m of a.group.children) {
      const im = m as THREE.InstancedMesh;
      im.geometry.addEventListener("dispose", () => geos++);
      (im.material as THREE.Material).addEventListener("dispose", () => mats++);
    }
    a.dispose();
    expect(geos).toBe(n);
    expect(mats).toBeGreaterThanOrEqual(1);
    expect(a.group.children).toHaveLength(0);
    b.dispose();
  });

  it("draws nothing for no buildings", () => {
    const layer = createFacadeLayer([], createRoleUniforms(), "high");
    expect(layer.group.children).toHaveLength(0);
    layer.dispose();
  });
});
