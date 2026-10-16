export type MapStyle = "realistic" | "stylised";

/**
 * Height reference for points and labels on the map. The stylised city draws on the flat
 * ellipsoid, so it clamps to ground; the realistic view clamps to Google 3D tiles when they are
 * configured, else to the ground. Pure (the Cesium enum is passed in) so it is unit-testable.
 */
export function heightRefFor<T>(
  style: MapStyle,
  hasGoogleTiles: boolean,
  hr: { CLAMP_TO_GROUND: T; CLAMP_TO_3D_TILE: T },
): T {
  return style === "realistic" && hasGoogleTiles ? hr.CLAMP_TO_3D_TILE : hr.CLAMP_TO_GROUND;
}
