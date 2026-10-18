import * as THREE from "three";
import { GROUND_BANDS, groundMaterial } from "./bands";
import { applyGroundDetail } from "./groundDetail";
import type { GroundLayer } from "./groundLayer";
import { LANDCOVER_COLOURS } from "./landcover";

const noRaycast = () => {};

/**
 * The grass verges of the active tiles (`planVerges` strips: flat triangles at the verge lift,
 * 9 floats each) merged into ONE mesh in the verges band (lift 0.07 m, renderOrder 3.5): between
 * base water and the roads. Grass-coloured through vertex colours, so the land-cover ground detail
 * (given the motion clock) speckles it like grass land cover. DECORATIVE: unpickable, never cited,
 * receives shadows and casts none. Null when there is nothing to draw.
 */
export function createVergeLayer(
  strips: readonly Float32Array[],
  uTime?: { value: number },
): GroundLayer | null {
  let n = 0;
  for (const s of strips) n += s.length;
  if (n < 9) return null;
  const pos = new Float32Array(n);
  let o = 0;
  for (const s of strips) {
    pos.set(s, o);
    o += s.length;
  }
  const verts = n / 3;
  const col = new Float32Array(n);
  const nor = new Float32Array(n);
  const grass = new THREE.Color(LANDCOVER_COLOURS.grass);
  for (let v = 0; v < verts; v++) {
    col[v * 3] = grass.r;
    col[v * 3 + 1] = grass.g;
    col[v * 3 + 2] = grass.b;
    nor[v * 3 + 1] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  const mat = groundMaterial("verges");
  if (uTime) applyGroundDetail(mat, { uTime });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "verges";
  mesh.renderOrder = GROUND_BANDS.verges.order;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.decorative = true;
  mesh.raycast = noRaycast;
  const group = new THREE.Group();
  group.name = "verge-layer";
  group.userData.decorative = true;
  group.add(mesh);
  return {
    group,
    dispose() {
      geo.dispose();
      mat.dispose();
      group.clear();
    },
  };
}
