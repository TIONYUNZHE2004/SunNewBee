import * as THREE from "three";
import {
  type ModelBox,
  type ModelBoxOf,
  type ModelCell,
  type ModelCellsOf,
  rasterTops,
} from "../clearance";
import type { AssetLibrary } from "./library";
import type { Manifest } from "./manifest";

/**
 * Drawn model bounds per asset/variant, over every LOD the manifest lists (memoised): the clearance
 * boxes follow the geometry actually drawn, not the manifest size.
 */
export function modelBoxesOf(lib: AssetLibrary, m: Manifest): ModelBoxOf {
  const memo = new Map<string, ModelBox | null>();
  return (asset, variant) => {
    const key = `${asset}/${variant}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const lods = m.assets[asset]?.variants[variant]?.lods.length ?? 1;
    const box = new THREE.Box3();
    for (let i = 0; i < Math.max(1, lods); i++) {
      const pos = lib.geometry(asset, variant, i)?.getAttribute("position");
      if (pos) box.union(new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute));
    }
    const out = box.isEmpty()
      ? null
      : { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, maxY: box.max.y };
    memo.set(key, out);
    return out;
  };
}

/** Landmarks' drawn mass from their LOD0 geometry (`rasterTops`), memoised per model. */
export function modelCellsOf(lib: AssetLibrary): ModelCellsOf {
  const memo = new Map<string, ModelCell[] | null>();
  return (asset, variant) => {
    const key = `${asset}/${variant}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const g = lib.geometry(asset, variant, 0);
    const pos = g?.getAttribute("position");
    const out = pos
      ? rasterTops(
          pos.array as ArrayLike<number>,
          g?.index ? (g.index.array as ArrayLike<number>) : null,
        )
      : null;
    const cells = out && out.length > 0 ? out : null;
    memo.set(key, cells);
    return cells;
  };
}
