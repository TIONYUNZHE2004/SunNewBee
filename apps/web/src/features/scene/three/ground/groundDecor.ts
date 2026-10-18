import * as THREE from "three";
import type { Site } from "../props/construction";
import { GROUND_BANDS, groundMaterial } from "./bands";
import { applyGroundDetail } from "./groundDetail";
import type { GroundLayer } from "./groundLayer";
import { LANDCOVER_COLOURS } from "./landcover";
import { constructionGround } from "./lotLayer";

const noRaycast = () => {};

/** What the active tiles give the ground-decor mesh. */
export interface GroundDecorParts {
  /** Per tile `TileContent.verges.strips` (flat triangles at VERGE_Y, 9 floats each). */
  strips: readonly Float32Array[];
  /** Per tile `TileContent.tracks` (TRACK_STRIDE floats per segment). */
  tracks: readonly Float32Array[];
  /** Construction sites to tint gravel, each once. */
  gravel: readonly Site[];
}

/**
 * The "ground decor" of the active tiles in ONE vertex-coloured mesh (wave 4b, ruling P4-X: six
 * ground draws): the construction ground (gravel tint, then earth tracks, at CONSTRUCTION_Y 0.045 m;
 * Task 10) and the grass verges (VERGE_Y 0.07 m; Task 9). One geometry carries both lifts. It
 * paints in that triangle order without depth writes, like land cover, in the `decor` band right
 * after land cover, so parks, base water and roads drawn later paint over it (bands.ts). The
 * land-cover ground detail (given the motion clock) speckles verges and gravel alike.
 * DECORATIVE: unpickable, never cited, receives shadows and casts none. Null when empty.
 */
export function createGroundDecorLayer(
  parts: GroundDecorParts,
  uTime?: { value: number },
): GroundLayer | null {
  const ground = constructionGround(parts.tracks, parts.gravel);
  let stripFloats = 0;
  for (const s of parts.strips) stripFloats += s.length - (s.length % 9);
  const n = ground.pos.length + stripFloats;
  if (n < 9) return null;
  const pos = new Float32Array(n);
  const col = new Float32Array(n);
  pos.set(ground.pos, 0);
  col.set(ground.col, 0);
  let o = ground.pos.length;
  const grass = new THREE.Color(LANDCOVER_COLOURS.grass);
  for (const s of parts.strips) {
    const len = s.length - (s.length % 9);
    pos.set(len === s.length ? s : s.subarray(0, len), o);
    for (let v = o; v < o + len; v += 3) {
      col[v] = grass.r;
      col[v + 1] = grass.g;
      col[v + 2] = grass.b;
    }
    o += len;
  }
  const nor = new Float32Array(n);
  for (let i = 1; i < n; i += 3) nor[i] = 1;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  const mat = groundMaterial("decor");
  // Painted in triangle order (gravel, tracks, verges), like land cover: no z-fight between them.
  mat.depthWrite = false;
  if (uTime) applyGroundDetail(mat, { uTime });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "ground-decor";
  mesh.renderOrder = GROUND_BANDS.decor.order;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.decorative = true;
  mesh.raycast = noRaycast;
  const group = new THREE.Group();
  group.name = "ground-decor-layer";
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
