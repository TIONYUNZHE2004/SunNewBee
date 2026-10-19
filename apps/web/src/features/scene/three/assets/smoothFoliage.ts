import type * as THREE from "three";

/** Archetype role index of foliage in COLOR_0.g (decoded floor(g * 7 + 0.5)). */
const FOLIAGE_ROLE = 6;
const KEY_SCALE = 1000; // weld positions to a millimetre

/**
 * B-T3 (AC-B3): rounds the faceted canopy lobes of a tree kit geometry. The baked glb lobes are
 * low-poly ellipsoids with flat shading; averaging the normals of foliage vertices that share a
 * position makes them read as the smooth clay spheres of the toy-diorama look, with the same
 * triangle count. Only foliage-role vertices change, and only their normals: positions, colours,
 * trunks and fronds are untouched (so no footprint, height or placement is affected). Display
 * only. Returns the number of vertices whose normal was smoothed.
 */
export function smoothFoliageNormals(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  const col = g.getAttribute("color");
  if (!pos || !nrm || !col || col.itemSize < 2) return 0;
  const n = pos.count;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    if (Math.round(col.getY(i) * 7) !== FOLIAGE_ROLE) continue;
    const k = `${Math.round(pos.getX(i) * KEY_SCALE)},${Math.round(pos.getY(i) * KEY_SCALE)},${Math.round(pos.getZ(i) * KEY_SCALE)}`;
    const list = groups.get(k);
    if (list) list.push(i);
    else groups.set(k, [i]);
  }
  let changed = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const i of list) {
      x += nrm.getX(i);
      y += nrm.getY(i);
      z += nrm.getZ(i);
    }
    const l = Math.hypot(x, y, z);
    if (l < 1e-6) continue;
    for (const i of list) nrm.setXYZ(i, x / l, y / l, z / l);
    changed += list.length;
  }
  if (changed > 0) nrm.needsUpdate = true;
  return changed;
}
