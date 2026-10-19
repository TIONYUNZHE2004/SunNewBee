import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildWarmDraws, releaseWarmDraws } from "./warmDraw";

/** ITER2 AC-D18: one real draw of every shown mesh at load (ANGLE builds its D3D shader at the first draw). */
describe("buildWarmDraws", () => {
  const box = () => new THREE.BoxGeometry(2, 2, 2);
  const mat = () => new THREE.MeshStandardMaterial();

  it("draws one triangle of each visible mesh, on the mesh's own buffers, material and transform", () => {
    const root = new THREE.Group();
    const landmark = new THREE.Mesh(box(), mat());
    landmark.position.set(300, 0, -40);
    landmark.castShadow = true;
    root.add(landmark);
    const trees = new THREE.InstancedMesh(box(), mat(), 2048);
    trees.count = 5;
    root.add(trees);
    const g = buildWarmDraws(root) as THREE.Group;
    expect(g.children.length).toBe(2);
    const [a, b] = g.children as [THREE.Mesh, THREE.InstancedMesh];
    expect(a.material).toBe(landmark.material);
    expect(a.geometry).not.toBe(landmark.geometry);
    expect(a.geometry.getAttribute("position")).toBe(landmark.geometry.getAttribute("position"));
    expect(a.geometry.index).toBe(landmark.geometry.index);
    expect(a.geometry.drawRange).toEqual({ start: 0, count: 3 });
    expect(a.frustumCulled).toBe(false);
    expect(a.castShadow).toBe(true);
    expect(a.matrixWorld.equals(landmark.matrixWorld)).toBe(true);
    // the real instance buffer, one instance: never a new 128 KB buffer to upload
    expect(b.isInstancedMesh).toBe(true);
    expect(b.instanceMatrix).toBe(trees.instanceMatrix);
    expect(b.count).toBe(1);
  });

  it("skips hidden meshes, empty instanced meshes, skinned and line geometry", () => {
    const root = new THREE.Group();
    const hidden = new THREE.Mesh(box(), mat());
    hidden.visible = false;
    root.add(hidden);
    const empty = new THREE.InstancedMesh(box(), mat(), 16);
    empty.count = 0;
    root.add(empty);
    const off = new THREE.Group();
    off.visible = false;
    off.add(new THREE.Mesh(box(), mat()));
    root.add(off);
    const lines = new THREE.Mesh(new THREE.InstancedBufferGeometry(), mat());
    root.add(lines);
    expect(buildWarmDraws(root)).toBeNull();
  });

  it("release frees the stand-ins without detaching the shared buffers from the real mesh", () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(box(), mat());
    scene.add(mesh);
    const g = buildWarmDraws(scene) as THREE.Group;
    scene.add(g);
    const pos = mesh.geometry.getAttribute("position");
    let disposedReal = false;
    mesh.geometry.addEventListener("dispose", () => {
      disposedReal = true;
    });
    const standGeo = (g.children[0] as THREE.Mesh).geometry;
    releaseWarmDraws(g);
    expect(g.parent).toBeNull();
    expect(standGeo.getAttribute("position")).toBeUndefined();
    expect(mesh.geometry.getAttribute("position")).toBe(pos);
    expect(disposedReal).toBe(false);
  });
});
