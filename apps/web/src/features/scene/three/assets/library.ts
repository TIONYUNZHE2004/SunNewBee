import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Manifest } from "./manifest";

export interface AssetLibrary {
  /** World-baked geometry of one LOD node (one primitive), shared, do not dispose. null when absent. */
  geometry(asset: string, variant: string, lod: number): THREE.BufferGeometry | null;
  has(asset: string): boolean;
  /**
   * Assets whose glb failed to load or parse, or lacks a manifest variant's LOD0 node (dropped).
   * The caller reports them, once per load.
   */
  readonly failed: readonly { asset: string; reason: string }[];
  /** Sum of attribute and index byteLength. */
  gpuBytes(): number;
  dispose(): void;
}

interface Opts {
  base?: string;
  assets?: string[];
  loadGlb?: (url: string) => Promise<ArrayBuffer>;
  signal?: AbortSignal;
}

const abortError = () => new DOMException("Asset load aborted", "AbortError");

/** Float32 copy, de-normalising quantised attributes so a matrix bake cannot clamp them. */
function toFloat32(
  a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): THREE.BufferAttribute {
  const out = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++) {
    out[i * a.itemSize] = a.getX(i);
    out[i * a.itemSize + 1] = a.getY(i);
    out[i * a.itemSize + 2] = a.getZ(i);
  }
  return new THREE.BufferAttribute(out, a.itemSize);
}

function bakeNode(mesh: THREE.Mesh): THREE.BufferGeometry | null {
  const src = mesh.geometry;
  const pos = src.getAttribute("position");
  if (!pos) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", toFloat32(pos));
  const nrm = src.getAttribute("normal");
  if (nrm) g.setAttribute("normal", toFloat32(nrm));
  const col = src.getAttribute("color");
  // Keep colour exactly as stored (normalized uint8/uint16 or float).
  if (col && !(col instanceof THREE.InterleavedBufferAttribute))
    g.setAttribute("color", col.clone());
  else if (col) {
    const c = new Float32Array(col.count * col.itemSize);
    for (let i = 0; i < col.count; i++)
      for (let k = 0; k < col.itemSize; k++) c[i * col.itemSize + k] = col.getComponent(i, k);
    g.setAttribute("color", new THREE.BufferAttribute(c, col.itemSize));
  }
  if (src.index) g.setIndex(src.index.clone());
  g.applyMatrix4(mesh.matrixWorld);
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  return g;
}

export async function loadAssetLibrary(m: Manifest, opts: Opts = {}): Promise<AssetLibrary> {
  const base = opts.base ?? "/city/";
  const loadGlb =
    opts.loadGlb ??
    (async (url: string) => {
      const r = await fetch(url, { signal: opts.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    });
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  const nodes = new Map<string, THREE.BufferGeometry>(); // by node name
  const loaded = new Set<string>();
  const failed: { asset: string; reason: string }[] = [];
  const all: THREE.BufferGeometry[] = [];
  const disposeAll = () => {
    for (const g of all) g.dispose();
    all.length = 0;
    nodes.clear();
    loaded.clear();
  };

  const ids = Object.keys(m.assets).filter((id) => !opts.assets || opts.assets.includes(id));
  await Promise.all(
    ids.map(async (id) => {
      const spec = m.assets[id];
      if (!spec || opts.signal?.aborted) return;
      try {
        const buf = await loadGlb(`${base}${spec.file}`);
        const gltf = await loader.parseAsync(buf, "");
        gltf.scene.updateMatrixWorld(true);
        const found = new Map<string, THREE.BufferGeometry>();
        gltf.scene.traverse((o) => {
          if (!(o as THREE.Mesh).isMesh) return;
          const g = bakeNode(o as THREE.Mesh);
          if (g) {
            found.set(o.name, g);
            all.push(g);
          }
        });
        // Loaded only if every manifest variant has its LOD0 node: planCity places any variant of
        // a loaded asset, and createCityInstances draws a variant only with some LOD geometry
        // (landmarks only with LOD0). Requiring LOD0 covers both, so a placed building is never
        // drawn by nothing (Review Focus 2); a missing coarser LOD falls back to the nearest one.
        const missing = Object.values(spec.variants)
          .map((v) => v.lods[0]?.node)
          .find((node) => !node || !found.has(node));
        if (missing !== undefined) {
          for (const g of found.values()) {
            g.dispose();
            all.splice(all.indexOf(g), 1);
          }
          throw new Error(`glb has no node ${missing}`);
        }
        for (const [name, g] of found) nodes.set(`${id}/${name}`, g);
        loaded.add(id);
      } catch (e) {
        if (opts.signal?.aborted) return;
        failed.push({ asset: id, reason: String(e) });
      }
    }),
  );

  if (opts.signal?.aborted) {
    disposeAll();
    throw abortError();
  }

  let disposed = false;
  return {
    geometry(asset, variant, lod) {
      const node = m.assets[asset]?.variants[variant]?.lods[lod]?.node;
      return node ? (nodes.get(`${asset}/${node}`) ?? null) : null;
    },
    has: (asset) => loaded.has(asset),
    failed,
    gpuBytes() {
      let n = 0;
      for (const g of all) {
        for (const a of Object.values(g.attributes))
          n += (a as THREE.BufferAttribute).array.byteLength;
        n += g.index?.array.byteLength ?? 0;
      }
      return n;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeAll();
    },
  };
}
