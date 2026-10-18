/**
 * Height reference for points and labels on the Realistic map: clamp to Google 3D tiles when they
 * are configured, else to the ground (Ion terrain). Pure (the Cesium enum is passed in) so it is
 * unit-testable.
 */
export function heightRefFor<T>(
  hasGoogleTiles: boolean,
  hr: { CLAMP_TO_GROUND: T; CLAMP_TO_3D_TILE: T },
): T {
  return hasGoogleTiles ? hr.CLAMP_TO_3D_TILE : hr.CLAMP_TO_GROUND;
}
