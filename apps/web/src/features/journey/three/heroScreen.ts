import * as THREE from "three";
import { HERO_DISPLAY_SCALE } from "../../scene/three/characters/hero";
import type { Rect } from "../cardPlacement";

/** Ground highlights under her (the yellow ring and the pale disc): a marker, not her body. */
const GROUND_PARTS = new Set(["ring", "disc"]);

/** Flesh and prop around the skeleton: 0.25 m at true scale, times the hero's display scale. */
export const BONE_PAD_M = 0.25 * HERO_DISPLAY_SCALE;

const _box = new THREE.Box3();
const _mb = new THREE.Box3();
const _v = new THREE.Vector3();

/**
 * The world box of the hero's body and walker (the ground ring and disc excluded), or null when
 * nothing is drawn. Reads the meshes' current world matrices (updated here).
 */
export function heroBodyBox(root: THREE.Object3D, out = new THREE.Box3()): THREE.Box3 | null {
  root.updateMatrixWorld(true);
  _box.makeEmpty();
  // only what is drawn: hidden LODs (and their subtrees) are skipped
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || GROUND_PARTS.has(o.userData.heroPart as string)) return;
    const sk = m as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh && sk.skeleton?.bones.length) {
      // the posed bounds from the bones' world positions, padded for the flesh and the prop
      // around them (re-skinning ~15k vertices per frame for a card would cost too much)
      _mb.makeEmpty();
      for (const b of sk.skeleton.bones) _mb.expandByPoint(b.getWorldPosition(_v));
      _mb.expandByScalar(BONE_PAD_M);
    } else {
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingBox) return;
      _mb.copy(g.boundingBox).applyMatrix4(m.matrixWorld);
    }
    _box.union(_mb);
  });
  return _box.isEmpty() ? null : out.copy(_box);
}

/**
 * A world box on screen (CSS px of a `size` viewport, y down) as a rectangle, or null when any
 * corner is at or behind the camera plane. The camera's matrices must be current.
 */
export function boxOnScreen(
  box: THREE.Box3,
  camera: THREE.Camera,
  size: readonly [number, number],
): Rect | null {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 8; i++) {
    _v.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    );
    _v.applyMatrix4(camera.matrixWorldInverse);
    if (_v.z >= 0) return null;
    _v.applyMatrix4((camera as THREE.PerspectiveCamera).projectionMatrix);
    const x = ((_v.x + 1) / 2) * size[0];
    const y = ((1 - _v.y) / 2) * size[1];
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The hero's body on screen, padded by `padPx` (the card keeps clear of it), or null. */
export function heroScreenRect(
  root: THREE.Object3D | null | undefined,
  camera: THREE.Camera,
  size: readonly [number, number],
  padPx = 6,
): Rect | null {
  if (!root) return null;
  const b = heroBodyBox(root);
  const r = b ? boxOnScreen(b, camera, size) : null;
  return r ? { x: r.x - padPx, y: r.y - padPx, w: r.w + 2 * padPx, h: r.h + 2 * padPx } : null;
}
