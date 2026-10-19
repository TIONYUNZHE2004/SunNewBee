import * as THREE from "three";
import type { Tier } from "../../shared/quality";
import { clayMaterial } from "../shared/clayTokens";
import { PEOPLE_VISIBLE_M } from "./agents";
import type { CrowdKit } from "./crowdBake";

/**
 * DECORATIVE crowd renderer (C-T7, P4/P5): one BatchedMesh per LOD (so at most 2 draw calls for the
 * whole crowd, multi-draw), each holding every look geometry the layer needs and one instance per
 * agent slot. A skinning shader samples the baked bone-matrix texture (`crowdBake.ts`) at the two
 * frames around the agent's gait phase and blends them; a per-instance texel carries
 * (row0, row1, blend, look row) and the palette texture recolours by (role, look). Props are
 * one-bone skinned. Nothing here is a fact: "Decorative details are illustrative."
 *
 * Slot `i` is instance `i` in both LOD meshes (same look geometry), so one instance texture serves
 * both; `set` shows a slot on one LOD and hides it on the other.
 */
export interface CrowdRenderer {
  group: THREE.Group;
  meshes: [THREE.BatchedMesh, THREE.BatchedMesh];
  material: THREE.MeshStandardMaterial;
  readonly slots: number;
  /** Show slot `i` on `lod` with `matrix`, posed between animation rows `row0` / `row1` by `t`. */
  set(i: number, lod: 0 | 1, matrix: THREE.Matrix4, row0: number, row1: number, t: number): void;
  hide(i: number): void;
  /** After a tick's set / hide calls: uploads the instance texture when it changed. */
  commit(): void;
  /** Draw calls this crowd costs now: one per LOD mesh with a visible instance. */
  drawCalls(): number;
  /** Visible instance count per LOD. */
  visible(): [number, number];
  /** The per-instance texels (row0, row1, blend, look) by slot (tests and reports). */
  instances(): Float32Array;
  /** Look index of a slot (heights and reports). */
  lookOf(i: number): number;
  setOpacity(o: number): void;
  dispose(): void;
}

const VERT_DECL = `uniform highp sampler2D tlCrowdAnim;
uniform highp sampler2D tlCrowdInst;
uniform vec2 tlCrowdPalSize;
attribute float crowdRole;
attribute vec4 crowdBone;
attribute vec4 crowdWeight;
varying vec2 vTlPal;
vec4 tlTexel(int row, int b, int r) { return texelFetch(tlCrowdAnim, ivec2(b * 3 + r, row), 0); }
void main() {`;

/** Replaces skinbase_vertex: the blended 3x4 skin matrix rows tlR0..2 for this vertex. */
const VERT_SKINBASE = `#ifdef USE_BATCHING
float tlId = getIndirectIndex(gl_DrawID);
#else
float tlId = 0.0;
#endif
int tlW = textureSize(tlCrowdInst, 0).x;
int tlJ = int(tlId + 0.5);
vec4 tlD = texelFetch(tlCrowdInst, ivec2(tlJ % tlW, tlJ / tlW), 0);
int tlF0 = int(tlD.x + 0.5);
int tlF1 = int(tlD.y + 0.5);
vec4 tlR0 = vec4(0.0);
vec4 tlR1 = vec4(0.0);
vec4 tlR2 = vec4(0.0);
for (int k = 0; k < 4; k++) {
  float tlWk = crowdWeight[k];
  if (tlWk > 0.0) {
    int tlB = int(crowdBone[k] + 0.5);
    tlR0 += tlWk * mix(tlTexel(tlF0, tlB, 0), tlTexel(tlF1, tlB, 0), tlD.z);
    tlR1 += tlWk * mix(tlTexel(tlF0, tlB, 1), tlTexel(tlF1, tlB, 1), tlD.z);
    tlR2 += tlWk * mix(tlTexel(tlF0, tlB, 2), tlTexel(tlF1, tlB, 2), tlD.z);
  }
}
vTlPal = vec2((crowdRole + 0.5) / tlCrowdPalSize.x, (tlD.w + 0.5) / tlCrowdPalSize.y);`;

const VERT_SKINNORMAL =
  "objectNormal = vec3(dot(tlR0.xyz, objectNormal), dot(tlR1.xyz, objectNormal), dot(tlR2.xyz, objectNormal));";
const VERT_SKINNING =
  "transformed = vec3(dot(tlR0, vec4(transformed, 1.0)), dot(tlR1, vec4(transformed, 1.0)), dot(tlR2, vec4(transformed, 1.0)));";

/** The crowd's shader hooks (exported for the shader-string tests). */
export function patchCrowdShader(
  shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> },
  u: Record<string, { value: unknown }>,
): void {
  Object.assign(shader.uniforms, u);
  const need = (src: string, chunk: string) => {
    if (!src.includes(chunk)) throw new Error(`crowd shader: ${chunk} missing`);
  };
  for (const c of [
    "void main() {",
    "#include <skinbase_vertex>",
    "#include <skinnormal_vertex>",
    "#include <skinning_vertex>",
  ])
    need(shader.vertexShader, c);
  need(shader.fragmentShader, "#include <color_fragment>");
  shader.vertexShader = shader.vertexShader
    .replace("void main() {", VERT_DECL)
    .replace("#include <skinbase_vertex>", VERT_SKINBASE)
    .replace("#include <skinnormal_vertex>", VERT_SKINNORMAL)
    .replace("#include <skinning_vertex>", VERT_SKINNING);
  shader.fragmentShader = shader.fragmentShader
    .replace("void main() {", "uniform sampler2D tlCrowdPal;\nvarying vec2 vTlPal;\nvoid main() {")
    .replace(
      "#include <color_fragment>",
      "#include <color_fragment>\ndiffuseColor.rgb *= texture2D(tlCrowdPal, vTlPal).rgb;",
    );
}

/**
 * The crowd's LOD bands (R-J7, superseding P4's "hidden beyond 300 m"): the manifest's bands with the
 * last (LOD1) stretched to PEOPLE_VISIBLE_M (800 m), so far crowds stay visible at up to 2.5x; hidden
 * beyond. LOD0 keeps the manifest's 60 m.
 */
export function crowdLodBands(lods: readonly { maxM: number }[]): { maxM: number }[] {
  return lods.map((l, i) =>
    i === lods.length - 1 ? { maxM: PEOPLE_VISIBLE_M } : { maxM: l.maxM },
  );
}

export function createCrowdRenderer(
  kit: CrowdKit,
  looks: readonly number[],
  opts: { tier?: Tier } = {},
): CrowdRenderer {
  const n = looks.length;
  const cap = Math.max(1, n);
  const group = new THREE.Group();
  group.name = "crowd";
  group.userData.decorative = true;

  // Per-instance texel: (row0, row1, blend, look row).
  const w = Math.max(1, Math.ceil(Math.sqrt(cap)));
  const h = Math.max(1, Math.ceil(cap / w));
  const inst = new THREE.DataTexture(
    new Float32Array(w * h * 4),
    w,
    h,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  inst.minFilter = THREE.NearestFilter;
  inst.magFilter = THREE.NearestFilter;
  inst.generateMipmaps = false;
  inst.needsUpdate = true;
  const instData = inst.image.data as Float32Array;
  let dirty = false;

  const material = clayMaterial("person", { tinted: true, tier: opts.tier });
  material.name = "tl_crowd";
  material.transparent = true;
  material.customProgramCacheKey = () => "tl_crowd";
  const m = kit.manifest;
  const uniforms = {
    tlCrowdAnim: { value: kit.anim.texture },
    tlCrowdInst: { value: inst },
    tlCrowdPal: { value: kit.palette },
    tlCrowdPalSize: { value: new THREE.Vector2(m.roles.length, m.looks.length) },
  };
  material.onBeforeCompile = (shader) => patchCrowdShader(shader, uniforms);

  // Distinct geometries the slots need (looks sharing body, outfit and props share one).
  const used = [...new Set(looks.map((l) => kit.lookGeometry[l] as number))];
  const meshes = ([0, 1] as const).map((lod) => {
    const geos = used.map((g) => kit.geometries[lod][g] as THREE.BufferGeometry);
    const verts = geos.reduce((s, g) => s + g.getAttribute("position").count, 0);
    const idx = geos.reduce((s, g) => s + (g.index?.count ?? 0), 0);
    const bm = new THREE.BatchedMesh(cap, Math.max(1, verts), Math.max(1, idx), material);
    bm.name = `crowd__LOD${lod}`;
    bm.perObjectFrustumCulled = false; // the motion layer culls by frustum itself (skinned bounds move)
    bm.sortObjects = false;
    bm.frustumCulled = false;
    bm.castShadow = false;
    bm.receiveShadow = true;
    bm.raycast = () => {};
    bm.userData.decorative = true;
    bm.userData.crowd = true;
    bm.userData.lod = lod;
    // For the acceptance crowd report: look id and true standing height per slot.
    bm.userData.lookIds = looks.map((l) => m.looks[l]?.id ?? "");
    bm.userData.heights = looks.map((l) => {
      const look = m.looks[l];
      return look ? m.bodies[look.body].height : 0;
    });
    const ids = new Map<number, number>();
    used.forEach((g, k) => {
      ids.set(g, bm.addGeometry(geos[k] as THREE.BufferGeometry));
    });
    for (let i = 0; i < n; i++) {
      const id = bm.addInstance(ids.get(kit.lookGeometry[looks[i] as number] as number) as number);
      if (id !== i) throw new Error("crowd: instance ids must follow slots");
      bm.setVisibleAt(id, false);
    }
    bm.visible = false;
    group.add(bm);
    return bm;
  }) as [THREE.BatchedMesh, THREE.BatchedMesh];
  for (let i = 0; i < n; i++) instData[i * 4 + 3] = looks[i] as number;

  const shown = new Int8Array(n).fill(-1);
  const count: [number, number] = [0, 0];
  const show = (i: number, lod: -1 | 0 | 1) => {
    const was = shown[i] as -1 | 0 | 1;
    if (was === lod) return;
    if (was >= 0) {
      meshes[was as 0 | 1].setVisibleAt(i, false);
      count[was as 0 | 1]--;
    }
    if (lod >= 0) {
      meshes[lod as 0 | 1].setVisibleAt(i, true);
      count[lod as 0 | 1]++;
    }
    shown[i] = lod;
  };

  return {
    group,
    meshes,
    material,
    slots: n,
    set(i, lod, matrix, row0, row1, t) {
      show(i, lod);
      meshes[lod].setMatrixAt(i, matrix);
      const o = i * 4;
      if (instData[o] !== row0 || instData[o + 1] !== row1 || instData[o + 2] !== t) {
        instData[o] = row0;
        instData[o + 1] = row1;
        instData[o + 2] = t;
        dirty = true;
      }
    },
    hide(i) {
      show(i, -1);
    },
    commit() {
      meshes[0].visible = count[0] > 0;
      meshes[1].visible = count[1] > 0;
      if (dirty) inst.needsUpdate = true;
      dirty = false;
    },
    drawCalls: () => (count[0] > 0 ? 1 : 0) + (count[1] > 0 ? 1 : 0),
    visible: () => [count[0], count[1]],
    instances: () => instData,
    lookOf: (i) => looks[i] as number,
    setOpacity(o) {
      material.opacity = o;
    },
    dispose() {
      for (const bm of meshes) bm.dispose();
      inst.dispose();
      material.dispose();
      group.clear();
    },
  };
}
