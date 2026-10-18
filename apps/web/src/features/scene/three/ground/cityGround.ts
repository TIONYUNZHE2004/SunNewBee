import * as THREE from "three";
import { GROUND_BANDS } from "./bands";

/**
 * The engine's city-level parks and base-water ground meshes (one draw each, in their bands): two
 * of the six ground draws (bands.ts). Used by `engine.setCity`; the 6-draw test reads them here.
 */
export function cityGroundMeshes(
  parks: THREE.BufferGeometry,
  water: THREE.BufferGeometry,
  parksMat: THREE.Material,
  waterMat: THREE.Material,
): { parks: THREE.Mesh; water: THREE.Mesh } {
  const p = new THREE.Mesh(parks, parksMat);
  p.renderOrder = GROUND_BANDS.parks.order;
  const w = new THREE.Mesh(water, waterMat);
  w.renderOrder = GROUND_BANDS.water.order;
  return { parks: p, water: w };
}
