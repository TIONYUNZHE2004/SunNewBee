import * as THREE from "three";
import type { Placement } from "./fit";
import type { AssetLibrary } from "./library";
import type { Manifest } from "./manifest";
import type { CityPlan } from "./plan";
import { createRoleMaterial, type RoleUniforms } from "./roleMaterial";

export type LodBucket = 0 | 1 | 2 | -1;

/** LOD for a distance with hysteresis: out needs d > maxM*(1+h), back in needs d < maxM*(1-h). -1 = hidden. */
export function lodFor(
  d: number,
  lods: { maxM: number | null }[],
  prev: LodBucket | undefined,
  h = 0.1,
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

export interface CityInstances {
  group: THREE.Group;
  /** Re-bucket by camera position; rebuilds only the InstancedMeshes whose membership changed. Returns how many. */
  update(camera: THREE.Vector3): number;
  stats(): { instances: number; meshes: number; visibleMeshes: number; gpuBytes: number };
  dispose(): void;
}

interface Bucket {
  mesh: THREE.InstancedMesh;
  pal: THREE.InstancedBufferAttribute[];
  lod: number;
}
interface Key {
  list: Placement[];
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

export function createCityInstances(
  lib: AssetLibrary,
  plan: CityPlan,
  m: Manifest,
  uniforms: RoleUniforms,
): CityInstances {
  const group = new THREE.Group();
  group.name = "city-instances";
  const material = createRoleMaterial({ instanced: true, uniforms });
  const landmarkMaterials: THREE.Material[] = [];
  const keys: Key[] = [];
  const wrappers: THREE.BufferGeometry[] = [];
  let landmarkMeshes = 0;

  for (const [keyStr, list] of plan.placements) {
    const slash = keyStr.indexOf("/");
    const asset = keyStr.slice(0, slash);
    const variant = keyStr.slice(slash + 1);
    const spec = m.assets[asset];
    const vspec = spec?.variants[variant];
    if (!spec || !vspec || list.length === 0) continue;
    const key: Key = {
      list,
      lods: vspec.lods,
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
      wrappers.push(geo);
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      mesh.name = `${asset}__${variant}__LOD${lod}`;
      const archetype = spec.group === "archetype";
      mesh.castShadow = archetype || lod === 0;
      mesh.receiveShadow = true;
      mesh.userData.ids = [] as string[];
      if (archetype) mesh.userData.pick = { kind: "building" };
      if (spec.decorative) {
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
    if (avail.length > 0) keys.push(key);
  }

  for (const p of plan.landmarks) {
    const spec = m.assets[p.asset];
    const geo = lib.geometry(p.asset, p.variant, 0);
    if (!spec || !geo) continue;
    const mat = createRoleMaterial({ instanced: false, uniforms, palette: p.palette });
    landmarkMaterials.push(mat);
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

  return {
    group,
    update(camera) {
      let rebuilt = 0;
      for (const key of keys) {
        const dirty = new Set<number>();
        for (let i = 0; i < key.list.length; i++) {
          const p = key.list[i] as Placement;
          const d = Math.hypot(p.x - camera.x, camera.y, p.z - camera.z);
          const rawPrev = key.raw[i] as number;
          const raw = lodFor(d, key.lods, rawPrev === UNSET ? undefined : (rawPrev as LodBucket));
          key.raw[i] = raw;
          const prev = key.cur[i] as number;
          const next = raw < 0 ? -1 : (key.resolve[raw] ?? -1);
          if (next !== prev) {
            key.cur[i] = next;
            dirty.add(prev);
            dirty.add(next);
          }
        }
        for (const lod of dirty) {
          const b = key.buckets[lod];
          if (!b) continue;
          rebuild(key, b);
          rebuilt++;
        }
      }
      return rebuilt;
    },
    stats() {
      let instances = landmarkMeshes;
      let meshes = landmarkMeshes;
      let visibleMeshes = landmarkMeshes;
      let gpuBytes = 0; // instance buffers only; shared geometry is counted by the library
      for (const key of keys)
        for (const b of key.buckets) {
          if (!b) continue;
          meshes++;
          if (b.mesh.visible) visibleMeshes++;
          instances += b.mesh.count;
          gpuBytes += b.mesh.instanceMatrix.array.byteLength;
          for (const a of b.pal) gpuBytes += a.array.byteLength;
        }
      return { instances, meshes, visibleMeshes, gpuBytes };
    },
    dispose() {
      group.traverse((o) => {
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      });
      for (const g of wrappers) {
        // Detach the library's shared attributes first: dispose() would delete their GPU buffers.
        for (const name of Object.keys(g.attributes))
          if (!name.startsWith("iPal")) g.deleteAttribute(name);
        g.setIndex(null);
        g.dispose();
      }
      material.dispose();
      for (const mt of landmarkMaterials) mt.dispose();
      group.clear();
    },
  };
}
