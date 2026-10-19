import * as THREE from "three";

const v = new THREE.Vector3();

/**
 * A world point in CSS px of a `size` viewport (x right, y down), or null when it is behind the
 * camera. Uses the camera's current matrices (call after a render, or after updateMatrixWorld).
 * Points off screen but in front of the camera still project (the card clamp keeps them inside).
 */
export function projectToScreen(
  camera: THREE.Camera,
  p: readonly [number, number, number],
  size: readonly [number, number],
): { x: number; y: number } | null {
  v.set(p[0], p[1], p[2]).applyMatrix4(camera.matrixWorldInverse);
  if (v.z >= 0) return null; // at or behind the camera plane (view space looks down -z)
  v.applyMatrix4(camera.projectionMatrix);
  return { x: ((v.x + 1) / 2) * size[0], y: ((1 - v.y) / 2) * size[1] };
}
