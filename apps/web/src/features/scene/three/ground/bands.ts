import type * as THREE from "three";
import type { Tier } from "../../shared/quality";
import { type ClayMaterial, type ClayRole, clayMaterial } from "../shared/clayTokens";

/**
 * The ground stack above the base plane, lowest first. Each band has a polygonOffset and a
 * renderOrder, strictly increasing in the same order, so centimetre lifts never flicker against
 * each other at township range (near 2 m, far 30 km). Six bands, one mesh each: at most 6 ground
 * draws (ruling P4-X, wave 4b):
 *  1. `landcover` (0.00-0.04 m, incl. the base-water class): streamed ground layer, no depth write;
 *  2. `decor`: ONE vertex-coloured "ground decor" mesh carrying the construction ground (gravel tint
 *     and earth tracks, CONSTRUCTION_Y 0.045 m) and the grass verges (VERGE_Y 0.07 m). It paints in
 *     triangle order (gravel, tracks, verges) without depth writes, like land cover, and draws right
 *     after it, so the parks, base water and roads drawn later always paint over it whatever its
 *     lift: a park or pond inside a construction site still shows, and a verge never covers water;
 *     it writes no depth, so AO and other depth reads see the base plane below it (a few cm off);
 *  3. `parks` (0.05 m) and 4. `water` (0.06 m): the engine's city-level meshes;
 *  5. `roads` (0.08 m) and 6. `markings` (0.10 m): dashed road marks and the parking-stall lines in
 *     one mesh.
 * Ground and land cover stay within 0.00-0.06 m.
 */
export const LANDCOVER_MAX_Y = 0.04;
/**
 * Construction land dressing (Task 10: gravel tint and earth tracks): above every land-cover class
 * (0.00-0.04), below parks (0.05) and base water (0.06). Drawn in the `decor` band. Inside the
 * 0.00-0.06 ground range.
 */
export const CONSTRUCTION_Y = 0.045;
export const PARK_Y = 0.05;
export const WATER_Y = 0.06;
/** Grass verges: between base water (0.06) and roads (0.08); drawn in the `decor` band. */
export const VERGE_Y = 0.07;
export const ROAD_Y = 0.08;
export const MARKING_Y = 0.1;

export const GROUND_BANDS = {
  landcover: { offset: -1, order: 1 },
  // Ground decor (verges + construction ground): between land cover (1) and parks (2), fractional
  // so no existing order moves (the 6-8 main-scene layers above stay put).
  decor: { offset: -1.5, order: 1.5 },
  parks: { offset: -2, order: 2 },
  water: { offset: -3, order: 3 },
  roads: { offset: -4, order: 4 },
  markings: { offset: -5, order: 5 },
} as const;
export type GroundBand = keyof typeof GROUND_BANDS;

/**
 * Night grade (A-T11): one albedo multiplier shared by every ground and road material, driven by
 * the mood (`LightPreset.groundGrade`: 1 by day, lower at night). Module-level so materials made
 * anywhere (streamed bands, the engine's base plane) read the same uniform.
 */
export const GROUND_GRADE = { value: 1 };

/**
 * Road grade (B-T4, `LightPreset.roadGrade`): the albedo multiplier for the `roads` and `markings`
 * bands. Asphalt is the darkest large surface, so at night it is graded less than the land cover.
 */
export const ROAD_GRADE = { value: 1 };

/** The grade uniform a band reads: roads and markings take ROAD_GRADE, the rest GROUND_GRADE. */
export function gradeFor(band: GroundBand): { value: number } {
  return band === "roads" || band === "markings" ? ROAD_GRADE : GROUND_GRADE;
}

/**
 * Multiplies the diffuse colour by a grade uniform (default `GROUND_GRADE`; chains any earlier
 * `onBeforeCompile`).
 */
export function applyGroundGrade(
  material: THREE.Material,
  grade: { value: number } = GROUND_GRADE,
): void {
  const prevKey = material.customProgramCacheKey.bind(material);
  const key = grade === ROAD_GRADE ? "_roadGrade" : "_groundGrade";
  material.customProgramCacheKey = () => `${prevKey()}${key}`;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uGroundGrade = grade;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float uGroundGrade;\nvoid main() {")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb *= uGroundGrade;",
      );
  };
}

/** The clay token each ground band draws with (B-T1). */
export const BAND_CLAY: Record<GroundBand, ClayRole> = {
  landcover: "ground",
  decor: "ground",
  parks: "park",
  water: "water",
  roads: "road",
  markings: "marking",
};

/**
 * Vertex-coloured clay material for one band (token `BAND_CLAY[band]`), with its polygon offset.
 * Every band except `water` takes the night grade (roads and markings: ROAD_GRADE). B-T1: the former `roughness` argument is gone;
 * roughness comes from the band's clay token (0.6-0.8). `tier` defaults to `clayTier()`.
 */
export function groundMaterial(band: GroundBand, tier?: Tier): ClayMaterial {
  const { offset } = GROUND_BANDS[band];
  const m = clayMaterial(BAND_CLAY[band], {
    tier,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: offset,
    polygonOffsetUnits: offset,
  });
  if (band !== "water") applyGroundGrade(m, gradeFor(band));
  return m;
}
