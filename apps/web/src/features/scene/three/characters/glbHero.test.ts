import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { HERO_VARIANTS, type HeroVariant, walkRate } from "../assets/heroManifest";
import { HERO_BENCH, HERO_MANIFEST } from "./benchGeometry";
import {
  clipTimeFor,
  createGlbHero,
  type GlbHeroModel,
  HERO_LIFT_CAP_M,
  HERO_LOD_SWITCH_M,
  heroVariantFor,
  lodFor,
  parseHeroGlb,
} from "./glbHero";
import { HERO_DISPLAY_SCALE, type Hero, type HeroContact } from "./hero";

/**
 * C-T4: the rigged GLB hero behind the `Hero` interface, read from the committed meshopt GLBs with
 * GLTFLoader in node (no mock). Rate maths, variant choice, scrub-safe clip time, crossfade,
 * planting, LOD, fallback.
 */
const glbBytes = (v: HeroVariant): ArrayBuffer => {
  const buf = readFileSync(
    new URL(`../../../../../public/city/characters/hero_${v}.glb`, import.meta.url),
  );
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};
const models = new Map<HeroVariant, Promise<GlbHeroModel>>();
const model = (v: HeroVariant): Promise<GlbHeroModel> => {
  let p = models.get(v);
  if (!p) {
    p = parseHeroGlb(glbBytes(v), v);
    models.set(v, p);
  }
  return p;
};
const S = HERO_DISPLAY_SCALE;
const spec = (v: HeroVariant) =>
  HERO_MANIFEST.variants[v] as NonNullable<(typeof HERO_MANIFEST.variants)[HeroVariant]>;
const byName = (cs: HeroContact[], n: string) => cs.find((c) => c.name === n) as HeroContact;
const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

describe("variant and rate maths", () => {
  it("picks the prop variant from the journey profile", () => {
    expect(heroVariantFor("older_adult_rest")).toBe("walker");
    expect(heroVariantFor("stroller")).toBe("stroller");
    expect(heroVariantFor("wheelchair")).toBe("wheelchair");
    for (const p of ["default", "drive", "walking", "", "anything"])
      expect(heroVariantFor(p), p).toBe("none");
  });

  it("walk rate = speed / (stride x 1.55) x walkDuration (1.20 at 1.16 m/s for the walker)", () => {
    const w = spec("walker");
    expect(walkRate(w, 1.16, S)).toBeCloseTo((1.16 / (0.56 * 1.55)) * 0.9, 9);
    expect(walkRate(w, 1.16, S)).toBeCloseTo(1.2028, 3);
    const c = spec("wheelchair");
    expect(walkRate(c, 1.16, S)).toBeCloseTo((1.16 / (0.9425 * 1.55)) * 1.2, 9);
    // linear in speed
    expect(walkRate(w, 0.58, S) * 2).toBeCloseTo(walkRate(w, 1.16, S), 12);
  });

  it("clip time: loops wrap, look wraps, sit_down / stand_up hold their last frame", () => {
    const w = spec("walker");
    expect(clipTimeFor(w, "walk", 0.95)).toBeCloseTo(0.05, 9);
    expect(clipTimeFor(w, "walk", -0.1)).toBeCloseTo(0.8, 9);
    expect(clipTimeFor(w, "look", 3.7)).toBeCloseTo(0.1, 6);
    expect(clipTimeFor(w, "sit_down", 9)).toBeLessThan(1.5);
    expect(clipTimeFor(w, "sit_down", 9)).toBeGreaterThan(1.499);
    expect(clipTimeFor(w, "stand_up", -1)).toBe(0);
    expect(clipTimeFor(w, "idle", Number.NaN)).toBe(0);
  });

  it("LOD0 within 40 m, LOD1 beyond (1 m hysteresis)", () => {
    expect(HERO_LOD_SWITCH_M).toBe(40);
    expect(lodFor(10, 0)).toBe(0);
    expect(lodFor(39.9, 0)).toBe(0);
    expect(lodFor(40.5, 0)).toBe(1);
    expect(lodFor(39.5, 1)).toBe(1);
    expect(lodFor(38.9, 1)).toBe(0);
  });
});

describe("GLB hero model (walker)", () => {
  it("implements Hero: 1.55x, yellow ring, six contacts, no picks, no decorative flag", async () => {
    const h = await model("walker");
    h.setPose({ x: 0, y: 0, z: 0 }, 0);
    h.play("idle", 0, 0);
    const box = new THREE.Box3();
    h.object3d.updateMatrixWorld(true);
    h.body(0).computeBoundingBox();
    let ring: THREE.Object3D | null = null;
    let decorative = false;
    h.object3d.traverse((o) => {
      if (o.userData.heroPart === "ring") ring = o;
      if (o.userData.decorative) decorative = true;
    });
    expect(ring).not.toBeNull();
    expect(decorative).toBe(false);
    expect(h.object3d.userData.journeyHero).toBe(true);
    for (const p of h.bodyPoints()) box.expandByPoint(p);
    const height = box.max.y - Math.min(0, box.min.y);
    expect(height).toBeGreaterThan(2.2);
    expect(height).toBeLessThan(2.5);
    expect(h.contacts().map((c) => c.name)).toEqual([
      "foot_l",
      "foot_r",
      "walker_fl",
      "walker_fr",
      "walker_bl",
      "walker_br",
    ]);
    const hits: THREE.Intersection[] = [];
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 0, -1));
    h.object3d.traverse((o) => {
      o.raycast(ray, hits);
    });
    expect(hits).toEqual([]);
  });

  it("deterministic clip time: the same (clip, time, fade) gives the same pose in any call order", async () => {
    const h = await model("walker");
    h.setPose({ x: 3, y: 0.08, z: -2 }, 0.7);
    const snap = () =>
      [h.bone("foot_L"), h.bone("palm_R"), h.bone("hips"), h.bone("head")].flatMap((b) =>
        wp(b).toArray(),
      );
    h.play("walk", 0.31, 1.2);
    const a = snap();
    h.play("look", 2.2, 0);
    h.play("sit_idle", 1, 0);
    h.play("walk", 5.7, 1.2);
    h.play("walk", 0.31, 1.2);
    snap().forEach((v, i) => {
      expect(v).toBeCloseTo(a[i] as number, 9);
    });
    // one wrap later is the same frame
    h.play("walk", 0.31 + 0.9 * 7, 1.2);
    snap().forEach((v, i) => {
      expect(v).toBeCloseTo(a[i] as number, 4);
    });
    // a fade is pure too
    const fade = { prevClip: "walk" as const, prevTime: 0.4, blend: 0.3 };
    h.play("look", 0.05, 0, fade);
    const f = snap();
    h.play("idle", 2, 0);
    h.play("look", 0.05, 0, fade);
    snap().forEach((v, i) => {
      expect(v).toBeCloseTo(f[i] as number, 9);
    });
  });

  it("crossfade: blend 0 shows the outgoing clip, 1 the incoming, 0.5 in between", async () => {
    const h = await model("walker");
    h.setPose({ x: 0, y: 0, z: 0 }, 0);
    const hips = () => wp(h.bone("hips"));
    h.play("sit_idle", 0, 0);
    const seated = hips();
    h.play("walk", 0.2, 1.2);
    const walking = hips();
    h.play("sit_idle", 0, 0, { prevClip: "walk", prevTime: 0.2, blend: 0 });
    expect(hips().distanceTo(walking)).toBeLessThan(1e-4);
    h.play("sit_idle", 0, 0, { prevClip: "walk", prevTime: 0.2, blend: 1 });
    expect(hips().distanceTo(seated)).toBeLessThan(1e-4);
    h.play("sit_idle", 0, 0, { prevClip: "walk", prevTime: 0.2, blend: 0.5 });
    const mid = hips();
    expect(mid.z).toBeLessThan(walking.z - 0.05);
    expect(mid.z).toBeGreaterThan(seated.z + 0.05);
  });

  it("H5 (unit): true pace 1.16 m/s on flat ground: foot slide <= 5 cm per step, contacts within 3 cm", async () => {
    const h = await model("walker");
    const speed = 1.16;
    const rate = walkRate(spec("walker"), speed, S);
    const G = 0.08;
    h.setGround(() => G);
    const steps: { foot: string; start: THREE.Vector3; maxSlide: number }[] = [];
    const open: Record<string, { start: THREE.Vector3; maxSlide: number } | null> = {
      foot_l: null,
      foot_r: null,
    };
    let worstY = 0;
    let maxLift = 0;
    for (let i = 0; i <= 600; i++) {
      const t = i / 60;
      h.setPose({ x: 0, y: G, z: speed * t }, 0);
      h.play("walk", t * rate, rate);
      for (const c of h.contacts()) {
        const rel = c.y - G;
        if (c.name.startsWith("walker")) worstY = Math.max(worstY, Math.abs(rel));
        else {
          worstY = Math.max(worstY, -rel); // never sinks
          maxLift = Math.max(maxLift, rel);
          const p = new THREE.Vector3(c.x, 0, c.z);
          const st = open[c.name];
          if (rel < 0.005) {
            if (!st) open[c.name] = { start: p, maxSlide: 0 };
            else st.maxSlide = Math.max(st.maxSlide, p.distanceTo(st.start));
          } else if (st) {
            steps.push({ foot: c.name, ...st });
            open[c.name] = null;
          }
        }
      }
    }
    expect(steps.length).toBeGreaterThan(14); // about 12.9 cycles over 10 s, two feet
    const worstSlide = Math.max(...steps.map((s) => s.maxSlide));
    expect(worstSlide).toBeLessThanOrEqual(0.05);
    expect(worstY).toBeLessThanOrEqual(0.03);
    expect(maxLift).toBeLessThanOrEqual(0.03);
    expect(maxLift).toBeGreaterThan(0.015); // she still lifts her feet (soft cap HERO_LIFT_CAP_M)
    expect(maxLift).toBeLessThanOrEqual(HERO_LIFT_CAP_M);
  });

  it("H6 (unit): palms on the grips (<= 3 cm displayed) through walk, idle and look; walker beside her seated", async () => {
    const h = await model("walker");
    h.setPose({ x: 0, y: 0.08, z: 0 }, 1.1);
    h.setGround(() => 0.08);
    let worst = 0;
    for (const clip of ["walk", "idle", "look"] as const) {
      const d = spec("walker").clips[clip].duration;
      for (let i = 0; i <= 24; i++) {
        h.play(clip, (d * i) / 24, clip === "walk" ? 1.2 : 0);
        worst = Math.max(worst, ...h.gripErrors());
      }
    }
    expect(worst).toBeLessThanOrEqual(0.03);
    h.play("sit_idle", 1, 0);
    const local = h
      .contacts()
      .filter((c) => c.name.startsWith("walker"))
      .map((c) => h.object3d.worldToLocal(new THREE.Vector3(c.x, c.y, c.z)));
    for (const p of local) expect(p.x).toBeLessThan(-0.236 * S); // her right (-x), clear of her hips
  });

  it("planting: a kerb under the walker and one foot keeps every contact within 3 cm and the palms on the grips", async () => {
    const h = await model("walker");
    const G = 0.08;
    // footway 0.08 for local x < 0.1, lawn 0.03 beyond (her left foot and left walker legs)
    const ground = (x: number) => (x > 0.1 ? 0.03 : G);
    h.setGround((x) => ground(x));
    let worst = 0;
    let grip = 0;
    for (const clip of ["idle", "walk", "look"] as const)
      for (let i = 0; i < 12; i++) {
        h.setPose({ x: 0, y: G, z: 0 }, 0);
        h.play(clip, (spec("walker").clips[clip].duration * i) / 12, clip === "walk" ? 1.2 : 0);
        for (const c of h.contacts()) {
          const rel = c.y - ground(c.x);
          worst = Math.max(
            worst,
            c.name.startsWith("foot") ? Math.max(-rel, rel - 0.03) : Math.abs(rel),
          );
        }
        grip = Math.max(grip, ...h.gripErrors());
      }
    expect(worst).toBeLessThanOrEqual(0.03);
    expect(grip).toBeLessThanOrEqual(0.03);
    // the planted foot really moved down onto the lawn
    h.setPose({ x: 0, y: G, z: 0 }, 0);
    h.play("idle", 0, 0);
    expect(byName(h.contacts(), "foot_l").y).toBeCloseTo(0.03, 2);
    expect(byName(h.contacts(), "foot_r").y).toBeCloseTo(G, 2);
  });

  it("H7 (unit): in sit_idle the hips sit on the bench seat within 5 cm; seated feet are flagged airborne", async () => {
    const h = await model("walker");
    h.setGround(null);
    h.setPose({ x: 0, y: 0, z: 0 }, 0);
    h.play("sit_idle", 2, 0);
    const hips = wp(h.bone("hips"));
    expect(Math.abs(hips.y - HERO_BENCH.seatHeightM * S)).toBeLessThanOrEqual(0.05);
    expect(hips.z).toBeLessThan(HERO_BENCH.frontEdgeZ * S);
    const feet = h.contacts().filter((c) => c.name.startsWith("foot"));
    expect(feet.every((c) => c.airborne)).toBe(true);
    h.play("idle", 0, 0);
    expect(h.contacts().some((c) => c.airborne)).toBe(false);
    // seated is the authored bench window (sit_down from 1.0 s, stand_up until 0.5 s), not foot
    // height: while she steps back in sit_down her feet are judged against the ground
    h.play("sit_down", 0.5, 0);
    expect(h.contacts().some((c) => c.airborne)).toBe(false);
    h.play("stand_up", 1.4, 0);
    expect(h.contacts().some((c) => c.airborne)).toBe(false);
  });

  it("sit clips: every foot outside the authored bench window stays within 3 cm of the ground", async () => {
    const h = await model("walker");
    h.setGround(() => 0.08);
    let worst = 0;
    let where = "";
    let seatedFrames = 0;
    for (const clip of ["sit_down", "sit_idle", "stand_up"] as const) {
      const d = spec("walker").clips[clip].duration;
      for (let i = 0; i <= 90; i++) {
        h.setPose({ x: 0, y: 0.08, z: 0 }, 0.3);
        h.play(clip, (d * i) / 90, 0);
        for (const c of h.contacts()) {
          if (c.airborne) {
            seatedFrames++;
            continue;
          }
          const e = Math.abs(c.y - 0.08);
          if (e > worst) {
            worst = e;
            where = `${clip}@${((d * i) / 90).toFixed(2)} ${c.name}`;
          }
        }
      }
    }
    expect(worst, where).toBeLessThanOrEqual(0.03);
    expect(seatedFrames).toBeGreaterThan(0);
  });

  it("LOD: LOD0 shown near, LOD1 beyond 40 m (body and prop)", async () => {
    const h = await model("walker");
    h.setPose({ x: 0, y: 0, z: 0 }, 0);
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 5, 20);
    h.updateLod(cam);
    expect(h.lod()).toBe(0);
    expect(h.body(0).visible && !h.body(1).visible).toBe(true);
    cam.position.set(0, 5, 60);
    h.updateLod(cam);
    expect(h.lod()).toBe(1);
    expect(!h.body(0).visible && h.body(1).visible).toBe(true);
    expect(h.propMeshes()).toEqual([]); // the prop is folded into each LOD's body
    cam.position.set(0, 5, 20);
    h.updateLod(cam);
  });

  it("H11 fold: the walker is part of the skinned body (one draw) and sits exactly where the glb's prop mesh is", async () => {
    const h = await model("walker");
    h.setGround(null);
    h.setPose({ x: 0, y: 0, z: 0 }, 0);
    let meshes = 0;
    h.object3d.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.visible && o.userData.heroPart !== "ring") meshes++;
    });
    expect(meshes).toBe(1);
    // the glb's double-sided shells (open tudung back, hem, lap) stay double-sided
    expect((h.body(0).material as THREE.Material).side).toBe(THREE.DoubleSide);
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const { MeshoptDecoder } = await import("three/addons/libs/meshopt_decoder.module.js");
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const raw = await loader.parseAsync(glbBytes("walker"), "");
    for (const [clip, t] of [
      ["walk", 0.3],
      ["sit_idle", 1],
    ] as const) {
      const mixer = new THREE.AnimationMixer(raw.scene);
      mixer
        .clipAction(THREE.AnimationClip.findByName(raw.animations, clip) as THREE.AnimationClip)
        .play();
      mixer.setTime(t);
      raw.scene.updateMatrixWorld(true);
      const want = new THREE.Box3().setFromObject(
        raw.scene.getObjectByName("prop__LOD0") as THREE.Object3D,
        true,
      );
      h.play(clip, t, 0);
      const body = h.body(0);
      const bi = body.skeleton.bones.findIndex((b) => b.name === "prop");
      const si = body.geometry.getAttribute("skinIndex");
      const got = new THREE.Box3();
      body.updateMatrixWorld(true);
      for (let i = 0; i < si.count; i++)
        if (si.getX(i) === bi)
          got.expandByPoint(
            body
              .getVertexPosition(i, new THREE.Vector3())
              .applyMatrix4(body.matrixWorld)
              .divideScalar(S),
          );
      expect(got.min.distanceTo(want.min), clip).toBeLessThan(0.003);
      expect(got.max.distanceTo(want.max), clip).toBeLessThan(0.003);
      mixer.stopAllAction();
    }
  });
});

describe("other variants load", () => {
  for (const v of HERO_VARIANTS)
    it(`${v}: loads with every clip; contacts per variant`, async () => {
      const h = await model(v);
      h.setPose({ x: 0, y: 0, z: 0 }, 0);
      h.play("walk", 0.3, 1);
      const names = h.contacts().map((c) => c.name);
      if (v === "none") expect(names).toEqual(["foot_l", "foot_r"]);
      else if (v === "wheelchair")
        expect(names).toEqual(["prop_fl", "prop_fr", "prop_bl", "prop_br"]);
      else expect(names.length).toBe(6);
      // one skinned mesh per LOD (props and wheelchair wheels folded in), the other LOD hidden
      const visible: string[] = [];
      h.object3d.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.visible && o.userData.heroPart !== "ring")
          visible.push(o.name);
      });
      expect(visible).toEqual(["hero__LOD0"]);
    });
});

describe("createGlbHero: async load and fallback", () => {
  const asHero = (h: Hero) => h;

  it("falls back to the placeholder when the GLB fails to load", async () => {
    const h = createGlbHero({
      profile: "older_adult_rest",
      loadGlb: () => Promise.reject(new Error("404")),
    });
    expect(await h.ready).toBe(false);
    expect(h.kind()).toBe("placeholder");
    h.setPose({ x: 1, y: 0.08, z: 2 }, 0);
    h.play("walk", 0.2, 1);
    expect(asHero(h).contacts().length).toBe(6);
    h.dispose();
  });

  it("without a loader in tests it stays on the placeholder", async () => {
    const h = createGlbHero({ profile: "older_adult_rest" });
    expect(await h.ready).toBe(false);
    expect(h.kind()).toBe("placeholder");
    h.dispose();
  });

  it("swaps in the GLB when it loads and re-applies the last pose, ground and clip", async () => {
    let swapped = 0;
    const h = createGlbHero({
      profile: "older_adult_rest",
      loadGlb: async () => glbBytes("walker"),
      onReady: () => {
        swapped++;
      },
    });
    expect(h.kind()).toBe("placeholder");
    h.setPose({ x: 5, y: 0.08, z: -3 }, 0.4);
    h.setGround?.(() => 0.08);
    h.play("idle", 0.5, 0);
    expect(await h.ready).toBe(true);
    expect(swapped).toBe(1);
    expect(h.kind()).toBe("glb");
    let placeholderLeft = false;
    h.object3d.traverse((o) => {
      if (o.userData.heroPart === "upper") placeholderLeft = true;
    });
    expect(placeholderLeft).toBe(false);
    const feet = h.contacts().filter((c) => c.name.startsWith("foot"));
    for (const f of feet) {
      expect(Math.hypot(f.x - 5, f.z + 3)).toBeLessThan(0.5);
      expect(Math.abs(f.y - 0.08)).toBeLessThan(0.01);
    }
    h.dispose();
  });

  it("a hero disposed before its GLB arrives never shows it", async () => {
    let resolve: (b: ArrayBuffer) => void = () => {};
    const h = createGlbHero({
      profile: "older_adult_rest",
      loadGlb: () =>
        new Promise<ArrayBuffer>((r) => {
          resolve = r;
        }),
    });
    h.dispose();
    resolve(glbBytes("walker"));
    expect(await h.ready).toBe(false);
    expect(h.object3d.children.length).toBe(0);
  });
});
