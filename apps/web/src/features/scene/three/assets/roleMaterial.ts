import * as THREE from "three";
import type { Tier } from "../../shared/quality";
import {
  CLAY,
  CLAY_PALETTE,
  type ClayRole,
  clayMaterial,
  EFFECT_COLOURS,
} from "../shared/clayTokens";
import { injectTreeCut } from "./treeCut";

export interface RoleUniforms {
  uWindowGlow: { value: number };
  uLitShare: { value: number };
  uLightGlow: { value: number };
  uAoStrength: { value: number };
  /** 1 = lit windows flicker (night and motion running); 0 = steady. Task 8 drives it. */
  uFlicker: { value: number };
}

/** sRGB hex (clay token table); THREE.Color converts to linear working space on construction. */
export const FIXED_ROLE_COLOURS: Record<"glass" | "dark" | "metal" | "foliage" | "light", string> =
  { ...CLAY_PALETTE.fixedRole };

/**
 * Clay role per archetype role index (0 primary, 1 secondary, 2 accent, 3 glass, 4 dark, 5 metal,
 * 6 foliage, 7 light): the fragment shader takes each role's roughness and metalness from its token
 * (B-T1). Only role 5 (metal: railings, poles, gates) has metalness.
 */
export const ROLE_CLAY: readonly ClayRole[] = [
  "wall",
  "roof",
  "wall",
  "glass",
  "dark",
  "metal",
  "foliage",
  "light",
];

/**
 * GLSL (after `metalnessmap_fragment`) that sets `roughnessFactor` / `metalnessFactor` per role from
 * the clay tokens, and `tlSheenK` / `tlSheenR`: the role's sheen relative to the material's (`base`
 * token, which sets the sheenColor uniform) and its sheen roughness. `roleSheenGlsl` applies them.
 */
export function roleResponseGlsl(base: ClayRole = "wall"): string {
  const ref = CLAY[base].sheen;
  const lines: string[] = ["float tlSheenK = 1.0;", "float tlSheenR = 0.8;"];
  ROLE_CLAY.forEach((role, i) => {
    const tok = CLAY[role];
    const cond = i === 7 ? "tlRole >= 7" : `tlRole == ${i}`;
    lines.push(
      `${i === 0 ? "" : "else "}if (${cond}) { roughnessFactor = ${tok.roughness.toFixed(2)}; metalnessFactor = ${tok.metalness.toFixed(2)}; tlSheenK = ${(tok.sheen / ref).toFixed(4)}; tlSheenR = ${tok.sheenRoughness.toFixed(2)}; }`,
    );
  });
  return lines.join(String.fromCharCode(10));
}

/** GLSL (after `lights_physical_fragment`): per-role sheen; a no-op without USE_SHEEN (Medium / Low). */
export const ROLE_SHEEN_GLSL = `#ifdef USE_SHEEN
material.sheenColor *= tlSheenK;
material.sheenRoughness = clamp(tlSheenR, 0.0001, 1.0);
#endif`;

/**
 * Floor for the baked AO (COLOR_0.r), A-T8. The per-vertex bake leaves exact zeros at corners whose
 * smoothed normal points into the ground or the body, and a zero multiplies the role colour to pure
 * black. The build clamps to this value (`AO_FLOOR` in assets/blender/tl_assets/core.py; a test
 * checks they match); the shader applies it too as a safety net for older glbs.
 */
export const AO_FLOOR = 0.4;

/**
 * Per-role AO floor (A-T8, display only). Index = role (0 primary, 1 secondary, 2 accent, 3 glass,
 * 4 dark, 5 metal, 6 foliage, 7 light). Measured at the link-house bookmark: recessed glass, brick
 * panels and the dark screen backing fell under 0.03 luminance only because the baked AO multiplied
 * in; walls, roofs and the ground keep the full AO (contact shadows). Roofs do not get a higher
 * floor: with AO off they are as dark (their share is ambient-only shade). Every entry is
 * >= `AO_FLOOR`, the build clamp.
 */
export const AO_FLOOR_BY_ROLE: readonly number[] = [0.4, 0.4, 0.7, 0.85, 0.7, 0.4, 0.4, 0.4];

/**
 * Rounded edges for the archetype and landmark GLBs (B-T2, AC-B3): a normal-only bevel in the role
 * shader, chosen over a Blender bevel modifier (no rebuild of every asset, no extra triangles or
 * bytes, the 4 MB city-kit budget untouched). Nothing moves: positions, footprints and heights are
 * exactly the fitted model's (AC-B2), only the shading normal tilts.
 * - Within `radiusM` (world metres, through the instance or mesh scale) of the model's box edges,
 *   the normal of a face lying on that box side tilts towards the neighbouring side, reaching 45° at
 *   the edge, so both faces meet with the same normal and the vertical corners and roof edges shade
 *   as a quarter-round.
 * - Every vertical face also rounds into the top within `radiusM` of the model's top (the mall's
 *   parapet follows its OSM outline, not its box).
 * - `onFaceM`: how far inside the box side a face may lie and still count as on it (plinths and
 *   reveals keep the main wall a little inside the box).
 */
export const BUILDING_SHADER_BEVEL = { radiusM: 0.45, onFaceM: 0.6 };

/** A model's local bounding box (`[x, y, z]` min and max): the shader bevel's reference. */
export interface BevelBox {
  min: [number, number, number];
  max: [number, number, number];
}

/** The box of a geometry, for `createRoleMaterial({ bevel })`. */
export function bevelBoxOf(geo: THREE.BufferGeometry): BevelBox | null {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const b = geo.boundingBox;
  if (!b || b.isEmpty()) return null;
  return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
}

/** Vertex GLSL: the view-space images of the object axes (the normal transform, instancing aware). */
export const BEVEL_VERTEX_DECL = `varying vec3 vTlP;
varying vec3 vTlN;
varying vec3 vTlAX;
varying vec3 vTlAY;
varying vec3 vTlAZ;
vec3 tlNrm(vec3 n) {
#ifdef USE_INSTANCING
  mat3 tlIm = mat3(instanceMatrix);
  n /= vec3(dot(tlIm[0], tlIm[0]), dot(tlIm[1], tlIm[1]), dot(tlIm[2], tlIm[2]));
  n = tlIm * n;
#endif
  return normalMatrix * n;
}`;

export const BEVEL_VERTEX = `vTlP = position;
vTlN = objectNormal;
vTlAX = tlNrm(vec3(1.0, 0.0, 0.0));
vTlAY = tlNrm(vec3(0.0, 1.0, 0.0));
vTlAZ = tlNrm(vec3(0.0, 0.0, 1.0));`;

export const BEVEL_FRAGMENT_DECL = `uniform vec3 uTlBoxMin;
uniform vec3 uTlBoxMax;
uniform vec2 uTlBevel;
varying vec3 vTlP;
varying vec3 vTlN;
varying vec3 vTlAX;
varying vec3 vTlAY;
varying vec3 vTlAZ;`;

/** Fragment GLSL after `normal_fragment_maps`: tilts the view-space `normal` near the box edges. */
export const BEVEL_FRAGMENT = `{
  // |axis image| = 1 / scale along that axis, so these are world metres.
  vec3 tlS = vec3(1.0 / max(length(vTlAX), 1e-6), 1.0 / max(length(vTlAY), 1e-6), 1.0 / max(length(vTlAZ), 1e-6));
  vec3 tlQ = vTlP - 0.5 * (uTlBoxMin + uTlBoxMax);
  vec3 tlH = 0.5 * (uTlBoxMax - uTlBoxMin);
  vec3 tlFn = normalize(vTlN);
  float tlDx = (tlH.x - abs(tlQ.x)) * tlS.x;
  float tlDz = (tlH.z - abs(tlQ.z)) * tlS.z;
  float tlDy = (uTlBoxMax.y - vTlP.y) * tlS.y;
  float tlWx = 1.0 - smoothstep(0.0, uTlBevel.x, tlDx);
  float tlWz = 1.0 - smoothstep(0.0, uTlBevel.x, tlDz);
  float tlWy = 1.0 - smoothstep(0.0, uTlBevel.x, tlDy);
  vec3 tlX = normalize(vTlAX) * sign(tlQ.x);
  vec3 tlY = normalize(vTlAY);
  vec3 tlZ = normalize(vTlAZ) * sign(tlQ.z);
  vec3 tlAdd = vec3(0.0);
  if (abs(tlFn.y) < 0.3) tlAdd += tlWy * tlY;
  if (abs(tlFn.x) > 0.9 && tlDx < uTlBevel.y) tlAdd += tlWz * tlZ;
  else if (abs(tlFn.z) > 0.9 && tlDz < uTlBevel.y) tlAdd += tlWx * tlX;
  else if (tlFn.y > 0.9 && tlDy < uTlBevel.y) tlAdd += tlWx * tlX + tlWz * tlZ;
  normal = normalize(normal + tlAdd);
}`;

/** Shared by every kit material; driven by the motion clock (Task 8). */
export interface MotionUniforms {
  uTime: { value: number };
  uSway: { value: number };
  uLimb: { value: number };
}

export function createMotionUniforms(): MotionUniforms {
  return { uTime: { value: 0 }, uSway: { value: 1 }, uLimb: { value: 1 } };
}

/**
 * `vehicle`: moving traffic (motion layer), headlights and tail lights glow. `parked`: a static
 * parked car (the `vehicles` kit in the city instances), its lights stay off at every mood and its
 * light-role faces take the body colour (primary palette), not the pale lamp colour.
 */
export type RoleKind = "tree" | "person" | "vehicle" | "parked" | "static";

/** Decorative kinds the journey's camera-to-hero cut may hide (treeCut.ts): trees and cars. */
export const DECOR_CUT_KINDS: ReadonlySet<RoleKind> = new Set(["tree", "parked", "vehicle"]);

const HEADLIGHT = EFFECT_COLOURS.headlight;
const TAILLIGHT = EFFECT_COLOURS.taillight;

export function createRoleUniforms(): RoleUniforms {
  return {
    uWindowGlow: { value: 0 },
    uLitShare: { value: 0.6 },
    uLightGlow: { value: 0 },
    uAoStrength: { value: 1 },
    uFlicker: { value: 0 },
  };
}

/** GLSL that sets `float tlAoFloor` from `tlRole` (roles >= 7 share the last entry). */
export function aoFloorGlsl(): string {
  const f = (i: number) => (AO_FLOOR_BY_ROLE[i] ?? AO_FLOOR).toFixed(2);
  const lines = [`float tlAoFloor = ${f(0)};`];
  for (let i = 1; i < 7; i++)
    lines.push(`${i === 1 ? "" : "else "}if (tlRole == ${i}) tlAoFloor = ${f(i)};`);
  lines.push(`else if (tlRole >= 7) tlAoFloor = ${f(7)};`);
  return lines.join(String.fromCharCode(10));
}

const vec3Of = (hex: string) => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
};

const DEFAULT_PALETTE: [string, string, string] = [...CLAY_PALETTE.roleDefault];

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
  /** Opt in to lit-window flicker (needs `motion.uTime`, gated at run time by `uniforms.uFlicker`). */
  flicker?: boolean;
  /** Scales the lit-glass night glow (default 1; roof skylights use 0.6, softer than the windows). */
  glassGlow?: number;
  /** Quality tier for the clay factory (High: physical + sheen; below: standard). Default: `clayTier()`. */
  tier?: Tier;
  /**
   * Buildings (archetypes, landmarks): the model's box for the normal-only shader bevel
   * (`BUILDING_SHADER_BEVEL`). The box is a per-material uniform, so each model gets its own
   * material; the program is shared (`_bv` key).
   */
  bevel?: BevelBox;
}): THREE.MeshStandardMaterial {
  const { instanced, uniforms } = opts;
  const palette = opts.palette ?? DEFAULT_PALETTE;
  const kind = opts.kind;
  // Only tree, person and vehicle change the program; "static" or no kind is the Phase 2 shader.
  const moving = kind === "tree" || kind === "person" || kind === "vehicle";
  // Parked: the static program without the light-role glow (lights off, never read as traffic).
  const parked = kind === "parked";
  const flicker = opts.flicker === true;
  const glassGlow = opts.glassGlow ?? 1;
  const motion = moving || flicker ? (opts.motion ?? createMotionUniforms()) : undefined;
  const clayRole: ClayRole =
    kind === "person" ? "person" : kind === "vehicle" || kind === "parked" ? "vehicle" : "wall";
  const mat = clayMaterial(clayRole, { vertexColors: true, tier: opts.tier });
  mat.name = "tl_role";
  const baseKey = instanced ? "tl_role_i" : "tl_role_s";
  const bevel = opts.bevel;
  mat.customProgramCacheKey = () =>
    `${moving || parked ? `${baseKey}_${kind}` : baseKey}${flicker ? "_fl" : ""}${glassGlow === 1 ? "" : `_g${glassGlow}`}${bevel ? "_bv" : ""}`;
  if (bevel) mat.userData.bevel = { box: bevel, ...BUILDING_SHADER_BEVEL };
  // carries the journey's decorative occluder cut (the engine also keeps it out of the post passes'
  // depth while the cut is on)
  if (kind && DECOR_CUT_KINDS.has(kind)) mat.userData.tlDecorCut = true;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindowGlow = uniforms.uWindowGlow;
    shader.uniforms.uLitShare = uniforms.uLitShare;
    shader.uniforms.uLightGlow = uniforms.uLightGlow;
    shader.uniforms.uAoStrength = uniforms.uAoStrength;
    if (flicker && motion) {
      shader.uniforms.uFlicker = uniforms.uFlicker;
      shader.uniforms.uTime = motion.uTime;
    }

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
      `${flicker ? "uniform float uTime;\nuniform float uFlicker;\n" : ""}uniform float uWindowGlow;
uniform float uLitShare;
uniform float uLightGlow;
uniform float uAoStrength;
${palDecl}
void main() {`,
    );
    fs = fs.replace(
      "#include <color_fragment>",
      `int tlRole = int(floor(vColor.g * 7.0 + 0.5));
${aoFloorGlsl()}
float tlAo = mix(1.0, max(vColor.r, tlAoFloor), uAoStrength);
vec3 tlBase = ${p(0)};
if (tlRole == 1) tlBase = ${p(1)};
else if (tlRole == 2) tlBase = ${p(2)};
else if (tlRole == 3) tlBase = ${vec3Of(FIXED_ROLE_COLOURS.glass)};
else if (tlRole == 4) tlBase = ${vec3Of(kind === "tree" ? CLAY_PALETTE.trunk : FIXED_ROLE_COLOURS.dark)};
else if (tlRole == 5) tlBase = ${vec3Of(FIXED_ROLE_COLOURS.metal)};
else if (tlRole == 6) tlBase = ${vec3Of(FIXED_ROLE_COLOURS.foliage)};
else if (tlRole >= 7) tlBase = ${parked ? p(0) : vec3Of(FIXED_ROLE_COLOURS.light)};
diffuseColor.rgb = tlBase * tlAo;`,
    );
    fs = fs.replace(
      "#include <metalnessmap_fragment>",
      `#include <metalnessmap_fragment>
${roleResponseGlsl(clayRole)}`,
    );
    fs = fs.replace(
      "#include <lights_physical_fragment>",
      `#include <lights_physical_fragment>
${ROLE_SHEEN_GLSL}`,
    );
    fs = fs.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
if (tlRole == 3 && vColor.b < uLitShare) totalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * uWindowGlow${glassGlow === 1 ? "" : ` * ${glassGlow.toFixed(2)}`}${
        flicker
          ? " * mix(1.0, 0.9 + 0.1 * step(0.97, fract(sin(vColor.b * 9301.0 + floor(uTime * 0.5)) * 43758.0)), uFlicker)"
          : ""
      };
${parked ? "" : `if (tlRole >= 7) totalEmissiveRadiance += ${vec3Of(FIXED_ROLE_COLOURS.light)} * uLightGlow;`}`,
    );
    if (bevel) {
      shader.uniforms.uTlBoxMin = { value: new THREE.Vector3(...bevel.min) };
      shader.uniforms.uTlBoxMax = { value: new THREE.Vector3(...bevel.max) };
      shader.uniforms.uTlBevel = {
        value: new THREE.Vector2(BUILDING_SHADER_BEVEL.radiusM, BUILDING_SHADER_BEVEL.onFaceM),
      };
      vs = vs
        .replace(
          "void main() {",
          `${BEVEL_VERTEX_DECL}
void main() {`,
        )
        .replace(
          "#include <defaultnormal_vertex>",
          `#include <defaultnormal_vertex>
${BEVEL_VERTEX}`,
        );
      fs = fs
        .replace(
          "void main() {",
          `${BEVEL_FRAGMENT_DECL}
void main() {`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
${BEVEL_FRAGMENT}`,
        );
    }
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    if (motion && moving) applyKind(shader, kind as RoleKind, motion, instanced);
    // The journey's decorative occluder cut (whole trees, parked and moving cars; off unless the
    // follow camera turns it on, treeCut.ts). Never buildings (cutaway) or fact props.
    if (DECOR_CUT_KINDS.has(kind as RoleKind)) injectTreeCut(shader);
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
  } else if (kind === "vehicle") {
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
