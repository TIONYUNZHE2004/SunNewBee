import * as THREE from "three";

/**
 * Decorative occluder cut (final gate: at the dive end a foreground canopy covered the journey hero;
 * at other beats a decorative parked car and a tree trunk stood between camera and hero). Display
 * only, decorative items only (whole trees, parked and moving cars: `DECOR_CUT_KINDS`): while the
 * journey camera follows her, their fragments inside a capsule from the camera to her chest are not
 * drawn. They are decoration ("Decorative details are illustrative."), never facts; fact props,
 * buildings (their own cutaway), picking, the clearance grid and route data are unchanged. Built
 * into those programs from the start (`roleMaterial`), switched by a uniform, so it never compiles a
 * program mid-trip.
 */

/** Capsule radius (m): her whole body (2.5 m tall, walker included) at her end. */
export const TREE_CUT_RADIUS_M = 1.8;

export const treeCutUniforms = {
  uTlTreeCutOn: { value: 0 },
  uTlTreeCutA: { value: new THREE.Vector3() },
  uTlTreeCutB: { value: new THREE.Vector3() },
  uTlTreeCutR: { value: TREE_CUT_RADIUS_M },
};

type V3 = readonly [number, number, number];

/** The cut drawn now (null: off). */
export const currentTreeCut: { value: { a: V3; b: V3; r: number } | null } = { value: null };

/** Turns the cut on between the camera `a` and her chest `b`, or off (null). */
export function setTreeCut(cut: { a: V3; b: V3 } | null): void {
  currentTreeCut.value = cut ? { a: cut.a, b: cut.b, r: TREE_CUT_RADIUS_M } : null;
  treeCutUniforms.uTlTreeCutOn.value = cut ? 1 : 0;
  if (!cut) return;
  treeCutUniforms.uTlTreeCutA.value.set(cut.a[0], cut.a[1], cut.a[2]);
  treeCutUniforms.uTlTreeCutB.value.set(cut.b[0], cut.b[1], cut.b[2]);
}

/** True when a tree fragment at p is cut (the shader's test). */
export function inTreeCut(p: V3): boolean {
  const c = currentTreeCut.value;
  if (!c) return false;
  const ab = [c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]] as const;
  const ap = [p[0] - c.a[0], p[1] - c.a[1], p[2] - c.a[2]] as const;
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t =
    l2 > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2)) : 0;
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t) < c.r;
}

/** The vertex shader additions (exported for tests that compare programs without the cut). */
export const TREE_CUT_VERT_DECL = "varying vec3 vTlTreeCut;\n";
export const TREE_CUT_VERT_BODY = `
  vec4 tlTreeWp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    tlTreeWp = instanceMatrix * tlTreeWp;
  #endif
  vTlTreeCut = ( modelMatrix * tlTreeWp ).xyz;
`;
const FRAG_DECL = `varying vec3 vTlTreeCut;
uniform float uTlTreeCutOn;
uniform vec3 uTlTreeCutA;
uniform vec3 uTlTreeCutB;
uniform float uTlTreeCutR;
`;
const FRAG_BODY = `
  if ( uTlTreeCutOn > 0.5 ) {
    vec3 tlTab = uTlTreeCutB - uTlTreeCutA;
    float tlTt = clamp( dot( vTlTreeCut - uTlTreeCutA, tlTab ) / max( dot( tlTab, tlTab ), 1e-6 ), 0.0, 1.0 );
    if ( distance( vTlTreeCut, uTlTreeCutA + tlTab * tlTt ) < uTlTreeCutR ) discard;
  }
`;

/** Adds the tree cut to a compiling shader (string edit + shared uniforms); false if it does not fit. */
export function injectTreeCut(shader: {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, unknown>;
}): boolean {
  if (
    !shader.vertexShader.includes("#include <project_vertex>") ||
    !shader.vertexShader.includes("void main() {") ||
    !shader.fragmentShader.includes("void main() {")
  )
    return false;
  shader.vertexShader = shader.vertexShader
    .replace("void main() {", `${TREE_CUT_VERT_DECL}void main() {`)
    .replace("#include <project_vertex>", `#include <project_vertex>\n${TREE_CUT_VERT_BODY}`);
  shader.fragmentShader = shader.fragmentShader.replace(
    "void main() {",
    `${FRAG_DECL}void main() {\n${FRAG_BODY}`,
  );
  Object.assign(shader.uniforms, treeCutUniforms);
  return true;
}
