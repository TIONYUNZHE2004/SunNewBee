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
import { markUsed } from "../assets/uploadRange";
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
  yawAt,
} from "./agents";
import type { BakedClip, CrowdKit } from "./crowdBake";
import { advanceGait, framePair, type GaitState, gaitAt, gaitStartPhase } from "./crowdGait";
import { type CrowdRenderer, createCrowdRenderer, crowdLodBands } from "./crowdRenderer";
import {
  assignLooks,
  densityShown,
  type HeroXZ,
  type KeepOutMemory,
  type KeepOutResult,
  keepOut,
  type LookMemory,
  lookSpeed,
  personClear,
  vehicleClear,
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
  /**
   * `frustum`: when given, only agents inside it (plus a 50 m margin) get matrices this tick.
   * `pure`: `nowMs` is a journey's trip clock, which can seek back and forth: facing and gait are
   * then pure functions of it (no smoothing memory), so a seek and a play to t agree (AC-D17).
   */
  tick(nowMs: number, camera: THREE.Vector3, frustum?: THREE.Frustum, pure?: boolean): void;
  setOpacity(o: number): void;
  dispose(): void;
}

/**
 * A flow override (devsim fast-forward, spec §7): `timeScale` multiplies agent speed (on the motion
 * clock; a pure clock already carries it, see `setFlow`), the densities (multiples of the day
 * density, 1 = day) scale the shown share of people and of vehicles, and people inside `avoid`
 * (e.g. a hoarded footway) are not drawn. Decorative.
 */
export interface MotionFlow {
  timeScale: number;
  peopleDensity: number;
  vehicleDensity: number;
  avoid?: (x: number, z: number) => boolean;
}

/** World points of the drawn agents, one entry per agent in a fixed order (NaN x: not drawn). */
export interface FlowSamples {
  people: readonly (readonly [number, number, number])[];
  vehicles: readonly (readonly [number, number, number])[];
}

/** The share of the peak-density plan shown at `density` x the day density. */
export function flowShare(density: number): number {
  return Math.max(
    0,
    Math.min(1, (density * densityFor({ day: 1, dusk: 0, night: 0 })) / DENSITY_PEAK),
  );
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
): MotionLayer & {
  setDensity(w: MoodMix): void;
  /**
   * The devsim flow (null: none, the default behaviour). With a flow, the motion clock runs
   * `timeScale` times faster (re-anchored on a change, so nobody jumps); a pure tick takes its clock
   * as given (the caller's clock is already flow time, so a seek stays deterministic).
   */
  setFlow(f: MotionFlow | null): void;
  /** Positions drawn by the last tick (probe samples). */
  samples(): FlowSamples;
  crowd: CrowdRenderer | null;
} {
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
      crowdSlots.push({ agent, raw: undefined, walk, idle });
      crowdLooks.push(look);
      continue;
    }
    const asset = ASSET[a.kind];
    const spec = m.assets[asset];
    const vspec = spec?.variants[a.variant];
    if (!spec || !vspec) continue;
    const { buckets, resolve } = variantBuckets(a);
    if (!buckets.some(Boolean)) continue;
    const pal = paletteFor(spec, "default", a.id);
    const lk = `${a.kind}/${a.variant}`;
    let lods = lodsByVariant.get(lk);
    if (!lods) {
      lods = agentLods(vspec.lods, a.kind === "person" ? PEOPLE_VISIBLE_M : AGENT_VISIBLE_M);
      lodsByVariant.set(lk, lods);
    }
    slots.push({
      agent: a,
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
  /**
   * The mood's share of the peak density: an agent is drawn while `densityShown(id, share)`, a
   * hash of its own id (ITER2 AC-D17: never a rank in the streamed union, which changed with the
   * seek history).
   */
  let share = 1;
  let flow: MotionFlow | null = null;
  /** Re-anchored flow clock: wall seconds and flow seconds at the last timeScale change. */
  let anchor: { wall: number; eff: number; scale: number } | null = null;
  let lastWall = 0;
  const shareOf = (kind: Agent["kind"]) =>
    flow ? flowShare(kind === "person" ? flow.peopleDensity : flow.vehicleDensity) : share;
  const flowTime = (wall: number, pure: boolean): number => {
    lastWall = wall;
    if (!flow || pure) return wall;
    if (!anchor) anchor = { wall, eff: wall, scale: flow.timeScale };
    return anchor.eff + (wall - anchor.wall) * anchor.scale;
  };
  // sample slots: legacy-kit people and vehicles in slot order, then the crowd's people
  const nan = (): [number, number, number] => [Number.NaN, 0, 0];
  const slotSample: ([number, number, number] | undefined)[] = [];
  const peopleSamples: [number, number, number][] = [];
  const vehicleSamples: [number, number, number][] = [];
  for (const sl of slots) {
    const v = nan();
    slotSample.push(v);
    (sl.agent.kind === "person" ? peopleSamples : vehicleSamples).push(v);
  }
  const crowdSample = crowdSlots.map(() => {
    const v = nan();
    peopleSamples.push(v);
    return v;
  });
  const pose: Pose2 = { x: 0, z: 0, yaw: 0 };
  /** The poses of the pure facing (`yawAt`): now and the look-back. */
  const cur: Pose2 = { x: 0, z: 0, yaw: 0 };
  const back: Pose2 = { x: 0, z: 0, yaw: 0 };
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
      share = Math.min(1, densityFor(w) / DENSITY_PEAK);
    },
    setFlow(f) {
      if (f && flow && anchor && f.timeScale !== anchor.scale) {
        // re-anchor at the last tick so the flow clock stays continuous
        const eff = anchor.eff + (lastWall - anchor.wall) * anchor.scale;
        anchor = { wall: lastWall, eff, scale: f.timeScale };
      }
      if (!f) anchor = null;
      flow = f;
    },
    samples: () => ({ people: peopleSamples, vehicles: vehicleSamples }),
    tick(nowMs, camera, frustum, pure = false) {
      const t = flowTime(nowMs / 1000, pure);
      for (const p of peopleSamples) p[0] = Number.NaN;
      for (const v of vehicleSamples) v[0] = Number.NaN;
      const hero = heroOf();
      // Pure (trip clock): facing from the look-back chord at t; the smoothing memory follows it,
      // so the hand-back to the motion clock starts from the drawn facing.
      const facing = (a: Agent) => {
        if (!pure) return smoothed(a.id, nowMs);
        // its own poses (the keep-out may have moved `pose` aside)
        const yaw = yawAt(a, t, cur, back);
        let mem = yawMemory.get(a.id);
        if (!mem) {
          mem = { yaw, at: nowMs };
          yawMemory.set(a.id, mem);
        }
        mem.yaw = yaw;
        mem.at = nowMs;
        return { yaw, dt: 0, mem };
      };
      for (const b of allBuckets) b.n = 0;
      for (const [si, s] of slots.entries()) {
        if (!densityShown(s.agent.id, shareOf(s.agent.kind))) continue;
        poseAt(s.agent, t, pose);
        if (!keepClear(s.agent, hero)) continue;
        if (s.agent.kind === "person" && flow?.avoid?.(pose.x, pose.z)) continue;
        // ITER2: no decorative vehicle by her route or between the camera and her, no person at the
        // camera's feet (whole agents, never half cut), while a journey hero is shown.
        if (
          s.agent.kind === "vehicle"
            ? !vehicleClear(pose.x, pose.z, hero, camera)
            : !personClear(pose.x, pose.z, hero, camera)
        )
          continue;
        const d = Math.hypot(pose.x - camera.x, camera.y, pose.z - camera.z);
        const raw = lodFor(d, s.lods, s.raw);
        s.raw = raw;
        if (raw < 0 || (s.agent.kind === "person" && d > PEOPLE_VISIBLE_M)) continue;
        const b = s.buckets[s.resolve[raw] ?? -1];
        if (!b) continue;
        _p.set(pose.x, AGENT_LIFT_M, pose.z);
        // Smooth the tangent yaw before the frustum test, so an agent panning into view has
        // already turned. A long gap (hidden, out of range) settles at once (k -> 1).
        const { yaw } = facing(s.agent);
        if (frustum && !frustum.intersectsSphere(_sphere.set(_p, FRUSTUM_MARGIN_M))) continue;
        const k = scaleFor(s.agent.kind, d);
        _q.setFromAxisAngle(_y, yaw);
        b.mesh.setMatrixAt(b.n, _m.compose(_p, _q, _s.set(k, k, k)));
        const smp = slotSample[si];
        if (smp) {
          smp[0] = pose.x;
          smp[1] = 1;
          smp[2] = pose.z;
        }
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
        if (!densityShown(s.agent.id, shareOf("person"))) {
          crowd.hide(i);
          continue;
        }
        poseAt(s.agent, t, pose);
        const clear =
          keepClear(s.agent, hero) &&
          personClear(pose.x, pose.z, hero, camera) &&
          !flow?.avoid?.(pose.x, pose.z);
        const d = Math.hypot(pose.x - camera.x, camera.y, pose.z - camera.z);
        const raw = lodFor(d, crowdLods, s.raw);
        s.raw = raw;
        // R-J7: hidden beyond 800 m outright (the LOD hysteresis would hold a person to 880 m).
        if (raw < 0 || !clear || d > PEOPLE_VISIBLE_M) {
          crowd.hide(i);
          continue;
        }
        _p.set(pose.x, AGENT_LIFT_M, pose.z);
        const { yaw, dt, mem } = facing(s.agent);
        const k = peopleScale(d);
        const dist = easedDistance(s.agent, t);
        if (pure) mem.gait = gaitAt(s.agent.id, dist, s.agent.speed, t, k, s.walk, s.idle);
        else if (!mem.gait)
          mem.gait = { phase: gaitStartPhase(s.agent.id, dist, s.walk, k), dist, idle: false };
        else advanceGait(mem.gait, dist, dt, k, s.walk, s.idle);
        if (frustum && !frustum.intersectsSphere(_sphere.set(_p, FRUSTUM_MARGIN_M))) {
          crowd.hide(i);
          continue;
        }
        const clip = mem.gait.idle ? s.idle : s.walk;
        const f = framePair(mem.gait.phase, clip.frames);
        _q.setFromAxisAngle(_y, yaw);
        const cs = crowdSample[i];
        if (cs) {
          cs[0] = pose.x;
          cs[1] = 1;
          cs[2] = pose.z;
        }
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
        markUsed(b.mesh.instanceMatrix, b.n);
        for (const a of b.pal) markUsed(a, b.n);
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
