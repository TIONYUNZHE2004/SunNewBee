import { readFileSync, statSync } from "node:fs";
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type Box,
  HERO_CLIPS,
  HERO_VARIANTS,
  type HeroClip,
  type HeroManifest,
  type HeroVariant,
  type HeroVariantSpec,
  parseHeroManifest,
  variantForProfile,
  walkRate,
} from "./heroManifest";

/** C-T3: the committed hero glbs meet H1-H4 (spec §5 C1), read with GLTFLoader + meshopt. */
const url = (p: string) => new URL(`../../../../../public/city/${p}`, import.meta.url);
const raw = JSON.parse(readFileSync(url("characters/manifest.json"), "utf8"));
const { manifest, problems } = parseHeroManifest(raw);
const m = manifest as HeroManifest;
const variant = (v: HeroVariant): HeroVariantSpec => {
  const spec = m.variants[v];
  if (!spec) throw new Error(`manifest lacks ${v}`);
  return spec;
};
const MAX_BYTES = 1_500_000;

async function load(v: HeroVariant) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const buf = readFileSync(url(`characters/hero_${v}.glb`));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return loader.parseAsync(ab, "");
}
type Gltf = Awaited<ReturnType<typeof load>>;

const tris = (mesh: THREE.Mesh) =>
  (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3;

function meshes(g: Gltf) {
  const out: THREE.Mesh[] = [];
  g.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

function bone(g: Gltf, name: string): THREE.Object3D {
  const b = g.scene.getObjectByName(name);
  if (!b) throw new Error(`no ${name}`);
  return b;
}

/** Pose the scene at time t of a clip (fresh mixer), world matrices updated. */
function poseAt(g: Gltf, clip: string, t: number) {
  const mixer = new THREE.AnimationMixer(g.scene);
  const c = THREE.AnimationClip.findByName(g.animations, clip);
  if (!c) throw new Error(`no clip ${clip}`);
  mixer.clipAction(c).play();
  mixer.setTime(t);
  g.scene.updateMatrixWorld(true);
  return mixer;
}

/** World positions of the skinned LOD0 body in the current pose. */
function bodyPoints(g: Gltf): { pts: THREE.Vector3[]; head: THREE.Box3; all: THREE.Box3 } {
  const body = meshes(g).find((x) => x.name === "hero__LOD0") as THREE.SkinnedMesh;
  const headIndex = body.skeleton.bones.findIndex((b) => b.name === "head");
  const idx = body.geometry.getAttribute("skinIndex");
  const wgt = body.geometry.getAttribute("skinWeight");
  const pts: THREE.Vector3[] = [];
  const all = new THREE.Box3();
  const head = new THREE.Box3();
  for (let i = 0; i < idx.count; i++) {
    const p = body.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(body.matrixWorld);
    pts.push(p);
    all.expandByPoint(p);
    let best = 0;
    let bestW = -1;
    for (let k = 0; k < 4; k++)
      if (wgt.getComponent(i, k) > bestW) {
        bestW = wgt.getComponent(i, k);
        best = idx.getComponent(i, k);
      }
    if (best === headIndex) head.expandByPoint(p);
  }
  return { pts, head, all };
}

/** How deep a point is inside a box (0 when outside). */
function depthIn(p: THREE.Vector3, b: Box): number {
  const d = Math.min(
    p.x - b.min[0],
    b.max[0] - p.x,
    p.y - b.min[1],
    b.max[1] - p.y,
    p.z - b.min[2],
    b.max[2] - p.z,
  );
  return Math.max(0, d);
}

const dist = (a: THREE.Object3D, b: THREE.Object3D) =>
  a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()));

describe("hero manifest", () => {
  it("parses and lists all four prop variants", () => {
    expect(problems).toEqual([]);
    expect(Object.keys(m.variants).sort()).toEqual([...HERO_VARIANTS].sort());
    expect(m.clips).toEqual([...HERO_CLIPS]);
    expect(variantForProfile(m, "older_adult_rest")).toBe("walker");
    expect(variantForProfile(m, "wheelchair")).toBe("wheelchair");
  });

  it("walk rate: displayed stride x cycle rate = speed", () => {
    const spec = variant("walker");
    const rate = walkRate(spec, 1.16, m.displayScale);
    const speed = (spec.stride * m.displayScale * rate) / spec.walkDuration;
    expect(speed).toBeCloseTo(1.16, 6);
    expect(rate).toBeGreaterThan(0.8);
    expect(rate).toBeLessThan(1.6);
  });
});

for (const v of HERO_VARIANTS) {
  describe(`hero_${v}.glb`, () => {
    let g: Gltf;
    beforeAll(async () => {
      g = await load(v);
    });
    const spec = () => variant(v);

    it("H1: six clips named exactly, sit_down/stand_up <= 1.5 s, durations match the manifest", () => {
      expect(g.animations.map((a) => a.name).sort()).toEqual([...HERO_CLIPS].sort());
      for (const a of g.animations) {
        expect(a.duration, a.name).toBeCloseTo(spec().clips[a.name as HeroClip].duration, 2);
      }
      for (const c of ["sit_down", "stand_up"])
        expect(THREE.AnimationClip.findByName(g.animations, c)?.duration).toBeLessThanOrEqual(1.5);
      for (const c of ["walk", "idle", "sit_idle"] as const)
        expect(spec().clips[c].loop).toBe(true);
    });

    it("H2: <= 60 bones, 1 skinned mesh + <= 2 prop meshes per LOD, <= 3 materials, no big textures", () => {
      const ms = meshes(g);
      const skinned = ms.filter(
        (x) => (x as THREE.SkinnedMesh).isSkinnedMesh,
      ) as THREE.SkinnedMesh[];
      for (const lod of [0, 1]) {
        const at = ms.filter((x) => x.name.endsWith(`__LOD${lod}`));
        expect(at.filter((x) => (x as THREE.SkinnedMesh).isSkinnedMesh).length).toBe(1);
        expect(
          at.filter((x) => !(x as THREE.SkinnedMesh).isSkinnedMesh).length,
        ).toBeLessThanOrEqual(2);
      }
      expect(skinned.length).toBe(2);
      for (const s of skinned) expect(s.skeleton.bones.length).toBeLessThanOrEqual(60);
      const mats = new Set(
        ms.flatMap((x) => (Array.isArray(x.material) ? x.material : [x.material])),
      );
      expect(mats.size).toBeLessThanOrEqual(3);
      for (const mat of mats) {
        const map = (mat as THREE.MeshStandardMaterial).map;
        if (map) {
          const img = map.image as { width: number; height: number };
          expect(Math.max(img.width, img.height)).toBeLessThanOrEqual(1024);
        }
      }
      expect(ms.every((x) => x.geometry.getAttribute("color"))).toBe(true);
    });

    it("H3: LOD0 6k-15k tris, LOD1 <= 2k tris (beyond 40 m), glb <= 1.5 MB", () => {
      const ms = meshes(g);
      const lodTris = (lod: number) =>
        ms.filter((x) => x.name.endsWith(`__LOD${lod}`)).reduce((s, x) => s + tris(x), 0);
      expect(lodTris(0)).toBeGreaterThanOrEqual(6000);
      expect(lodTris(0)).toBeLessThanOrEqual(15000);
      expect(lodTris(1)).toBeLessThanOrEqual(2000);
      expect(spec().lods.map((l) => l.tris)).toEqual([lodTris(0), lodTris(1)]);
      expect(spec().lods[0]?.maxM).toBe(40);
      const bytes = statSync(url(`characters/hero_${v}.glb`)).size;
      expect(bytes).toBe(spec().bytes);
      expect(bytes).toBeLessThanOrEqual(MAX_BYTES);
    });

    it("H4: head group 1/2.4-1/2.8 of the height; displayed height 2.2-2.5 m (bind pose)", async () => {
      // a fresh load is in the bind pose (skeleton.pose() is unusable here: meshopt
      // quantisation folds a scale into the inverse bind matrices)
      const fresh = await load(v);
      fresh.scene.updateMatrixWorld(true);
      const { head, all } = bodyPoints(fresh);
      const height = all.max.y - all.min.y;
      const ratio = height / (head.max.y - head.min.y);
      expect(ratio).toBeGreaterThanOrEqual(2.4);
      expect(ratio).toBeLessThanOrEqual(2.8);
      expect(head.max.y).toBeCloseTo(all.max.y, 3); // the tudung crown is the top
      expect(height * m.displayScale).toBeGreaterThanOrEqual(2.2);
      expect(height * m.displayScale).toBeLessThanOrEqual(2.5);
    });

    if (v !== "wheelchair") {
      it("H4 in the stooped idle and look poses: head ratio 2.4-2.8, displayed height 2.2-2.5 m", () => {
        for (const [clip, t] of [
          ["idle", 0],
          ["idle", 0.75],
          ["look", 1.3],
          ["look", 2.5],
        ] as const) {
          poseAt(g, clip, t);
          const { head, all } = bodyPoints(g);
          const height = all.max.y - Math.min(0, all.min.y);
          const ratio = height / (head.max.y - head.min.y);
          expect(ratio, `${clip}@${t}`).toBeGreaterThanOrEqual(2.4);
          expect(ratio, `${clip}@${t}`).toBeLessThanOrEqual(2.8);
          expect(height * m.displayScale, `${clip}@${t}`).toBeGreaterThanOrEqual(2.2);
          expect(height * m.displayScale, `${clip}@${t}`).toBeLessThanOrEqual(2.5);
        }
      });

      it("no body vertex enters the reference bench by more than 1 cm (sit_down, sit_idle, stand_up)", () => {
        let worst = 0;
        let where = "";
        for (const clip of ["sit_down", "sit_idle", "stand_up"] as const) {
          const d = spec().clips[clip].duration;
          const n = clip === "sit_idle" ? 4 : 15;
          for (let i = 0; i <= n; i++) {
            const t = Math.min(d - 1e-4, (d * i) / n);
            poseAt(g, clip, t);
            for (const p of bodyPoints(g).pts)
              for (const b of [m.bench.seat, m.bench.back]) {
                const e = depthIn(p, b);
                if (e > worst) {
                  worst = e;
                  where = `${clip}@${t.toFixed(2)}`;
                }
              }
          }
        }
        expect(worst, where).toBeLessThanOrEqual(0.01);
      });

      it("the kain hem stays on or above the ground through walk", () => {
        const d = spec().walkDuration;
        for (let i = 0; i < 12; i++) {
          poseAt(g, "walk", (d * i) / 12);
          expect(bodyPoints(g).all.min.y, `${i}/12`).toBeGreaterThanOrEqual(-0.005);
        }
      });
    }

    if (v === "walker" || v === "stroller") {
      it("R2: in sit_idle the prop is parked beside her (right of her hips, level with her knees, clear of the bench)", () => {
        poseAt(g, "sit_idle", 0);
        const prop = meshes(g).find((x) => x.name === "prop__LOD0") as THREE.Mesh;
        const box = new THREE.Box3().setFromObject(prop);
        expect(box.max.x).toBeLessThan(-0.236); // her right is -x; baju hip half-width 0.236 m
        const knee = bone(g, "shin_R").getWorldPosition(new THREE.Vector3());
        expect(knee.z).toBeGreaterThanOrEqual(box.min.z);
        expect(knee.z).toBeLessThanOrEqual(box.max.z);
        const seat = new THREE.Box3(
          new THREE.Vector3(...m.bench.seat.min),
          new THREE.Vector3(...m.bench.seat.max),
        );
        expect(box.intersectsBox(seat)).toBe(false);
        for (const c of m.bones.contacts)
          expect(Math.abs(bone(g, c).getWorldPosition(new THREE.Vector3()).y), c).toBeLessThan(
            0.002,
          );
      });
    }

    if (v === "walker" || v === "stroller") {
      it("palms stay on the grips (<= 3 cm displayed) through walk, idle and look", () => {
        for (const clip of ["walk", "idle", "look"] as const) {
          const d = spec().clips[clip].duration;
          for (let i = 0; i <= 12; i++) {
            poseAt(g, clip, (d * i) / 12);
            for (const s of [0, 1] as const) {
              const e = dist(bone(g, m.bones.palm[s]), bone(g, m.bones.grip[s])) * m.displayScale;
              expect(e, `${clip} ${i}/12 side ${s}`).toBeLessThanOrEqual(0.03);
            }
          }
        }
      });
    }

    if (v !== "wheelchair") {
      it("sit_idle: hips within 5 cm (displayed) above the bench seat, behind its front edge", () => {
        poseAt(g, "sit_idle", 0);
        const hips = bone(g, m.bones.hips).getWorldPosition(new THREE.Vector3());
        expect(Math.abs(hips.y - m.bench.seatY) * m.displayScale).toBeLessThanOrEqual(0.05);
        expect(hips.z).toBeLessThan(m.bench.frontEdgeZ);
        expect(hips.toArray().map((c) => Number(c.toFixed(3)))).toEqual(
          spec().sitHips.map((c) => Number(c.toFixed(3))),
        );
      });

      it("walk: the stance foot slides back at stride / duration (in place)", () => {
        const d = spec().walkDuration;
        const foot = bone(g, m.bones.foot[0]);
        poseAt(g, "walk", 0.05 * d);
        const a = foot.getWorldPosition(new THREE.Vector3());
        poseAt(g, "walk", 0.45 * d);
        const b = foot.getWorldPosition(new THREE.Vector3());
        const expected = (spec().stride * 0.4) / 1; // 40 % of a cycle at stride per cycle
        expect(a.z - b.z).toBeCloseTo(expected, 2);
        expect(Math.abs(a.y - b.y)).toBeLessThan(0.002);
      });
    }

    it("walk loops seamlessly (first and last frame match)", () => {
      const d = spec().walkDuration;
      const names = ["hips", "foot_L", "palm_R", "head"];
      poseAt(g, "walk", 0);
      const a = names.map((n) => bone(g, n).getWorldPosition(new THREE.Vector3()));
      poseAt(g, "walk", d - 1e-4);
      names.forEach((n, i) => {
        expect(
          bone(g, n)
            .getWorldPosition(new THREE.Vector3())
            .distanceTo(a[i] as THREE.Vector3),
          n,
        ).toBeLessThan(0.005);
      });
    });
  });
}
