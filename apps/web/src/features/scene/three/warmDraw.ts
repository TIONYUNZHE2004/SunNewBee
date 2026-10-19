import * as THREE from "three";

/**
 * First-draw warm-up (ITER2 AC-D18). On ANGLE / Direct3D 11 a program's D3D shader executable for
 * a given vertex input layout and render target is built lazily, at its first DRAW, inside the GPU
 * process. Compiling the program (compileAsync) and touching it (onFirstUse) do not do that. A
 * landmark (a 44k-triangle tl_role mesh, compiled at load but outside the load view) was first drawn
 * when the dive brought it into view: the GPU process spent ~270 ms in that flush and the main
 * thread blocked on the next upload (234-358 ms at Ask+1.3-1.6 s in every take).
 *
 * `buildWarmDraws(root)` makes a group of stand-ins that draw ONE triangle of each visible mesh in
 * `root`, with the mesh's own material, vertex buffers (shared, never copied) and world transform,
 * frustum culling off. For one frame that triangle is drawn exactly where the real mesh draws it, so
 * it adds nothing visible, but every pass (scene, shadow, AO / depth of field overrides) builds its
 * executable and uploads the buffers at load. `releaseWarmDraws` drops the group without deleting
 * the shared GPU buffers.
 *
 * Skipped: hidden meshes (a triangle of a hidden mesh would show), empty instanced meshes, skinned,
 * batched and morphed meshes, sprites, points and instanced-geometry lines (Line2).
 */
export function buildWarmDraws(root: THREE.Object3D): THREE.Group | null {
  const group = new THREE.Group();
  group.name = "warm-draws";
  group.userData.warm = true;
  root.updateWorldMatrix(true, true);
  const visit = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !o.userData.warm) {
      const stand = standIn(m);
      if (stand) group.add(stand);
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return group.children.length > 0 ? group : null;
}

const NOOP = () => {};

function standIn(m: THREE.Mesh): THREE.Mesh | null {
  const geo = m.geometry;
  if (
    (m as THREE.SkinnedMesh).isSkinnedMesh ||
    (m as unknown as { isBatchedMesh?: boolean }).isBatchedMesh ||
    (geo as THREE.InstancedBufferGeometry).isInstancedBufferGeometry ||
    Array.isArray(m.material) ||
    !geo?.getAttribute("position") ||
    Object.keys(geo.morphAttributes).length > 0
  )
    return null;
  const im = m as THREE.InstancedMesh;
  if (im.isInstancedMesh && im.count <= 0) return null;
  const n = geo.index
    ? geo.index.count
    : (geo.getAttribute("position") as THREE.BufferAttribute).count;
  if (n < 3) return null;
  // Its own geometry object over the same attribute objects (three keys GPU buffers by attribute:
  // nothing is copied), drawing the first triangle only.
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(geo.attributes)) g.setAttribute(name, a);
  if (geo.index) g.setIndex(geo.index);
  g.setDrawRange(0, 3);
  let s: THREE.Mesh;
  if (im.isInstancedMesh) {
    const c = new THREE.InstancedMesh(g, m.material, 1);
    // the real instance buffers (the constructor's own are dropped before any upload)
    c.instanceMatrix = im.instanceMatrix;
    c.instanceColor = im.instanceColor;
    c.count = 1;
    s = c;
  } else s = new THREE.Mesh(g, m.material);
  s.matrixAutoUpdate = false;
  s.matrix.copy(m.matrixWorld);
  s.matrixWorld.copy(m.matrixWorld);
  s.castShadow = m.castShadow;
  s.receiveShadow = m.receiveShadow;
  s.renderOrder = m.renderOrder;
  s.layers.mask = m.layers.mask;
  s.frustumCulled = false;
  s.raycast = NOOP;
  s.userData = { warm: true, decorative: true };
  return s;
}

/**
 * Removes a warm-up group from its parent and frees its geometry objects (their VAOs) WITHOUT
 * deleting the shared vertex, index and instance buffers: attributes are detached first, and the
 * instanced stand-ins are never disposed (InstancedMesh.dispose deletes its instance buffer).
 */
export function releaseWarmDraws(group: THREE.Group): void {
  group.removeFromParent();
  for (const c of group.children) {
    const g = (c as THREE.Mesh).geometry;
    for (const name of Object.keys(g.attributes)) g.deleteAttribute(name);
    g.setIndex(null);
    g.dispose();
  }
  group.clear();
}
