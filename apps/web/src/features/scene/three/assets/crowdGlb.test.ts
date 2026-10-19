import { readFileSync, statSync } from "node:fs";
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CROWD_BODIES,
  type CrowdBody,
  type CrowdManifest,
  parseCrowdManifest,
  roleOfU,
} from "./crowdManifest";

/** C-T6: the committed crowd glbs (meshopt) meet the P4 per-person budgets and the kit contract. */
const url = (p: string) => new URL(`../../../../../public/city/${p}`, import.meta.url);
const m = parseCrowdManifest(JSON.parse(readFileSync(url("characters/crowd.json"), "utf8")))
  .manifest as CrowdManifest;
const MAX_BONES = 20;
const maxTris = (lod: number): number => {
  const spec = m.lods[lod];
  if (!spec) throw new Error(`manifest lacks LOD${lod}`);
  return spec.maxTris;
};
const clipSpec = (body: CrowdBody, name: string) => {
  const c = m.bodies[body].clips[name];
  if (!c) throw new Error(`${body} lacks clip ${name}`);
  return c;
};
const MAX_KIT_BYTES = 700_000;

async function load(body: CrowdBody) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const buf = readFileSync(url(m.bodies[body].file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return loader.parseAsync(ab, "");
}
type Gltf = Awaited<ReturnType<typeof load>>;

const tris = (mesh: THREE.Mesh) =>
  (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3;

function meshByName(g: Gltf): Map<string, THREE.Mesh> {
  const out = new Map<string, THREE.Mesh>();
  g.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.set(o.name, o as THREE.Mesh);
  });
  return out;
}

describe("crowd kit", () => {
  it("files exist, sizes match the manifest, the kit stays small", () => {
    let total = 0;
    for (const b of CROWD_BODIES) {
      const size = statSync(url(m.bodies[b].file)).size;
      expect(size, b).toBe(m.bodies[b].bytes);
      total += size;
    }
    expect(total).toBeLessThanOrEqual(MAX_KIT_BYTES);
  });

  it("P4: every look within the LOD triangle budgets (manifest)", () => {
    for (const l of m.looks) {
      expect(l.tris[0], l.id).toBeLessThanOrEqual(maxTris(0));
      expect(l.tris[1], l.id).toBeLessThanOrEqual(maxTris(1));
      expect(l.tris[1], l.id).toBeLessThan(l.tris[0]);
    }
  });
});

for (const body of CROWD_BODIES) {
  describe(`crowd_${body}.glb`, () => {
    let g: Gltf;
    let meshes: Map<string, THREE.Mesh>;
    beforeAll(async () => {
      g = await load(body);
      meshes = meshByName(g);
    });

    it("one shared skeleton of <= 20 bones, skinned outfits, no textures", () => {
      const skinned = [...meshes.values()].filter((x) => (x as THREE.SkinnedMesh).isSkinnedMesh);
      expect(skinned.length).toBe(2 * m.bodies[body].outfits.length);
      const bones = (skinned[0] as THREE.SkinnedMesh).skeleton.bones.map((b) => b.name);
      expect(bones.length).toBeLessThanOrEqual(MAX_BONES);
      expect([...bones].sort()).toEqual([...m.bones].sort());
      for (const n of m.bones) expect(g.scene.getObjectByName(n), n).toBeTruthy();
      for (const x of meshes.values()) {
        const mat = x.material as THREE.MeshStandardMaterial;
        expect(mat.map ?? null, x.name).toBeNull();
        expect(x.geometry.getAttribute("color"), x.name).toBeTruthy();
      }
    });

    it("clips: walk and idle per mode, durations as the manifest, loops close", () => {
      const spec = m.bodies[body].clips;
      expect(g.animations.map((a) => a.name).sort()).toEqual(Object.keys(spec).sort());
      for (const a of g.animations) {
        expect(a.duration, a.name).toBeCloseTo(clipSpec(body, a.name).duration, 3);
        for (const tr of a.tracks) {
          if (tr.name.startsWith("wheels.")) continue; // a quarter turn on a symmetric wheel
          const k = tr.getValueSize();
          const first = Array.from(tr.values.slice(0, k));
          const last = Array.from(tr.values.slice(tr.values.length - k));
          last.forEach((v, i) => {
            expect(v, `${a.name} ${tr.name}`).toBeCloseTo(first[i] ?? Number.NaN, 3);
          });
        }
      }
    });

    it("walk moves the feet; idle keeps them planted", () => {
      const foot = g.scene.getObjectByName("foot_L") as THREE.Object3D;
      const at = (clip: string, t: number) => {
        const mixer = new THREE.AnimationMixer(g.scene);
        const c = THREE.AnimationClip.findByName(g.animations, clip);
        if (!c) throw new Error(`no clip ${clip}`);
        mixer.clipAction(c).play();
        mixer.setTime(t);
        g.scene.updateMatrixWorld(true);
        return foot.getWorldPosition(new THREE.Vector3());
      };
      const d = clipSpec(body, "walk").duration;
      const s = clipSpec(body, "walk").stride;
      // left foot in stance: moves backwards (-z in glTF, she faces +z) at the stride rate
      const a = at("walk", 0.1 * d);
      const b = at("walk", 0.3 * d);
      expect(a.z - b.z).toBeCloseTo(0.2 * s, 2);
      expect(Math.abs(a.y - b.y)).toBeLessThan(0.002);
      const i0 = at("idle", 0);
      const i1 = at("idle", 1.5);
      expect(i0.distanceTo(i1)).toBeLessThan(0.003);
    });

    it("each look: meshes per LOD, budgets as shipped, roles decode from TEXCOORD_0", () => {
      for (const l of m.looks.filter((x) => x.body === body)) {
        for (const lod of [0, 1] as const) {
          const names = [l.mesh, ...l.propMeshes].map((n) => `${n}__LOD${lod}`);
          let n = 0;
          for (const name of names) {
            const mesh = meshes.get(name);
            expect(mesh, `${l.id} ${name}`).toBeTruthy();
            if (!mesh) continue;
            n += tris(mesh);
            const uv = mesh.geometry.getAttribute("uv");
            expect(uv, name).toBeTruthy();
            const roles = new Set<string>();
            for (let i = 0; i < uv.count; i++) roles.add(roleOfU(m, uv.getX(i)));
            for (const r of roles) expect(l.palette[r], `${name} ${r}`).toMatch(/^#[0-9a-f]{6}$/);
          }
          expect(n, `${l.id} LOD${lod}`).toBe(l.tris[lod]);
          expect(n, `${l.id} LOD${lod}`).toBeLessThanOrEqual(maxTris(lod));
        }
      }
    });
  });
}
