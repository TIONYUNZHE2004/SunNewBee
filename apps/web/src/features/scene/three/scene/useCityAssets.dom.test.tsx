// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, stubFetch } from "../../../../test/helpers";
import type { Tier } from "../../cesium/stylised/quality";
import type { CityInstances } from "../assets/cityInstances";
import type { Placement } from "../assets/fit";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import { createMotionUniforms, createRoleUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import { createFrame } from "../frame";
import { KIT_LOD_SCALE } from "../props/caps";
import { useCityAssets } from "./useCityAssets";

// Every city build goes through this spy; each instance's setKits is spied too.
const built = vi.hoisted(() => ({ calls: 0, last: null as null | CityInstances }));
vi.mock("../assets/cityInstances", async (orig) => {
  const mod = await orig<typeof import("../assets/cityInstances")>();
  return {
    ...mod,
    createCityInstances: (...a: Parameters<typeof mod.createCityInstances>) => {
      built.calls++;
      const inst = mod.createCityInstances(...a);
      vi.spyOn(inst, "setKits");
      built.last = inst;
      return inst;
    },
  };
});
// A library of boxes whose geometry lookups (one per bucket built) are counted.
const libSpy = vi.hoisted(() => ({ lib: null as null | AssetLibrary }));
vi.mock("../assets/library", async (orig) => {
  const mod = await orig<typeof import("../assets/library")>();
  return { ...mod, loadAssetLibrary: async () => libSpy.lib as AssetLibrary };
});

const CENTER: [number, number] = [101.5099, 3.1813];
const frame = createFrame(CENTER);
const local = (pts: [number, number][]) => [
  [...pts, pts[0] as [number, number]].map(([x, z]) => frame.toLonLat(x, z)),
];
/** 6.4 m frontage along x, 15.5 m deep along z, centred on (cx, 100). */
const link = (id: string, cx: number) => ({
  type: "Feature",
  geometry: {
    type: "Polygon",
    coordinates: local([
      [cx - 3.2, 100 - 7.75],
      [cx + 3.2, 100 - 7.75],
      [cx + 3.2, 100 + 7.75],
      [cx - 3.2, 100 + 7.75],
    ]),
  },
  properties: {
    id,
    kind: "residential",
    height_m: 8.5,
    archetype: "link_intermediate",
    precinct: "Elmina Valley 2",
  },
});
const fc = (features: unknown[] = []) => ({ type: "FeatureCollection", features });
const CITY = {
  attribution: [],
  buildings: fc([link("l1", 50), link("l2", 80)]),
  parks: fc(),
  water: fc(),
  trees: fc(),
};
const lods = (a: string) => [
  { node: `${a}__LOD0`, tris: 1, maxM: 300 },
  { node: `${a}__LOD1`, tris: 1, maxM: null },
];
const MANIFEST: Manifest = {
  version: 1,
  as_of: "2026-10-17",
  precinctGroups: [["valley", "elmina valley"]],
  assets: {
    link_intermediate: {
      group: "archetype",
      file: "link_intermediate.glb",
      bytes: 1,
      repeat: "none",
      frontage: "short",
      fit: { xz: [0.75, 1.35], y: [0.6, 1.6] },
      decorative: false,
      placement: null,
      jitter: {},
      variantByGroup: { default: "gable" },
      palettes: { default: [["#111111", "#222222", "#333333"]] },
      variants: { gable: { size: [6.4, 8.5, 15.5], lods: lods("link_intermediate__gable") } },
    },
    furniture: {
      group: "kit",
      file: "furniture.glb",
      bytes: 1,
      repeat: "none",
      frontage: "short",
      fit: { xz: [0.5, 2], y: [0.5, 2] },
      decorative: true,
      placement: null,
      jitter: {},
      variantByGroup: {},
      palettes: {},
      variants: { lamp_single: { size: [1, 5, 1], lods: lods("furniture__lamp_single") } },
    },
  },
  landmarks: {},
};

function boxLibrary() {
  const geos = new Map<string, THREE.BufferGeometry>();
  const geometry = vi.fn((a: string, v: string, l: number) => {
    const k = `${a}/${v}/${l}`;
    if (!geos.has(k)) geos.set(k, new THREE.BoxGeometry(1, 1, 1));
    return geos.get(k) ?? null;
  });
  const lib: AssetLibrary = {
    geometry,
    has: () => true,
    gpuBytes: () => 0,
    failed: [],
    dispose: vi.fn(),
  };
  return { lib, geometry };
}

const lamp = (id: string): Placement => ({
  id,
  asset: "furniture",
  variant: "lamp_single",
  x: id.length,
  z: 0,
  yaw: 0,
  sx: 1,
  sy: 1,
  sz: 1,
  palette: ["#111111", "#222222", "#333333"],
});
const kitsOf = (...ids: string[]) => new Map([["furniture/lamp_single", ids.map(lamp)]]);

function fakeEngine() {
  return {
    setCity: vi.fn(),
    setAssets: vi.fn(),
    requestRender: vi.fn(),
    motion: createMotionUniforms(),
    rig: { set: vi.fn() },
  };
}

const roleUniforms = createRoleUniforms();

function mount(engine = fakeEngine(), tier: Tier = "medium") {
  return renderHook(
    (p: { tier: Tier }) =>
      useCityAssets({
        engine: engine as unknown as Engine,
        frame,
        buildings: CITY as never,
        tier: p.tier,
        assetsOn: true,
        showroom: false,
        roleUniforms,
      }),
    { initialProps: { tier } },
  );
}

beforeEach(() => {
  built.calls = 0;
  built.last = null;
  stubFetch((url) => (url.endsWith("/city/manifest.json") ? json(MANIFEST) : json({}, 404)));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCityAssets: one city build", () => {
  it("builds the instances once with the props kits; a later props plan only calls setKits", async () => {
    const { lib } = boxLibrary();
    libSpy.lib = lib;
    const engine = fakeEngine();
    const { result } = mount(engine);
    const first = kitsOf("a");
    // Props planned before the assets are in: handed to the single build.
    act(() => result.current.setKits(first));
    await waitFor(() => expect(result.current.assetsState).toBe("ready"));
    expect(built.calls).toBe(1);
    expect(engine.setAssets).toHaveBeenCalledTimes(1);
    const inst = built.last as CityInstances;
    expect(engine.setAssets).toHaveBeenCalledWith(inst);
    expect(inst.group.children.some((m) => m.name.startsWith("furniture__"))).toBe(true);
    expect(result.current.plan?.stats.units).toBe(2);

    const next = kitsOf("a", "bb");
    act(() => result.current.setKits(next));
    expect(built.calls).toBe(1);
    expect(inst.setKits).toHaveBeenLastCalledWith(next, KIT_LOD_SCALE.medium);
    expect(engine.setAssets).toHaveBeenCalledTimes(1);
  });

  it("a Medium to High change calls setKits again and leaves the archetype buckets alone", async () => {
    const { lib, geometry } = boxLibrary();
    libSpy.lib = lib;
    const { result, rerender } = mount(fakeEngine(), "medium");
    await waitFor(() => expect(result.current.assetsState).toBe("ready"));
    const kits = kitsOf("a");
    act(() => result.current.setKits(kits));
    const inst = built.last as CityInstances;
    const archetypes = () => inst.group.children.filter((m) => m.name.startsWith("link_"));
    const before = archetypes();
    expect(before.length).toBeGreaterThan(0);
    const calls = vi.mocked(inst.setKits).mock.calls.length;
    geometry.mockClear();

    rerender({ tier: "high" });
    await waitFor(() => expect(vi.mocked(inst.setKits).mock.calls.length).toBe(calls + 1));
    expect(inst.setKits).toHaveBeenLastCalledWith(kits, KIT_LOD_SCALE.high);
    expect(built.calls).toBe(1);
    // No archetype bucket was rebuilt: no archetype geometry lookups, the same mesh objects.
    expect(geometry.mock.calls.some(([a]) => a === "link_intermediate")).toBe(false);
    expect(archetypes()).toEqual(before);
  });
});
