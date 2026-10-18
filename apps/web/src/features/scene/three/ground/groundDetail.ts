import * as THREE from "three";
import { LANDCOVER_COLOURS } from "./landcover";

/**
 * Land-cover detail: a world-space value noise (two octaves, 6 m and 1.5 m) modulating the
 * brightness by at most +-6 %, plus a sparse dark speckle on grass and bare earth. Hue never moves,
 * so colours stay within +-6 % of LANDCOVER_COLOURS. Base water is left alone (it keeps only its
 * +-4 % shimmer) so it can never drift towards the flood blue. Decorative, display only.
 */
export const DETAIL_AMPLITUDE = 0.06;
export const DETAIL_OCTAVES_M = [6, 1.5] as const;
const OCTAVE_WEIGHTS = [0.65, 0.35] as const;
/** Speckle cell (m) and the share of cells that are speckled (grass and bare only). */
const SPECKLE_CELL_M = 0.75;
const SPECKLE_SHARE = 0.035;
const SPECKLE_CLASSES = new Set(["grass", "bare"]);

/** The classic GLSL one-liner hash in [0, 1); the shader uses the same formula. */
const hash2 = (x: number, z: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
};
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise in [0, 1] at lattice coordinates (x, z). */
export function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Brightness factor in [0.94, 1.06] for a land-cover class at local (x, z); water is exactly 1. */
export function detailBrightness(cls: string, x: number, z: number): number {
  if (cls === "water") return 1;
  const [o0, o1] = DETAIL_OCTAVES_M;
  const [w0, w1] = OCTAVE_WEIGHTS;
  const n = w0 * valueNoise(x / o0, z / o0) + w1 * valueNoise(x / o1, z / o1);
  let f = 1 + DETAIL_AMPLITUDE * (2 * n - 1);
  if (
    SPECKLE_CLASSES.has(cls) &&
    hash2(Math.floor(x / SPECKLE_CELL_M) + 17, Math.floor(z / SPECKLE_CELL_M) - 29) >
      1 - SPECKLE_SHARE
  )
    f = 1 - DETAIL_AMPLITUDE;
  return Math.min(1 + DETAIL_AMPLITUDE, Math.max(1 - DETAIL_AMPLITUDE, f));
}

/** The class colour after detail, as a THREE.Color (the CPU mirror of the fragment patch). */
export function detailColour(cls: string, hex: string, x: number, z: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(detailBrightness(cls, x, z));
}

const near = (hex: string | undefined, t = 0.02): string => {
  const c = new THREE.Color(hex);
  return `(abs(vColor.r - ${c.r.toFixed(5)}) + abs(vColor.g - ${c.g.toFixed(5)}) + abs(vColor.b - ${c.b.toFixed(5)}) < ${t})`;
};

const GLSL = `
float tlHash(vec2 p) { return fract(sin(p.x * 127.1 + p.y * 311.7) * 43758.5453123); }
float tlVNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = tlHash(i); float b = tlHash(i + vec2(1.0, 0.0));
  float c = tlHash(i + vec2(0.0, 1.0)); float d = tlHash(i + vec2(1.0, 1.0));
  return a + (b - a) * f.x + (c - a) * f.y + (a - b - c + d) * f.x * f.y;
}`;

/**
 * Adds the detail to a vertex-coloured land-cover material (chained after any earlier patch, such
 * as the water shimmer). `uniforms.uTime` is the shared motion clock, bound for uniform parity with
 * the shimmer; the detail itself is static. The programme cache key is a constant, so every patched
 * material shares one programme.
 */
export function applyGroundDetail(
  material: THREE.Material,
  uniforms: { uTime: { value: number } },
): void {
  const prevKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${prevKey()}_groundDetail`;
  const prev = material.onBeforeCompile;
  const [o0, o1] = DETAIL_OCTAVES_M;
  const [w0, w1] = OCTAVE_WEIGHTS;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec2 vDetXZ;\nvoid main() {")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvDetXZ = position.xz;");
    const speckleGate = `(${near(LANDCOVER_COLOURS.grass)} || ${near(LANDCOVER_COLOURS.bare)})`;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `varying vec2 vDetXZ;${GLSL}\nvoid main() {`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
if (!${near(LANDCOVER_COLOURS.water)}) {
  float tlN = ${w0.toFixed(2)} * tlVNoise(vDetXZ / ${o0.toFixed(1)}) + ${w1.toFixed(2)} * tlVNoise(vDetXZ / ${o1.toFixed(1)});
  float tlF = 1.0 + ${DETAIL_AMPLITUDE} * (2.0 * tlN - 1.0);
  if (${speckleGate} && tlHash(floor(vDetXZ / ${SPECKLE_CELL_M}) + vec2(17.0, -29.0)) > ${(1 - SPECKLE_SHARE).toFixed(3)}) tlF = ${1 - DETAIL_AMPLITUDE};
  diffuseColor.rgb *= clamp(tlF, ${1 - DETAIL_AMPLITUDE}, ${1 + DETAIL_AMPLITUDE});
}`,
      );
  };
}
