import * as THREE from "three";

/** Archetype role index of foliage in COLOR_0.g (decoded floor(g * 7 + 0.5)). */
const FOLIAGE_ROLE = 6;
const KEY_SCALE = 1000; // weld positions to a millimetre
/** A lobe is roughly round: its thinnest extent is at least this share of its longest. */
const MIN_ROUNDNESS = 0.3;
/** Near lobes (the baked ~100-triangle ellipsoids) become 10 x 7 spheres; far ones keep 6 x 4 / 8 x 3. */
const NEAR_LOBE_TRIS = 80;
const MIN_LOBE_TRIS = 12;
export const NEAR_LOBE_SEGS: [number, number] = [10, 7];
const FAR_LOBE_SEGS: [number, number][] = [
  [6, 4],
  [8, 3],
];
const sphereTris = (s: [number, number]) => 2 * s[0] * (s[1] - 1);

export interface CanopyResult {
  geometry: THREE.BufferGeometry;
  lobes: number;
  trisBefore: number;
  trisAfter: number;
}

interface Comp {
  tris: number[];
  edges: Map<number, number>;
  lo: [number, number, number];
  hi: [number, number, number];
  verts: Set<number>;
}

/**
 * B-T3 (AC-B3 trees): rebuilds the faceted canopy lobes of a tree-kit geometry as clustered smooth
 * clay spheres (the prototype's look). Foliage-role triangles are welded by position and grouped
 * into connected components; a component that is a closed, roughly round surface is a lobe and is
 * replaced by a low-segment SphereGeometry fitted to its bounding ellipsoid (same centre and
 * extents, so the silhouette box, height and ground clearance are unchanged). Each new vertex
 * takes COLOR_0 from the nearest original vertex (role, baked AO, sway), so instance colour and
 * the clay tokens keep working. Open sheets (palm fronds), trunks and flowers are kept. Display
 * only. Returns the input unchanged (no lobes) when the geometry lacks position/normal/color.
 */
export function roundCanopies(g: THREE.BufferGeometry): CanopyResult {
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  const col = g.getAttribute("color");
  const n = pos?.count ?? 0;
  const triCount = (g.index ? g.index.count : n) / 3;
  const same: CanopyResult = { geometry: g, lobes: 0, trisBefore: triCount, trisAfter: triCount };
  if (!pos || !nrm || !col || col.itemSize < 4) return same;
  const vi = (t: number, k: number) => (g.index ? g.index.getX(t * 3 + k) : t * 3 + k);

  // Weld ids for foliage vertices.
  const weld = new Map<string, number>();
  const wid = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (Math.round(col.getY(i) * 7) !== FOLIAGE_ROLE) continue;
    const k = `${Math.round(pos.getX(i) * KEY_SCALE)},${Math.round(pos.getY(i) * KEY_SCALE)},${Math.round(pos.getZ(i) * KEY_SCALE)}`;
    let w = weld.get(k);
    if (w === undefined) {
      w = weld.size;
      weld.set(k, w);
    }
    wid[i] = w;
  }
  const nW = weld.size + 1;
  const parent = Array.from({ length: nW }, (_, i) => i);
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[a] !== r) {
      const next = parent[a]!;
      parent[a] = r;
      a = next;
    }
    return r;
  };
  const foliageTri = new Uint8Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const a = wid[vi(t, 0)]!;
    const b = wid[vi(t, 1)]!;
    const c = wid[vi(t, 2)]!;
    if (a < 0 || b < 0 || c < 0 || a === b || b === c || a === c) continue;
    foliageTri[t] = 1;
    parent[find(a)] = find(b);
    parent[find(b)] = find(c);
  }
  const comps = new Map<number, Comp>();
  for (let t = 0; t < triCount; t++) {
    if (!foliageTri[t]) continue;
    const root = find(wid[vi(t, 0)]!);
    let c = comps.get(root);
    if (!c) {
      c = {
        tris: [],
        edges: new Map(),
        lo: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
        hi: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
        verts: new Set(),
      };
      comps.set(root, c);
    }
    c.tris.push(t);
    for (let k = 0; k < 3; k++) {
      const v = vi(t, k);
      c.verts.add(v);
      const p = [pos.getX(v), pos.getY(v), pos.getZ(v)];
      for (let a = 0; a < 3; a++) {
        c.lo[a] = Math.min(c.lo[a]!, p[a]!);
        c.hi[a] = Math.max(c.hi[a]!, p[a]!);
      }
      const e0 = wid[v]!;
      const e1 = wid[vi(t, (k + 1) % 3)]!;
      const key = Math.min(e0, e1) * nW + Math.max(e0, e1);
      c.edges.set(key, (c.edges.get(key) ?? 0) + 1);
    }
  }
  const lobes: Comp[] = [];
  for (const c of comps.values()) {
    if (c.tris.length < MIN_LOBE_TRIS) continue;
    const ext = [0, 1, 2].map((a) => c.hi[a]! - c.lo[a]!);
    if (Math.min(...ext) <= 0 || Math.min(...ext) < MIN_ROUNDNESS * Math.max(...ext)) continue;
    if ([...c.edges.values()].every((cnt) => cnt === 2)) lobes.push(c);
  }
  if (lobes.length === 0) return same;

  const drop = new Set<number>();
  for (const c of lobes) for (const t of c.tris) drop.add(t);

  const outPos: number[] = [];
  const outNrm: number[] = [];
  const outCol: number[] = [];
  const outIdx: number[] = [];
  const kept = new Map<number, number>();
  const take = (v: number): number => {
    let o = kept.get(v);
    if (o === undefined) {
      o = outPos.length / 3;
      kept.set(v, o);
      outPos.push(pos.getX(v), pos.getY(v), pos.getZ(v));
      outNrm.push(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
      outCol.push(col.getX(v), col.getY(v), col.getZ(v), col.getW(v));
    }
    return o;
  };
  for (let t = 0; t < triCount; t++) {
    if (drop.has(t)) continue;
    outIdx.push(take(vi(t, 0)), take(vi(t, 1)), take(vi(t, 2)));
  }

  for (const c of lobes) {
    const segs: [number, number] =
      c.tris.length >= NEAR_LOBE_TRIS
        ? NEAR_LOBE_SEGS
        : FAR_LOBE_SEGS.reduce((best, s) =>
            Math.abs(sphereTris(s) - c.tris.length) < Math.abs(sphereTris(best) - c.tris.length)
              ? s
              : best,
          );
    const s = new THREE.SphereGeometry(1, segs[0], segs[1]);
    const r = [0, 1, 2].map((a) => (c.hi[a]! - c.lo[a]!) / 2);
    const ctr = [0, 1, 2].map((a) => (c.hi[a]! + c.lo[a]!) / 2);
    const sp = s.getAttribute("position");
    const base = outPos.length / 3;
    const src = [...c.verts];
    for (let i = 0; i < sp.count; i++) {
      const ux = sp.getX(i);
      const uy = sp.getY(i);
      const uz = sp.getZ(i);
      const x = ctr[0]! + ux * r[0]!;
      const y = ctr[1]! + uy * r[1]!;
      const z = ctr[2]! + uz * r[2]!;
      outPos.push(x, y, z);
      // Ellipsoid normal: the unit-sphere point over the squared radii.
      const nx = ux / r[0]!;
      const ny = uy / r[1]!;
      const nz = uz / r[2]!;
      const l = Math.hypot(nx, ny, nz) || 1;
      outNrm.push(nx / l, ny / l, nz / l);
      let best = src[0]!;
      let bd = Number.POSITIVE_INFINITY;
      for (const v of src) {
        const d = (pos.getX(v) - x) ** 2 + (pos.getY(v) - y) ** 2 + (pos.getZ(v) - z) ** 2;
        if (d < bd) {
          bd = d;
          best = v;
        }
      }
      outCol.push(col.getX(best), col.getY(best), col.getZ(best), col.getW(best));
    }
    const idx = s.index!;
    for (let i = 0; i < idx.count; i++) outIdx.push(base + idx.getX(i));
    s.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(outPos), 3));
  out.setAttribute("normal", new THREE.BufferAttribute(Float32Array.from(outNrm), 3));
  const Arr = col.array.constructor as new (n: number) => THREE.TypedArray;
  const ca = new THREE.BufferAttribute(new Arr(outCol.length), 4, col.normalized);
  for (let i = 0; i < outCol.length / 4; i++)
    ca.setXYZW(i, outCol[i * 4]!, outCol[i * 4 + 1]!, outCol[i * 4 + 2]!, outCol[i * 4 + 3]!);
  out.setAttribute("color", ca);
  out.setIndex(
    outPos.length / 3 > 65535
      ? new THREE.Uint32BufferAttribute(outIdx, 1)
      : new THREE.Uint16BufferAttribute(outIdx, 1),
  );
  return { geometry: out, lobes: lobes.length, trisBefore: triCount, trisAfter: outIdx.length / 3 };
}
