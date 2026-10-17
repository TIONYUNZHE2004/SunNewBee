import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildingIdOf, createCityInstances, lodFor } from "./cityInstances";
import type { Placement } from "./fit";
import type { AssetLibrary } from "./library";
import type { Manifest } from "./manifest";
import type { CityPlan } from "./plan";
import { createRoleUniforms } from "./roleMaterial";

const L = [{ maxM: 300 }, { maxM: 1500 }, { maxM: null }];

describe("lodFor", () => {
  it("hysteresis", () => {
    expect(lodFor(299, L, undefined)).toBe(0);
    expect(lodFor(320, L, 0)).toBe(0);
    expect(lodFor(331, L, 0)).toBe(1);
    expect(lodFor(280, L, 1)).toBe(1);
    expect(lodFor(269, L, 1)).toBe(0);
    expect(lodFor(5000, L, 1)).toBe(2);
  });
  it("kit beyond last maxM is hidden", () => {
    const kit = [{ maxM: 80 }, { maxM: 300 }];
    expect(lodFor(400, kit, undefined)).toBe(-1);
    expect(lodFor(310, kit, 1)).toBe(1);
    expect(lodFor(400, kit, 1)).toBe(-1);
    expect(lodFor(290, kit, -1)).toBe(-1);
    expect(lodFor(260, kit, -1)).toBe(1);
  });
});

const lods = [
  { node: "a__v__LOD0", tris: 12, maxM: 300 },
  { node: "a__v__LOD1", tris: 12, maxM: 1500 },
  { node: "a__v__LOD2", tris: 12, maxM: null },
];
const spec = (group: "archetype" | "kit" | "landmark", decorative: boolean) => ({
  group,
  file: "x.glb",
  bytes: 1,
  repeat: "none" as const,
  frontage: "long" as const,
  fit: { xz: [0.5, 2], y: [0.5, 2] } as { xz: [number, number]; y: [number, number] },
  decorative,
  placement: null,
  jitter: {},
  variantByGroup: {},
  palettes: {},
  variants: { v: { size: [4, 4, 4] as [number, number, number], lods } },
});
const manifest = (): Manifest => ({
  version: 1,
  as_of: "",
  precinctGroups: [],
  assets: { a: spec("archetype", false), k: spec("kit", true), lm: spec("landmark", false) },
  landmarks: {},
});
const box = () => {
  const g = new THREE.BoxGeometry(4, 4, 4);
  g.translate(0, 2, 0);
  return g;
};
const lib = (): AssetLibrary => {
  const geos = new Map<string, THREE.BufferGeometry>();
  return {
    geometry(a, v, l) {
      const k = `${a}/${v}/${l}`;
      if (!geos.has(k)) geos.set(k, box());
      return geos.get(k) ?? null;
    },
    has: () => true,
    gpuBytes: () => 0,
    failed: [],
    dispose() {},
  };
};
const pl = (asset: string, i: number): Placement => ({
  id: `${asset}${i}`,
  asset,
  variant: "v",
  x: i * 200,
  z: 0,
  yaw: 0,
  sx: 1,
  sy: 1,
  sz: 1,
  palette: [`#${(i + 1).toString(16).padStart(2, "0")}0000`, "#00ff00", "#0000ff"],
});
const plan = (asset: string, landmarks: Placement[] = []): CityPlan => ({
  placements: new Map([[`${asset}/v`, Array.from({ length: 10 }, (_, i) => pl(asset, i))]]),
  extrude: new Set(),
  landmarks,
  stats: { placed: 10, units: 10, fallback: {} },
});
const meshesOf = (c: ReturnType<typeof createCityInstances>) =>
  c.group.children as THREE.InstancedMesh[];

describe("createCityInstances", () => {
  it("buckets by distance and rebuilds only on change", () => {
    const c = createCityInstances(lib(), plan("a"), manifest(), createRoleUniforms());
    const cam = new THREE.Vector3(0, 0, 0);
    expect(c.update(cam)).toBeGreaterThan(0);
    const [m0, m1, m2] = meshesOf(c);
    expect([m0?.count, m1?.count, m2?.count]).toEqual([2, 6, 2]);
    expect(c.update(cam)).toBe(0);
    expect(c.update(cam.set(1, 0, 0))).toBe(0);
    const s = c.stats();
    expect(s.meshes).toBe(3);
    expect(s.visibleMeshes).toBe(3);
    expect(s.instances).toBe(10);
  });

  it("empty buckets are hidden", () => {
    const c = createCityInstances(lib(), plan("a"), manifest(), createRoleUniforms());
    c.update(new THREE.Vector3(100000, 0, 0));
    expect(c.stats().visibleMeshes).toBe(1);
    expect(meshesOf(c)[0]?.visible).toBe(false);
  });

  it("writes per-instance palettes", () => {
    const c = createCityInstances(lib(), plan("a"), manifest(), createRoleUniforms());
    c.update(new THREE.Vector3());
    const m0 = meshesOf(c)[0] as THREE.InstancedMesh;
    const a = m0.geometry.getAttribute("iPal0") as THREE.BufferAttribute;
    const expected = new THREE.Color("#020000"); // placement 1
    expect(a.getX(1)).toBeCloseTo(expected.r, 5);
    expect(a.getY(1)).toBeCloseTo(0, 5);
    const a1 = m0.geometry.getAttribute("iPal1") as THREE.BufferAttribute;
    expect(a1.getY(0)).toBeCloseTo(new THREE.Color("#00ff00").g, 5);
  });

  it("kits are decorative and unpickable; archetypes pick by id", () => {
    const kit = createCityInstances(lib(), plan("k"), manifest(), createRoleUniforms());
    kit.update(new THREE.Vector3());
    const km = meshesOf(kit)[0] as THREE.InstancedMesh;
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(km)).toEqual([]);
    expect(km.userData.decorative).toBe(true);
    expect(km.castShadow).toBe(true);
    expect(meshesOf(kit)[1]?.castShadow).toBe(false);

    const arch = createCityInstances(lib(), plan("a"), manifest(), createRoleUniforms());
    arch.update(new THREE.Vector3());
    const am = meshesOf(arch)[0] as THREE.InstancedMesh;
    am.updateMatrixWorld(true);
    const hits = ray.intersectObject(am);
    expect(hits.length).toBeGreaterThan(0);
    const id = am.userData.ids[hits[0]?.instanceId ?? -1];
    expect(id).toBe("a0");
    expect(am.userData.pick).toEqual({ kind: "building" });
    expect(am.castShadow && am.receiveShadow).toBe(true);
  });

  it("shadows: kits cast at LOD0 only, archetypes at LOD0 and LOD1, never at LOD2; landmarks cast", () => {
    const cast = (asset: string) =>
      meshesOf(createCityInstances(lib(), plan(asset), manifest(), createRoleUniforms())).map(
        (m) => m.castShadow,
      );
    expect(cast("k")).toEqual([true, false, false]);
    expect(cast("a")).toEqual([true, true, false]);
    const c = createCityInstances(
      lib(),
      plan("a", [pl("lm", 0)]),
      manifest(),
      createRoleUniforms(),
    );
    const lm = c.group.children.find((o) => o.userData.pick?.kind === "landmark") as THREE.Mesh;
    expect(lm.castShadow).toBe(true);
    for (const m of c.group.children) expect(m.receiveShadow).toBe(true);
  });

  it("aoExcluded lists the LOD2 meshes only (left out of the GTAO normal pass)", () => {
    const c = createCityInstances(lib(), plan("a"), manifest(), createRoleUniforms());
    const [m0, m1, m2] = meshesOf(c);
    expect(c.aoExcluded()).toEqual([]); // nothing visible before the first update
    c.update(new THREE.Vector3());
    expect(c.aoExcluded()).toEqual([m2]);
    expect(c.aoExcluded()).not.toContain(m0);
    expect(c.aoExcluded()).not.toContain(m1);
  });

  it("buildingIdOf maps a unit id back to its building id", () => {
    expect(buildingIdOf("way/42#3")).toBe("way/42");
    expect(buildingIdOf("way/42")).toBe("way/42");
    expect(buildingIdOf("a#b")).toBe("a#b");
    expect(buildingIdOf("a#1#12")).toBe("a#1");
  });

  it("adds landmark meshes with a pick payload", () => {
    const lm = pl("lm", 0);
    const c = createCityInstances(lib(), plan("a", [lm]), manifest(), createRoleUniforms());
    const mesh = c.group.children.find((o) => o.userData.pick?.kind === "landmark");
    expect(mesh).toBeDefined();
    expect(mesh?.userData.pick.id).toBe("lm0");
  });

  it("gpuBytes counts instance buffers; dispose leaves library geometry", () => {
    const l = lib();
    const g = l.geometry("a", "v", 0) as THREE.BufferGeometry;
    let geoDisposed = false;
    g.addEventListener("dispose", () => {
      geoDisposed = true;
    });
    const c = createCityInstances(l, plan("a"), manifest(), createRoleUniforms());
    expect(c.stats().gpuBytes).toBeGreaterThanOrEqual(3 * 10 * (16 + 3 * 3) * 4);
    let disposed = 0;
    for (const m of meshesOf(c)) m.addEventListener("dispose", () => disposed++);
    c.dispose();
    expect(disposed).toBe(3);
    expect(geoDisposed).toBe(false);
  });

  it("dispose detaches shared attributes so a second city from the same library is intact", () => {
    const l = lib();
    const g = l.geometry("a", "v", 0) as THREE.BufferGeometry;
    const pos = g.getAttribute("position");
    const c1 = createCityInstances(l, plan("a"), manifest(), createRoleUniforms());
    const wrapper = meshesOf(c1)[0]?.geometry as THREE.BufferGeometry;
    expect(wrapper.getAttribute("position")).toBe(pos);
    c1.dispose();
    expect(wrapper.getAttribute("position")).toBeUndefined();
    expect(wrapper.index).toBeNull();
    const c2 = createCityInstances(l, plan("a"), manifest(), createRoleUniforms());
    const w2 = meshesOf(c2)[0]?.geometry as THREE.BufferGeometry;
    expect(w2.getAttribute("position")).toBe(pos);
    expect(g.getAttribute("position")).toBe(pos);
    expect(g.index).not.toBeNull();
  });

  it("a missing LOD geometry falls back to the nearest available LOD", () => {
    const base = lib();
    const holey: AssetLibrary = {
      ...base,
      geometry: (a, v, lod) => (lod === 0 ? null : base.geometry(a, v, lod)),
    };
    const c = createCityInstances(holey, plan("a"), manifest(), createRoleUniforms());
    c.update(new THREE.Vector3());
    const ms = meshesOf(c);
    expect(ms.length).toBe(2); // LOD1 and LOD2 only
    expect(ms[0]?.count).toBe(8); // near (2) + mid (6) both draw LOD1
    expect(ms[1]?.count).toBe(2);
    expect(c.stats().instances).toBe(10);
  });
});
