import * as THREE from "three";
import type { Clearance, Vec3 } from "../../scene/three/clearance";
import { HERO_CHEST_Y } from "../../scene/three/journey/followRig";
import { buildingMeshes } from "../../scene/three/scene/useAcceptanceHook";

/**
 * Building cutaway around the hero (D-T5 ruling). Display only: when she stands inside a drawn
 * building (the planned route crosses Harmoni 1 at the start and the Sales Gallery at ~831 m),
 * fragments of THAT building (inside its footprint box, up to its top) that also lie in a capsule
 * from the camera to her chest are not drawn, so the camera sees her. Every other building is
 * drawn as is. Route data, footprints, heights and positions are untouched; geometry, picking and
 * the clearance grid are unchanged (the camera still never enters a building).
 */

/** Capsule radius (m): wide enough for her whole box (2.5 m tall, walker included) at her end. */
export const CUT_RADIUS_M = 2.6;

export interface Cut {
  on: boolean;
  /** Camera end and hero end (her chest) of the capsule, local metres. */
  a: Vec3;
  b: Vec3;
  r: number;
  /** The building she stands in: its footprint box (padded), ground to top; only it is cut. */
  min: Vec3;
  max: Vec3;
}

/** Padding (m) of the cut building's box, so its wall faces (on the footprint edge) are inside. */
export const CUT_BOX_PAD_M = 0.3;

export const NO_CUT: Cut = {
  on: false,
  a: [0, 0, 0],
  b: [0, 0, 0],
  r: 0,
  min: [0, 0, 0],
  max: [0, 0, 0],
};

/**
 * The cut for a frame: on only while she stands inside a drawn building (the grid), limited to
 * that building's box (the union of the footprints containing her: an OSM extrusion and the
 * archetype box fitted to it). Pure.
 */
export function cutFor(
  hero: readonly [number, number] | null,
  camera: Vec3,
  grid: Pick<Clearance, "footprintsAt"> | null,
): Cut {
  const fps = hero && grid ? grid.footprintsAt(hero[0], hero[1]) : [];
  if (!hero || fps.length === 0) return NO_CUT;
  const p = CUT_BOX_PAD_M;
  return {
    on: true,
    a: [...camera],
    b: [hero[0], HERO_CHEST_Y, hero[1]],
    r: CUT_RADIUS_M,
    min: [Math.min(...fps.map((f) => f.minX)) - p, -p, Math.min(...fps.map((f) => f.minZ)) - p],
    max: [
      Math.max(...fps.map((f) => f.maxX)) + p,
      Math.max(...fps.map((f) => f.topM)) + p,
      Math.max(...fps.map((f) => f.maxZ)) + p,
    ],
  };
}

/** Distance from p to the segment a-b. */
export function segmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l2 = (ab[0] as number) ** 2 + (ab[1] as number) ** 2 + (ab[2] as number) ** 2;
  const t =
    l2 > 0
      ? Math.max(
          0,
          Math.min(
            1,
            ((ap[0] as number) * (ab[0] as number) +
              (ap[1] as number) * (ab[1] as number) +
              (ap[2] as number) * (ab[2] as number)) /
              l2,
          ),
        )
      : 0;
  return Math.hypot(
    p[0] - (a[0] + (ab[0] as number) * t),
    p[1] - (a[1] + (ab[1] as number) * t),
    p[2] - (a[2] + (ab[2] as number) * t),
  );
}

/** True when a building fragment at p is cut away (not drawn). Same test as the shader. */
export const inCut = (cut: Cut, p: Vec3): boolean =>
  cut.on &&
  p[0] >= cut.min[0] &&
  p[0] <= cut.max[0] &&
  p[1] >= cut.min[1] &&
  p[1] <= cut.max[1] &&
  p[2] >= cut.min[2] &&
  p[2] <= cut.max[2] &&
  segmentDistance(p, cut.a, cut.b) < cut.r;

/** Shared uniforms of every patched building material. */
export const cutUniforms = {
  uTlCutOn: { value: 0 },
  uTlCutA: { value: new THREE.Vector3() },
  uTlCutB: { value: new THREE.Vector3() },
  uTlCutR: { value: 0 },
  uTlCutMin: { value: new THREE.Vector3() },
  uTlCutMax: { value: new THREE.Vector3() },
};

/** The cut drawn now (the acceptance probe ignores building hits inside it). */
export const currentCut: { value: Cut } = { value: NO_CUT };

export function setCut(cut: Cut): void {
  currentCut.value = cut;
  cutUniforms.uTlCutOn.value = cut.on ? 1 : 0;
  cutUniforms.uTlCutA.value.set(...cut.a);
  cutUniforms.uTlCutB.value.set(...cut.b);
  cutUniforms.uTlCutR.value = cut.r;
  cutUniforms.uTlCutMin.value.set(...cut.min);
  cutUniforms.uTlCutMax.value.set(...cut.max);
}

const VERT_DECL = "varying vec3 vTlCut;\n";
const VERT_BODY = `
  vec4 tlCutWp = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    tlCutWp = batchingMatrix * tlCutWp;
  #endif
  #ifdef USE_INSTANCING
    tlCutWp = instanceMatrix * tlCutWp;
  #endif
  vTlCut = ( modelMatrix * tlCutWp ).xyz;
`;
const FRAG_DECL = `varying vec3 vTlCut;
uniform float uTlCutOn;
uniform vec3 uTlCutA;
uniform vec3 uTlCutB;
uniform float uTlCutR;
uniform vec3 uTlCutMin;
uniform vec3 uTlCutMax;
`;
const FRAG_BODY = `
  if ( uTlCutOn > 0.5 && all( greaterThanEqual( vTlCut, uTlCutMin ) ) && all( lessThanEqual( vTlCut, uTlCutMax ) ) ) {
    vec3 tlAb = uTlCutB - uTlCutA;
    float tlT = clamp( dot( vTlCut - uTlCutA, tlAb ) / max( dot( tlAb, tlAb ), 1e-6 ), 0.0, 1.0 );
    if ( distance( vTlCut, uTlCutA + tlAb * tlT ) < uTlCutR ) discard;
  }
`;

/** Injects the cutaway into a material's shader source (pure string edit); null if it does not fit. */
export function injectCutaway(
  vertex: string,
  fragment: string,
): { vertex: string; fragment: string } | null {
  if (
    !vertex.includes("#include <project_vertex>") ||
    !vertex.includes("void main() {") ||
    !fragment.includes("void main() {")
  )
    return null;
  return {
    vertex: vertex
      .replace("void main() {", `${VERT_DECL}void main() {`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERT_BODY}`),
    fragment: fragment.replace("void main() {", `${FRAG_DECL}void main() {\n${FRAG_BODY}`),
  };
}

const patched = new WeakSet<THREE.Material>();

/** Adds the cutaway to a material (once; keeps any existing onBeforeCompile). True when patched now. */
export function patchCutaway(m: THREE.Material): boolean {
  if (patched.has(m)) return false;
  patched.add(m);
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    const out = injectCutaway(shader.vertexShader, shader.fragmentShader);
    if (!out) return;
    shader.vertexShader = out.vertex;
    shader.fragmentShader = out.fragment;
    Object.assign(shader.uniforms, cutUniforms);
  };
  m.customProgramCacheKey = () => `${prevKey()}|tl-cut`;
  m.needsUpdate = true;
  return true;
}

/** Patches every drawn building / landmark material under the roots; the count patched now. */
export function applyCutaway(roots: THREE.Object3D[]): number {
  let n = 0;
  for (const mesh of buildingMeshes(roots)) {
    const ms = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of ms) if (m && patchCutaway(m)) n++;
  }
  return n;
}
