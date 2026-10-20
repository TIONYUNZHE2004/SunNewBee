import { readFileSync, statSync } from "node:fs";
import type * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";

/** Devsim AS1: the site worker (adult man, hard hat, hi-vis vest) ships as crowd_worker.glb with a
 * `worker` key in crowd.json; same 19-bone rig and the walk and idle clips. Decorative only. */
const url = (p: string) => new URL(`../../../../../public/city/${p}`, import.meta.url);
const manifest = JSON.parse(readFileSync(url("characters/crowd.json"), "utf8"));
const worker = manifest.worker;
const MAX_BYTES = 400_000;

describe("crowd_worker.glb", () => {
  it("has a manifest entry whose size matches the file and stays under 400 KB", () => {
    expect(worker.file).toBe("characters/crowd_worker.glb");
    expect(worker.body).toBe("adult_man");
    const size = statSync(url(worker.file)).size;
    expect(size).toBe(worker.bytes);
    expect(size).toBeLessThan(MAX_BYTES);
  });

  it("loads: same rig, LOD0/LOD1 skinned meshes, walk + idle clips, hat and vest colours", async () => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const buf = readFileSync(url(worker.file));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const g = await loader.parseAsync(ab, "");
    const skinned: THREE.SkinnedMesh[] = [];
    g.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
    });
    expect(skinned.map((s) => s.name).sort()).toEqual(["worker__LOD0", "worker__LOD1"]);
    const bones = skinned[0]?.skeleton.bones.map((b) => b.name) ?? [];
    expect([...bones].sort()).toEqual([...manifest.bones].sort());
    expect(g.animations.map((a) => a.name).sort()).toEqual(["idle", "walk"]);
    const [t0, t1] = worker.tris;
    expect(t0).toBeLessThanOrEqual(manifest.lods[0].maxTris);
    expect(t1).toBeLessThanOrEqual(manifest.lods[1].maxTris);
    const roles: string[] = manifest.roles;
    const us = new Set<number>();
    const uv = skinned.find((s) => s.name === "worker__LOD0")?.geometry.getAttribute("uv");
    for (let i = 0; i < (uv?.count ?? 0); i++)
      us.add(Math.round((uv?.getX(i) ?? 0) * roles.length - 0.5));
    const used = [...us].map((i) => roles[i]);
    for (const r of ["headwear", "outer", "top_trim"]) expect(used).toContain(r);
    expect(worker.palette.headwear.toLowerCase()).toBe("#ffd51a");
    expect(worker.palette.outer.toLowerCase()).toBe("#ff7a12");
  });
});
