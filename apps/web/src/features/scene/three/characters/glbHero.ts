import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  type HeroVariant,
  type HeroVariantSpec,
  heroUrl,
  variantForProfile,
} from "../assets/heroManifest";
import { clayMaterial } from "../shared/clayTokens";
import { HERO_MANIFEST } from "./benchGeometry";
import {
  drawHeroLast,
  HERO_DISPLAY_SCALE,
  type Hero,
  type HeroClip,
  type HeroContact,
  type HeroFade,
} from "./hero";
import { createHeroRing } from "./heroRing";
import { createPlaceholderHero } from "./placeholderHero";

/**
 * The rigged journey hero (C-T4): `public/city/characters/hero_<variant>.glb` (C-T3) behind the
 * `Hero` interface, so the driver (`heroDriver.ts`) and the layer (`heroLayer.ts`) never change.
 *
 * - **Variant** by the journey profile: older_adult_rest -> walker, stroller -> stroller,
 *   wheelchair -> wheelchair, anything else -> none (`heroVariantFor`).
 * - **Clip time is set, never accumulated:** every `play` sets each action's `time` from the driver
 *   and updates the mixer by 0, so a scrub, a seek and playback show the same frame.
 * - **Crossfade:** the outgoing and incoming actions run together, weighted 1 - blend / blend.
 * - **LOD:** `hero__LOD0` / `prop__LOD0` within 40 m of the camera, `__LOD1` beyond (manifest).
 * - **Scale:** the model is drawn at the manifest's display scale (1.55x, R-J3), root fixed in
 *   every clip; the yellow ground ring is kept.
 * - **Planting** (`setGround`): after the mixer, each foot moves vertically onto the ground under
 *   its sole (and the walk clip's swing lift is softly capped at HERO_LIFT_CAP_M so a swing foot
 *   stays within 3 cm of the ground at 1.55x); the walker / stroller is tilted and lifted to the best-fit
 *   plane under its four contact bones, and a hand that held a grip is brought back onto it with
 *   a two-bone CCD pass (upper arm, forearm). On flat ground every correction is zero.
 * - Never call `skeleton.pose()` on these meshopt glbs (see `heroManifest.ts`).
 *
 * Decorative display of the plan's subject only: it encodes no fact. Every mesh ignores picks.
 */

/** Camera distance (m) beyond which the LOD1 body and prop are drawn (manifest `lods[0].maxM`). */
export const HERO_LOD_SWITCH_M = HERO_MANIFEST.variants.walker?.lods[0]?.maxM ?? 40;
/** Back to LOD0 only this much closer, so the switch never flickers at 40 m. */
const LOD_HYSTERESIS_M = 1;
/**
 * The walk clip's swing lift (the sole rises about 4.5 cm true at mid-swing, about 7 cm at 1.55x)
 * is softly capped at runtime: lift' = cap x (1 - exp(-lift / cap)). Small lifts stay as authored
 * (slope 1 at the ground), the peak stays under the cap, so a swing foot never floats more than
 * the H5 3 cm above the footway.
 */
export const HERO_LIFT_CAP_M = 0.025;
export const softLift = (rel: number): number =>
  rel <= 0 ? rel : HERO_LIFT_CAP_M * (1 - Math.exp(-rel / HERO_LIFT_CAP_M));
/** A sole lower than this above her root (displayed m) is near the ground: lift scaling applies. */
const LIFT_ZONE_M = 0.1;
/** Ground following fades out as a sole rises to this height (feet dangling on the bench). */
const GROUND_FOLLOW_M = 0.15;
/**
 * The authored bench window of the sit clips (C-T3 contract: from 1.0 s of `sit_down` she lifts her
 * hips and climbs back onto the seat, her legs leave the ground; `stand_up` is its exact reverse),
 * in seconds from the clip end for `stand_up`. Seated = `sit_idle`, or the dominant clip inside
 * this window: a clip-time rule, never a foot-height one, so a foot that floats outside it is
 * judged against the ground.
 */
export const HERO_BENCH_CLIMB_S = 1.0;

/** True when the pose (dominant clip at its clip time) is on or climbing onto the bench. */
export function seatedAt(spec: HeroVariantSpec, clip: HeroClip, clipTime: number): boolean {
  if (spec.seated) return false;
  if (clip === "sit_idle") return true;
  if (clip === "sit_down") return clipTime >= HERO_BENCH_CLIMB_S;
  if (clip === "stand_up") return clipTime <= spec.clips.stand_up.duration - HERO_BENCH_CLIMB_S;
  return false;
}
/** A palm this close to its grip before planting is holding it (displayed m). */
const HOLD_M = 0.02;
const CCD_ITERATIONS = 4;

/** The prop variant for a journey profile (falls back to `none` when the manifest lacks it). */
export function heroVariantFor(profile: string): HeroVariant {
  const v = variantForProfile(HERO_MANIFEST, profile);
  return HERO_MANIFEST.variants[v] ? v : "none";
}

/**
 * The action time for `time` in `clip`'s own seconds: loops wrap (`look` too: it starts and ends in
 * the idle pose); `sit_down` / `stand_up` hold their last frame past the end.
 */
export function clipTimeFor(spec: HeroVariantSpec, clip: HeroClip, time: number): number {
  const d = spec.clips[clip].duration;
  const t = Number.isFinite(time) ? time : 0;
  if (spec.clips[clip].loop || clip === "look") return ((t % d) + d) % d;
  return Math.max(0, Math.min(d - 1e-4, t));
}

/** LOD for a camera distance, with a 1 m hysteresis below the switch. */
export function lodFor(distanceM: number, current: 0 | 1): 0 | 1 {
  if (current === 0) return distanceM > HERO_LOD_SWITCH_M ? 1 : 0;
  return distanceM < HERO_LOD_SWITCH_M - LOD_HYSTERESIS_M ? 0 : 1;
}

/** The GLB model with the extra reads the tests and the acceptance lab use. */
export interface GlbHeroModel extends Hero {
  readonly variant: HeroVariant;
  readonly spec: HeroVariantSpec;
  setGround(sample: ((x: number, z: number) => number | null) | null): void;
  bone(name: string): THREE.Object3D;
  /** The skinned body of a LOD (0 near, 1 far). */
  body(lod: 0 | 1): THREE.SkinnedMesh;
  /** Separate prop meshes: none since H11 (the prop is folded into the skinned body). */
  propMeshes(): THREE.Mesh[];
  /** World positions of the skinned LOD0 body in the current pose. */
  bodyPoints(): THREE.Vector3[];
  /** Palm-to-grip distances [left, right] in displayed metres. */
  gripErrors(): [number, number];
  updateLod(camera: THREE.Camera): void;
  lod(): 0 | 1;
}

const noRaycast = () => {};
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
// Scratch for the per-frame planting and grip IK (no allocation per frame, final review).
const _m3 = new THREE.Matrix4();
const _pqInv = new THREE.Quaternion();
const _goal = new THREE.Vector3();
const _toGoal = new THREE.Vector3();

function need(scene: THREE.Object3D, name: string): THREE.Object3D {
  const o = scene.getObjectByName(name);
  if (!o) throw new Error(`hero glb has no node ${name}`);
  return o;
}

/**
 * A marker under each foot bone at the shoe's sole, found from the bind pose (a fresh load):
 * the lowest LOD0 vertices skinned mostly to that foot.
 */
function soleMarker(body: THREE.SkinnedMesh, foot: THREE.Object3D): THREE.Object3D {
  const bi = body.skeleton.bones.indexOf(foot as THREE.Bone);
  const idx = body.geometry.getAttribute("skinIndex");
  const wgt = body.geometry.getAttribute("skinWeight");
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < idx.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (idx.getComponent(i, k) === bi) w += wgt.getComponent(i, k);
    if (w > 0.5)
      pts.push(body.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(body.matrixWorld));
  }
  const fw = foot.getWorldPosition(new THREE.Vector3());
  let sole = new THREE.Vector3(fw.x, 0, fw.z);
  if (pts.length) {
    const minY = Math.min(...pts.map((p) => p.y));
    const low = pts.filter((p) => p.y < minY + 0.01);
    sole = low.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(low.length);
    sole.y = minY;
  }
  const marker = new THREE.Object3D();
  marker.name = `${foot.name}_sole`;
  foot.add(marker);
  marker.position.copy(foot.worldToLocal(sole));
  return marker;
}

/** A plain Float32 copy of an attribute, dequantised (meshopt packs positions, normals, colours). */
function floatAttr(
  a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  size = a.itemSize,
): THREE.BufferAttribute {
  const out = new Float32Array(a.count * size);
  const get = [
    (i: number) => a.getX(i),
    (i: number) => a.getY(i),
    (i: number) => a.getZ(i),
    (i: number) => a.getW(i),
  ];
  // getX..getW denormalise normalised integer attributes
  for (let i = 0; i < a.count; i++)
    for (let k = 0; k < size; k++)
      out[i * size + k] = k < a.itemSize ? (get[k] as (i: number) => number)(i) : 1;
  return new THREE.BufferAttribute(out, size);
}

/**
 * H11: the walker / stroller / wheelchair mesh is folded into the skinned body of the same LOD as
 * vertices skinned 100 % to the `prop` bone, so the hero is one draw per pass instead of two
 * (ANGLE / D3D11 draws are costly at 1440x900 High with shadow and post passes). The prop moves
 * exactly as before (its bone drives it), and planting the prop bone still tilts it.
 */
function foldPropIntoBody(
  body: THREE.SkinnedMesh,
  prop: THREE.Mesh,
  propBone: THREE.Object3D,
): void {
  const bi = body.skeleton.bones.indexOf(propBone as THREE.Bone);
  if (bi < 0) throw new Error("prop bone not in the body skeleton");
  const bg = body.geometry;
  const pg = prop.geometry;
  // body-local bind position = bindMatrix^-1 x boneInverse_prop^-1 x prop.matrix x v
  const m = new THREE.Matrix4()
    .copy(body.bindMatrix)
    .invert()
    .multiply(new THREE.Matrix4().copy(body.skeleton.boneInverses[bi] as THREE.Matrix4).invert())
    .multiply(prop.matrix);
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const n = pg.getAttribute("position").count;
  const a = new THREE.BufferGeometry();
  const b = new THREE.BufferGeometry();
  for (const name of Object.keys(bg.attributes)) {
    const src = bg.getAttribute(name);
    const size = src.itemSize;
    a.setAttribute(name, floatAttr(src));
    let attr: THREE.BufferAttribute;
    if (name === "skinIndex" || name === "skinWeight") {
      const arr = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) arr[i * 4] = name === "skinIndex" ? bi : 1;
      attr = new THREE.BufferAttribute(arr, 4);
    } else if (pg.getAttribute(name)) attr = floatAttr(pg.getAttribute(name), size);
    else attr = new THREE.BufferAttribute(new Float32Array(n * size), size);
    if (name === "position") attr.applyMatrix4(m);
    if (name === "normal") {
      attr.applyNormalMatrix(nm);
      const v = new THREE.Vector3();
      for (let i = 0; i < attr.count; i++) {
        v.fromBufferAttribute(attr, i).normalize();
        attr.setXYZ(i, v.x, v.y, v.z);
      }
    }
    b.setAttribute(name, attr);
  }
  const idx = (g: THREE.BufferGeometry) =>
    g.index
      ? new THREE.BufferAttribute(Uint32Array.from(g.index.array as ArrayLike<number>), 1)
      : new THREE.BufferAttribute(
          Uint32Array.from({ length: g.getAttribute("position").count }, (_, i) => i),
          1,
        );
  a.setIndex(idx(bg));
  b.setIndex(idx(pg));
  const merged = mergeGeometries([a, b], false);
  if (!merged) throw new Error("hero prop merge failed");
  a.dispose();
  b.dispose();
  bg.dispose();
  pg.dispose();
  body.geometry = merged;
  prop.removeFromParent();
}

/** Builds the model from a parsed glb (fresh, so in its bind pose). Throws on a malformed glb. */
export function buildHeroModel(
  gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] },
  variant: HeroVariant,
): GlbHeroModel {
  const spec = HERO_MANIFEST.variants[variant];
  if (!spec) throw new Error(`manifest lacks hero variant ${variant}`);
  const bones = HERO_MANIFEST.bones;
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const body0 = need(scene, "hero__LOD0") as THREE.SkinnedMesh;
  const body1 = need(scene, "hero__LOD1") as THREE.SkinnedMesh;
  if (!body0.isSkinnedMesh || !body1.isSkinnedMesh) throw new Error("hero body is not skinned");
  const hasProp = variant !== "none";
  const props: THREE.Mesh[] = hasProp
    ? [need(scene, "prop__LOD0") as THREE.Mesh, need(scene, "prop__LOD1") as THREE.Mesh]
    : [];
  const prop = need(scene, bones.prop);
  const palms = bones.palm.map((n) => need(scene, n)) as [THREE.Object3D, THREE.Object3D];
  const grips = bones.grip.map((n) => need(scene, n)) as [THREE.Object3D, THREE.Object3D];
  const feet = bones.foot.map((n) => need(scene, n)) as [THREE.Object3D, THREE.Object3D];
  const propContacts = bones.contacts.map((n) => need(scene, n));
  // per-model scratch of the planting (one entry per prop contact)
  const contactPts = propContacts.map(() => new THREE.Vector3());
  const contactGap = propContacts.map(() => 0);
  const holdingNow = [false, false];
  const arms = (["L", "R"] as const).map((s) => [
    need(scene, `forearm_${s}`),
    need(scene, `upper_arm_${s}`),
  ]) as [THREE.Object3D[], THREE.Object3D[]];
  const actions = new Map<HeroClip, THREE.AnimationAction>();
  const mixer = new THREE.AnimationMixer(scene);
  for (const clip of HERO_MANIFEST.clips) {
    const c = THREE.AnimationClip.findByName(gltf.animations, clip);
    if (!c) throw new Error(`hero glb has no clip ${clip}`);
    const a = mixer.clipAction(c);
    a.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY); // the runtime wraps / holds itself
    actions.set(clip, a);
  }
  // Sole markers from the bind pose, before anything moves.
  const soles = feet.map((f) => soleMarker(body0, f)) as [THREE.Object3D, THREE.Object3D];
  // H11: every rigid prop mesh of a LOD (the walker / stroller / chair frame, the wheelchair's
  // rear wheels on the `wheels` bone) is folded into that LOD's skinned body, skinned to its bone.
  const rigid: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && /__LOD[01]$/.test(m.name))
      rigid.push(m);
  });
  const doubleSided = [body0, body1, ...rigid].some(
    (m) => (m.material as THREE.Material).side === THREE.DoubleSide,
  );
  for (const m of rigid) {
    (m.material as THREE.Material).dispose();
    foldPropIntoBody(m.name.endsWith("__LOD0") ? body0 : body1, m, m.parent as THREE.Object3D);
  }
  props.length = 0;

  // Clay materials (B-T1 token table): vertex colours carry the colour, as the glb authored it.
  const owned: THREE.Material[] = [];
  const geos = new Set<THREE.BufferGeometry>();
  const replaced = new Map<THREE.Material, THREE.Material>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    geos.add(m.geometry);
    const old = m.material as THREE.Material;
    let mat = replaced.get(old);
    if (!mat) {
      // one material for the body and its folded prop (one draw); vertex colours carry both
      // the glb is double-sided (open tudung back, hem and lap shells): keep it
      mat = clayMaterial("hero", {
        vertexColors: true,
        side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      });
      mat.name = old.name;
      // shadows from the front faces only: the open shells still cast, at half the shadow fill
      mat.shadowSide = THREE.FrontSide;
      owned.push(mat);
      replaced.set(old, mat);
      old.dispose();
    }
    m.material = mat;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false; // the sit clips carry the hips 0.28 m back from the bind bounds
    m.raycast = noRaycast;
  });

  const root = new THREE.Group();
  root.name = "journey-hero";
  root.userData.journeyHero = true;
  root.userData.heroModel = `glb:${variant}`;
  const ring = createHeroRing();
  root.add(ring.group);
  const rig = new THREE.Group();
  rig.scale.setScalar(HERO_DISPLAY_SCALE);
  rig.add(scene);
  root.add(rig);

  let lod: 0 | 1 = 0;
  const showLod = (l: 0 | 1) => {
    lod = l;
    body0.visible = l === 0;
    body1.visible = l === 1;
    if (props.length) {
      (props[0] as THREE.Mesh).visible = l === 0;
      (props[1] as THREE.Mesh).visible = l === 1;
    }
  };
  showLod(0);
  const updateLod = (camera: THREE.Camera) => {
    camera.getWorldPosition(_a);
    root.getWorldPosition(_b);
    const l = lodFor(_a.distanceTo(_b), lod);
    if (l !== lod) showLod(l);
  };
  // The ring is drawn every frame she is in view: it switches the LOD for the next frame.
  ring.ring.onBeforeRender = (_r, _s, camera) => updateLod(camera);

  let ground: ((x: number, z: number) => number | null) | null = null;
  const airborne = [false, false];
  // Planting edits bones after the mixer; not every bone has every track, so each edited bone is
  // put back to its mixer value before the next pose (no drift from frame to frame).
  const saved = new Map<THREE.Object3D, [THREE.Vector3, THREE.Quaternion, THREE.Vector3]>();
  const save = (o: THREE.Object3D) => {
    if (!saved.has(o)) saved.set(o, [o.position.clone(), o.quaternion.clone(), o.scale.clone()]);
  };
  const restore = () => {
    for (const [o, [p, q, sc]] of saved) {
      o.position.copy(p);
      o.quaternion.copy(q);
      o.scale.copy(sc);
    }
    saved.clear();
  };
  // The walker prop's transform, re-applied before each pose, so the walker a rest's sit clips park
  // beside the bench never keeps that place in the next clip that does not key it.
  // A pose is then a function of its clip and time only: a seek back past a rest drew the walker
  // where the rest had left it (gate round 2, AC-D17 with the beats visited in reverse).
  // The reference is the idle pose at time 0 (what every clip was authored against: the walker
  // in her hands), not the glb's bind pose.
  const rest: [THREE.Object3D, THREE.Vector3, THREE.Quaternion, THREE.Vector3][] = [];
  {
    const idle = actions.get("idle") as THREE.AnimationAction;
    idle.play();
    idle.time = 0;
    idle.setEffectiveWeight(1);
    mixer.update(0);
    // the prop bone only (the walker): the mixer restores the bones its clips key, but the prop's
    // "original" state is whatever it held when a clip first bound it (planting may have moved it)
    rest.push([prop, prop.position.clone(), prop.quaternion.clone(), prop.scale.clone()]);
    idle.stop();
  }
  let weights = new Map<HeroClip, number>();
  let dominant: { clip: HeroClip; time: number } = { clip: "idle", time: 0 };

  const pose = (clip: HeroClip, time: number, fade?: HeroFade) => {
    const want = new Map<HeroClip, { time: number; weight: number }>();
    const blend = fade && fade.prevClip !== clip ? Math.max(0, Math.min(1, fade.blend)) : 1;
    want.set(clip, { time: clipTimeFor(spec, clip, time), weight: blend });
    if (fade && blend < 1)
      want.set(fade.prevClip, {
        time: clipTimeFor(spec, fade.prevClip, fade.prevTime),
        weight: 1 - blend,
      });
    for (const [c, a] of actions) if (!want.has(c) && a.isScheduled()) a.stop();
    for (const [c, s] of want) {
      const a = actions.get(c) as THREE.AnimationAction;
      if (!a.isScheduled()) a.play();
      a.enabled = true;
      a.paused = false;
      a.time = s.time;
      a.setEffectiveWeight(s.weight);
    }
    weights = new Map([...want].map(([c, s]) => [c, s.weight]));
    let best = -1;
    for (const [c, s] of want)
      if (s.weight > best) {
        best = s.weight;
        dominant = { clip: c, time: s.time };
      }
    restore();
    for (const [o, p, q, sc] of rest) {
      o.position.copy(p);
      o.quaternion.copy(q);
      o.scale.copy(sc);
    }
    mixer.update(0);
    root.updateWorldMatrix(true, true);
  };

  /** Rotates `bone` (in world space) by `q`, keeping its parent. */
  const rotateWorld = (bone: THREE.Object3D, q: THREE.Quaternion) => {
    save(bone);
    (bone.parent as THREE.Object3D).getWorldQuaternion(_pq);
    const local = _pqInv.copy(_pq).invert().multiply(q).multiply(_pq);
    bone.quaternion.premultiply(local);
    bone.updateMatrixWorld(true);
  };

  const plant = () => {
    root.getWorldPosition(_c);
    const rootY = _c.y;
    const walkW = weights.get("walk") ?? 0;
    // Seated (feet off the ground by design) from the authored clip window, never foot height.
    const seated = seatedAt(spec, dominant.clip, dominant.time);
    const groundAt = (x: number, z: number) => (ground ? (ground(x, z) ?? rootY) : rootY);
    // feet: lift scaling and ground following, a small vertical move of the foot bone
    for (let i = 0; i < 2; i++) {
      airborne[i] = false;
      if (spec.seated) continue;
      const foot = feet[i] as THREE.Object3D;
      const sole = (soles[i] as THREE.Object3D).getWorldPosition(_a);
      const rel = sole.y - rootY;
      const newRel = rel > 0 && rel < LIFT_ZONE_M ? rel + walkW * (softLift(rel) - rel) : rel;
      const gy = groundAt(sole.x, sole.z);
      const follow = Math.max(0, Math.min(1, 1 - Math.max(0, rel) / GROUND_FOLLOW_M));
      const dy = newRel - rel + (gy - rootY) * follow;
      if (Math.abs(dy) > 1e-6) {
        save(foot);
        foot.getWorldPosition(_b);
        _b.y += dy;
        foot.position.copy((foot.parent as THREE.Object3D).worldToLocal(_b));
        foot.updateMatrixWorld(true);
      }
      airborne[i] = seated;
    }
    if (!hasProp) return;
    // prop: best-fit plane under its four contacts (the wheelchair carries her with it)
    const pts = contactPts;
    const d = contactGap;
    let worst = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = (propContacts[i] as THREE.Object3D).getWorldPosition(pts[i] as THREE.Vector3);
      d[i] = groundAt(p.x, p.z) - p.y;
      worst = Math.max(worst, Math.abs(d[i] as number));
    }
    if (worst < 1e-4) return;
    const holding = holdingNow;
    for (const s of [0, 1])
      holding[s] =
        (palms[s] as THREE.Object3D)
          .getWorldPosition(_a)
          .distanceTo((grips[s] as THREE.Object3D).getWorldPosition(_b)) < HOLD_M;
    const n = pts.length;
    const cx = pts.reduce((s, p) => s + p.x, 0) / n;
    const cy = pts.reduce((s, p) => s + p.y, 0) / n;
    const cz = pts.reduce((s, p) => s + p.z, 0) / n;
    const a0 = d.reduce((s, v) => s + v, 0) / n;
    let sxx = 0;
    let sxz = 0;
    let szz = 0;
    let sxd = 0;
    let szd = 0;
    pts.forEach((p, i) => {
      const dx = p.x - cx;
      const dz = p.z - cz;
      const di = d[i] as number;
      sxx += dx * dx;
      sxz += dx * dz;
      szz += dz * dz;
      sxd += dx * di;
      szd += dz * di;
    });
    const det = sxx * szz - sxz * sxz;
    const b = Math.abs(det) > 1e-9 ? (sxd * szz - szd * sxz) / det : 0;
    const c = Math.abs(det) > 1e-9 ? (szd * sxx - sxd * sxz) / det : 0;
    const target = spec.seated ? scene : prop;
    _q.setFromUnitVectors(UP, _a.set(-b, 1, -c).normalize());
    // M = T(P + a) R T(-P), applied in world space
    _m.makeTranslation(cx, cy + a0, cz)
      .multiply(_m2.makeRotationFromQuaternion(_q))
      .multiply(_m3.makeTranslation(-cx, -cy, -cz));
    const world = _m.multiply(target.matrixWorld);
    save(target);
    const local = _m2
      .copy((target.parent as THREE.Object3D).matrixWorld)
      .invert()
      .multiply(world);
    local.decompose(target.position, target.quaternion, target.scale);
    target.updateMatrixWorld(true);
    // hands that held a grip stay on it: two-bone CCD (forearm, upper arm)
    for (const s of [0, 1]) {
      if (!holding[s]) continue;
      const palm = palms[s] as THREE.Object3D;
      const goal = (grips[s] as THREE.Object3D).getWorldPosition(_goal);
      for (let k = 0; k < CCD_ITERATIONS; k++)
        for (const bone of arms[s] as THREE.Object3D[]) {
          bone.getWorldPosition(_b);
          const toPalm = palm.getWorldPosition(_a).sub(_b);
          const toGoal = _toGoal.copy(goal).sub(_b);
          if (toPalm.lengthSq() < 1e-12 || toGoal.lengthSq() < 1e-12) continue;
          _q.setFromUnitVectors(toPalm.normalize(), toGoal.normalize());
          rotateWorld(bone, _q);
        }
    }
  };

  const contactName = ["fl", "fr", "bl", "br"];
  const prefix = variant === "walker" ? "walker" : "prop";
  const disposed = { v: false };
  return {
    variant,
    spec,
    object3d: root,
    setPose(pos, yaw) {
      root.position.set(pos.x, pos.y, pos.z);
      root.rotation.set(0, yaw, 0);
    },
    setGround(sample) {
      ground = sample;
    },
    play(clip, time, _rate, fade) {
      pose(clip, time, fade);
      plant();
    },
    contacts(): HeroContact[] {
      root.updateWorldMatrix(true, true);
      const out: HeroContact[] = [];
      const v = new THREE.Vector3();
      if (!spec.seated)
        soles.forEach((s, i) => {
          s.getWorldPosition(v);
          const c: HeroContact = { name: i === 0 ? "foot_l" : "foot_r", x: v.x, y: v.y, z: v.z };
          if (airborne[i]) c.airborne = true;
          out.push(c);
        });
      if (hasProp)
        propContacts.forEach((o, i) => {
          o.getWorldPosition(v);
          out.push({ name: `${prefix}_${contactName[i]}`, x: v.x, y: v.y, z: v.z });
        });
      return out;
    },
    bone: (name) => need(scene, name),
    body: (l) => (l === 0 ? body0 : body1),
    propMeshes: () => props,
    bodyPoints() {
      root.updateWorldMatrix(true, true);
      const pts: THREE.Vector3[] = [];
      const n = body0.geometry.getAttribute("position").count;
      for (let i = 0; i < n; i++)
        pts.push(body0.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(body0.matrixWorld));
      return pts;
    },
    gripErrors() {
      return [0, 1].map((s) =>
        (palms[s] as THREE.Object3D)
          .getWorldPosition(_a)
          .distanceTo((grips[s] as THREE.Object3D).getWorldPosition(_b)),
      ) as [number, number];
    },
    updateLod,
    lod: () => lod,
    dispose() {
      if (disposed.v) return;
      disposed.v = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      for (const g of geos) g.dispose();
      for (const m of owned) m.dispose();
      ring.dispose();
      root.clear();
    },
  };
}

let loader: GLTFLoader | null = null;
/** Parses hero glb bytes (meshopt) into a model. */
export async function parseHeroGlb(buf: ArrayBuffer, variant: HeroVariant): Promise<GlbHeroModel> {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  const gltf = await loader.parseAsync(buf, "");
  return buildHeroModel(gltf, variant);
}

/** Fetched glb bytes per URL, shared by every hero the session creates (a new plan reuses them). */
const bytesCache = new Map<string, Promise<ArrayBuffer>>();
function fetchGlb(url: string): Promise<ArrayBuffer> {
  let p = bytesCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    p.catch(() => bytesCache.delete(url));
    bytesCache.set(url, p);
  }
  return p;
}

export interface GlbHero extends Hero {
  /** True once the GLB replaced the placeholder; false when it failed (the placeholder stays). */
  readonly ready: Promise<boolean>;
  readonly variant: HeroVariant;
  kind(): "glb" | "placeholder";
  /** The GLB model once loaded (tests, the acceptance lab). */
  model(): GlbHeroModel | null;
  setGround(sample: ((x: number, z: number) => number | null) | null): void;
}

/**
 * The journey hero: shows the placeholder at once, loads `hero_<variant>.glb` and swaps it in,
 * re-applying the last pose, ground and clip, then calls `onReady` (ask for a frame). If the glb
 * fails to load (or no loader is available: unit tests without `loadGlb`), the placeholder stays.
 */
export function createGlbHero(
  opts: {
    profile?: string;
    variant?: HeroVariant;
    /** Loads the glb bytes; default: fetch (none in unit tests: the placeholder stays). */
    loadGlb?: (url: string) => Promise<ArrayBuffer>;
    fallback?: () => Hero;
    onReady?: () => void;
    /**
     * Compiles the loaded model's shader programs before it is swapped in (the engine's `prewarm`),
     * so the swap never links a program on the main thread (gate AC-D18). Default: none.
     */
    prepare?: (o: THREE.Object3D) => Promise<unknown>;
  } = {},
): GlbHero {
  const variant = opts.variant ?? heroVariantFor(opts.profile ?? "");
  const root = new THREE.Group();
  root.name = "journey-hero-slot";
  root.userData.journeyHero = true;
  let current: Hero = (opts.fallback ?? createPlaceholderHero)();
  drawHeroLast(current.object3d);
  root.add(current.object3d);
  let glb: GlbHeroModel | null = null;
  let disposed = false;
  let lastPose: [{ x: number; y: number; z: number }, number] | null = null;
  let lastPlay: [HeroClip, number, number, HeroFade | undefined] | null = null;
  let ground: ((x: number, z: number) => number | null) | null = null;

  const url = heroUrl(HERO_MANIFEST, variant);
  const spec = HERO_MANIFEST.variants[variant];
  const load =
    opts.loadGlb ?? (import.meta.env.MODE === "test" ? null : (u: string) => fetchGlb(u));
  const ready: Promise<boolean> =
    !url || !spec || !load
      ? Promise.resolve(false)
      : load(`${url}?v=${spec.bytes}`)
          .then((buf) => (disposed ? null : parseHeroGlb(buf, variant)))
          .then(async (m) => {
            if (m) {
              drawHeroLast(m.object3d);
              if (opts.prepare && !disposed) await opts.prepare(m.object3d).catch(() => {});
            }
            return m;
          })
          .then((m) => {
            if (!m) return false;
            if (disposed) {
              m.dispose();
              return false;
            }
            const old = current;
            root.remove(old.object3d);
            old.dispose();
            glb = m;
            current = m;
            root.add(m.object3d);
            m.setGround(ground);
            if (lastPose) m.setPose(...lastPose);
            if (lastPlay) m.play(...lastPlay);
            else m.play("idle", 0, 0);
            opts.onReady?.();
            return true;
          })
          .catch((e: unknown) => {
            if (!disposed) console.warn(`hero glb ${variant} not loaded; placeholder kept`, e);
            return false;
          });

  return {
    object3d: root,
    ready,
    variant,
    kind: () => (glb ? "glb" : "placeholder"),
    model: () => glb,
    setPose(pos, yaw) {
      lastPose = [{ ...pos }, yaw];
      current.setPose(pos, yaw);
    },
    setGround(sample) {
      ground = sample;
      current.setGround?.(sample);
    },
    play(clip, time, rate, fade) {
      lastPlay = [clip, time, rate, fade];
      current.play(clip, time, rate, fade);
    },
    contacts: () => current.contacts(),
    dispose() {
      if (disposed) return;
      disposed = true;
      current.dispose();
      root.clear();
    },
  };
}
