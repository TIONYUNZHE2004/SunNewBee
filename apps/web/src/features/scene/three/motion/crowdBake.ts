import * as THREE from "three";
import type { CrowdBody, CrowdManifest } from "../assets/crowdManifest";

/**
 * Runtime bone-matrix bake of the crowd kit (C-T7; coordinator ruling: a bone-matrix animation
 * texture, not a per-vertex VAT). Decorative only: "Decorative details are illustrative."
 *
 * Per body glb, every clip is sampled through an AnimationMixer (channels are sparse, idles are keyed
 * at 10 fps) at its key rate, frames 0..n inclusive (frame n is the end pose, so the wheelchair's
 * quarter wheel turn wraps seamlessly). Each frame stores, per bone, the 3x4 affine
 * `A = boneWorld(t) x boneWorld(rest)^-1` as three RGBA half-float texels (rows of the matrix). The
 * merged per-look geometry is pre-transformed into the rest pose, so a vertex skins as
 * `sum_k w_k A_bk p_rest`: exactly three's `bindMatrixInverse x boneWorld x boneInverse x bindMatrix`
 * (each mesh's `matrixWorld x bindMatrixInverse x restWorld x boneInverse x bindMatrix` is one
 * matrix for all its bones; the fresh load is the bind pose, so `skeleton.pose()` is never called).
 * Props are rigid children of the `prop` / `wheels` bones: one-bone skinned at weight 1.
 *
 * Done at runtime from the shipped glbs (0 bytes on disk, never out of step with the clips); about
 * 821 rows x 57 texels x 8 B = 0.37 MB of GPU memory.
 */

/** Three RGBA texels per bone: the rows of its 3x4 affine matrix. */
export const ANIM_TEXELS_PER_BONE = 3;
/** P4: crowd animation textures within 4 MB in all. */
export const CROWD_ANIM_MAX_BYTES = 4 * 1024 * 1024;

export interface BakedClip {
  /** First row of this clip in the animation texture (frame 0). */
  row: number;
  /** Segments: rows row..row+frames hold frames 0..frames (the last is the clip's end pose). */
  frames: number;
  duration: number;
  /** True metres per cycle (0 for idles). */
  stride: number;
}

export interface BodyBake {
  body: CrowdBody;
  /** Rows of this body's clips: `rows` x (bones x 3) RGBA float32, clip rows relative to 0. */
  clips: Record<string, BakedClip>;
  rows: number;
  data: Float32Array;
  /** Merged look geometry by key (body/mesh/props), [LOD0, LOD1]. */
  geometries: Map<string, [THREE.BufferGeometry, THREE.BufferGeometry]>;
  ms: number;
}

export interface CrowdKit {
  manifest: CrowdManifest;
  anim: {
    texture: THREE.DataTexture;
    data: Uint16Array;
    width: number;
    rows: number;
    bytes: number;
  };
  /** Clip table per body, rows absolute in the animation texture. */
  clips: Record<CrowdBody, Record<string, BakedClip>>;
  /** u = role, v = look row (looks order), linear RGB. */
  palette: THREE.DataTexture;
  /** Distinct look geometries per LOD; `lookGeometry[look]` indexes both. */
  geometries: [THREE.BufferGeometry[], THREE.BufferGeometry[]];
  lookGeometry: number[];
  lookIndex: Map<string, number>;
  /** CPU bake time over all bodies (ms). */
  bakeMs: number;
  dispose(): void;
}

export const lookGeometryKey = (l: { body: string; mesh: string; propMeshes: string[] }) =>
  `${l.body}/${l.mesh}/${l.propMeshes.join("+")}`;

const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();

/** The bone of `o` (itself or nearest ancestor) in the manifest's bone list, or -1. */
function boneOf(o: THREE.Object3D, boneIndex: Map<string, number>): number {
  for (let p: THREE.Object3D | null = o.parent; p; p = p.parent) {
    const i = boneIndex.get(p.name);
    if (i !== undefined) return i;
  }
  return -1;
}

/**
 * One merged rest-pose geometry from the named meshes (scene already at the fresh-load pose,
 * matrixWorld updated). Attributes: position, normal (float32), crowdRole (role index), crowdBone /
 * crowdWeight (manifest bone order, 4 influences), index.
 */
function mergeLook(
  scene: THREE.Object3D,
  names: string[],
  boneIndex: Map<string, number>,
  roles: number,
): THREE.BufferGeometry {
  const parts: {
    pos: number[];
    nor: number[];
    role: number[];
    bone: number[];
    weight: number[];
    index: number[];
  } = { pos: [], nor: [], role: [], bone: [], weight: [], index: [] };
  for (const name of names) {
    const mesh = scene.getObjectByName(name) as THREE.Mesh | undefined;
    if (!mesh?.isMesh) throw new Error(`crowd mesh ${name} missing`);
    const g = mesh.geometry;
    const pos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    const uv = g.getAttribute("uv");
    const base = parts.pos.length / 3;
    let rest: THREE.Matrix4;
    let remap: number[] | null = null;
    let rigid = -1;
    const sm = mesh as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh) {
      // matrixWorld x bindMatrixInverse x restWorld_i x boneInverse_i x bindMatrix: the same for
      // every bone in the bind pose (checked against three's skinning in the tests).
      const b0 = sm.skeleton.bones[0] as THREE.Bone;
      rest = new THREE.Matrix4()
        .multiplyMatrices(sm.matrixWorld, sm.bindMatrixInverse)
        .multiply(b0.matrixWorld)
        .multiply(sm.skeleton.boneInverses[0] as THREE.Matrix4)
        .multiply(sm.bindMatrix);
      remap = sm.skeleton.bones.map((b) => {
        const i = boneIndex.get(b.name);
        if (i === undefined) throw new Error(`crowd bone ${b.name} not in the manifest`);
        return i;
      });
    } else {
      rest = mesh.matrixWorld.clone();
      rigid = boneOf(mesh, boneIndex);
      if (rigid < 0) throw new Error(`crowd prop ${name} is not under a bone`);
    }
    _n.getNormalMatrix(rest);
    const si = sm.isSkinnedMesh ? g.getAttribute("skinIndex") : null;
    const sw = sm.isSkinnedMesh ? g.getAttribute("skinWeight") : null;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(rest);
      parts.pos.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(nor, i).applyMatrix3(_n).normalize();
      parts.nor.push(_v.x, _v.y, _v.z);
      parts.role.push(Math.min(roles - 1, Math.max(0, Math.floor(uv.getX(i) * roles))));
      if (si && sw && remap) {
        let sum = 0;
        const w = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)];
        for (const x of w) sum += x;
        const idx = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)];
        for (let k = 0; k < 4; k++) {
          parts.bone.push(remap[idx[k] as number] ?? 0);
          parts.weight.push(sum > 0 ? (w[k] as number) / sum : k === 0 ? 1 : 0);
        }
      } else {
        parts.bone.push(rigid, 0, 0, 0);
        parts.weight.push(1, 0, 0, 0);
      }
    }
    const idx = g.index;
    if (idx) for (let i = 0; i < idx.count; i++) parts.index.push(base + idx.getX(i));
    else for (let i = 0; i < pos.count; i++) parts.index.push(base + i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(parts.pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(parts.nor, 3));
  geo.setAttribute("crowdRole", new THREE.Float32BufferAttribute(parts.role, 1));
  geo.setAttribute("crowdBone", new THREE.Float32BufferAttribute(parts.bone, 4));
  geo.setAttribute("crowdWeight", new THREE.Float32BufferAttribute(parts.weight, 4));
  geo.setIndex(parts.index);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** Bake one body's clips and merge its looks' geometry. Leaves the scene in the fresh-load pose. */
export function bakeBody(
  m: CrowdManifest,
  body: CrowdBody,
  gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] },
): BodyBake {
  const t0 = performance.now();
  const spec = m.bodies[body];
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const boneIndex = new Map(m.bones.map((b, i) => [b, i]));
  const bones = m.bones.map((n) => {
    const b = scene.getObjectByName(n);
    if (!b) throw new Error(`${body}: bone ${n} missing`);
    return b;
  });
  const restInv = bones.map((b) => b.matrixWorld.clone().invert());
  const rest = bones.map((b) => ({
    p: b.position.clone(),
    q: b.quaternion.clone(),
    s: b.scale.clone(),
  }));
  const restore = () => {
    bones.forEach((b, i) => {
      const r = rest[i] as (typeof rest)[number];
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
      b.scale.copy(r.s);
    });
  };

  // Geometry first, in the fresh-load (bind) pose.
  const geometries = new Map<string, [THREE.BufferGeometry, THREE.BufferGeometry]>();
  for (const look of m.looks) {
    if (look.body !== body) continue;
    const key = lookGeometryKey(look);
    if (geometries.has(key)) continue;
    const names = [look.mesh, ...look.propMeshes];
    const lod = (i: number) =>
      mergeLook(
        scene,
        names.map((n) => `${n}${m.lods[i]?.suffix ?? `__LOD${i}`}`),
        boneIndex,
        m.roles.length,
      );
    geometries.set(key, [lod(0), lod(1)]);
  }

  const width = m.bones.length * ANIM_TEXELS_PER_BONE;
  const clips: Record<string, BakedClip> = {};
  let rows = 0;
  for (const [name, c] of Object.entries(spec.clips)) {
    const frames = Math.round(c.duration * c.keyFps);
    clips[name] = { row: rows, frames, duration: c.duration, stride: c.stride };
    rows += frames + 1;
  }
  const data = new Float32Array(rows * width * 4);
  for (const [name, bc] of Object.entries(clips)) {
    const clip = THREE.AnimationClip.findByName(gltf.animations, name);
    if (!clip) throw new Error(`${body}: clip ${name} missing`);
    // A fresh mixer per clip, from the rest pose. Never reset bones by hand between frames: three's
    // PropertyMixer only writes a value that changed since its last apply, so a constant track
    // (the wheelchair's seated hips) would stay at the hand-reset value.
    restore();
    const mixer = new THREE.AnimationMixer(scene);
    const action = mixer.clipAction(clip);
    // LoopOnce + clamp: time = duration poses the end key (a repeat loop would wrap to 0).
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    for (let f = 0; f <= bc.frames; f++) {
      action.reset().play();
      action.time = (f / bc.frames) * bc.duration;
      mixer.update(0);
      scene.updateMatrixWorld(true);
      const row = bc.row + f;
      bones.forEach((b, bi) => {
        _m.multiplyMatrices(b.matrixWorld, restInv[bi] as THREE.Matrix4);
        const e = _m.elements;
        const o = (row * width + bi * ANIM_TEXELS_PER_BONE) * 4;
        // Rows of the 3x4 (column-major elements).
        for (let r = 0; r < 3; r++) {
          data[o + r * 4] = e[r] as number;
          data[o + r * 4 + 1] = e[r + 4] as number;
          data[o + r * 4 + 2] = e[r + 8] as number;
          data[o + r * 4 + 3] = e[r + 12] as number;
        }
      });
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(scene);
  }
  restore();
  scene.updateMatrixWorld(true);
  return { body, clips, rows, data, geometries, ms: performance.now() - t0 };
}

/** Stack the body bakes into one half-float texture, build the palette texture and look tables. */
export function assembleCrowdKit(m: CrowdManifest, bakes: BodyBake[]): CrowdKit {
  const width = m.bones.length * ANIM_TEXELS_PER_BONE;
  const rows = bakes.reduce((n, b) => n + b.rows, 0);
  const data = new Uint16Array(rows * width * 4);
  const clips = {} as Record<CrowdBody, Record<string, BakedClip>>;
  let at = 0;
  for (const b of bakes) {
    for (let i = 0; i < b.data.length; i++)
      data[at * width * 4 + i] = THREE.DataUtils.toHalfFloat(b.data[i] as number);
    clips[b.body] = Object.fromEntries(
      Object.entries(b.clips).map(([k, c]) => [k, { ...c, row: c.row + at }]),
    );
    at += b.rows;
  }
  const anim = new THREE.DataTexture(data, width, rows, THREE.RGBAFormat, THREE.HalfFloatType);
  anim.minFilter = THREE.NearestFilter;
  anim.magFilter = THREE.NearestFilter;
  anim.generateMipmaps = false;
  anim.needsUpdate = true;
  anim.name = "crowd-anim";

  const roles = m.roles.length;
  const pal = new Float32Array(roles * m.looks.length * 4);
  const c = new THREE.Color();
  m.looks.forEach((look, li) => {
    m.roles.forEach((role, ri) => {
      const hex = look.palette[role];
      if (!hex) throw new Error(`${look.id}: no palette colour for ${role}`);
      c.set(hex);
      pal.set([c.r, c.g, c.b, 1], (li * roles + ri) * 4);
    });
  });
  const palette = new THREE.DataTexture(
    pal,
    roles,
    m.looks.length,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  palette.minFilter = THREE.NearestFilter;
  palette.magFilter = THREE.NearestFilter;
  palette.generateMipmaps = false;
  palette.needsUpdate = true;
  palette.name = "crowd-palette";

  const byKey = new Map<string, number>();
  const geometries: [THREE.BufferGeometry[], THREE.BufferGeometry[]] = [[], []];
  const all = new Map<string, [THREE.BufferGeometry, THREE.BufferGeometry]>();
  for (const b of bakes) for (const [k, g] of b.geometries) all.set(k, g);
  const lookGeometry = m.looks.map((look) => {
    const key = lookGeometryKey(look);
    let i = byKey.get(key);
    if (i === undefined) {
      const g = all.get(key);
      if (!g) throw new Error(`${look.id}: body ${look.body} not baked`);
      i = geometries[0].length;
      geometries[0].push(g[0]);
      geometries[1].push(g[1]);
      byKey.set(key, i);
    }
    return i;
  });
  return {
    manifest: m,
    anim: { texture: anim, data, width, rows, bytes: data.byteLength },
    clips,
    palette,
    geometries,
    lookGeometry,
    lookIndex: new Map(m.looks.map((l, i) => [l.id, i])),
    bakeMs: bakes.reduce((n, b) => n + b.ms, 0),
    dispose() {
      anim.dispose();
      palette.dispose();
      for (const g of [...geometries[0], ...geometries[1]]) g.dispose();
    },
  };
}

/**
 * CPU mirror of the crowd vertex shader (tests and diagnostics): vertex `i` of `geo` skinned with
 * the rows `row0` / `row1` of the animation texture blended by `t`.
 */
export function skinPointCpu(
  kit: CrowdKit,
  geo: THREE.BufferGeometry,
  i: number,
  row0: number,
  row1: number,
  t: number,
): THREE.Vector3 {
  const { data, width } = kit.anim;
  const p = new THREE.Vector3().fromBufferAttribute(geo.getAttribute("position"), i);
  const bone = geo.getAttribute("crowdBone");
  const weight = geo.getAttribute("crowdWeight");
  const texel = (row: number, b: number, r: number, k: number) =>
    THREE.DataUtils.fromHalfFloat(
      data[(row * width + b * ANIM_TEXELS_PER_BONE + r) * 4 + k] as number,
    );
  const out = new THREE.Vector3();
  const acc = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const w = weight.getComponent(i, k);
    if (!(w > 0)) continue;
    const b = Math.round(bone.getComponent(i, k));
    for (let r = 0; r < 3; r++) {
      const row = [0, 1, 2, 3].map(
        (c) => texel(row0, b, r, c) * (1 - t) + texel(row1, b, r, c) * t,
      ) as [number, number, number, number];
      acc[r] = (acc[r] as number) + w * (row[0] * p.x + row[1] * p.y + row[2] * p.z + row[3]);
    }
  }
  return out.set(acc[0] as number, acc[1] as number, acc[2] as number);
}
