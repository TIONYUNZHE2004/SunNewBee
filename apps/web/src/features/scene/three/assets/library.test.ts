import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeGlb } from "../../../../test/glbFixture";
import { loadAssetLibrary } from "./library";
import type { AssetSpec, Manifest } from "./manifest";

const spec = (id: string, lods: string[]): AssetSpec => ({
  group: "archetype",
  file: `${id}.glb`,
  bytes: 1,
  repeat: "none",
  frontage: "short",
  fit: { xz: [0.75, 1.35], y: [0.6, 1.6] },
  decorative: false,
  placement: null,
  jitter: {},
  variantByGroup: {},
  palettes: {},
  variants: {
    v: { size: [1, 1, 1], lods: lods.map((node) => ({ node, tris: 1, maxM: null })) },
  },
});
const manifest = (): Manifest => ({
  version: 1,
  as_of: "x",
  precinctGroups: [],
  assets: { a: spec("a", ["a__v__LOD0", "a__v__LOD1"]), b: spec("b", ["b__v__LOD0"]) },
  landmarks: {},
});
const glbs: Record<string, () => ArrayBuffer> = {
  "/city/a.glb": () =>
    makeGlb([{ name: "a__v__LOD0", translation: [10, 0, 0] }, { name: "a__v__LOD1" }]),
  "/city/b.glb": () => makeGlb([{ name: "b__v__LOD0" }]),
};
const loadGlb = async (url: string) => (glbs[url] as () => ArrayBuffer)();

afterEach(() => vi.restoreAllMocks());

describe("loadAssetLibrary", () => {
  it("exposes position, normal and color", async () => {
    const lib = await loadAssetLibrary(manifest(), { loadGlb });
    const g = lib.geometry("a", "v", 0);
    expect(g?.getAttribute("position")).toBeDefined();
    expect(g?.getAttribute("normal")).toBeDefined();
    expect(g?.getAttribute("color")).toBeDefined();
  });
  it("bakes the node translation", async () => {
    const lib = await loadAssetLibrary(manifest(), { loadGlb });
    const g = lib.geometry("a", "v", 0) as THREE.BufferGeometry;
    g.computeBoundingBox();
    expect(g.boundingBox?.min.x).toBeCloseTo(10);
  });
  it("returns null for a missing LOD, variant or asset", async () => {
    const lib = await loadAssetLibrary(manifest(), { loadGlb });
    expect(lib.geometry("b", "v", 1)).toBeNull();
    expect(lib.geometry("b", "zz", 0)).toBeNull();
    expect(lib.geometry("nope", "v", 0)).toBeNull();
  });
  it("drops only the asset whose glb fails and lists it in `failed`, without warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lib = await loadAssetLibrary(manifest(), {
      loadGlb: (u) => (u.endsWith("a.glb") ? Promise.reject(new Error("404")) : loadGlb(u)),
    });
    expect(lib.has("a")).toBe(false);
    expect(lib.has("b")).toBe(true);
    expect(lib.failed).toEqual([{ asset: "a", reason: "Error: 404" }]);
    // The caller aggregates failures into one warning per load (ThreeScene).
    expect(warn).not.toHaveBeenCalled();
  });
  it("a glb without a manifest variant's LOD0 node is not loaded and lands in `failed`", async () => {
    const m = manifest();
    m.assets.a!.variants.w = {
      size: [1, 1, 1],
      lods: [{ node: "a__w__LOD0", tris: 1, maxM: null }],
    };
    const lib = await loadAssetLibrary(m, { loadGlb });
    expect(lib.has("a")).toBe(false);
    expect(lib.has("b")).toBe(true);
    expect(lib.failed).toEqual([{ asset: "a", reason: "Error: glb has no node a__w__LOD0" }]);
    // Its baked geometry is released at once, not kept until dispose().
    expect(lib.geometry("a", "v", 0)).toBeNull();
  });
  it("a glb missing only a coarser LOD stays loaded (cityInstances falls back to LOD0)", async () => {
    const m = manifest();
    m.assets.b!.variants.v!.lods.push({ node: "b__v__LOD1", tris: 1, maxM: null });
    const lib = await loadAssetLibrary(m, { loadGlb });
    expect(lib.has("b")).toBe(true);
    expect(lib.failed).toEqual([]);
  });
  it("failed is empty when every glb loads", async () => {
    const lib = await loadAssetLibrary(manifest(), { loadGlb });
    expect(lib.failed).toEqual([]);
  });
  it("gpuBytes sums attribute byte lengths", async () => {
    const lib = await loadAssetLibrary(manifest(), { loadGlb });
    let sum = 0;
    for (const [id, lod] of [
      ["a", 0],
      ["a", 1],
      ["b", 0],
    ] as const) {
      const g = lib.geometry(id, "v", lod) as THREE.BufferGeometry;
      for (const n of ["position", "normal", "color"])
        sum += (g.getAttribute(n) as THREE.BufferAttribute).array.byteLength;
      sum += g.index?.array.byteLength ?? 0;
    }
    expect(lib.gpuBytes()).toBe(sum);
    expect(sum).toBeGreaterThan(0);
  });
  it("rejects with AbortError and disposes when aborted", async () => {
    const dispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const ac = new AbortController();
    const p = loadAssetLibrary(manifest(), {
      signal: ac.signal,
      loadGlb: async (u) => {
        const b = await loadGlb(u);
        ac.abort();
        return b;
      },
    });
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(dispose).toHaveBeenCalled();
  });
  it("dispose() disposes every geometry once", async () => {
    const lib = await loadAssetLibrary(manifest(), { loadGlb });
    const dispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    lib.dispose();
    lib.dispose();
    expect(dispose).toHaveBeenCalledTimes(3);
  });
});
