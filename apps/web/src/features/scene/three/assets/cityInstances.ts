import * as THREE from "three";
import { tileAt } from "../stream/tiles";
import type { Placement } from "./fit";
import type { AssetLibrary } from "./library";
import type { Manifest } from "./manifest";
import type { CityPlan } from "./plan";
import {
  createMotionUniforms,
  createRoleMaterial,
  type MotionUniforms,
  type RoleKind,
  type RoleUniforms,
} from "./roleMaterial";

/** Kit asset name -> shader kind; other kits are static. */
const KIT_KIND: Record<string, RoleKind> = {
  trees: "tree",
  people: "person",
  vehicles: "vehicle",
};

export type LodBucket = 0 | 1 | 2 | -1;

/** Hysteresis fraction of `lodFor`. */
const LOD_HYSTERESIS = 0.1;

/** LOD for a distance with hysteresis: out needs d > maxM*(1+h), back in needs d < maxM*(1-h). -1 = hidden. */
export function lodFor(
  d: number,
  lods: { maxM: number | null }[],
  prev: LodBucket | undefined,
  h = LOD_HYSTERESIS,
): LodBucket {
  const n = lods.length;
  let b = prev === undefined ? 0 : prev < 0 ? n : prev;
  const k = prev === undefined ? 0 : h;
  while (b < n) {
    const m = lods[b]?.maxM;
    if (m == null || d <= m * (1 + k)) break;
    b++;
  }
  while (b > 0) {
    const m = lods[b - 1]?.maxM;
    if (m == null || d >= m * (1 - k)) break;
    b--;
  }
  return (b >= n ? -1 : b) as LodBucket;
}

/**
 * The building id of an instance unit id. `fitArchetype` names the units of a row building
 * `${buildingId}#${i}` (i = 0..n-1) and a single unit by the plain building id, so this strips a
 * trailing `#<digits>` only.
 */
export function buildingIdOf(unitId: string): string {
  const m = /^(.*)#\d+$/.exec(unitId);
  return m ? (m[1] as string) : unitId;
}

export interface CityInstances {
  /**
   * One InstancedMesh per (asset, variant, LOD) plus one Mesh per landmark. Each InstancedMesh has
   * `userData.ids: string[]`, the unit id per instance index (`ids[hit.instanceId]`): a row
   * building's units are `${buildingId}#${i}`, a single-unit building is its plain id; map back
   * with `buildingIdOf`. `userData.lod` is the LOD index.
   */
  group: THREE.Group;
  /**
   * Re-bucket by camera position; rebuilds only the InstancedMeshes whose membership changed. Returns how many.
   * Placements are bucketed into the 250 m tiles: a tile whose LOD cannot change at this camera is not
   * visited. With `frustum`, tiles wholly outside it are not visited either (their instance writes wait
   * until they are seen again); no mesh is removed from the scene, so draw counts do not change.
   */
  update(camera: THREE.Vector3, frustum?: THREE.Frustum): number;
  /** Visible LOD2 meshes, which the engine leaves out of the GTAO normal/depth pass. */
  aoExcluded(): THREE.Object3D[];
  stats(): {
    instances: number;
    meshes: number;
    visibleMeshes: number;
    gpuBytes: number;
    /** Placements looped over by the last `update` (tile-skipped ones are not counted). */
    visitedPerTick: number;
  };
  /**
   * Replaces the kit buckets (props) with `kits`, their LOD distances scaled by `kitLodScale`
   * (default 1). Archetype and landmark meshes are kept as they are; the old kit meshes are
   * disposed. New kits are bucketed at the last camera seen by `update`, if any.
   */
  setKits(kits: Map<string, Placement[]> | null | undefined, kitLodScale?: number): void;
  dispose(): void;
}

interface Bucket {
  mesh: THREE.InstancedMesh;
  pal: THREE.InstancedBufferAttribute[];
  lod: number;
}
/** The placements of one key inside one 250 m tile. */
interface KeyTile {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  idx: Int32Array;
  /** Raw LOD every placement had after the last visit, or UNSET when mixed or never visited. */
  uni: number;
}
interface Key {
  list: Placement[];
  tiles: KeyTile[];
  /** Per raw LOD (index = raw, hidden = lods.length): the distance band in which it cannot change. */
  stay: { lo: number; hi: number }[];
  lods: { maxM: number | null }[];
  /** Current bucket per placement; UNSET before the first update. */
  cur: Int8Array;
  /** Raw LOD per placement (hysteresis state); cur is the available bucket it resolves to. */
  raw: Int8Array;
  /** Missing LOD geometry resolves to the nearest available LOD (ties go finer). */
  resolve: number[];
  buckets: Bucket[];
}

const UNSET = -2;
/** Polygon offset (factor and units) of a depth-yielding landmark; positive pushes it back. */
export const LANDMARK_YIELD_OFFSET = 2;
const NOOP = () => {};
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

function compose(p: Placement, out: THREE.Matrix4) {
  _q.setFromAxisAngle(_y, p.yaw);
  return out.compose(_p.set(p.x, 0, p.z), _q, _s.set(p.sx, p.sy, p.sz));
}

/** Placements grouped by 250 m tile (x, z only). */
function tilesOf(list: Placement[]): KeyTile[] {
  const by = new Map<string, { t: ReturnType<typeof tileAt>; idx: number[] }>();
  for (let i = 0; i < list.length; i++) {
    const p = list[i] as Placement;
    const t = tileAt(p.x, p.z);
    const e = by.get(t.key);
    if (e) e.idx.push(i);
    else by.set(t.key, { t, idx: [i] });
  }
  return [...by.values()].map(({ t, idx }) => ({
    ...t.box,
    idx: Int32Array.from(idx),
    uni: UNSET,
  }));
}

/**
 * For a placement whose raw LOD is `b` (hidden = lods.length), the camera distances at which `lodFor`
 * returns `b` again: both of its hysteresis loops stop at once.
 */
function stayBands(lods: { maxM: number | null }[], h = LOD_HYSTERESIS) {
  const n = lods.length;
  const out: { lo: number; hi: number }[] = [];
  for (let b = 0; b <= n; b++) {
    const mb = b < n ? lods[b]?.maxM : null;
    const mp = b > 0 ? lods[b - 1]?.maxM : null;
    out.push({
      lo: mp == null ? 0 : mp * (1 - h),
      hi: b >= n || mb == null ? Number.POSITIVE_INFINITY : mb * (1 + h),
    });
  }
  return out;
}

/** Margin so float rounding in hypot can never let a tile skip when a placement would change. */
const SKIP_EPS = 1e-6;
const _box = new THREE.Box3();
const _bmin = new THREE.Vector3();
const _bmax = new THREE.Vector3();
/** Instances are at most this tall (m) for the tile frustum test. */
const TILE_TOP_M = 250;

export function createCityInstances(
  lib: AssetLibrary,
  plan: CityPlan,
  m: Manifest,
  uniforms: RoleUniforms,
  extra?: {
    kits?: Map<string, Placement[]>;
    motion?: MotionUniforms;
    /** Multiplies every kit LOD distance (maxM); archetypes are untouched. Default 1. */
    kitLodScale?: number;
  },
): CityInstances {
  const group = new THREE.Group();
  group.name = "city-instances";
  const motion = extra?.motion ?? createMotionUniforms();
  // Lit-window flicker is opt-in: only when the caller owns the motion clock (Task 8 drives uFlicker).
  const material = createRoleMaterial({
    instanced: true,
    uniforms,
    ...(extra?.motion ? { motion, flicker: true } : {}),
  });
  const kitMaterials = new Map<RoleKind, THREE.MeshStandardMaterial>();
  const kitMaterial = (asset: string) => {
    const kind = KIT_KIND[asset] ?? "static";
    let mt = kitMaterials.get(kind);
    if (!mt) {
      mt = createRoleMaterial({ instanced: true, uniforms, motion, kind });
      kitMaterials.set(kind, mt);
    }
    return mt;
  };
  const landmarkMaterials: THREE.Material[] = [];
  let landmarkMeshes = 0;

  /** The buckets of one (asset, variant) placement list; null when nothing of it can be drawn. */
  function buildKey(keyStr: string, list: Placement[], kitLodScale: number): Key | null {
    const slash = keyStr.indexOf("/");
    const asset = keyStr.slice(0, slash);
    const variant = keyStr.slice(slash + 1);
    const spec = m.assets[asset];
    const vspec = spec?.variants[variant];
    if (!spec || !vspec || list.length === 0) return null;
    const lodScale = spec.group === "kit" ? kitLodScale : 1;
    const lods =
      lodScale === 1
        ? vspec.lods
        : vspec.lods.map((l) => ({ ...l, maxM: l.maxM == null ? null : l.maxM * lodScale }));
    const key: Key = {
      list,
      lods,
      tiles: tilesOf(list),
      stay: stayBands(lods),
      cur: new Int8Array(list.length).fill(UNSET),
      raw: new Int8Array(list.length).fill(UNSET),
      resolve: [],
      buckets: [],
    };
    vspec.lods.forEach((_l, lod) => {
      const src = lib.geometry(asset, variant, lod);
      if (!src) return;
      // Own geometry object sharing the library's vertex attributes, so instance attributes stay per mesh.
      const geo = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(src.attributes)) geo.setAttribute(name, attr);
      if (src.index) geo.setIndex(src.index);
      const pal = [0, 1, 2].map(() => {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
        a.setUsage(THREE.DynamicDrawUsage);
        return a;
      });
      for (const [i, a] of pal.entries()) geo.setAttribute(`iPal${i}`, a);
      const kit = spec.group === "kit";
      const mesh = new THREE.InstancedMesh(geo, kit ? kitMaterial(asset) : material, list.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      mesh.name = `${asset}__${variant}__LOD${lod}`;
      const archetype = spec.group === "archetype";
      // Shadows: LOD0 only (archetype and kit alike). Beyond 300 m the texels are tiny at hero-mid and
      // the shadow pass re-draws every caster, so LOD1 and LOD2 never cast (budget lever, Task 6).
      mesh.castShadow = lod === 0;
      mesh.userData.lod = lod;
      mesh.receiveShadow = true;
      mesh.userData.ids = [] as string[];
      if (archetype) mesh.userData.pick = { kind: "building" };
      if (spec.decorative || kit) {
        mesh.raycast = NOOP;
        mesh.userData.decorative = true;
      }
      group.add(mesh);
      key.buckets[lod] = { mesh, pal, lod };
    });
    const avail = key.buckets.flatMap((b, i) => (b ? [i] : []));
    key.resolve = vspec.lods.map((_l, i) => {
      let best = -1;
      for (const a of avail)
        if (
          best < 0 ||
          Math.abs(a - i) < Math.abs(best - i) ||
          (Math.abs(a - i) === Math.abs(best - i) && a < best)
        )
          best = a;
      return best;
    });
    return avail.length > 0 ? key : null;
  }

  const buildKeys = (entries: Iterable<[string, Placement[]]>, kitLodScale: number) => {
    const out: Key[] = [];
    try {
      for (const [keyStr, list] of entries) {
        const key = buildKey(keyStr, list, kitLodScale);
        if (key) out.push(key);
      }
    } catch (e) {
      // Do not leave the keys built so far in the group, unowned.
      for (const key of out)
        for (const b of key.buckets)
          if (b) {
            group.remove(b.mesh);
            releaseBucket(b);
          }
      throw e;
    }
    return out;
  };

  /** The city's own placements (archetypes, and every variant in the showroom): built once. */
  const keys = buildKeys(plan.placements, extra?.kitLodScale ?? 1);
  /** The props: rebuilt by setKits, leaving `keys` alone. */
  let kitKeys = buildKeys(extra?.kits ?? [], extra?.kitLodScale ?? 1);

  for (const p of plan.landmarks) {
    const spec = m.assets[p.asset];
    const geo = lib.geometry(p.asset, p.variant, 0);
    if (!spec || !geo) continue;
    const mat = createRoleMaterial({ instanced: false, uniforms, palette: p.palette });
    landmarkMaterials.push(mat);
    if (p.depthYield) {
      // Behind coplanar surfaces: the OSM podium roof (8.71 m) wins over the slab's own podium
      // (8.7 m) where they overlap, deterministically and without moving the model.
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = LANDMARK_YIELD_OFFSET;
      mat.polygonOffsetUnits = LANDMARK_YIELD_OFFSET;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `${p.asset}__${p.variant}__LOD0`;
    mesh.position.set(p.x, 0, p.z);
    mesh.rotation.y = p.yaw;
    mesh.scale.set(p.sx, p.sy, p.sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.pick = { kind: "landmark", id: p.id };
    if (spec.decorative) {
      mesh.raycast = NOOP;
      mesh.userData.decorative = true;
    }
    group.add(mesh);
    landmarkMeshes++;
  }

  function rebuild(key: Key, b: Bucket) {
    const ids = b.mesh.userData.ids as string[];
    ids.length = 0;
    let n = 0;
    for (let i = 0; i < key.list.length; i++) {
      if (key.cur[i] !== b.lod) continue;
      const p = key.list[i] as Placement;
      b.mesh.setMatrixAt(n, compose(p, _m));
      for (let k = 0; k < 3; k++) {
        _c.set(p.palette[k] as string);
        (b.pal[k] as THREE.InstancedBufferAttribute).setXYZ(n, _c.r, _c.g, _c.b);
      }
      ids.push(p.id);
      n++;
    }
    b.mesh.count = n;
    b.mesh.visible = n > 0;
    b.mesh.instanceMatrix.needsUpdate = true;
    for (const a of b.pal) a.needsUpdate = true;
    // Raycast and frustum culling must see the new members.
    b.mesh.boundingSphere = null;
    b.mesh.boundingBox = null;
  }

  /** One key's re-bucketing for a camera position; visits only the tiles whose LOD can change. */
  function updateKey(key: Key, camera: THREE.Vector3, frustum?: THREE.Frustum) {
    let rebuilt = 0;
    const dirty = new Set<number>();
    for (const t of key.tiles) {
      const dxMin = Math.max(t.x0 - camera.x, 0, camera.x - t.x1);
      const dzMin = Math.max(t.z0 - camera.z, 0, camera.z - t.z1);
      if (t.uni !== UNSET) {
        const dxMax = Math.max(Math.abs(camera.x - t.x0), Math.abs(camera.x - t.x1));
        const dzMax = Math.max(Math.abs(camera.z - t.z0), Math.abs(camera.z - t.z1));
        const band = key.stay[t.uni < 0 ? key.lods.length : t.uni] as { lo: number; hi: number };
        const dMin = Math.hypot(dxMin, camera.y, dzMin);
        const dMax = Math.hypot(dxMax, camera.y, dzMax);
        if (dMin >= band.lo + SKIP_EPS && dMax <= band.hi - SKIP_EPS) continue;
      }
      if (
        frustum &&
        !frustum.intersectsBox(
          _box.set(_bmin.set(t.x0, -1, t.z0), _bmax.set(t.x1, TILE_TOP_M, t.z1)),
        )
      )
        continue;
      visited += t.idx.length;
      let uni = UNSET as number;
      let mixed = false;
      for (const i of t.idx) {
        const p = key.list[i] as Placement;
        const d = Math.hypot(p.x - camera.x, camera.y, p.z - camera.z);
        const rawPrev = key.raw[i] as number;
        const raw = lodFor(d, key.lods, rawPrev === UNSET ? undefined : (rawPrev as LodBucket));
        key.raw[i] = raw;
        if (uni === UNSET) uni = raw;
        else if (uni !== raw) mixed = true;
        const prev = key.cur[i] as number;
        const next = raw < 0 ? -1 : (key.resolve[raw] ?? -1);
        if (next !== prev) {
          key.cur[i] = next;
          dirty.add(prev);
          dirty.add(next);
        }
      }
      t.uni = mixed ? UNSET : uni;
    }
    for (const lod of dirty) {
      const b = key.buckets[lod];
      if (!b) continue;
      rebuild(key, b);
      rebuilt++;
    }
    return rebuilt;
  }

  /** Frees one bucket's instance buffers and wrapper geometry; the library's geometry stays. */
  function releaseBucket(b: Bucket) {
    b.mesh.dispose();
    const g = b.mesh.geometry;
    // Detach the library's shared attributes first: dispose() would delete their GPU buffers.
    for (const name of Object.keys(g.attributes))
      if (!name.startsWith("iPal")) g.deleteAttribute(name);
    g.setIndex(null);
    g.dispose();
  }

  /** Placements looped over in the current / last `update`. */
  let visited = 0;
  let lastVisited = 0;
  const farOf = () =>
    [...keys, ...kitKeys].flatMap((k) => (k.buckets[2] ? [k.buckets[2].mesh] : []));
  let far = farOf();
  /** The last camera position seen by update, so new kits can be bucketed at once. */
  let lastCamera: THREE.Vector3 | null = null;

  return {
    group,
    aoExcluded: () => far.filter((m) => m.visible),
    update(camera, frustum) {
      lastCamera = (lastCamera ?? new THREE.Vector3()).copy(camera);
      let rebuilt = 0;
      visited = 0;
      for (const key of keys) rebuilt += updateKey(key, camera, frustum);
      for (const key of kitKeys) rebuilt += updateKey(key, camera, frustum);
      lastVisited = visited;
      return rebuilt;
    },
    setKits(kits, kitLodScale = 1) {
      const old = kitKeys;
      // Forget the old kits first: if building the new ones throws, nothing may point at released buckets.
      kitKeys = [];
      far = farOf();
      for (const key of old)
        for (const b of key.buckets) {
          if (!b) continue;
          group.remove(b.mesh);
          releaseBucket(b);
        }
      kitKeys = buildKeys(kits ?? [], kitLodScale);
      far = farOf();
      visited = 0;
      if (lastCamera) for (const key of kitKeys) updateKey(key, lastCamera);
    },
    stats() {
      let instances = landmarkMeshes;
      let meshes = landmarkMeshes;
      let visibleMeshes = landmarkMeshes;
      let gpuBytes = 0; // instance buffers only; shared geometry is counted by the library
      for (const key of [...keys, ...kitKeys])
        for (const b of key.buckets) {
          if (!b) continue;
          meshes++;
          if (b.mesh.visible) visibleMeshes++;
          instances += b.mesh.count;
          gpuBytes += b.mesh.instanceMatrix.array.byteLength;
          for (const a of b.pal) gpuBytes += a.array.byteLength;
        }
      return { instances, meshes, visibleMeshes, gpuBytes, visitedPerTick: lastVisited };
    },
    dispose() {
      for (const key of [...keys, ...kitKeys]) for (const b of key.buckets) if (b) releaseBucket(b);
      material.dispose();
      for (const mt of kitMaterials.values()) mt.dispose();
      for (const mt of landmarkMaterials) mt.dispose();
      group.clear();
    },
  };
}
