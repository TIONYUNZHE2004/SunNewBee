import * as THREE from "three";
import type { Rect } from "../../../devsim/types";

const _v = new THREE.Vector3();

/**
 * World point to stage CSS px ([x, y] from the top left), or null when it is behind the camera.
 * `camera` must have current matrices (the engine updates them before `beforeRender`).
 */
export function toScreen(
  camera: THREE.Camera,
  size: readonly [number, number],
  x: number,
  y: number,
  z: number,
): [number, number] | null {
  _v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
  if (_v.z > -1e-3) return null; // behind (or at) the camera
  _v.applyMatrix4(camera.projectionMatrix);
  return [(_v.x * 0.5 + 0.5) * size[0], (-_v.y * 0.5 + 0.5) * size[1]];
}

/** True when the screen point lies on the stage. */
export const onStage = (p: [number, number] | null, size: readonly [number, number], pad = 0) =>
  !!p && p[0] >= -pad && p[1] >= -pad && p[0] <= size[0] + pad && p[1] <= size[1] + pad;

/**
 * The screen bounding box of world points, clipped to the stage; null when none is in front of the
 * camera or the box misses the stage.
 */
export function screenRect(
  camera: THREE.Camera,
  size: readonly [number, number],
  pts: readonly (readonly [number, number, number])[],
): Rect | null {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const [x, y, z] of pts) {
    const s = toScreen(camera, size, x, y, z);
    if (!s) continue;
    any = true;
    x0 = Math.min(x0, s[0]);
    y0 = Math.min(y0, s[1]);
    x1 = Math.max(x1, s[0]);
    y1 = Math.max(y1, s[1]);
  }
  if (!any) return null;
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(size[0], x1);
  const cy1 = Math.min(size[1], y1);
  if (cx1 <= cx0 || cy1 <= cy0) return null;
  return { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 };
}
