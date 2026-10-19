import * as THREE from "three";
import { type LodBucket, lodFor } from "../assets/cityInstances";
import { hash01, paletteFor } from "../assets/fit";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import {
  createRoleMaterial,
  type MotionUniforms,
  type RoleKind,
  type RoleUniforms,
} from "../assets/roleMaterial";
import {
  AGENT_LIFT_M,
  type Agent,
  DENSITY_PEAK,
  densityFor,
  displayScale,
  easedDistance,
  type MoodMix,
  PEOPLE_VISIBLE_M,
  type Pose2,
  peopleScale,
  poseAt,
  smoothYaw,
} from "./agents";
import type { BakedClip, CrowdKit } from "./crowdBake";
import { advanceGait, framePair, type GaitState, gaitStartPhase } from "./crowdGait";
import { type CrowdRenderer, createCrowdRenderer, crowdLodBands } from "./crowdRenderer";
import {
  assignLooks,
  type HeroXZ,
  type KeepOutMemory,
  type KeepOutResult,
  keepOut,
  type LookMemory,
  lookSpeed,
} from "./crowdRules";

/**
 * Smoothed yaw per agent id, with the motion time (ms) it was last updated. Keyed by id (not by
 * slot) so a layer rebuilt from a different union of tiles keeps every surviving agent turning
 * smoothly: pass the same map to each rebuild. Each rebuild prunes the ids that are not in its agent
 * set, so streaming never grows the map beyond the latest set.
 */
export interface YawEntry {
  yaw: number;
  /** Motion time (ms) of the last yaw update; NaN for an entry made by the keep-out before any pose. */
  at: number;
  gait?: GaitState;
  /** C-T8 keep-out side memory (P8). */
  keep?: KeepOutMemory;
}
export type YawMemory = Map<string, YawEntry>;

export interface MotionLayer {
  group: THREE.Group;
  /** `frustum`: when given, only agents inside it (plus a 50 m margin) get matrices this tick. */
  tick(nowMs: number, camera: THREE.Vector3, frustum?: THREE.Frustum): void;
  setOpacity(o: number): void;
  dispose(): void;
}

/** Agents just outside the view still get matrices, so nothing pops in at the edge while panning. */
const FRUSTUM_MARGIN_M = 50;

/** On the road ribbons (0.08 m) rather than in them (defined in agents.ts; the hero shares it). */
export { AGENT_LIFT_M };

const NOOP = () => {};
/**
 * Vehicles stay visible (on their last LOD, scaled up by displayScale) out to this distance, or the
 * kit's own last maxM when that is larger, then hide. Owner ruling P2: decorative vehicles read
 * "1x near, rising to about 3x at hero-mid", and hero-mid's camera is > 565 m away. People follow
 * R-J7 instead: peopleScale, visible to PEOPLE_VISIBLE_M (800 m), hidden beyond.
 */
export const AGENT_VISIBLE_M = 900;

/** The kit's LOD bands with the last one stretched to `visibleM` (never shortened). */
export function agentLods(
  lods: readonly { maxM: number | null }[],
  visibleM = AGENT_VISIBLE_M,
): { maxM: number | null }[] {
  return lods.map((l, i) =>
    i === lods.length - 1 && l.maxM !== null ? { maxM: Math.max(l.maxM, visibleM) } : l,
  );
}
/** Display scale by kind: people R-J7 (`peopleScale`), vehicles ruling P2 (`displayScale`). */
const scaleFor = (kind: Agent["kind"], d: number) =>
  kind === "person" ? peopleScale(d) : displayScale(d);
const ASSET: Record<Agent["kind"], string> = { person: "people", vehicle: "vehicles" };

/**
 * The crowd look of a person agent: its `look` id when the kit has it, else the C-T8 assignment
 * (`assigned`, from assignLooks), else a seeded pick over all looks. Display only.
 */
export function crowdLookIndex(kit: CrowdKit, a: Agent, assigned?: Map<string, number>): number {
  const byId = a.look === undefined ? undefined : kit.lookIndex.get(a.look);
  if (byId !== undefined) return byId;
  const given = assigned?.get(a.id);
  if (given !== undefined && kit.manifest.looks[given]) return given;
  const n = kit.manifest.looks.length;
  return Math.min(n - 1, Math.floor(hash01(a.id, "look") * n));
}

/**
 * The people the crowd assigns looks to (C-T8): no cyclists (they would walk at 4.5 m/s) and no one
 * with a fixed `look`. The same list `lookJob` runs on before a build (useMotion).
 */
export function crowdPeopleOf(agents: readonly Agent[]): Agent[] {
  return agents.filter(
    (a) => a.kind === "person" && a.variant !== "cyclist" && a.look === undefined,
  );
}

interface CrowdSlot {
  agent: Agent;
  rank: number;
  raw: LodBucket | undefined;
  walk: BakedClip;
  idle: BakedClip;
}
const KIND: Record<Agent["kind"], RoleKind> = { person: "person", vehicle: "vehicle" };

interface Bucket {
  mesh: THREE.InstancedMesh;
  pal: THREE.InstancedBufferAttribute[];
  n: number;
}
interface Slot {
  agent: Agent;
  /** Rank within its kind: shown while rank < the kind's active count. */
  rank: number;
  lods: { maxM: number | null }[];
  buckets: (Bucket | undefined)[];
  /** Missing LOD geometry resolves to the nearest available LOD. */
  resolve: number[];
  raw: LodBucket | undefined;
  palette: [THREE.Color, THREE.Color, THREE.Color];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);
const _sphere = new THREE.Sphere();

/**
 * DECORATIVE traffic and pedestrians: one InstancedMesh per (kit, variant, LOD), rewritten on every
 * tick for the agents in view. Never picked (no-op raycast), never casts a shadow, faded by
 * setOpacity (materials stay transparent so a fade never recompiles a program). The distance
 * scale-up is applied to the instance matrix only; the library geometry is never changed.
 */
export function createMotionLayer(
  agents: Agent[],
  lib: AssetLibrary,
  m: Manifest,
  uniforms: RoleUniforms,
  motion: MotionUniforms,
  opts: {
    yaw?: YawMemory;
    /**
     * People (C-T7): a crowd kit draws them with the baked-animation crowd renderer; `null` (kit still
     * loading or failed) draws no people; omitted, the legacy `people` kit with the shader limb swing.
     */
    crowd?: CrowdKit | null;
    /** Crowd looks by agent id, kept across rebuilds like `yaw` (C-T8, P3); reset to this agent set. */
    looks?: LookMemory;
    /**
     * The hero's position and heading, read every tick (C-T8 keep-out, P8): no crowd person within
     * 2 m of her or of her next 10 m. Only these numbers; never the journey plan or its events (P9).
     */
    hero?: () => HeroXZ | null;
    /**
     * Crowd looks already assigned for these agents (useMotion runs `lookJob` in slices before the
     * build; GATE AC-D18). Omitted, the layer runs `assignLooks` itself (same result, all at once).
     */
    assigned?: Map<string, number>;
  } = {},
): MotionLayer & { setDensity(w: MoodMix): void; crowd: CrowdRenderer | null } {
  const yawMemory: YawMemory = opts.yaw ?? new Map();
  if (opts.yaw) {
    const ids = new Set(agents.map((a) => a.id));
    for (const id of yawMemory.keys()) if (!ids.has(id)) yawMemory.delete(id);
  }
  const group = new THREE.Group();
  group.name = "motion-agents";
  group.userData.decorative = true;
  const materials = new Map<Agent["kind"], THREE.MeshStandardMaterial>();
  const materialFor = (kind: Agent["kind"]) => {
    let mt = materials.get(kind);
    if (!mt) {
      mt = createRoleMaterial({ instanced: true, uniforms, motion, kind: KIND[kind] });
      mt.transparent = true;
      materials.set(kind, mt);
    }
    return mt;
  };
  const wrappers: THREE.BufferGeometry[] = [];

  // Capacity per (kind, variant): every bucket of a variant can hold all its agents.
  const perVariant = new Map<string, number>();
  for (const a of agents) {
    const k = `${a.kind}/${a.variant}`;
    perVariant.set(k, (perVariant.get(k) ?? 0) + 1);
  }
  const bucketsByVariant = new Map<
    string,
    { buckets: (Bucket | undefined)[]; resolve: number[] }
  >();
  const variantBuckets = (a: Agent) => {
    const key = `${a.kind}/${a.variant}`;
    const hit = bucketsByVariant.get(key);
    if (hit) return hit;
    const asset = ASSET[a.kind];
    const vspec = m.assets[asset]?.variants[a.variant];
    const buckets: (Bucket | undefined)[] = [];
    const cap = perVariant.get(key) ?? 0;
    vspec?.lods.forEach((_l, lod) => {
      const src = lib.geometry(asset, a.variant, lod);
      if (!src || cap === 0) return;
      // Own geometry object sharing the library's attributes, so instance attributes stay per mesh.
      const geo = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(src.attributes)) geo.setAttribute(name, attr);
      if (src.index) geo.setIndex(src.index);
      const pal = [0, 1, 2].map(() => {
        const at = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        at.setUsage(THREE.DynamicDrawUsage);
        return at;
      });
      for (const [i, at] of pal.entries()) geo.setAttribute(`iPal${i}`, at);
      wrappers.push(geo);
      const mesh = new THREE.InstancedMesh(geo, materialFor(a.kind), cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.name = `motion__${asset}__${a.variant}__LOD${lod}`;
      mesh.count = 0;
      mesh.visible = false;
      // Agents never cast (budget, and moving shadows would shimmer); the layer culls by itself.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.raycast = NOOP;
      mesh.userData.decorative = true;
      mesh.userData.lod = lod;
      group.add(mesh);
      buckets[lod] = { mesh, pal, n: 0 };
    });
    const avail = buckets.flatMap((b, i) => (b ? [i] : []));
    const resolve = (vspec?.lods ?? []).map((_l, i) => {
      let best = -1;
      for (const v of avail) if (best < 0 || Math.abs(v - i) < Math.abs(best - i)) best = v;
      return best;
    });
    const out = { buckets, resolve };
    bucketsByVariant.set(key, out);
    return out;
  };

  const rankOf = new Map<Agent["kind"], number>();
  const total: Record<Agent["kind"], number> = { person: 0, vehicle: 0 };
  const slots: Slot[] = [];
  const lodsByVariant = new Map<string, { maxM: number | null }[]>();
  const crowdMode = opts.crowd !== undefined;
  const kit = opts.crowd ?? null;
  const crowdSlots: CrowdSlot[] = [];
  const crowdLooks: number[] = [];
  const crowdLods = kit ? crowdLodBands(kit.manifest.lods) : [];
  // C-T8: no cyclists in the people crowd (they would walk at 4.5 m/s); looks with no twins nearby.
  const crowdPeople = kit ? crowdPeopleOf(agents) : [];
  const assigned = kit
    ? (opts.assigned ?? assignLooks(crowdPeople, kit.manifest.looks, opts.looks))
    : undefined;
  for (const a of agents) {
    if (a.kind === "person" && crowdMode) {
      if (!kit || a.variant === "cyclist") continue;
      const look = crowdLookIndex(kit, a, assigned);
      const spec = kit.manifest.looks[look];
      const clips = spec ? kit.clips[spec.body] : undefined;
      const walk = spec && clips?.[spec.clips.walk];
      const idle = spec && clips?.[spec.clips.idle];
      if (!spec || !walk || !idle) continue;
      // The look's own pace (older, walker, wheelchair slower; cadence capped), on its own object.
      const stride = kit.manifest.bodies[spec.body].clips[spec.clips.walk]?.stride ?? 0;
      const speed = lookSpeed(a, spec, stride);
      const agent = speed === a.speed ? a : { ...a, speed };
      const rank = rankOf.get(a.kind) ?? 0;
      rankOf.set(a.kind, rank + 1);
      total[a.kind]++;
      crowdSlots.push({ agent, rank, raw: undefined, walk, idle });
      crowdLooks.push(look);
      continue;
    }
    const asset = ASSET[a.kind];
    const spec = m.assets[asset];
    const vspec = spec?.variants[a.variant];
    if (!spec || !vspec) continue;
    const { buckets, resolve } = variantBuckets(a);
    if (!buckets.some(Boolean)) continue;
    const rank = rankOf.get(a.kind) ?? 0;
    rankOf.set(a.kind, rank + 1);
    total[a.kind]++;
    const pal = paletteFor(spec, "default", a.id);
    const lk = `${a.kind}/${a.variant}`;
    let lods = lodsByVariant.get(lk);
    if (!lods) {
      lods = agentLods(vspec.lods, a.kind === "person" ? PEOPLE_VISIBLE_M : AGENT_VISIBLE_M);
      lodsByVariant.set(lk, lods);
    }
    slots.push({
      agent: a,
      rank,
      lods,
      buckets,
      resolve,
      raw: undefined,
      palette: [new THREE.Color(pal[0]), new THREE.Color(pal[1]), new THREE.Color(pal[2])],
    });
  }
  const crowd = kit && crowdSlots.length > 0 ? createCrowdRenderer(kit, crowdLooks) : null;
  if (crowd) group.add(crowd.group);
  const allBuckets = [...bucketsByVariant.values()].flatMap((v) =>
    v.buckets.filter((b): b is Bucket => !!b),
  );
  const active: Record<Agent["kind"], number> = { ...total };
  const pose: Pose2 = { x: 0, z: 0, yaw: 0 };
  const kept: KeepOutResult = { x: 0, z: 0, hidden: false };
  const heroOf = opts.hero ?? (() => null);
  /**
   * The keep-out (P8) on `pose` for a person: moves pose.x / z out of her zone; false when the
   * person must not be drawn this frame. Vehicles are untouched (they keep to the carriageway).
   */
  const keepClear = (a: Agent, hero: HeroXZ | null): boolean => {
    if (a.kind !== "person") return true;
    let mem = yawMemory.get(a.id);
    if (!hero) {
      if (mem?.keep) mem.keep.side = undefined;
      return true;
    }
    if (!mem) {
      mem = { yaw: pose.yaw, at: Number.NaN };
      yawMemory.set(a.id, mem);
    }
    mem.keep ??= {};
    keepOut(pose.x, pose.z, hero, mem.keep, kept);
    pose.x = kept.x;
    pose.z = kept.z;
    return !kept.hidden;
  };

  /** Smoothed yaw for an agent at pose.yaw; returns it and the seconds since its last update. */
  const smoothed = (id: string, nowMs: number) => {
    const mem = yawMemory.get(id);
    if (!mem || Number.isNaN(mem.at)) {
      // An entry the keep-out made before the first pose (at NaN) keeps its keep-out side.
      const fresh: YawEntry = {
        yaw: pose.yaw,
        at: nowMs,
        ...(mem?.keep ? { keep: mem.keep } : {}),
      };
      yawMemory.set(id, fresh);
      return { yaw: pose.yaw, dt: 0, mem: fresh };
    }
    const dt = Math.max(0, nowMs - mem.at) / 1000;
    mem.yaw = smoothYaw(mem.yaw, pose.yaw, dt);
    mem.at = nowMs;
    return { yaw: mem.yaw, dt, mem };
  };

  return {
    group,
    crowd,
    setDensity(w) {
      const share = Math.min(1, densityFor(w) / DENSITY_PEAK);
      active.person = Math.round(total.person * share);
      active.vehicle = Math.round(total.vehicle * share);
    },
    tick(nowMs, camera, frustum) {
      const t = nowMs / 1000;
      const hero = heroOf();
      for (const b of allBuckets) b.n = 0;
      for (const s of slots) {
        if (s.rank >= active[s.agent.kind]) continue;
        poseAt(s.agent, t, pose);
        if (!keepClear(s.agent, hero)) continue;
        const d = Math.hypot(pose.x - camera.x, camera.y, pose.z - camera.z);
        const raw = lodFor(d, s.lods, s.raw);
        s.raw = raw;
        if (raw < 0 || (s.agent.kind === "person" && d > PEOPLE_VISIBLE_M)) continue;
        const b = s.buckets[s.resolve[raw] ?? -1];
        if (!b) continue;
        _p.set(pose.x, AGENT_LIFT_M, pose.z);
        // Smooth the tangent yaw before the frustum test, so an agent panning into view has
        // already turned. A long gap (hidden, out of range) settles at once (k -> 1).
        const { yaw } = smoothed(s.agent.id, nowMs);
        if (frustum && !frustum.intersectsSphere(_sphere.set(_p, FRUSTUM_MARGIN_M))) continue;
        const k = scaleFor(s.agent.kind, d);
        _q.setFromAxisAngle(_y, yaw);
        b.mesh.setMatrixAt(b.n, _m.compose(_p, _q, _s.set(k, k, k)));
        for (let i = 0; i < 3; i++) {
          const c = s.palette[i] as THREE.Color;
          (b.pal[i] as THREE.InstancedBufferAttribute).setXYZ(b.n, c.r, c.g, c.b);
        }
        b.n++;
      }
      // The crowd (C-T7): LOD0 to 60 m, LOD1 to 800 m (R-J7, crowdLodBands), hidden beyond; the
      // gait phase integrates the distance walked (crowdGait.ts, P5); the keep-out moves people
      // out of the hero's way (P8).
      for (const [i, s] of crowdSlots.entries()) {
        if (!crowd) break;
        if (s.rank >= active.person) {
          crowd.hide(i);
          continue;
        }
        poseAt(s.agent, t, pose);
        const clear = keepClear(s.agent, hero);
        const d = Math.hypot(pose.x - camera.x, camera.y, pose.z - camera.z);
        const raw = lodFor(d, crowdLods, s.raw);
        s.raw = raw;
        // R-J7: hidden beyond 800 m outright (the LOD hysteresis would hold a person to 880 m).
        if (raw < 0 || !clear || d > PEOPLE_VISIBLE_M) {
          crowd.hide(i);
          continue;
        }
        _p.set(pose.x, AGENT_LIFT_M, pose.z);
        const { yaw, dt, mem } = smoothed(s.agent.id, nowMs);
        const k = peopleScale(d);
        const dist = easedDistance(s.agent, t);
        if (!mem.gait)
          mem.gait = { phase: gaitStartPhase(s.agent.id, dist, s.walk, k), dist, idle: false };
        else advanceGait(mem.gait, dist, dt, k, s.walk, s.idle);
        if (frustum && !frustum.intersectsSphere(_sphere.set(_p, FRUSTUM_MARGIN_M))) {
          crowd.hide(i);
          continue;
        }
        const clip = mem.gait.idle ? s.idle : s.walk;
        const f = framePair(mem.gait.phase, clip.frames);
        _q.setFromAxisAngle(_y, yaw);
        crowd.set(
          i,
          raw === 0 ? 0 : 1,
          _m.compose(_p, _q, _s.set(k, k, k)),
          clip.row + f.f0,
          clip.row + f.f1,
          f.t,
        );
      }
      crowd?.commit();
      for (const b of allBuckets) {
        const was = b.mesh.count;
        b.mesh.count = b.n;
        b.mesh.visible = b.n > 0;
        if (b.n === 0 && was === 0) continue;
        b.mesh.instanceMatrix.needsUpdate = true;
        for (const a of b.pal) a.needsUpdate = true;
      }
    },
    setOpacity(o) {
      for (const mt of materials.values()) mt.opacity = o;
      crowd?.setOpacity(o);
      group.visible = o > 0;
    },
    dispose() {
      for (const b of allBuckets) b.mesh.dispose();
      for (const g of wrappers) {
        // Detach the library's shared attributes first: dispose() would delete their GPU buffers.
        for (const name of Object.keys(g.attributes))
          if (!name.startsWith("iPal")) g.deleteAttribute(name);
        g.setIndex(null);
        g.dispose();
      }
      for (const mt of materials.values()) mt.dispose();
      crowd?.dispose();
      group.clear();
    },
  };
}
