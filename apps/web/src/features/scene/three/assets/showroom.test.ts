import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createCityInstances } from "./cityInstances";
import type { Placement } from "./fit";
import type { AssetLibrary } from "./library";
import type { AssetSpec, Manifest } from "./manifest";
import { createRoleUniforms } from "./roleMaterial";
import {
  SHOWROOM_MARGIN_M,
  SHOWROOM_SPACING_M,
  showroomBounds,
  showroomManifest,
  showroomPlan,
} from "./showroom";

const lods = (id: string, v: string) => [
  { node: `${id}__${v}__LOD0`, tris: 1, maxM: 300 },
  { node: `${id}__${v}__LOD1`, tris: 1, maxM: 1500 },
  { node: `${id}__${v}__LOD2`, tris: 1, maxM: null },
];
const spec = (
  id: string,
  group: AssetSpec["group"],
  variants: string[],
  over: Partial<AssetSpec> = {},
): AssetSpec => ({
  group,
  file: `${id}.glb`,
  bytes: 1,
  repeat: "none",
  frontage: "short",
  fit: { xz: [0.75, 1.35], y: [0.6, 1.6] },
  decorative: group === "kit",
  placement: group === "landmark" ? "anchor" : null,
  jitter: {},
  variantByGroup: {},
  palettes: { default: [["#111111", "#222222", "#333333"]] },
  variants: Object.fromEntries(variants.map((v) => [v, { size: [6, 8, 15], lods: lods(id, v) }])),
  ...over,
});
const manifest = (): Manifest => ({
  version: 1,
  as_of: "x",
  precinctGroups: [],
  assets: {
    link_intermediate: spec("link_intermediate", "archetype", ["gable", "modern"]),
    highrise: spec("highrise", "archetype", ["mid", "tall"]),
    people: spec("people", "kit", ["a", "b", "c"]),
    lakeside_mall: {
      ...spec("lakeside_mall", "landmark", ["main"]),
      variants: { main: { size: [120, 20, 90], lods: lods("lakeside_mall", "main") } },
    },
  },
  landmarks: { lakeside_mall: { anchor: [101.5, 3.18] } },
});
const CENTRE: [number, number] = [100, -200];

const all = (p: ReturnType<typeof showroomPlan>): Placement[] => [
  ...[...p.placements.values()].flat(),
  ...p.landmarks,
];

describe("showroomPlan", () => {
  it("places every asset variant exactly once, and extrudes nothing", () => {
    const p = showroomPlan(manifest(), CENTRE);
    const keys = all(p).map((x) => `${x.asset}/${x.variant}`);
    expect(keys.sort()).toEqual(
      [
        "highrise/mid",
        "highrise/tall",
        "lakeside_mall/main",
        "link_intermediate/gable",
        "link_intermediate/modern",
        "people/a",
        "people/b",
        "people/c",
      ].sort(),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(p.extrude.size).toBe(0);
    expect(p.landmarks.map((l) => l.asset)).toEqual(["lakeside_mall"]);
    expect(p.stats.units + p.landmarks.length).toBe(8);
    for (const x of all(p)) {
      expect([x.sx, x.sy, x.sz, x.yaw]).toEqual([1, 1, 1, 0]);
    }
  });

  it("a 285 m landmark does not stretch the small rows: kits stay 30 m apart", () => {
    expect(SHOWROOM_SPACING_M).toBe(30);
    expect(SHOWROOM_MARGIN_M).toBe(5);
    const m = manifest();
    m.assets.lakeside_mall!.variants.main!.size = [237, 9, 285];
    const ps = all(showroomPlan(m, CENTRE));
    const xs = ps
      .filter((x) => x.asset === "people")
      .map((x) => x.x)
      .sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBeCloseTo(30, 6);
    expect(xs[2]! - xs[1]!).toBeCloseTo(30, 6);
  });

  it("an asset sits at the centre (the hero-near view sees models), landmarks on the outer rows", () => {
    const m = manifest();
    m.assets.lakeside_mall!.variants.main!.size = [237, 9, 285];
    const p = showroomPlan(m, CENTRE);
    const ps = all(p);
    const nearest = Math.min(...ps.map((x) => Math.hypot(x.x - CENTRE[0], x.z - CENTRE[1])));
    expect(nearest).toBeLessThanOrEqual(15 + 1e-6);
    const zOf = (a: string) => ps.find((x) => x.asset === a)!.z;
    const zs = ps.map((x) => x.z);
    expect(zOf("lakeside_mall")).toBe(Math.max(...zs));
  });

  it("showroomBounds holds every footprint and the centre", () => {
    const m = manifest();
    m.assets.lakeside_mall!.variants.main!.size = [237, 9, 285];
    const p = showroomPlan(m, CENTRE);
    const b = showroomBounds(p, m);
    for (const x of all(p)) {
      const [w, , d] = m.assets[x.asset]!.variants[x.variant]!.size;
      expect(x.x - w / 2).toBeGreaterThanOrEqual(b.min[0] - 1e-6);
      expect(x.x + w / 2).toBeLessThanOrEqual(b.max[0] + 1e-6);
      expect(x.z - d / 2).toBeGreaterThanOrEqual(b.min[1] - 1e-6);
      expect(x.z + d / 2).toBeLessThanOrEqual(b.max[1] + 1e-6);
    }
    expect(CENTRE[0]).toBeGreaterThan(b.min[0]);
    expect(CENTRE[0]).toBeLessThan(b.max[0]);
    expect(CENTRE[1]).toBeGreaterThan(b.min[1]);
    expect(CENTRE[1]).toBeLessThan(b.max[1]);
    // Compact: well under a kilometre for this fixture.
    expect(b.max[0] - b.min[0]).toBeLessThan(400);
    expect(b.max[1] - b.min[1]).toBeLessThan(600);
  });

  it("footprints never overlap and every pair is at least 30 m apart", () => {
    const m = manifest();
    m.assets.lakeside_mall!.variants.main!.size = [237, 9, 285];
    const ps = all(showroomPlan(m, CENTRE));
    const half = (x: Placement) => {
      const [w, , d] = m.assets[x.asset]!.variants[x.variant]!.size;
      return [w / 2, d / 2] as const;
    };
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i]!;
        const b = ps[j]!;
        const dx = Math.abs(a.x - b.x);
        const dz = Math.abs(a.z - b.z);
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(30 - 1e-6);
        // Yaw 0: axis-aligned footprints; they must be separated on x or on z.
        const [ax, az] = half(a);
        const [bx, bz] = half(b);
        expect(dx >= ax + bx || dz >= az + bz).toBe(true);
      }
    // One row per asset: the variants of one asset share z.
    const rowZ = (asset: string) => new Set(ps.filter((x) => x.asset === asset).map((x) => x.z));
    expect(rowZ("people").size).toBe(1);
    // Every row is centred on the centre's x.
    const xs = ps.map((x) => x.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(CENTRE[0], 6);
  });

  it("showroomManifest keeps LOD0 only (always drawn) and keeps decorative flags", () => {
    const m = manifest();
    const s = showroomManifest(m);
    for (const [id, a] of Object.entries(s.assets)) {
      expect(a.decorative).toBe(m.assets[id]!.decorative);
      for (const [v, vs] of Object.entries(a.variants)) {
        expect(vs.lods).toEqual([{ ...m.assets[id]!.variants[v]!.lods[0]!, maxM: null }]);
      }
    }
    // The input manifest is not mutated.
    expect(m.assets.people!.variants.a!.lods).toHaveLength(3);
  });

  it("decorative kits stay decorative (no-op raycast) once instanced; archetypes stay pickable", () => {
    const m = manifest();
    const geo = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
      return g;
    };
    const lib: AssetLibrary = {
      geometry: () => geo(),
      has: () => true,
      gpuBytes: () => 0,
      failed: [],
      dispose: () => {},
    };
    const sm = showroomManifest(m);
    const inst = createCityInstances(lib, showroomPlan(m, CENTRE), sm, createRoleUniforms());
    // Far away: LOD0 is still drawn for every variant.
    inst.update(new THREE.Vector3(5000, 5000, 5000));
    expect(inst.stats().instances).toBe(8);
    const meshes: THREE.Object3D[] = [];
    inst.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o);
    });
    const people = meshes.filter((o) => o.name.startsWith("people__"));
    expect(people).toHaveLength(3);
    for (const o of people) expect(o.userData.decorative).toBe(true);
    const link = meshes.find((o) => o.name.startsWith("link_intermediate__"));
    expect(link?.userData.decorative).toBeUndefined();
    inst.dispose();
  });
});
