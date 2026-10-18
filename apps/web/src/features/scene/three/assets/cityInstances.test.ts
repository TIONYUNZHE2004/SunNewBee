import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { buildingIdOf, createCityInstances, type LodBucket, lodFor } from "./cityInstances";
import type { Placement } from "./fit";
import type { AssetLibrary } from "./library";
import type { Manifest } from "./manifest";
import type { CityPlan } from "./plan";
import { createMotionUniforms, createRoleUniforms } from "./roleMaterial";

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
  assets: {
    a: spec("archetype", false),
    k: spec("kit", true),
    lm: spec("landmark", false),
    trees: spec("kit", true),
    people: spec("kit", true),
    vehicles: spec("kit", true),
  },
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

describe("createCityInstances kits", () => {
  const kits = (asset: string) => new Map([[`${asset}/v`, [pl(asset, 0), pl(asset, 1)]]]);
  const empty = (): CityPlan => ({
    placements: new Map(),
    extrude: new Set(),
    landmarks: [],
    stats: { placed: 0, units: 0, fallback: {} },
  });

  it("kit placements create decorative, unpickable buckets", () => {
    const c = createCityInstances(lib(), empty(), manifest(), createRoleUniforms(), {
      kits: kits("trees"),
      motion: createMotionUniforms(),
    });
    c.update(new THREE.Vector3());
    const ms = meshesOf(c);
    expect(ms.length).toBe(3);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
    for (const m of ms) {
      expect(m.userData.decorative).toBe(true);
      m.updateMatrixWorld(true);
      expect(ray.intersectObject(m)).toEqual([]);
    }
  });

  it("people and vehicles do not cast shadows at LOD1", () => {
    for (const a of ["people", "vehicles"]) {
      const c = createCityInstances(lib(), empty(), manifest(), createRoleUniforms(), {
        kits: kits(a),
      });
      const ms = meshesOf(c);
      expect(ms[0]?.castShadow).toBe(true);
      expect(ms[1]?.castShadow).toBe(false);
    }
  });

  it("stats().instances counts kits; distant kits drop to cheaper LODs then hide", () => {
    const m = manifest();
    const people = m.assets.people;
    if (people?.variants.v)
      people.variants.v.lods = [
        { node: "people__v__LOD0", tris: 12, maxM: 80 },
        { node: "people__v__LOD1", tris: 12, maxM: 300 },
      ];
    const c = createCityInstances(lib(), plan("a"), m, createRoleUniforms(), {
      kits: kits("people"),
    });
    c.update(new THREE.Vector3());
    expect(c.stats().instances).toBe(12);
    c.update(new THREE.Vector3(100000, 0, 0));
    expect(c.stats().instances).toBe(10); // the 10 archetypes (LOD2); both kit people are hidden
  });

  it("kit buckets use kind-specific role materials; archetypes keep the plain one", () => {
    const motion = createMotionUniforms();
    const c = createCityInstances(lib(), plan("a"), manifest(), createRoleUniforms(), {
      kits: new Map([...kits("trees"), ...kits("people")]),
      motion,
    });
    const keyOf = (name: string) =>
      (
        (meshesOf(c).find((m) => m.name.startsWith(name)) as THREE.InstancedMesh)
          .material as THREE.Material
      ).customProgramCacheKey();
    expect(new Set([keyOf("a__"), keyOf("trees__"), keyOf("people__")]).size).toBe(3);
  });
});

describe("kit LOD distance scale", () => {
  const kitsOf = (a: string) => new Map([[`${a}/v`, [pl(a, 0)]]]);
  const lodAt = (a: string, scale: number | undefined, d: number) => {
    const c = createCityInstances(lib(), plan("none"), manifest(), createRoleUniforms(), {
      kits: kitsOf(a),
      kitLodScale: scale,
    });
    c.update(new THREE.Vector3(d, 0, 0));
    return meshesOf(c).findIndex((m) => m.visible);
  };
  it("shortens kit LOD distances and leaves archetypes alone", () => {
    // unit lods are 300 / 1500 / unbounded; at 200 m a 0.5 scale puts a kit in LOD1
    expect(lodAt("k", 1, 200)).toBe(0);
    expect(lodAt("k", 0.5, 200)).toBe(1);
    expect(lodAt("k", 0.5, 800)).toBe(2);
    const arch = (scale: number) => {
      const c = createCityInstances(lib(), plan("a"), manifest(), createRoleUniforms(), {
        kitLodScale: scale,
      });
      c.update(new THREE.Vector3(200, 0, 0));
      return meshesOf(c).findIndex((m) => m.visible);
    };
    expect(arch(0.5)).toBe(arch(1));
  });
});

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

  it("shadows: kits and archetypes cast at LOD0 only; landmarks cast", () => {
    const cast = (asset: string) =>
      meshesOf(createCityInstances(lib(), plan(asset), manifest(), createRoleUniforms())).map(
        (m) => m.castShadow,
      );
    expect(cast("k")).toEqual([true, false, false]);
    expect(cast("a")).toEqual([true, false, false]);
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

  it("a depth-yielding landmark (traced outline over its OSM podium) is polygon-offset back", () => {
    const yielding = { ...pl("lm", 0), depthYield: true };
    const plain = pl("lm", 1);
    const c = createCityInstances(
      lib(),
      plan("a", [yielding, plain]),
      manifest(),
      createRoleUniforms(),
    );
    const meshes = c.group.children.filter(
      (o) => o.userData.pick?.kind === "landmark",
    ) as THREE.Mesh[];
    const mat = (id: string) =>
      meshes.find((m) => m.userData.pick.id === id)?.material as THREE.Material;
    expect(mat("lm0").polygonOffset).toBe(true);
    expect(mat("lm0").polygonOffsetFactor).toBeGreaterThan(0);
    expect(mat("lm0").polygonOffsetUnits).toBeGreaterThan(0);
    expect(mat("lm1").polygonOffset).toBe(false);
    // the drawn position is untouched (the card's OSM height is never changed either)
    expect(meshes.find((m) => m.userData.pick.id === "lm0")!.position.y).toBe(0);
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

describe("setKits", () => {
  const kitsOf = (a: string, n: number) =>
    new Map([[`${a}/v`, Array.from({ length: n }, (_, i) => pl(a, i))]]);
  const named = (c: ReturnType<typeof createCityInstances>, prefix: string) =>
    meshesOf(c).filter((m) => m.name.startsWith(prefix));

  it("replaces only the kit buckets: archetype meshes are the same objects, old kits disposed", () => {
    const l = lib();
    const geometry = vi.spyOn(l, "geometry");
    const c = createCityInstances(l, plan("a"), manifest(), createRoleUniforms(), {
      kits: kitsOf("k", 2),
      motion: createMotionUniforms(),
    });
    c.update(new THREE.Vector3());
    const arch = named(c, "a__");
    const oldKits = named(c, "k__");
    expect(arch).toHaveLength(3);
    expect(oldKits).toHaveLength(3);
    let disposed = 0;
    for (const m of oldKits) m.addEventListener("dispose", () => disposed++);
    geometry.mockClear();

    c.setKits(kitsOf("trees", 3), 0.5);

    expect(named(c, "a__")).toEqual(arch);
    expect(named(c, "k__")).toHaveLength(0);
    expect(named(c, "trees__")).toHaveLength(3);
    expect(disposed).toBe(3);
    // Only the new kit's buckets were built (one geometry lookup per kit LOD).
    expect(geometry.mock.calls.every(([a]) => a === "trees")).toBe(true);
    expect(geometry).toHaveBeenCalledTimes(3);
    // Bucketed at once at the last camera: 10 archetypes plus 3 trees drawn.
    expect(c.stats().instances).toBe(13);
  });

  it("null clears the kits; the LOD scale applies to the new kits; aoExcluded follows", () => {
    const c = createCityInstances(lib(), plan("none"), manifest(), createRoleUniforms());
    c.update(new THREE.Vector3(200, 0, 0));
    c.setKits(kitsOf("k", 1), 0.5);
    // 200 m from the kit at x=0: a 0.5 scale puts it in LOD1 (as at creation).
    expect(named(c, "k__").findIndex((m) => m.visible)).toBe(1);
    c.update(new THREE.Vector3(5000, 0, 0));
    expect(c.aoExcluded().map((m) => m.name)).toEqual(["k__v__LOD2"]);
    c.setKits(null);
    expect(named(c, "k__")).toHaveLength(0);
    expect(c.aoExcluded()).toEqual([]);
    expect(c.stats().instances).toBe(0);
  });
});

describe("tile-bucketed LOD updates", () => {
  // A seeded synthetic township: 4 km square, ~15% archetypes, the rest kits with finite last LODs.
  const rng = (seed: number) => () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const synth = () => {
    const r = rng(7);
    const mk = (asset: string, n: number): [string, Placement[]] => [
      `${asset}/v`,
      Array.from({ length: n }, (_, i) => ({
        ...pl(asset, i),
        x: (r() - 0.5) * 4000,
        z: (r() - 0.5) * 4000,
      })),
    ];
    const m = manifest();
    for (const k of ["k", "trees", "people", "vehicles"])
      (m.assets[k] as ReturnType<typeof spec>).variants.v.lods = [
        { node: "k__v__LOD0", tris: 12, maxM: 80 },
        { node: "k__v__LOD1", tris: 12, maxM: 300 },
      ];
    const archetypes = mk("a", 1200);
    const kits = new Map([mk("trees", 3000), mk("people", 1800), mk("vehicles", 2000)]);
    const all = [archetypes, ...kits];
    const city = (): CityPlan => ({
      placements: new Map([archetypes]),
      extrude: new Set(),
      landmarks: [],
      stats: { placed: 1200, units: 1200, fallback: {} },
    });
    return { m, city, kits, all, total: 8000 };
  };
  const lodsById = (c: ReturnType<typeof createCityInstances>) => {
    const out = new Map<string, number>();
    for (const mesh of meshesOf(c)) {
      const ids = mesh.userData.ids as string[];
      for (let i = 0; i < mesh.count; i++)
        out.set(`${mesh.name.split("__")[0]}:${ids[i]}`, mesh.userData.lod);
    }
    return out;
  };
  const TOWNSHIP = new THREE.Vector3(0, 1400, 1400);
  const HERO_NEAR = new THREE.Vector3(-300, 120, 200);

  it("visitedPerTick stays under 25% at the township view and 10% at hero-near", () => {
    const s = synth();
    const c = createCityInstances(lib(), s.city(), s.m, createRoleUniforms(), {
      kits: s.kits,
      motion: createMotionUniforms(),
    });
    c.update(TOWNSHIP);
    expect(c.stats().visitedPerTick).toBe(s.total); // the first tick sets everything
    c.update(TOWNSHIP);
    const township = c.stats().visitedPerTick / s.total;
    c.update(HERO_NEAR);
    c.update(HERO_NEAR);
    const hero = c.stats().visitedPerTick / s.total;
    expect(township).toBeLessThan(0.25);
    expect(hero).toBeLessThan(0.1);
  });

  it("LOD results equal the old full loop for 500 sampled placements along a camera path", () => {
    const s = synth();
    const c = createCityInstances(lib(), s.city(), s.m, createRoleUniforms(), {
      kits: s.kits,
      motion: createMotionUniforms(),
    });
    const r = rng(11);
    const sample: [string, Placement][] = [];
    const flat = s.all.flatMap(([k, l]) =>
      l.map((p) => [k.split("/")[0] as string, p] as [string, Placement]),
    );
    while (sample.length < 500)
      sample.push(flat[Math.floor(r() * flat.length)] as [string, Placement]);
    const lodsOf = (asset: string) =>
      (s.m.assets[asset] as ReturnType<typeof spec>).variants.v.lods;
    const prev = new Map<string, LodBucket | undefined>();
    const path = [
      TOWNSHIP,
      HERO_NEAR,
      new THREE.Vector3(-290, 120, 210),
      new THREE.Vector3(900, 60, -400),
      new THREE.Vector3(895, 400, -380),
      TOWNSHIP,
      new THREE.Vector3(-1800, 30, 1700),
      HERO_NEAR,
    ];
    for (const cam of path) {
      c.update(cam);
      const got = lodsById(c);
      for (const [asset, p] of sample) {
        const id = `${asset}:${p.id}`;
        const d = Math.hypot(p.x - cam.x, cam.y, p.z - cam.z);
        const ref = lodFor(d, lodsOf(asset), prev.get(id));
        prev.set(id, ref);
        expect(got.get(id) ?? -1).toBe(ref);
      }
    }
  });

  it("a frustum skips tiles outside it without changing draw counts, and they catch up when seen", () => {
    const s = synth();
    const c = createCityInstances(lib(), s.city(), s.m, createRoleUniforms(), {
      kits: s.kits,
      motion: createMotionUniforms(),
    });
    c.update(TOWNSHIP);
    const meshes = c.stats().meshes;
    const cam = new THREE.PerspectiveCamera(50, 1.5, 1, 6000);
    cam.position.copy(HERO_NEAR);
    cam.lookAt(-300, 0, -2000);
    cam.updateMatrixWorld(true);
    const f = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
    );
    c.update(HERO_NEAR, f);
    const culled = c.stats();
    expect(culled.meshes).toBe(meshes);
    c.update(HERO_NEAR);
    const full = c.stats();
    expect(full.meshes).toBe(meshes);
    const ref = createCityInstances(lib(), s.city(), s.m, createRoleUniforms(), {
      kits: s.kits,
      motion: createMotionUniforms(),
    });
    ref.update(TOWNSHIP);
    ref.update(HERO_NEAR);
    expect(culled.visitedPerTick).toBeLessThan(ref.stats().visitedPerTick);
    expect(lodsById(c)).toEqual(lodsById(ref));
  });

  it("setKits applies to the tile buckets too, at the last camera", () => {
    const s = synth();
    const c = createCityInstances(lib(), s.city(), s.m, createRoleUniforms(), {
      motion: createMotionUniforms(),
    });
    c.update(HERO_NEAR);
    c.setKits(s.kits);
    c.update(HERO_NEAR);
    const near = c.stats().visitedPerTick;
    expect(near).toBeLessThan(800);
    const ref = createCityInstances(lib(), s.city(), s.m, createRoleUniforms(), {
      kits: s.kits,
      motion: createMotionUniforms(),
    });
    ref.update(HERO_NEAR);
    expect(lodsById(c)).toEqual(lodsById(ref));
  });
});

describe("setKits failure", () => {
  it("a throw while building the new kits leaves no stale kit state behind", () => {
    const base = lib();
    let boom = false;
    const l: AssetLibrary = {
      ...base,
      geometry(a, v, lod) {
        if (boom && a === "people") throw new Error("boom");
        return base.geometry(a, v, lod);
      },
    };
    const mk = (a: string) => new Map([[`${a}/v`, [pl(a, 0), pl(a, 1)]]]);
    const c = createCityInstances(l, plan("a"), manifest(), createRoleUniforms(), {
      kits: mk("k"),
      motion: createMotionUniforms(),
    });
    c.update(new THREE.Vector3());
    const oldKits = meshesOf(c).filter((m) => m.name.startsWith("k__"));
    let disposed = 0;
    for (const m of oldKits) m.addEventListener("dispose", () => disposed++);
    boom = true;
    expect(() => c.setKits(mk("people"))).toThrow("boom");
    expect(disposed).toBe(oldKits.length);
    expect(meshesOf(c).some((m) => m.name.startsWith("k__"))).toBe(false);
    expect(c.aoExcluded().some((m) => m.name.startsWith("k__"))).toBe(false);
    // Nothing writes to or re-releases the old kits; a later setKits and dispose are clean.
    expect(() => c.update(new THREE.Vector3(5, 0, 0))).not.toThrow();
    expect(c.stats().instances).toBe(10);
    boom = false;
    c.setKits(mk("trees"));
    expect(meshesOf(c).filter((m) => m.name.startsWith("trees__"))).toHaveLength(3);
    expect(disposed).toBe(oldKits.length);
    c.dispose();
    expect(disposed).toBe(oldKits.length);
  });
});
