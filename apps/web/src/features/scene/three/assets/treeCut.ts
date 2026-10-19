import * as THREE from "three";

/**
 * Decorative occluder cut (final gate and §9.1 comparison: a foreground canopy, a parked car, a
 * tree trunk, a lamp post and a crowd figure stood between the camera and the hero or the event's
 * element). Display only, decorative items only: whole trees, parked and moving cars, the
 * decorative props kit (lamp posts, furniture), the decorative street dressing and the decorative
 * crowd. While the journey camera follows her, their fragments inside a capsule from the camera to
 * her chest, and (at an event hold) from the camera to the event's element, are not drawn. They are
 * decoration ("Decorative details are illustrative."), never facts; fact props (mapped benches),
 * buildings (their own cutaway), the hero, picking, the clearance grid and route data are
 * unchanged. Built into those programs from the start, switched by a uniform, so it never compiles a
 * program mid-trip.
 *
 * ITER2 (owner video: huge canopies at the first crossing, a canopy at the 836 m rest, giant heads
 * at the frame's edges): while the cut is on, decorative fragments near the camera itself are not
 * drawn either: inside NEAR_CUT_M of the camera none, then a screen-door fade over NEAR_FADE_M; and a
 * whole instanced item (a tree with its trunk, a car) whose origin stands within NEAR_INSTANCE_M of
 * the camera on the ground is not drawn at all, so it never shows as a hollow half.
 */

/** Capsule radius (m): her whole body (2.5 m tall, walker included) at her end. */
export const TREE_CUT_RADIUS_M = 1.8;
/**
 * Near-camera cut (m): decorative fragments this close to the camera are not drawn. The follow
 * camera stands ~10.5 m from her (followPose), so her own surroundings stay.
 */
export const NEAR_CUT_M = 6;
/** Beyond NEAR_CUT_M, decorative fragments fade in (screen-door) over this many metres. */
export const NEAR_FADE_M = 1.5;
/** A whole instanced decorative item whose origin is this close to the camera (ground metres) is not drawn. */
export const NEAR_INSTANCE_M = 6.5;

export const treeCutUniforms = {
  uTlTreeCutOn: { value: 0 },
  uTlTreeCutA: { value: new THREE.Vector3() },
  uTlTreeCutB: { value: new THREE.Vector3() },
  /** The second capsule's far end (the event's element); `uTlTreeCutC2` 0 turns it off. */
  uTlTreeCutC: { value: new THREE.Vector3() },
  uTlTreeCutC2: { value: 0 },
  uTlTreeCutR: { value: TREE_CUT_RADIUS_M },
  uTlNearR: { value: NEAR_CUT_M },
  uTlNearFade: { value: NEAR_FADE_M },
  uTlNearInst: { value: NEAR_INSTANCE_M },
};

type V3 = readonly [number, number, number];

/** The cut drawn now (null: off). */
export const currentTreeCut: { value: { a: V3; b: V3; c: V3 | null; r: number } | null } = {
  value: null,
};

/**
 * Turns the cut on between the camera `a` and her chest `b` (and, with `c`, the camera and the
 * event's element too), or off (null).
 */
export function setTreeCut(cut: { a: V3; b: V3; c?: V3 | null } | null): void {
  currentTreeCut.value = cut
    ? { a: cut.a, b: cut.b, c: cut.c ?? null, r: TREE_CUT_RADIUS_M }
    : null;
  treeCutUniforms.uTlTreeCutOn.value = cut ? 1 : 0;
  treeCutUniforms.uTlTreeCutC2.value = cut?.c ? 1 : 0;
  if (!cut) return;
  treeCutUniforms.uTlTreeCutA.value.set(cut.a[0], cut.a[1], cut.a[2]);
  treeCutUniforms.uTlTreeCutB.value.set(cut.b[0], cut.b[1], cut.b[2]);
  if (cut.c) treeCutUniforms.uTlTreeCutC.value.set(cut.c[0], cut.c[1], cut.c[2]);
}

function segDist(p: V3, a: V3, b: V3): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]] as const;
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t =
    l2 > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2)) : 0;
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

/**
 * True when a decorative fragment at p is cut (the shader's test; the near-camera fade band counts
 * as drawn). `origin`: the fragment's instance origin, for an instanced or batched item.
 */
export function inTreeCut(p: V3, origin?: V3): boolean {
  const c = currentTreeCut.value;
  if (!c) return false;
  if (segDist(p, c.a, c.b) < c.r || (!!c.c && segDist(p, c.a, c.c) < c.r)) return true;
  if (Math.hypot(p[0] - c.a[0], p[1] - c.a[1], p[2] - c.a[2]) < NEAR_CUT_M) return true;
  return !!origin && Math.hypot(origin[0] - c.a[0], origin[2] - c.a[2]) < NEAR_INSTANCE_M;
}

/** The vertex shader additions (exported for tests that compare programs without the cut). */
export const TREE_CUT_VERT_DECL =
  "varying vec3 vTlTreeCut;\nvarying vec3 vTlCutOrigin;\nvarying float vTlCutInst;\n";
export const TREE_CUT_VERT_BODY = `
  vec4 tlTreeWp = vec4( transformed, 1.0 );
  vec4 tlCutO = vec4( 0.0, 0.0, 0.0, 1.0 );
  vTlCutInst = 0.0;
  #ifdef USE_BATCHING
    tlTreeWp = batchingMatrix * tlTreeWp;
    tlCutO = batchingMatrix * tlCutO;
    vTlCutInst = 1.0;
  #endif
  #ifdef USE_INSTANCING
    tlTreeWp = instanceMatrix * tlTreeWp;
    tlCutO = instanceMatrix * tlCutO;
    vTlCutInst = 1.0;
  #endif
  vTlTreeCut = ( modelMatrix * tlTreeWp ).xyz;
  vTlCutOrigin = ( modelMatrix * tlCutO ).xyz;
`;
const FRAG_DECL = `varying vec3 vTlTreeCut;
varying vec3 vTlCutOrigin;
varying float vTlCutInst;
uniform float uTlNearR;
uniform float uTlNearFade;
uniform float uTlNearInst;
uniform float uTlTreeCutOn;
uniform vec3 uTlTreeCutA;
uniform vec3 uTlTreeCutB;
uniform vec3 uTlTreeCutC;
uniform float uTlTreeCutC2;
uniform float uTlTreeCutR;
float tlTreeSeg( vec3 p, vec3 a, vec3 b ) {
  vec3 ab = b - a;
  float t = clamp( dot( p - a, ab ) / max( dot( ab, ab ), 1e-6 ), 0.0, 1.0 );
  return distance( p, a + ab * t );
}
`;
const FRAG_BODY = `
  if ( uTlTreeCutOn > 0.5 ) {
    if ( tlTreeSeg( vTlTreeCut, uTlTreeCutA, uTlTreeCutB ) < uTlTreeCutR ) discard;
    if ( uTlTreeCutC2 > 0.5 && tlTreeSeg( vTlTreeCut, uTlTreeCutA, uTlTreeCutC ) < uTlTreeCutR ) discard;
    if ( vTlCutInst > 0.5 && distance( vTlCutOrigin.xz, uTlTreeCutA.xz ) < uTlNearInst ) discard;
    float tlNear = distance( vTlTreeCut, uTlTreeCutA );
    if ( tlNear < uTlNearR ) discard;
    if ( tlNear < uTlNearR + uTlNearFade ) {
      float tlIgn = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
      if ( tlIgn > ( tlNear - uTlNearR ) / uTlNearFade ) discard;
    }
  }
`;

/** Adds the decorative cut to a compiling shader (string edit + shared uniforms); false if it does not fit. */
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

/**
 * Adds the decorative cut to a material (once), keeping its earlier `onBeforeCompile` and giving it
 * its own program cache key. For decorative-only materials (never a fact prop's or a building's).
 */
export function patchDecorCut(m: THREE.Material): void {
  if (m.userData.tlDecorCut) return;
  m.userData.tlDecorCut = true;
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    injectTreeCut(shader);
  };
  m.customProgramCacheKey = () => `${prevKey()}|tl-dcut`;
  m.needsUpdate = true;
}
