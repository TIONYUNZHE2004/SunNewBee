import * as THREE from "three";

/**
 * Building lookups shared by the acceptance hook and the journey camera probe (production code:
 * `__journey.camera()` exists in the demo preset), kept out of the test-only hook module so that
 * module can load on demand (final review: no test-only code in the production bundle).
 */
const BUILDING_KINDS = new Set(["building", "landmark"]);

/** Visible building and landmark meshes (extruded city, archetype instances, landmarks). */
export function buildingMeshes(roots: THREE.Object3D[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const kind = (o.userData.pick as { kind?: string } | undefined)?.kind;
    if ((o as THREE.Mesh).isMesh && kind && BUILDING_KINDS.has(kind)) out.push(o as THREE.Mesh);
    for (const c of o.children) visit(c);
  };
  for (const r of roots) visit(r);
  return out;
}

const _down = new THREE.Raycaster();
const _probe = new THREE.Mesh();
const _inst = new THREE.Matrix4();

/** Highest building surface hit by a vertical ray at (x, z); per instance, no scene state touched. */
export function roofHit(roots: THREE.Object3D[], x: number, z: number): number {
  _down.set(new THREE.Vector3(x, 10_000, z), new THREE.Vector3(0, -1, 0));
  _down.far = 20_000;
  const hits: THREE.Intersection[] = [];
  for (const m of buildingMeshes(roots)) {
    const im = m as THREE.InstancedMesh;
    if (!im.isInstancedMesh) {
      // Decorative meshes opt out of raycasting (`raycast` is a no-op): call the Mesh raycast.
      THREE.Mesh.prototype.raycast.call(m, _down, hits);
      continue;
    }
    _probe.geometry = im.geometry;
    _probe.material = im.material;
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, _inst);
      _probe.matrixWorld.multiplyMatrices(im.matrixWorld, _inst);
      THREE.Mesh.prototype.raycast.call(_probe, _down, hits);
    }
  }
  let top = 0;
  for (const h of hits) if (h.point.y > top) top = h.point.y;
  return top;
}
