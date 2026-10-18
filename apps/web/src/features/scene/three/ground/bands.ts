import * as THREE from "three";

/**
 * The ground stack above the base plane, lowest first. Each band has a lift (metres), a
 * polygonOffset and a renderOrder, all strictly increasing in the same order, so centimetre lifts
 * never flicker against each other at township range (near 2 m, far 30 km). Land cover (and its
 * base-water class) is lowest; the parks and base-water meshes sit above it; roads above both
 * (road lift 0.08 m); dashed markings on top. Ground and land cover stay within 0.00-0.06 m.
 */
export const LANDCOVER_MAX_Y = 0.04;
export const PARK_Y = 0.05;
export const WATER_Y = 0.06;
export const ROAD_Y = 0.08;
export const MARKING_Y = 0.1;

export const GROUND_BANDS = {
  landcover: { offset: -1, order: 1 },
  parks: { offset: -2, order: 2 },
  water: { offset: -3, order: 3 },
  roads: { offset: -4, order: 4 },
  markings: { offset: -5, order: 5 },
} as const;
export type GroundBand = keyof typeof GROUND_BANDS;

/** Vertex-coloured material for one band, with its polygon offset. */
export function groundMaterial(band: GroundBand, roughness = 1): THREE.MeshStandardMaterial {
  const { offset } = GROUND_BANDS[band];
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness,
    polygonOffset: true,
    polygonOffsetFactor: offset,
    polygonOffsetUnits: offset,
  });
}
