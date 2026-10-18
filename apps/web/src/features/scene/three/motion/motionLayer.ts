import * as THREE from "three";
import { type LodBucket, lodFor } from "../assets/cityInstances";
import { paletteFor } from "../assets/fit";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import {
  createRoleMaterial,
  type MotionUniforms,
  type RoleKind,
  type RoleUniforms,
} from "../assets/roleMaterial";
import {
  type Agent,
  DENSITY_PEAK,
  densityFor,
  displayScale,
  type MoodMix,
  type Pose2,
  poseAt,
  smoothYaw,
} from "./agents";

/**
 * Smoothed yaw per agent id, with the motion time (ms) it was last updated. Keyed by id (not by
 * slot) so a layer rebuilt from a different union of tiles keeps every surviving agent turning
 * smoothly: pass the same map to each rebuild. Each rebuild prunes the ids that are not in its agent
 * set, so streaming never grows the map beyond the latest set.
 */
export type YawMemory = Map<string, { yaw: number; at: number }>;

export interface MotionLayer {
  group: THREE.Group;
  /** `frustum`: when given, only agents inside it (plus a 50 m margin) get matrices this tick. */
  tick(nowMs: number, camera: THREE.Vector3, frustum?: THREE.Frustum): void;
  setOpacity(o: number): void;
  dispose(): void;
}

/** Agents just outside the view still get matrices, so nothing pops in at the edge while panning. */
const FRUSTUM_MARGIN_M = 50;
/** On the road ribbons (0.08 m) rather than in them. */
const AGENT_LIFT_M = 0.08;
const NOOP = () => {};
/**
 * Agents stay visible (on their last LOD, scaled up by displayScale) out to this distance, or the
 * kit's own last maxM when that is larger, then hide. Owner ruling P2: decorative people and
 * vehicles read "1x near, rising to about 3x at hero-mid", and hero-mid's camera is > 565 m away,
 * beyond the people kit's 300 m LOD1.
 */
export const AGENT_VISIBLE_M = 900;

/** The kit's LOD bands with the last one stretched to AGENT_VISIBLE_M (never shortened). */
export function agentLods(lods: readonly { maxM: number | null }[]): { maxM: number | null }[] {
  return lods.map((l, i) =>
    i === lods.length - 1 && l.maxM !== null ? { maxM: Math.max(l.maxM, AGENT_VISIBLE_M) } : l,
  );
}
const ASSET: Record<Agent["kind"], string> = { person: "people", vehicle: "vehicles" };
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
  opts: { yaw?: YawMemory } = {},
): MotionLayer & { setDensity(w: MoodMix): void } {
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
  for (const a of agents) {
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
      lods = agentLods(vspec.lods);
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
  const allBuckets = [...bucketsByVariant.values()].flatMap((v) =>
    v.buckets.filter((b): b is Bucket => !!b),
  );
  const active: Record<Agent["kind"], number> = { ...total };
  const pose: Pose2 = { x: 0, z: 0, yaw: 0 };

  return {
    group,
    setDensity(w) {
      const share = Math.min(1, densityFor(w) / DENSITY_PEAK);
      active.person = Math.round(total.person * share);
      active.vehicle = Math.round(total.vehicle * share);
    },
    tick(nowMs, camera, frustum) {
      const t = nowMs / 1000;
      for (const b of allBuckets) b.n = 0;
      for (const s of slots) {
        if (s.rank >= active[s.agent.kind]) continue;
        poseAt(s.agent, t, pose);
        const d = Math.hypot(pose.x - camera.x, camera.y, pose.z - camera.z);
        const raw = lodFor(d, s.lods, s.raw);
        s.raw = raw;
        if (raw < 0) continue;
        const b = s.buckets[s.resolve[raw] ?? -1];
        if (!b) continue;
        _p.set(pose.x, AGENT_LIFT_M, pose.z);
        // Smooth the tangent yaw before the frustum test, so an agent panning into view has
        // already turned. A long gap (hidden, out of range) settles at once (k -> 1).
        const mem = yawMemory.get(s.agent.id);
        let yaw = pose.yaw;
        if (!mem) yawMemory.set(s.agent.id, { yaw, at: nowMs });
        else {
          yaw = smoothYaw(mem.yaw, pose.yaw, Math.max(0, nowMs - mem.at) / 1000);
          mem.yaw = yaw;
          mem.at = nowMs;
        }
        if (frustum && !frustum.intersectsSphere(_sphere.set(_p, FRUSTUM_MARGIN_M))) continue;
        const k = displayScale(d);
        _q.setFromAxisAngle(_y, yaw);
        b.mesh.setMatrixAt(b.n, _m.compose(_p, _q, _s.set(k, k, k)));
        for (let i = 0; i < 3; i++) {
          const c = s.palette[i] as THREE.Color;
          (b.pal[i] as THREE.InstancedBufferAttribute).setXYZ(b.n, c.r, c.g, c.b);
        }
        b.n++;
      }
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
      group.clear();
    },
  };
}
