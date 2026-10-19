import * as THREE from "three";
import type { Site } from "../props/construction";
import { GROUND_BANDS, groundMaterial } from "./bands";
import { DRESS_STRIDE } from "./dressingPlan";
import { applyGroundDetail } from "./groundDetail";
import type { GroundLayer } from "./groundLayer";
import { LANDCOVER_COLOURS } from "./landcover";
import { constructionGround } from "./lotLayer";

export {
  DRESS_LOD,
  DRESS_STRIDE,
  DRESS_WALK_CLEAR_M,
  type DressingCounts,
  type DressingInput,
  type DressingPlan,
  planDressing,
} from "./dressingPlan";

const noRaycast = () => {};

/** Flat +y normal unless the triangle slopes: then its (upward) face normal. */
function faceNormal(pos: Float32Array, nor: Float32Array, t: number): void {
  const ax = pos[t + 3]! - pos[t]!;
  const ay = pos[t + 4]! - pos[t + 1]!;
  const az = pos[t + 5]! - pos[t + 2]!;
  const bx = pos[t + 6]! - pos[t]!;
  const by = pos[t + 7]! - pos[t + 1]!;
  const bz = pos[t + 8]! - pos[t + 2]!;
  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  for (let k = 0; k < 9; k += 3) {
    nor[t + k] = nx;
    nor[t + k + 1] = ny;
    nor[t + k + 2] = nz;
  }
}

/** What the active tiles give the ground-decor mesh. */
export interface GroundDecorParts {
  /** Per tile `TileContent.verges.strips` (flat triangles at VERGE_Y, 9 floats each). */
  strips: readonly Float32Array[];
  /** Per tile `verges.skirts`: the rounded outer shoulder of each strip piece (B-T3), 9 floats per triangle. */
  skirts?: readonly Float32Array[];
  /** Per tile `TileContent.tracks` (TRACK_STRIDE floats per segment). */
  tracks: readonly Float32Array[];
  /** Construction sites to tint gravel, each once. */
  gravel: readonly Site[];
  /** Per tile `TileContent.dressing` (A-T10): interleaved x y z r g b triangles (DRESS_STRIDE per triangle). */
  dressing?: readonly Float32Array[];
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
  let skirtFloats = 0;
  for (const s of parts.skirts ?? []) skirtFloats += s.length - (s.length % 9);
  let dressTris = 0;
  for (const d of parts.dressing ?? []) dressTris += Math.floor(d.length / DRESS_STRIDE);
  const dressFloats = dressTris * 9;
  const n = ground.pos.length + stripFloats + skirtFloats + dressFloats;
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
  for (const s of parts.skirts ?? []) {
    const len = s.length - (s.length % 9);
    pos.set(len === s.length ? s : s.subarray(0, len), o);
    for (let v = o; v < o + len; v += 3) {
      col[v] = grass.r;
      col[v + 1] = grass.g;
      col[v + 2] = grass.b;
    }
    o += len;
  }
  // Dressing last: flowers, crop rows, cones and mounds paint over the ground they sit on.
  const dressStart = o;
  for (const d of parts.dressing ?? []) {
    for (let t = 0; t + DRESS_STRIDE <= d.length; t += DRESS_STRIDE) {
      for (let v = 0; v < 3; v++) {
        const i = t + v * 6;
        pos[o] = d[i]!;
        pos[o + 1] = d[i + 1]!;
        pos[o + 2] = d[i + 2]!;
        col[o] = d[i + 3]!;
        col[o + 1] = d[i + 4]!;
        col[o + 2] = d[i + 5]!;
        o += 3;
      }
    }
  }
  const nor = new Float32Array(n);
  for (let i = 1; i < n; i += 3) nor[i] = 1;
  // The shoulders slope, so they take their face normals (the strips above stay flat, +y).
  for (let t = dressStart - skirtFloats; t < dressStart; t += 9) {
    const ax = pos[t + 3]! - pos[t]!;
    const ay = pos[t + 4]! - pos[t + 1]!;
    const az = pos[t + 5]! - pos[t + 2]!;
    const bx = pos[t + 6]! - pos[t]!;
    const by = pos[t + 7]! - pos[t + 1]!;
    const bz = pos[t + 8]! - pos[t + 2]!;
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (let k = 0; k < 9; k += 3) {
      nor[t + k] = nx;
      nor[t + k + 1] = ny;
      nor[t + k + 2] = nz;
    }
  }
  // Upright pieces (cones, mounds) take face normals too; flat ones keep +y.
  for (let t = dressStart; t < n; t += 9) faceNormal(pos, nor, t);
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
