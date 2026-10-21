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
import { bokehDepthMaterial } from "../tiltShift";
import {
  AGENT_LIFT_M,
  type Agent,
  DENSITY_PEAK,
  densityFor,
  displayScale,
  easedDistance,
  fadeAt,
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
import { nearDeadEnd, uturnSample, uturnTickBegin, uturnTickEnd, uturnWatchOn } from "./uturnWatch";
import { createVehicleLights } from "./vehicleLights";

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
  /** The fading lap the keep-out memory belongs to: a respawn forgets the side (review M2). */
  lap?: number;
  /** The keep-out's last push (m) and its motion time (s): a sudden change is not drawn. */
  push?: { dx: number; dz: number; t: number; shown: boolean };
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
  /** Vehicles inside this zone are not drawn (devsim: the parked school-run queue's lane). */
  avoidVehicles?: (x: number, z: number) => boolean;
}

/** World points of the drawn agents, one entry per agent in a fixed order (NaN x: not drawn). */
export interface FlowSamples {
  people: readonly (readonly [number, number, number])[];
  vehicles: readonly (readonly [number, number, number])[];
}

/** Sampling step (m) when clipping a path out of an avoid zone. */
const AVOID_STEP_M = 1;
/** A clipped route shorter than this is not walked (the person is not drawn). */
const AVOID_MIN_M = 4;

/** The warp knots up to path metre `s` (the last knot interpolated onto it). */
function truncateWarp(w: Float32Array, s: number): Float32Array {
  const k: number[] = [];
  for (let i = 0; i < w.length; i += 2) {
    const n = w[i] as number;
    const a = w[i + 1] as number;
    if (a < s) {
      k.push(n, a);
      continue;
    }
    const pn = k[k.length - 2] ?? 0;
    const pa = k[k.length - 1] ?? 0;
    k.push(a > pa ? pn + ((n - pn) * (s - pa)) / (a - pa) : pn, s);
    break;
  }
  return Float32Array.from(k);
}

/**
 * The agent's path without the avoid zone (devsim: the hoarded footway). The agent itself when the
 * path never enters the zone; null when less than AVOID_MIN_M of it is outside. Pure.
 * - A fading agent (`ends: "fade"`, demo polish A1) walks its path up to where it first enters the
 *   zone, fades out there and respawns at its start (the first stretch outside the zone, when its
 *   start is inside): never turning round in place.
 * - A hand-made open path keeps the longest run outside the zone and turns round at its ends
 *   (`poseAt`), so people stop and turn before the hoarding instead of walking through it.
 */
export function avoidRoute(a: Agent, avoid: (x: number, z: number) => boolean): Agent | null {
  if (a.ends === "fade") return fadeAvoidRoute(a, avoid);
  const p = a.path;
  const n = p.length / 2;
  if (n < 2) return avoid(p[0] ?? 0, p[1] ?? 0) ? null : a;
  let best: number[] = [];
  let bestL = 0;
  let run: number[] = [];
  let runL = 0;
  let entered = false;
  const close = () => {
    if (runL > bestL) {
      best = run;
      bestL = runL;
    }
    run = [];
    runL = 0;
  };
  const push = (x: number, z: number) => {
    const k = run.length;
    if (k >= 2) runL += Math.hypot(x - (run[k - 2] as number), z - (run[k - 1] as number));
    run.push(x, z);
  };
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2] as number;
    const az = p[i * 2 + 1] as number;
    const bx = p[i * 2 + 2] as number;
    const bz = p[i * 2 + 3] as number;
    const L = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(L / AVOID_STEP_M));
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const u = k / steps;
      const x = ax + (bx - ax) * u;
      const z = az + (bz - az) * u;
      if (avoid(x, z)) {
        entered = true;
        close();
      } else push(x, z);
    }
  }
  close();
  if (!entered) return a;
  if (bestL < AVOID_MIN_M) return null;
  return { ...a, path: new Float32Array(best), length: bestL, offset: a.offset % bestL };
}

function fadeAvoidRoute(a: Agent, avoid: (x: number, z: number) => boolean): Agent | null {
  const p = a.path;
  const n = p.length / 2;
  if (n < 2) return avoid(p[0] ?? 0, p[1] ?? 0) ? null : a;
  const run: number[] = [];
  let runL = 0;
  let startS = 0;
  let walked = 0;
  let entered = false;
  let done = false;
  for (let i = 0; i < n - 1 && !done; i++) {
    const ax = p[i * 2] as number;
    const az = p[i * 2 + 1] as number;
    const bx = p[i * 2 + 2] as number;
    const bz = p[i * 2 + 3] as number;
    const L = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(L / AVOID_STEP_M));
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const u = k / steps;
      const x = ax + (bx - ax) * u;
      const z = az + (bz - az) * u;
      if (avoid(x, z)) {
        entered = true;
        // in the zone: the stretch so far is the route when long enough, else look past the zone
        if (runL >= AVOID_MIN_M) {
          done = true;
          break;
        }
        run.length = 0;
        runL = 0;
        continue;
      }
      const m = run.length;
      if (m === 0) startS = walked + L * u;
      else runL += Math.hypot(x - (run[m - 2] as number), z - (run[m - 1] as number));
      run.push(x, z);
    }
    walked += L;
  }
  if (!entered) return a;
  if (runL < AVOID_MIN_M) return null;
  const out: Agent = {
    ...a,
    path: new Float32Array(run),
    length: runL,
    offset: a.offset % runL,
  };
  // the slow zones still hold when the route starts at the path's start; else walk it unwarped
  if (a.warp && startS === 0) out.warp = truncateWarp(a.warp, runL);
  else delete out.warp;
  return out;
}

/** The share of the peak-density plan shown at `density` x the day density. */
export function flowShare(density: number): number {
  return Math.max(
    0,
    Math.min(1, (density * densityFor({ day: 1, dusk: 0, night: 0 })) / DENSITY_PEAK),
  );
}

/**
 * A keep-out push changing by more than this between two drawn frames (m) hides the person for that
 * frame: a safety net only, kept at the review-round threshold. Since the radial push at round
 * joints (A4w) the push is continuous and the demo playback never trips it (crowdKeepOut.test.ts
 * asserts 0 hides and a largest push step under this value).
 */
const PUSH_SNAP_M = 0.6;
/**
 * Keep-out counters for tests (crowdKeepOut.test.ts): frames hidden because the push jumped by more
 * than PUSH_SNAP_M, and the largest push change between consecutive frames (m). Display only.
 */
export const keepOutStats = { snapHides: 0, maxPushStepM: 0 };

/** Vehicle variants without a headlight: no night beam on the road (A2 kit: the bicycle). */
const NO_BEAM: ReadonlySet<string> = new Set(["bicycle"]);

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
  /** Per-instance opacity (demo polish A1: fading at a path end). */
  fade: THREE.InstancedBufferAttribute;
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
  /** Vehicles: centre to bumper (m, unscaled), where the night beams and tail glows start. */
  halfLengthM: number;
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
      mt = createRoleMaterial({ instanced: true, uniforms, motion, kind: KIND[kind], fade: true });
      mt.transparent = true;
      materials.set(kind, mt);
    }
    return mt;
  };
  const wrappers: THREE.BufferGeometry[] = [];
  // A3: the bokeh depth render draws each agent at its instance matrix and leaves out the faded
  // ones (iFade < 0.5), as the colour pass does (one twin for every agent mesh)
  const bokehDepth = bokehDepthMaterial();
  bokehDepth.name = "tl_agent_depth";
  bokehDepth.customProgramCacheKey = () => "tl_agent_depth";
  bokehDepth.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "attribute float iFade;\nvarying float vTlFade;\nvoid main() {")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTlFade = iFade;");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "varying float vTlFade;\nvoid main() {")
      .replace(
        "#include <alphatest_fragment>",
        "if (vTlFade < 0.5) discard;\n#include <alphatest_fragment>",
      );
  };

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
      const fade = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(1), 1);
      fade.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("iFade", fade);
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
      mesh.userData.bokehDepth = bokehDepth;
      group.add(mesh);
      buckets[lod] = { mesh, pal, fade, n: 0 };
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
      halfLengthM: vspec.size[2] / 2,
    });
  }
  // Night: headlight beams and tail glows on the road, one pair per drawn vehicle (none without).
  const vehicleCount = slots.filter((sl) => sl.agent.kind === "vehicle").length;
  const lights = vehicleCount > 0 ? createVehicleLights(vehicleCount, uniforms) : null;
  if (lights) group.add(lights.group);
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
  /** Person routes clipped out of the flow's avoid zone, by agent (reset when the zone changes). */
  let routes = new WeakMap<Agent, Agent | null>();
  let routesFor: MotionFlow["avoid"] | null = null;
  const routeOf = (a: Agent): Agent | null => {
    const avoid = flow?.avoid;
    if (!avoid || a.kind !== "person") return a;
    if (routesFor !== avoid) {
      routes = new WeakMap();
      routesFor = avoid;
    }
    let r = routes.get(a);
    if (r === undefined) {
      r = avoidRoute(a, avoid);
      routes.set(a, r);
    }
    return r;
  };
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
  /** A fading agent's opacity and lap this tick (fadeAt). */
  const fo = { opacity: 1, lap: 0 };
  /** The poses of the pure facing (`yawAt`): now and the look-back. */
  const cur: Pose2 = { x: 0, z: 0, yaw: 0 };
  const back: Pose2 = { x: 0, z: 0, yaw: 0 };
  const kept: KeepOutResult = { x: 0, z: 0, hidden: false };
  const heroOf = opts.hero ?? (() => null);
  /**
   * The keep-out (P8) on `pose` for a person: moves pose.x / z out of her zone; false when the
   * person must not be drawn this frame. Vehicles are untouched (they keep to the carriageway).
   */
  const keepClear = (a: Agent, hero: HeroXZ | null, t: number): boolean => {
    if (a.kind !== "person") return true;
    let mem = yawMemory.get(a.id);
    // a respawned person is somewhere else: the side of her path it was held on no longer holds
    // (an entry without a lap yet, made by the facing, adopts this one without a reset)
    if (mem && mem.lap !== fo.lap) {
      if (mem.lap !== undefined) {
        if (mem.keep) mem.keep.side = undefined;
        // and its last push belongs to the old spot
        if (mem.push) mem.push.shown = false;
      }
      mem.lap = fo.lap;
    }
    if (!hero) {
      if (mem?.keep) mem.keep.side = undefined;
      return true;
    }
    if (!mem) {
      // born on this lap: the next frame must not take it for a respawn (review minor)
      mem = { yaw: pose.yaw, at: Number.NaN, lap: fo.lap };
      yawMemory.set(a.id, mem);
    }
    mem.keep ??= {};
    keepOut(pose.x, pose.z, hero, mem.keep, kept);
    // The zone's push is continuous (crowdRules keepOut); a frame where it still jumps by over
    // PUSH_SNAP_M is not drawn, the next one shows it settled (no visible snap). Counted for tests.
    const dx = kept.x - pose.x;
    const dz = kept.z - pose.z;
    const prev = mem.push;
    const shown = !kept.hidden;
    // the jump against the last frame, when both are drawn and that frame is recent (a person the
    // keep-out hid reappears where she is: that is not a jump anyone saw)
    const step =
      shown && prev?.shown && t > prev.t && t - prev.t < 0.25
        ? Math.hypot(dx - prev.dx, dz - prev.dz)
        : 0;
    // mutate (no per-frame allocation)
    if (prev) {
      prev.dx = dx;
      prev.dz = dz;
      prev.t = t;
      prev.shown = shown;
    } else mem.push = { dx, dz, t, shown };
    pose.x = kept.x;
    pose.z = kept.z;
    if (step > keepOutStats.maxPushStepM) keepOutStats.maxPushStepM = step;
    if (step > PUSH_SNAP_M) {
      keepOutStats.snapHides++;
      return false;
    }
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
        ...(mem?.lap !== undefined ? { lap: mem.lap } : {}),
        ...(mem?.push ? { push: mem.push } : {}),
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
      // a new avoid zone: clip every person's route now, not lazily on the first frame drawn
      // (gate 2: a 228 ms first frame after a seek)
      if (f?.avoid && f.avoid !== routesFor) {
        routes = new WeakMap();
        routesFor = f.avoid;
        for (const s of slots)
          if (s.agent.kind === "person") routes.set(s.agent, avoidRoute(s.agent, f.avoid));
        for (const s of crowdSlots) routes.set(s.agent, avoidRoute(s.agent, f.avoid));
      }
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
      lights?.begin();
      const watch = uturnWatchOn();
      if (watch) uturnTickBegin(t);
      for (const [si, s] of slots.entries()) {
        if (!densityShown(s.agent.id, shareOf(s.agent.kind))) continue;
        // a person whose path crosses the avoid zone walks the part before it (turning there)
        const ag = routeOf(s.agent);
        if (!ag) continue;
        poseAt(ag, t, pose);
        const tangent = pose.yaw;
        // A1: a fading agent at the very end / start of its lap is not drawn at all
        const fade = fadeAt(ag, t, fo).opacity;
        if (fade <= 0) continue;
        if (s.agent.kind === "vehicle" && flow?.avoidVehicles?.(pose.x, pose.z)) continue;
        if (!keepClear(ag, hero, t)) continue;
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
        const { yaw } = facing(ag);
        if (frustum && !frustum.intersectsSphere(_sphere.set(_p, FRUSTUM_MARGIN_M))) continue;
        const k = scaleFor(s.agent.kind, d);
        _q.setFromAxisAngle(_y, yaw);
        b.mesh.setMatrixAt(b.n, _m.compose(_p, _q, _s.set(k, k, k)));
        // night beams only while the car is mostly shown (no beam on a faded-out car); a bicycle
        // has no headlight (A2 kit) and throws no car-sized beam (A4w)
        if (s.agent.kind === "vehicle" && fade >= 0.5 && !NO_BEAM.has(s.agent.variant))
          lights?.add(pose.x, pose.z, yaw, s.halfLengthM, k);
        b.fade.setX(b.n, fade);
        if (watch)
          uturnSample(
            ag.id,
            ag.kind,
            t,
            pose.x,
            pose.z,
            tangent,
            nearDeadEnd(ag.deadEnds, pose.x, pose.z),
            fo.lap,
          );
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
        const ag = routeOf(s.agent);
        if (!ag) {
          crowd.hide(i);
          continue;
        }
        poseAt(ag, t, pose);
        const tangent = pose.yaw;
        const fade = fadeAt(ag, t, fo).opacity;
        const clear =
          fade > 0 && keepClear(ag, hero, t) && personClear(pose.x, pose.z, hero, camera);
        const d = Math.hypot(pose.x - camera.x, camera.y, pose.z - camera.z);
        const raw = lodFor(d, crowdLods, s.raw);
        s.raw = raw;
        // R-J7: hidden beyond 800 m outright (the LOD hysteresis would hold a person to 880 m).
        if (raw < 0 || !clear || d > PEOPLE_VISIBLE_M) {
          crowd.hide(i);
          continue;
        }
        _p.set(pose.x, AGENT_LIFT_M, pose.z);
        const { yaw, dt, mem } = facing(ag);
        const k = peopleScale(d);
        const dist = easedDistance(ag, t);
        if (pure) mem.gait = gaitAt(ag.id, dist, ag.speed, t, k, s.walk, s.idle);
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
          fade,
        );
        if (watch)
          uturnSample(
            ag.id,
            "person",
            t,
            pose.x,
            pose.z,
            tangent,
            nearDeadEnd(ag.deadEnds, pose.x, pose.z),
            fo.lap,
          );
      }
      crowd?.commit();
      lights?.end();
      if (watch) uturnTickEnd();
      for (const b of allBuckets) {
        const was = b.mesh.count;
        b.mesh.count = b.n;
        b.mesh.visible = b.n > 0;
        if (b.n === 0 && was === 0) continue;
        markUsed(b.mesh.instanceMatrix, b.n);
        for (const a of b.pal) markUsed(a, b.n);
        markUsed(b.fade, b.n);
      }
    },
    setOpacity(o) {
      for (const mt of materials.values()) mt.opacity = o;
      crowd?.setOpacity(o);
      lights?.setOpacity(o);
      group.visible = o > 0;
    },
    dispose() {
      for (const b of allBuckets) b.mesh.dispose();
      for (const g of wrappers) {
        // Detach the library's shared attributes first: dispose() would delete their GPU buffers.
        for (const name of Object.keys(g.attributes))
          if (!name.startsWith("iPal") && name !== "iFade") g.deleteAttribute(name);
        g.setIndex(null);
        g.dispose();
      }
      for (const mt of materials.values()) mt.dispose();
      bokehDepth.dispose();
      crowd?.dispose();
      lights?.dispose();
      group.clear();
    },
  };
}
