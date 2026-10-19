import * as THREE from "three";

/**
 * A height table of the drawn ground along the journey corridor (D-T6 fix round 2): the triangles
 * of the ground-band meshes (land cover, city parks / water / base plane, streamed roads; markings
 * excluded) that touch the corridor, bucketed on a 2 m grid. `heightAt(x, z)` is the highest
 * band surface there (barycentric, exact: the same surface a downward raycast hits), with no
 * raycast per frame. Built once per change of the ground meshes, so play and seek plant the feet
 * on identical heights.
 */
export interface GroundIndex {
  heightAt(x: number, z: number): number | null;
  /** The band of the surface `heightAt` used (for tests and probes). */
  bandAt(x: number, z: number): string | null;
  triangles: number;
  cells: number;
  buildMs: number;
}

export const GROUND_INDEX_CELL_M = 2;
const OFF = 50_000;
const keyOf = (ix: number, iz: number) => (ix + OFF) * 200_000 + (iz + OFF);
const cellOf = (v: number) => Math.floor(v / GROUND_INDEX_CELL_M);

/** Grid cells within `radius` of any of `points` (local xz). */
export function corridorCells(points: readonly [number, number][], radius: number): Set<number> {
  const out = new Set<number>();
  const r = Math.ceil(radius / GROUND_INDEX_CELL_M);
  for (const [x, z] of points) {
    const cx = cellOf(x);
    const cz = cellOf(z);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) out.add(keyOf(cx + i, cz + j));
  }
  return out;
}

/** The ground-band meshes under `roots` (visible, tagged `userData.groundBand`, markings excluded). */
export function groundBandMeshes(roots: readonly THREE.Object3D[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const r of roots)
    r.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && o.userData.groundBand && o.userData.groundBand !== "markings") out.push(m);
    });
  return out;
}

/** One mesh's triangles that touch the corridor, cached per (mesh, geometry, corridor). */
interface MeshTris {
  geometry: string;
  corridor: ReadonlySet<number>;
  tris: number[];
  cells: number[][];
}
const meshCache = new WeakMap<THREE.Mesh, MeshTris>();

function corridorBounds(keys: readonly number[]): [number, number, number, number] {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const key of keys) {
    const ix = Math.floor(key / 200_000) - OFF;
    const iz = (key % 200_000) - OFF;
    x0 = Math.min(x0, ix);
    x1 = Math.max(x1, ix);
    z0 = Math.min(z0, iz);
    z1 = Math.max(z1, iz);
  }
  return [x0, x1, z0, z1];
}

/** The corridor triangles of one mesh (world xz), with the corridor cells each touches. */
function meshTriangles(
  m: THREE.Mesh,
  corridor: ReadonlySet<number>,
  corridorKeys: readonly number[],
  bounds: [number, number, number, number],
): MeshTris {
  const hit = meshCache.get(m);
  if (hit && hit.geometry === m.geometry.uuid && hit.corridor === corridor) return hit;
  m.updateWorldMatrix(true, false);
  const out: MeshTris = { geometry: m.geometry.uuid, corridor, tris: [], cells: [] };
  const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (pos) {
    const idx = m.geometry.getIndex();
    const n = idx ? idx.count : pos.count;
    const e = m.matrixWorld.elements;
    const identity = m.matrixWorld.equals(new THREE.Matrix4());
    const arr = pos.array as ArrayLike<number>;
    const stride = (pos as { data?: { stride: number } }).data ? 0 : pos.itemSize;
    const p = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const v = new THREE.Vector3();
    const [bx0, bx1, bz0, bz1] = bounds;
    for (let k = 0; k + 2 < n; k += 3) {
      for (let c = 0; c < 3; c++) {
        const vi = idx ? idx.getX(k + c) : k + c;
        let x: number;
        let y: number;
        let z: number;
        if (stride) {
          x = arr[vi * stride] as number;
          y = arr[vi * stride + 1] as number;
          z = arr[vi * stride + 2] as number;
        } else {
          v.fromBufferAttribute(pos, vi);
          x = v.x;
          y = v.y;
          z = v.z;
        }
        if (!identity) {
          const wx =
            (e[0] as number) * x + (e[4] as number) * y + (e[8] as number) * z + (e[12] as number);
          const wy =
            (e[1] as number) * x + (e[5] as number) * y + (e[9] as number) * z + (e[13] as number);
          const wz =
            (e[2] as number) * x + (e[6] as number) * y + (e[10] as number) * z + (e[14] as number);
          x = wx;
          y = wy;
          z = wz;
        }
        p[c * 3] = x;
        p[c * 3 + 1] = y;
        p[c * 3 + 2] = z;
      }
      const x0 = cellOf(Math.min(p[0] as number, p[3] as number, p[6] as number));
      const x1 = cellOf(Math.max(p[0] as number, p[3] as number, p[6] as number));
      const z0 = cellOf(Math.min(p[2] as number, p[5] as number, p[8] as number));
      const z1 = cellOf(Math.max(p[2] as number, p[5] as number, p[8] as number));
      if (x1 < bx0 || x0 > bx1 || z1 < bz0 || z0 > bz1) continue; // nowhere near the corridor
      const cells: number[] = [];
      if ((x1 - x0 + 1) * (z1 - z0 + 1) <= corridorKeys.length) {
        for (let ix = x0; ix <= x1; ix++)
          for (let iz = z0; iz <= z1; iz++) {
            const key = keyOf(ix, iz);
            if (corridor.has(key)) cells.push(key);
          }
      } else {
        // a huge triangle (land cover, base plane): walk the corridor instead of its bbox
        for (const key of corridorKeys) {
          const ix = Math.floor(key / 200_000) - OFF;
          const iz = (key % 200_000) - OFF;
          if (ix >= x0 && ix <= x1 && iz >= z0 && iz <= z1) cells.push(key);
        }
      }
      if (cells.length) {
        out.tris.push(...p);
        out.cells.push(cells);
      }
    }
  }
  meshCache.set(m, out);
  return out;
}

const keysCache = new WeakMap<ReadonlySet<number>, number[]>();
const boundsCache = new WeakMap<ReadonlySet<number>, [number, number, number, number]>();
function cachedKeys(c: ReadonlySet<number>): number[] {
  let k = keysCache.get(c);
  if (!k) {
    k = [...c];
    keysCache.set(c, k);
  }
  return k;
}
function cachedBounds(c: ReadonlySet<number>, keys: readonly number[]) {
  let b = boundsCache.get(c);
  if (!b) {
    b = corridorBounds(keys);
    boundsCache.set(c, b);
  }
  return b;
}

export function buildGroundIndex(
  meshes: readonly THREE.Mesh[],
  corridor: ReadonlySet<number>,
): GroundIndex {
  const t0 = performance.now();
  const tris: number[] = []; // x0 y0 z0 x1 y1 z1 x2 y2 z2 per triangle
  const bands: string[] = [];
  const buckets = new Map<number, number[]>();
  const corridorKeys = cachedKeys(corridor);
  const bounds = cachedBounds(corridor, corridorKeys);
  for (const m of meshes) {
    const mt = meshTriangles(m, corridor, corridorKeys, bounds);
    const band = m.userData.groundBand as string;
    for (let i = 0; i < mt.cells.length; i++) {
      const id = bands.length;
      bands.push(band);
      for (let k = 0; k < 9; k++) tris.push(mt.tris[i * 9 + k] as number);
      for (const key of mt.cells[i] as number[]) {
        const b = buckets.get(key);
        if (b) b.push(id);
        else buckets.set(key, [id]);
      }
    }
  }
  const T = Float64Array.from(tris);
  const surface = (x: number, z: number): { y: number; band: string } | null => {
    const b = buckets.get(keyOf(cellOf(x), cellOf(z)));
    if (!b) return null;
    let best: { y: number; band: string } | null = null;
    for (const i of b) {
      const o = i * 9;
      const ax = T[o] as number;
      const az = T[o + 2] as number;
      const bx = T[o + 3] as number;
      const bz = T[o + 5] as number;
      const cx = T[o + 6] as number;
      const cz = T[o + 8] as number;
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const w2 = 1 - w0 - w1;
      const e = -1e-9;
      if (w0 < e || w1 < e || w2 < e) continue;
      const y = w0 * (T[o + 1] as number) + w1 * (T[o + 4] as number) + w2 * (T[o + 7] as number);
      if (!best || y > best.y) best = { y, band: bands[i] as string };
    }
    return best;
  };
  return {
    heightAt: (x, z) => {
      const s = surface(x, z);
      return s ? Math.max(0, s.y) : null;
    },
    bandAt: (x, z) => surface(x, z)?.band ?? null,
    triangles: bands.length,
    cells: buckets.size,
    buildMs: performance.now() - t0,
  };
}
