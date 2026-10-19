import * as THREE from "three";

/** Instances are at most this tall (m): the same bound as CityInstances' tile frustum box. */
const CASTER_TOP_M = 250;

/**
 * Pushes every plane of a (normalised) frustum outward by `padM` metres. A point within `padM` of
 * the frustum then tests inside: planes are 1-Lipschitz, so a point at distance d from any point
 * inside the frustum has a signed distance >= -d to every plane.
 */
export function padFrustum(f: THREE.Frustum, padM: number): THREE.Frustum {
  if (padM > 0) for (const p of f.planes) p.constant += padM;
  return f;
}

/**
 * How far outside the view a shadow caster can still matter (P4-I): the CityInstances frustum
 * skip leaves an unvisited tile's instances as they were, so a tile that can cast into view must
 * be visited. The orbit target is inside the view; every caster that reaches the shadow map lies
 * within the shadow box (half size `shadowHalfM`, centred on the target), so within
 * `shadowHalfM * sqrt(2)` of the target horizontally, plus the tallest caster. 0 without shadows.
 */
export function shadowPadM(shadows: boolean, shadowHalfM: number): number {
  return shadows ? shadowHalfM * Math.SQRT2 + CASTER_TOP_M : 0;
}

/** The camera's view frustum, padded for shadow casters, into `out`. */
export function cullFrustum(
  camera: THREE.Camera,
  padM: number,
  out: THREE.Frustum,
  m = new THREE.Matrix4(),
): THREE.Frustum {
  camera.updateMatrixWorld();
  out.setFromProjectionMatrix(
    m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  return padFrustum(out, padM);
}
