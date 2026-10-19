/**
 * The hero's rest bench, in the hero's own frame (true metres, before the R-J3 display scale; front
 * +z, origin = her root, which stays at the bench-front stand point through sit_down / sit_idle /
 * stand_up). Matches the rigged hero's asset manifest (C-T3 ruling): the clips carry the hips back
 * onto the seat from a fixed root, and park the walker beside her.
 *
 * TODO(C-T3 merge): read these from `apps/web/public/city/characters/manifest.json` (`bench`) via
 * `heroManifest.ts` instead of repeating them here.
 */
export const HERO_BENCH = {
  /** Seat top above the ground (H7: 0.45 m true). */
  seatHeightM: 0.45,
  /** The seat's front edge, behind her root (manifest `bench.frontEdgeZ`). */
  frontEdgeZ: -0.21,
  /** How far the clips carry the hips back from the root onto the seat. */
  hipTravelM: 0.28,
  /** Seat depth, front edge to back rest (TODO(C-T3): confirm against the manifest). */
  depthM: 0.45,
  /** Seat width. */
  widthM: 1.9,
} as const;
