import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Bakes a group's static meshes into one mesh per (material, shadow flags, render order), in the
 * group's own frame, and puts those in place of its children (C10p: the devsim yard's floodlights
 * and the tower entrance were 6-12 draws per pass for a few hundred triangles). The group keeps its
 * own transform. Returns the merged geometries for the caller to dispose; the source geometries are
 * left to their owner. Children without a mergeable mesh are kept as they are. A bucket that
 * `mergeGeometries` cannot merge (mismatched attributes) is not dropped: its meshes are put back
 * one by one, at the same place, sharing their source geometry.
 */
export function mergeStatic(group: THREE.Group): THREE.BufferGeometry[] {
  group.updateMatrixWorld(true);
  const toGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map<
    string,
    {
      mat: THREE.Material;
      cast: boolean;
      receive: boolean;
      order: number;
      geos: THREE.BufferGeometry[];
      /** Each source mesh and its matrix in the group frame (the fallback when merging fails). */
      src: { mesh: THREE.Mesh; local: THREE.Matrix4 }[];
    }
  >();
  const keep: THREE.Object3D[] = [];
  const m = new THREE.Matrix4();
  for (const child of [...group.children]) {
    let ok = true;
    const meshes: THREE.Mesh[] = [];
    child.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) {
        const mesh = o as THREE.Mesh;
        if (Array.isArray(mesh.material)) ok = false;
        else meshes.push(mesh);
      } else if (o !== child && !(o as THREE.Group).isGroup && o.type !== "Object3D") ok = false;
    });
    if (!ok || meshes.length === 0) {
      keep.push(child);
      continue;
    }
    for (const mesh of meshes) {
      const mat = mesh.material as THREE.Material;
      const key = `${mat.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.renderOrder}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          mat,
          cast: mesh.castShadow,
          receive: mesh.receiveShadow,
          order: mesh.renderOrder,
          geos: [],
          src: [],
        };
        buckets.set(key, b);
      }
      const local = new THREE.Matrix4().multiplyMatrices(toGroup, mesh.matrixWorld);
      const g = mesh.geometry.clone();
      g.applyMatrix4(local);
      b.geos.push(g);
      b.src.push({ mesh, local });
    }
  }
  // merge every bucket before the group is cleared, so a failed merge loses nothing
  const out: THREE.BufferGeometry[] = [];
  const add: THREE.Object3D[] = [];
  for (const b of buckets.values()) {
    // mergeGeometries needs all indexed or none
    const mixed = b.geos.some((g) => !g.index) && b.geos.some((g) => !!g.index);
    const geos = mixed ? b.geos.map((g) => (g.index ? g.toNonIndexed() : g)) : b.geos;
    const merged = mergeGeometries(geos, false);
    if (mixed) for (const g of geos) g.dispose();
    for (const g of b.geos) g.dispose();
    if (merged) {
      out.push(merged);
      add.push(bucketMesh(merged, b));
      continue;
    }
    for (const { mesh, local } of b.src) {
      const k = bucketMesh(mesh.geometry, b);
      local.decompose(k.position, k.quaternion, k.scale);
      k.name = mesh.name;
      add.push(k);
    }
  }
  group.clear();
  for (const k of keep) group.add(k);
  for (const k of add) group.add(k);
  return out;
}

function bucketMesh(
  geo: THREE.BufferGeometry,
  b: { mat: THREE.Material; cast: boolean; receive: boolean; order: number },
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, b.mat);
  mesh.castShadow = b.cast;
  mesh.receiveShadow = b.receive;
  mesh.renderOrder = b.order;
  mesh.raycast = () => {};
  return mesh;
}
