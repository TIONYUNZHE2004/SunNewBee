import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { mergeStatic } from "./merge";

describe("mergeStatic (C10p)", () => {
  it("one mesh per material and shadow flags, vertices in the group frame, group transform kept", () => {
    const g = new THREE.Group();
    g.position.set(10, 0, 0);
    g.rotation.y = 0.5;
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    const box = (m: THREE.Material, x: number, cast = true) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);
      mesh.position.set(x, 2, 0);
      mesh.castShadow = cast;
      return mesh;
    };
    const sub = new THREE.Group();
    sub.position.set(0, 0, 5);
    sub.add(box(a, 0));
    g.add(box(a, 1), box(a, 3), box(b, 5), box(a, 7, false), sub);
    const before = new THREE.Box3().setFromObject(g, true);
    const geos = mergeStatic(g);
    expect(g.children).toHaveLength(3);
    expect(geos).toHaveLength(3);
    const byMat = g.children.map((c) => (c as THREE.Mesh).material);
    expect(byMat.filter((m) => m === a)).toHaveLength(2);
    expect(g.position.x).toBe(10);
    const after = new THREE.Box3().setFromObject(g, true);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-6);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-6);
    const castA = g.children.find((c) => (c as THREE.Mesh).material === a && c.castShadow);
    expect((castA as THREE.Mesh).geometry.getAttribute("position").count).toBe(3 * 24);
  });

  it("a bucket mergeGeometries cannot merge keeps its meshes, in place (C10p review minor)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const g = new THREE.Group();
    g.position.set(4, 0, 0);
    const mat = new THREE.MeshStandardMaterial();
    // a box has uv + normal; a bare triangle has position only: the attribute sets differ
    const bare = new THREE.BufferGeometry();
    bare.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    a.position.set(1, 2, 3);
    a.castShadow = true;
    const b = new THREE.Mesh(bare, mat);
    b.position.set(-2, 0, 1);
    b.castShadow = true;
    const ok = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    g.add(a, b, ok);
    const before = new THREE.Box3().setFromObject(g, true);
    const geos = mergeStatic(g);
    // the mergeable bucket merged; the failed one put back mesh by mesh
    expect(geos).toHaveLength(1);
    expect(g.children).toHaveLength(3);
    const back = g.children.filter((c) => (c as THREE.Mesh).material === mat) as THREE.Mesh[];
    expect(back.map((m) => m.geometry).sort((x, y) => x.id - y.id)).toEqual(
      [a.geometry, b.geometry].sort((x, y) => x.id - y.id),
    );
    expect(back.every((m) => m.castShadow)).toBe(true);
    const after = new THREE.Box3().setFromObject(g, true);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-6);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-6);
    err.mockRestore();
  });

  it("keeps instanced meshes as they are", () => {
    const g = new THREE.Group();
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
    g.add(inst, new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    mergeStatic(g);
    expect(g.children).toContain(inst);
    expect(g.children).toHaveLength(2);
  });
});
