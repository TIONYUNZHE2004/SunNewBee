import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createCityInstances } from "./cityInstances";
import type { Placement } from "./fit";
import type { AssetLibrary } from "./library";
import type { AssetSpec, Manifest } from "./manifest";
import { createRoleUniforms } from "./roleMaterial";
import { SHOWROOM_SPACING_M, showroomManifest, showroomPlan } from "./showroom";

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
    lakeside_mall: spec("lakeside_mall", "landmark", ["main"]),
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

  it("lays rows 30 m apart, variants 30 m apart along a row, centred on the centre", () => {
    expect(SHOWROOM_SPACING_M).toBe(30);
    const ps = all(showroomPlan(manifest(), CENTRE));
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i]!;
        const b = ps[j]!;
        const dx = Math.abs(a.x - b.x);
        const dz = Math.abs(a.z - b.z);
        // On a 30 m grid: every offset is a multiple of 30 and no two share a cell.
        expect((dx / 30) % 1).toBeCloseTo(0, 6);
        expect((dz / 30) % 1).toBeCloseTo(0, 6);
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(30 - 1e-6);
      }
    // One row per asset: the variants of one asset share z.
    const rowZ = (asset: string) => new Set(ps.filter((x) => x.asset === asset).map((x) => x.z));
    expect(rowZ("people").size).toBe(1);
    const xs = ps.map((x) => x.x);
    const zs = ps.map((x) => x.z);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(CENTRE[0], 6);
    expect((Math.min(...zs) + Math.max(...zs)) / 2).toBeCloseTo(CENTRE[1], 6);
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
