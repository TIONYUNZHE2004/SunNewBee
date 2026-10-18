import * as THREE from "three";

export interface RoleUniforms {
  uWindowGlow: { value: number };
  uLitShare: { value: number };
  uLightGlow: { value: number };
  uAoStrength: { value: number };
}

/** sRGB hex; THREE.Color converts to linear working space on construction. */
export const FIXED_ROLE_COLOURS: Record<"glass" | "dark" | "metal" | "foliage" | "light", string> =
  {
    glass: "#6f8aa0",
    dark: "#2b2d31",
    metal: "#9aa1a8",
    foliage: "#5f8f4e",
    light: "#fff1c9",
  };

/** Shared by every kit material; driven by the motion clock (Task 8). */
export interface MotionUniforms {
  uTime: { value: number };
  uSway: { value: number };
  uLimb: { value: number };
}

export function createMotionUniforms(): MotionUniforms {
  return { uTime: { value: 0 }, uSway: { value: 1 }, uLimb: { value: 1 } };
}

export type RoleKind = "tree" | "person" | "vehicle" | "static";

const HEADLIGHT = "#fff4d6";
const TAILLIGHT = "#ff3b30";

export function createRoleUniforms(): RoleUniforms {
  return {
    uWindowGlow: { value: 0 },
    uLitShare: { value: 0.6 },
    uLightGlow: { value: 0 },
    uAoStrength: { value: 1 },
  };
}

const vec3Of = (hex: string) => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
};

const DEFAULT_PALETTE: [string, string, string] = ["#c9c2b4", "#9a8f80", "#b5654a"];

/**
 * Base colour = role palette (COLOR_0.g, decoded floor(g*7+0.5)) x baked AO (COLOR_0.r).
 * Roles: 0 primary, 1 secondary, 2 accent (palette), 3 glass, 4 dark, 5 metal, 6 foliage, 7 light.
 * Palette: instance attributes iPal0..2 (instanced) or uniforms uPal0..2 (single mesh).
 * Glass glows by uWindowGlow when COLOR_0.b (window seed) < uLitShare; role light by uLightGlow.
 */
export function createRoleMaterial(opts: {
  instanced: boolean;
  uniforms: RoleUniforms;
  motion?: MotionUniforms;
  kind?: RoleKind;
  palette?: [string, string, string];
}): THREE.MeshStandardMaterial {
  const { instanced, uniforms } = opts;
  const palette = opts.palette ?? DEFAULT_PALETTE;
  const kind = opts.kind;
  // Only tree, person and vehicle change the program; "static" or no kind is the Phase 2 shader.
  const moving = kind === "tree" || kind === "person" || kind === "vehicle";
  const motion = moving ? (opts.motion ?? createMotionUniforms()) : undefined;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  mat.name = "tl_role";
  const baseKey = instanced ? "tl_role_i" : "tl_role_s";
  mat.customProgramCacheKey = () => (moving ? `${baseKey}_${kind}` : baseKey);

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindowGlow = uniforms.uWindowGlow;
    shader.uniforms.uLitShare = uniforms.uLitShare;
    shader.uniforms.uLightGlow = uniforms.uLightGlow;
    shader.uniforms.uAoStrength = uniforms.uAoStrength;

    let vs = shader.vertexShader;
    let palDecl: string;
    if (instanced) {
      vs = vs.replace(
        "void main() {",
        `attribute vec3 iPal0;
attribute vec3 iPal1;
attribute vec3 iPal2;
varying vec3 vPal0;
varying vec3 vPal1;
varying vec3 vPal2;
void main() {`,
      );
      vs = vs.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vPal0 = iPal0; vPal1 = iPal1; vPal2 = iPal2;`,
      );
      palDecl = "varying vec3 vPal0;\nvarying vec3 vPal1;\nvarying vec3 vPal2;";
    } else {
      for (let i = 0; i < 3; i++)
        shader.uniforms[`uPal${i}`] = { value: new THREE.Color(palette[i]) };
      palDecl = "uniform vec3 uPal0;\nuniform vec3 uPal1;\nuniform vec3 uPal2;";
    }
    const p = (i: number) => (instanced ? `vPal${i}` : `uPal${i}`);

    let fs = shader.fragmentShader;
    fs = fs.replace(
      "void main() {",
      `uniform float uWindowGlow;
uniform float uLitShare;
uniform float uLightGlow;
uniform float uAoStrength;
${palDecl}
void main() {`,
    );
    fs = fs.replace(
      "#include <color_fragment>",
      `float tlAo = mix(1.0, vColor.r, uAoStrength);
int tlRole = int(floor(vColor.g * 7.0 + 0.5));
vec3 tlBase = ${p(0)};
if (tlRole == 1) tlBase = ${p(1)};
else if (tlRole == 2) tlBase = ${p(2)};
else if (tlRole == 3) tlBase = ${vec3Of(FIXED_ROLE_COLOURS.glass)};
else if (tlRole == 4) tlBase = ${vec3Of(FIXED_ROLE_COLOURS.dark)};
else if (tlRole == 5) tlBase = ${vec3Of(FIXED_ROLE_COLOURS.metal)};
else if (tlRole == 6) tlBase = ${vec3Of(FIXED_ROLE_COLOURS.foliage)};
else if (tlRole >= 7) tlBase = ${vec3Of(FIXED_ROLE_COLOURS.light)};
diffuseColor.rgb = tlBase * tlAo;`,
    );
    fs = fs.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
if (tlRole == 3 && vColor.b < uLitShare) totalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * uWindowGlow;
if (tlRole >= 7) totalEmissiveRadiance += ${vec3Of(FIXED_ROLE_COLOURS.light)} * uLightGlow;`,
    );
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    if (motion) applyKind(shader, kind as RoleKind, motion, instanced);
  };
  return mat;
}

/** Instance phase from the matrix translation (0 for a single mesh). */
const phaseOf = (instanced: boolean) =>
  instanced
    ? "float tlPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.53;"
    : "float tlPhase = 0.0;";

function applyKind(
  shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> },
  kind: RoleKind,
  motion: MotionUniforms,
  instanced: boolean,
) {
  const decl = (u: string) => {
    shader.vertexShader = shader.vertexShader.replace("void main() {", `${u}\nvoid main() {`);
  };
  const phase = phaseOf(instanced);
  if (kind === "tree") {
    shader.uniforms.uTime = motion.uTime;
    shader.uniforms.uSway = motion.uSway;
    decl("uniform float uTime;\nuniform float uSway;");
    // COLOR_0.b = sway weight (0 at the trunk base, rising to the crown).
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
{
${phase}
float tlSw = sin(uTime * 1.3 + tlPhase) * 0.25 * color.b * uSway;
transformed.x += tlSw;
transformed.z += tlSw;
}`,
    );
  } else if (kind === "person") {
    shader.uniforms.uTime = motion.uTime;
    shader.uniforms.uLimb = motion.uLimb;
    // COLOR_0.b limb code: 0.25 swings +, 0.75 swings -, 0.5 stays. Legs (y < 0.95 m) pivot at the
    // hip (0.9 m), arms at the shoulder (1.35 m); local metres, so the instance scale applies after.
    decl(`uniform float uTime;
uniform float uLimb;
// x = swing angle (rad), y = pivot height (0 = not a swinging part)
vec2 tlLimb(vec3 pos, float code) {
  if (abs(code - 0.5) < 0.1) return vec2(0.0, 0.0);
  float piv = pos.y < 0.95 ? 0.9 : 1.35;
  float sgn = code < 0.5 ? 1.0 : -1.0;
  ${phase}
  return vec2(sgn * 0.45 * sin(uTime * 6.0 + tlPhase) * uLimb, piv);
}`);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
{
vec2 tlL = tlLimb(position, color.b);
float tlC = cos(tlL.x);
float tlS = sin(tlL.x);
objectNormal = vec3(objectNormal.x, objectNormal.y * tlC - objectNormal.z * tlS, objectNormal.z * tlC + objectNormal.y * tlS);
}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
{
vec2 tlL = tlLimb(position, color.b);
float tlC = cos(tlL.x);
float tlS = sin(tlL.x);
float tlDy = transformed.y - tlL.y;
if (tlL.y > 0.0) transformed.yz = vec2(tlL.y + tlDy * tlC - transformed.z * tlS, transformed.z * tlC + tlDy * tlS);
}`,
      );
  } else {
    // Vehicle: the light role splits by COLOR_0.b (0.25 headlight, 0.75 tail light).
    const head = vec3Of(HEADLIGHT);
    const tail = vec3Of(TAILLIGHT);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "diffuseColor.rgb = tlBase * tlAo;",
        `if (tlRole >= 7) tlBase = vColor.b < 0.5 ? ${head} : ${tail};
diffuseColor.rgb = tlBase * tlAo;`,
      )
      .replace(
        `if (tlRole >= 7) totalEmissiveRadiance += ${vec3Of(FIXED_ROLE_COLOURS.light)} * uLightGlow;`,
        `if (tlRole >= 7) totalEmissiveRadiance += vColor.b < 0.5 ? ${head} * max(uLightGlow, 0.15) : ${tail} * uLightGlow;`,
      );
  }
}
