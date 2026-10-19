import { readFileSync } from "node:fs";
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CROWD_BODIES,
  type CrowdBody,
  type CrowdManifest,
  parseCrowdManifest,
} from "../assets/crowdManifest";
import {
  ANIM_TEXELS_PER_BONE,
  assembleCrowdKit,
  type BodyBake,
  bakeBody,
  CROWD_ANIM_MAX_BYTES,
  type CrowdKit,
  skinPointCpu,
} from "./crowdBake";
import { framePair } from "./crowdGait";

/** C-T7 (P4, P5): the runtime bone-matrix bake of the committed crowd glbs, checked against three's own skinning. */
const url = (p: string) => new URL(`../../../../../public/city/${p}`, import.meta.url);
const m = parseCrowdManifest(JSON.parse(readFileSync(url("characters/crowd.json"), "utf8")))
  .manifest as CrowdManifest;

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
async function load(body: CrowdBody) {
  const buf = readFileSync(url(m.bodies[body].file));
  return loader.parseAsync(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    "",
  );
}

/** World position of vertex `i` of `mesh` as three skins it (mixer pose at time t of `clip`). */
function threePose(gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }) {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  return (clip: string, t: number) => {
    mixer.stopAllAction();
    const c = THREE.AnimationClip.findByName(gltf.animations, clip);
    if (!c) throw new Error(clip);
    const a = mixer.clipAction(c);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.reset().play();
    a.time = t;
    mixer.update(0);
    gltf.scene.updateMatrixWorld(true);
  };
}

describe("crowd bake", () => {
  const bakes: BodyBake[] = [];
  const gltfs = new Map<CrowdBody, Awaited<ReturnType<typeof load>>>();
  let kit: CrowdKit;
  let bakeMs = 0;
  beforeAll(async () => {
    for (const b of CROWD_BODIES) {
      const g = await load(b);
      const t0 = performance.now();
      bakes.push(bakeBody(m, b, g));
      bakeMs += performance.now() - t0;
      // A fresh copy for the reference pose (the bake leaves its scene in the bind pose).
      gltfs.set(b, await load(b));
    }
    kit = assembleCrowdKit(m, bakes);
  }, 30_000);

  it("P4: the bone-matrix animation texture is within 4 MB; bake time recorded", () => {
    const rows = Object.values(m.bodies).reduce(
      (n, b) => n + Object.values(b.clips).reduce((k, c) => k + c.keys, 0),
      0,
    );
    expect(kit.anim.rows).toBe(rows);
    expect(kit.anim.width).toBe(m.bones.length * ANIM_TEXELS_PER_BONE);
    expect(kit.anim.bytes).toBe(rows * m.bones.length * ANIM_TEXELS_PER_BONE * 4 * 2); // RGBA half
    expect(kit.anim.bytes).toBeLessThanOrEqual(CROWD_ANIM_MAX_BYTES);
    expect(CROWD_ANIM_MAX_BYTES).toBe(4 * 1024 * 1024);
    // Node, no GPU: the CPU bake of all six bodies (the browser does it one body per idle slice).
    expect(bakeMs).toBeLessThan(2000);
  });

  it("P4: per-look geometry per LOD equals the manifest triangle counts (LOD0 <= 1.5k, LOD1 <= 400)", () => {
    for (const [i, look] of m.looks.entries()) {
      for (const lod of [0, 1] as const) {
        const g = kit.geometries[lod][kit.lookGeometry[i] as number] as THREE.BufferGeometry;
        const tris = (g.index as THREE.BufferAttribute).count / 3;
        expect(tris, `${look.id} LOD${lod}`).toBe(look.tris[lod]);
        expect(tris).toBeLessThanOrEqual(m.lods[lod]?.maxTris ?? 0);
      }
    }
    // Looks that share body, outfit and props share one geometry.
    expect(kit.geometries[0].length).toBe(
      new Set(m.looks.map((l) => `${l.body}/${l.mesh}/${l.propMeshes.join("+")}`)).size,
    );
  });

  it("palette texture: one row per look in looks order, one texel per role", () => {
    expect(kit.palette.image.width).toBe(m.roles.length);
    expect(kit.palette.image.height).toBe(m.looks.length);
    const data = kit.palette.image.data as Float32Array;
    const look = m.looks[5]!;
    const r = m.roles.indexOf("top");
    const c = new THREE.Color(look.palette.top);
    const o = (5 * m.roles.length + r) * 4;
    expect(data[o]).toBeCloseTo(c.r, 5);
    expect(data[o + 1]).toBeCloseTo(c.g, 5);
    expect(data[o + 2]).toBeCloseTo(c.b, 5);
  });

  it("bake correctness: baked bone matrices skin vertices to three's AnimationMixer pose (frames and mid-frames)", () => {
    let worst = 0;
    let worstMid = 0;
    for (const look of [m.looks[0]!, ...m.looks.filter((l) => l.prop)]) {
      const g = gltfs.get(look.body);
      if (!g) throw new Error(look.body);
      const pose = threePose(g);
      const geo = kit.geometries[0][kit.lookGeometry[m.looks.indexOf(look)] as number]!;
      const meshes = [look.mesh, ...look.propMeshes].map(
        (n) => g.scene.getObjectByName(`${n}__LOD0`) as THREE.Mesh,
      );
      for (const clipName of [look.clips.walk, look.clips.idle]) {
        const clip = kit.clips[look.body][clipName];
        if (!clip) throw new Error(clipName);
        // Exact frames, then halfway between frames (idles are keyed at 10 fps: linear in the clip too).
        for (const [phase, mid] of [
          [0, false],
          [0.37, false],
          [(clip.frames - 1) / clip.frames, false],
          [(3.5 / clip.frames) % 1, true],
        ] as const) {
          const fp = framePair(phase, clip.frames);
          const f = mid ? fp.f0 + fp.t : Math.round(phase * clip.frames);
          pose(clipName, (f / clip.frames) * clip.duration);
          // Walk the merged geometry's vertices in mesh order.
          let v = 0;
          for (const mesh of meshes) {
            const n = mesh.geometry.getAttribute("position").count;
            for (let i = 0; i < n; i += 7) {
              const want = new THREE.Vector3();
              if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
                const sm = mesh as THREE.SkinnedMesh;
                want.fromBufferAttribute(sm.geometry.getAttribute("position"), i);
                sm.applyBoneTransform(i, want);
                want.applyMatrix4(sm.matrixWorld);
              } else {
                want.fromBufferAttribute(mesh.geometry.getAttribute("position"), i);
                want.applyMatrix4(mesh.matrixWorld);
              }
              const got = skinPointCpu(
                kit,
                geo,
                v + i,
                clip.row + (mid ? fp.f0 : Math.round(phase * clip.frames) % clip.frames),
                clip.row + (mid ? fp.f1 : Math.round(phase * clip.frames) % clip.frames),
                mid ? fp.t : 0,
              );
              const e = got.distanceTo(want);
              if (mid) worstMid = Math.max(worstMid, e);
              else worst = Math.max(worst, e);
            }
            v += n;
          }
        }
      }
    }
    // Half-float storage: about a millimetre at exact frames; linear matrix blend between frames
    // (30 fps walks, 10 fps idles) stays within a few millimetres of the slerped pose.
    expect(worst).toBeLessThan(0.003);
    expect(worstMid).toBeLessThan(0.01);
  });

  it("the last baked frame is the clip's end pose (wheels a quarter turn on), so the loop wraps seamlessly", () => {
    const g = gltfs.get("adult_man")!;
    const pose = threePose(g);
    const clip = kit.clips.adult_man.walk_wheelchair!;
    const geo =
      kit.geometries[0][
        kit.lookGeometry[
          m.looks.findIndex((l) => l.prop === "wheelchair" && l.body === "adult_man")
        ] as number
      ]!;
    pose("walk_wheelchair", clip.duration);
    const wheels = g.scene.getObjectByName("prop_wheelchair_wheels__LOD0") as THREE.Mesh;
    const look = m.looks.find((l) => l.prop === "wheelchair" && l.body === "adult_man")!;
    let v = 0;
    for (const n of [look.mesh, ...look.propMeshes]) {
      const mesh = g.scene.getObjectByName(`${n}__LOD0`) as THREE.Mesh;
      if (mesh === wheels) break;
      v += mesh.geometry.getAttribute("position").count;
    }
    const want = new THREE.Vector3()
      .fromBufferAttribute(wheels.geometry.getAttribute("position"), 3)
      .applyMatrix4(wheels.matrixWorld);
    const got = skinPointCpu(kit, geo, v + 3, clip.row + clip.frames, clip.row + clip.frames, 0);
    expect(got.distanceTo(want)).toBeLessThan(0.003);
  });
});
