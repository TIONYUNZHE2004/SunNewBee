import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../../lib/api";
import { buildCityGeometry } from "../cityMesh";
import { facadeFor } from "../facade/facadePlan";
import { fallbackColours } from "../fallbackStyle";
import { createFrame } from "../frame";
import { type AssetSpec, type Manifest, parseManifest } from "./manifest";
import { facadeInputs, GENERIC_UNSTRETCHED, LANDMARK_FIT, planCity, roofInputs } from "./plan";

const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

const frame = createFrame([101.5, 3.18]);

function poly(cx: number, cz: number, w: number, l: number): [number, number][] {
  // l along x, w along z (local metres) -> lon/lat ring
  const pts: [number, number][] = [
    [cx - l / 2, cz - w / 2],
    [cx + l / 2, cz - w / 2],
    [cx + l / 2, cz + w / 2],
    [cx - l / 2, cz + w / 2],
    [cx - l / 2, cz - w / 2],
  ];
  return pts.map(([x, z]) => frame.toLonLat(x, z));
}
const feat = (props: Record<string, unknown>, ring: [number, number][]) => ({
  type: "Feature",
  properties: props,
  geometry: { type: "Polygon", coordinates: [ring] },
});
const layerOf = (buildings: unknown[], landmarks: unknown[] = []) =>
  ({
    buildings: { type: "FeatureCollection", features: buildings },
    landmarks: { type: "FeatureCollection", features: landmarks },
  }) as unknown as BuildingsLayer;

const spec = (over: Partial<AssetSpec> = {}): AssetSpec => ({
  group: "archetype",
  file: "a.glb",
  bytes: 1,
  repeat: "frontage",
  frontage: "short",
  fit: { xz: [0.75, 1.35], y: [0.6, 1.6] },
  decorative: false,
  placement: null,
  jitter: {},
  variantByGroup: { default: "gable", valley: "modern" },
  palettes: {
    default: [["#111111", "#222222", "#333333"]],
    valley: [["#aa0000", "#00aa00", "#0000aa"]],
  },
  variants: {
    gable: { size: [6.4, 8.5, 15.5], lods: [{ node: "g", tris: 1, maxM: null }] },
    modern: { size: [6.4, 8.5, 15.5], lods: [{ node: "m", tris: 1, maxM: null }] },
  },
  ...over,
});
const manifest = (): Manifest => ({
  version: 1,
  as_of: "x",
  precinctGroups: [["valley", "elmina valley"]],
  assets: {
    link_intermediate: spec(),
    generic: spec({
      repeat: "none",
      variantByGroup: { default: "box" },
      variants: { box: { size: [10, 9, 10], lods: [{ node: "b", tris: 1, maxM: null }] } },
    }),
    lakeside_mall: spec({
      group: "landmark",
      repeat: "none",
      placement: "anchor",
      variantByGroup: {},
      variants: { main: { size: [100, 20, 100], lods: [{ node: "l", tris: 1, maxM: null }] } },
    }),
    kanopi: spec({
      group: "landmark",
      repeat: "none",
      placement: "deferred",
      variantByGroup: {},
      variants: { main: { size: [50, 20, 50], lods: [{ node: "k", tris: 1, maxM: null }] } },
    }),
  },
  landmarks: { lakeside_mall: { anchor: [101.51, 3.185] } },
});
const all = () => true;
const link = (id: string, extra: Record<string, unknown> = {}) =>
  feat({ id, archetype: "link_intermediate", height_m: 8.5, ...extra }, poly(0, 0, 6.4, 15.5));

describe("planCity", () => {
  it("places a link footprint under asset/variant", () => {
    const p = planCity(layerOf([link("b1")]), frame, manifest(), all);
    expect(p.placements.get("link_intermediate/gable")).toHaveLength(1);
    expect(p.extrude.size).toBe(0);
    expect(p.stats.placed).toBe(1);
    expect(p.stats.units).toBe(1);
  });
  it("each unit of a frontage row takes its own palette; neighbours differ (deterministic per id)", () => {
    const PAL3: [string, string, string][] = [
      ["#111111", "#222222", "#333333"],
      ["#aa0000", "#00aa00", "#0000aa"],
      ["#ffee00", "#00ffee", "#ee00ff"],
    ];
    const m = manifest();
    m.assets.link_intermediate = spec({ palettes: { default: PAL3 } });
    const row = (id: string) =>
      feat({ id, archetype: "link_intermediate", height_m: 8.5 }, poly(0, 0, 15.5, 64));
    for (const id of ["r1", "r2", "r3", "r4", "r5", "r6"]) {
      const a = planCity(layerOf([row(id)]), frame, m, all).placements.get(
        "link_intermediate/gable",
      )!;
      expect(a.length).toBeGreaterThan(4);
      for (let i = 1; i < a.length; i++) expect(a[i]!.palette).not.toEqual(a[i - 1]!.palette);
      for (const u of a) expect(PAL3).toContainEqual(u.palette);
      const b = planCity(layerOf([row(id)]), frame, m, all).placements.get(
        "link_intermediate/gable",
      )!;
      expect(b.map((u) => u.palette)).toEqual(a.map((u) => u.palette));
    }
  });
  it("uses the valley variant and palette for Elmina Valley 2", () => {
    const p = planCity(
      layerOf([link("b1", { precinct: "Elmina Valley 2" })]),
      frame,
      manifest(),
      all,
    );
    const got = p.placements.get("link_intermediate/modern")!;
    expect(got[0]!.palette).toEqual(["#aa0000", "#00aa00", "#0000aa"]);
  });
  it("extrudes an archetype missing from the manifest with reason no_asset", () => {
    const f = feat({ id: "b2", archetype: "mystery", height_m: 8.5 }, poly(0, 0, 6.4, 15.5));
    const p = planCity(layerOf([f]), frame, manifest(), all);
    expect(p.extrude.has("b2")).toBe(true);
    expect(p.stats.fallback.no_asset).toBe(1);
  });
  it("extrudes when the glb did not load (has() false)", () => {
    const p = planCity(layerOf([link("b1")]), frame, manifest(), (a) => a !== "link_intermediate");
    expect(p.extrude.has("b1")).toBe(true);
    expect(p.stats.fallback.no_asset).toBe(1);
  });
  it("places generic at fill 0.9 and extrudes it at 0.7", () => {
    const sq = (id: string, cut: number) => {
      // 10 x 10 square with a corner notch; notch area fraction = cut
      const s = Math.sqrt(cut) * 10;
      const pts: [number, number][] = [
        [-5, -5],
        [5, -5],
        [5, 5 - s],
        [5 - s, 5 - s],
        [5 - s, 5],
        [-5, 5],
        [-5, -5],
      ];
      return feat(
        { id, archetype: "generic", height_m: 9 },
        pts.map(([x, z]) => frame.toLonLat(x + (id === "g2" ? 50 : 0), z)),
      );
    };
    const p = planCity(layerOf([sq("g1", 0.1), sq("g2", 0.3)]), frame, manifest(), all);
    expect(p.placements.get("generic/box")).toHaveLength(1);
    expect(p.extrude.has("g2")).toBe(true);
    expect(p.extrude.has("g1")).toBe(false);
    expect(p.stats.fallback.generic_fill).toBe(1);
  });
  it("extrudes a building without an archetype", () => {
    const f = feat({ id: "b3", height_m: 9 }, poly(0, 0, 6.4, 15.5));
    const p = planCity(layerOf([f]), frame, manifest(), all);
    expect(p.extrude.has("b3")).toBe(true);
    expect(p.stats.fallback.no_archetype).toBe(1);
  });
  it("extrudes a footprint the archetype cannot fit", () => {
    const f = feat(
      { id: "b4", archetype: "link_intermediate", height_m: 8.5 },
      poly(0, 0, 6.4, 40),
    );
    const p = planCity(layerOf([f]), frame, manifest(), all);
    expect(p.extrude.has("b4")).toBe(true);
    expect(p.stats.fallback.no_fit).toBe(1);
  });
  it("places a landmark at its anchor and drops its building from both sets", () => {
    const lm = feat({ id: "lm", model: "lakeside_mall", building_id: "b1" }, poly(0, 0, 60, 60));
    const p = planCity(layerOf([link("b1"), link("b5")], [lm]), frame, manifest(), all);
    expect(p.landmarks).toHaveLength(1);
    const [ax, az] = frame.toLocal(101.51, 3.185);
    expect(p.landmarks[0]!.x).toBeCloseTo(ax, 6);
    expect(p.landmarks[0]!.z).toBeCloseTo(az, 6);
    expect(p.landmarks[0]!.yaw).toBe(0);
    expect(p.landmarks[0]!.sx).toBe(1);
    expect(p.landmarks[0]!.depthYield).toBeUndefined();
    expect(p.extrude.has("b1")).toBe(false);
    const ids = [...p.placements.values()].flat().map((q) => q.id);
    expect(ids).not.toContain("b1");
    expect(ids).toContain("b5");
  });
  it("places an obb landmark at the feature's OBB centre and takes its building", () => {
    const m = manifest();
    m.assets.lakeside_mall = { ...m.assets.lakeside_mall!, placement: "obb" };
    const lm = feat({ id: "lm", model: "lakeside_mall", building_id: "b1" }, poly(20, 10, 60, 60));
    const b1 = feat(
      { id: "b1", archetype: "link_intermediate", height_m: 20 },
      poly(20, 10, 60, 60),
    );
    const p = planCity(layerOf([b1], [lm]), frame, m, all);
    expect(p.landmarks).toHaveLength(1);
    expect(p.landmarks[0]!.x).toBeCloseTo(20, 1);
    expect(p.landmarks[0]!.z).toBeCloseTo(10, 1);
    expect(p.landmarks[0]!.sx).toBeCloseTo(0.6, 1);
    expect(p.extrude.has("b1")).toBe(false);
    expect(p.placements.size).toBe(0);
  });
  it("reads display_height_m before height_m", () => {
    const f = feat(
      { id: "h", archetype: "link_intermediate", height_m: 30, display_height_m: 8.5 },
      poly(0, 0, 6.4, 15.5),
    );
    const p = planCity(layerOf([f]), frame, manifest(), all);
    expect(p.placements.get("link_intermediate/gable")![0]!.sy).toBeCloseTo(1, 6);
    const g = feat(
      { id: "h2", archetype: "link_intermediate", height_m: 8.5, display_height_m: 30 },
      poly(0, 0, 6.4, 15.5),
    );
    expect(planCity(layerOf([g]), frame, manifest(), all).extrude.has("h2")).toBe(true);
  });
  it("leaves a deferred landmark unplaced and its building in the normal flow", () => {
    const lm = feat({ id: "k", model: "kanopi", building_id: "b1" }, poly(0, 0, 40, 40));
    const p = planCity(layerOf([link("b1")], [lm]), frame, manifest(), all);
    expect(p.landmarks).toHaveLength(0);
    expect(p.placements.get("link_intermediate/gable")).toHaveLength(1);
  });
  it("a traced_outline landmark takes the model's design height, not its building's OSM height", () => {
    const m = manifest();
    m.assets.kanopi = {
      ...m.assets.kanopi!,
      placement: "obb",
      frontage: "long",
      variants: { tower: { size: [40, 130, 20], lods: [{ node: "k", tris: 1, maxM: null }] } },
    };
    const podium = feat({ id: "pod", archetype: "generic", height_m: 8.71 }, poly(0, 0, 20, 40));
    const traced = { id: "k", model: "kanopi", building_id: "pod", match: "traced_outline" };
    const p = planCity(layerOf([podium], [feat(traced, poly(0, 0, 20, 40))]), frame, m, all);
    expect(p.landmarks).toHaveLength(1);
    expect(p.landmarks[0]!.sy).toBeCloseTo(1, 6);
    expect(p.landmarks[0]!.sx).toBeCloseTo(1, 2);
    expect(p.landmarks[0]!.sz).toBeCloseTo(1, 2);
    // the OSM podium is real and stays: drawn (placed or extruded), counted and pickable
    const placedIds = [...p.placements.values()].flat().map((u) => u.id);
    expect(p.extrude.has("pod") || placedIds.includes("pod")).toBe(true);
    // the slab yields where it is coplanar with the podium roof (no z-fighting)
    expect(p.landmarks[0]!.depthYield).toBe(true);
    // the same footprint matched by building name keeps the building's height (8.71 / 130 is
    // outside the 0.5..2 band, so nothing is placed and the podium stays in the normal flow)
    const named = { ...traced, match: "building_name" };
    const q = planCity(layerOf([podium], [feat(named, poly(0, 0, 20, 40))]), frame, m, all);
    expect(q.landmarks).toHaveLength(0);
  });
  it("the real Kanopi traced outline fits the real slab inside LANDMARK_FIT at its design height", () => {
    const site = readJson("../../../../../../../data/seed/elmina/site.json");
    const fc = readJson("../../../../../../../data/seed/elmina/base/landmarks.geojson");
    const kanopi = fc.features.find(
      (f: { properties: { model?: string } }) => f.properties.model === "kanopi",
    );
    expect(kanopi.properties.match).toBe("traced_outline");
    const { manifest: real } = parseManifest(readJson("../../../../../public/city/manifest.json"));
    const spec = real!.assets.kanopi!;
    expect(spec.frontage).toBe("long");
    expect(spec.designStoreys).toBe(36);
    const f = createFrame(site.center);
    const osm = readJson("../../../../../../../data/seed/elmina/base/buildings.geojson");
    const podium = osm.features.find(
      (b: { properties: { id?: string } }) => b.properties.id === kanopi.properties.building_id,
    );
    expect(podium.properties.height_m).toBeCloseTo(8.71, 2);
    const p = planCity(layerOf([podium], [kanopi]), f, real!, all);
    expect(p.landmarks).toHaveLength(1);
    const k = p.landmarks[0]!;
    expect(k.sy).toBeCloseTo(1, 6);
    for (const v of [k.sx, k.sz]) {
      expect(v).toBeGreaterThanOrEqual(LANDMARK_FIT.xz[0]);
      expect(v).toBeLessThanOrEqual(LANDMARK_FIT.xz[1]);
      expect(Math.abs(v - 1)).toBeLessThan(0.1);
    }
    const bid = kanopi.properties.building_id;
    const placedIds = [...p.placements.values()].flat().map((u) => u.id);
    expect(p.extrude.has(bid) || placedIds.includes(bid)).toBe(true);
  });
  it("never invents a landmark when the layer has no landmark features", () => {
    const p = planCity(layerOf([link("b1")]), frame, manifest(), all);
    expect(p.landmarks).toHaveLength(0);
  });
  it("returns an empty plan for a null or empty layer", () => {
    for (const l of [null, undefined, layerOf([]), {} as BuildingsLayer]) {
      const p = planCity(l, frame, manifest(), all);
      expect(p.placements.size).toBe(0);
      expect(p.extrude.size).toBe(0);
      expect(p.landmarks).toHaveLength(0);
      expect(p.stats.placed).toBe(0);
    }
  });

  describe("generic placements that would be stretched become extrusions with a facade", () => {
    // The real manifest's generic band (0.3..4) accepts a 2x stretch; the facade path takes it instead.
    const wide = (): Manifest => {
      const m = manifest();
      m.assets.generic = { ...m.assets.generic!, fit: { xz: [0.3, 4], y: [0.6, 1.6] } };
      return m;
    };
    const generic = (id: string, w: number, l: number, cx = 0) =>
      feat({ id, archetype: "generic", height_m: 9, kind: "commercial" }, poly(cx, 0, w, l));

    it("the unstretched band is 0.8..1.25", () => {
      expect(GENERIC_UNSTRETCHED).toEqual([0.8, 1.25]);
    });
    it("a generic with sz 2.0 is extruded (generic_stretch), not placed as a stretched box", () => {
      // 10 m frontage (short side) x 20 m deep on the 10 x 10 box: sx 1.0, sz 2.0
      const p = planCity(layerOf([generic("g20", 10, 20)]), frame, wide(), all);
      expect(p.placements.get("generic/box") ?? []).toHaveLength(0);
      expect(p.extrude.has("g20")).toBe(true);
      expect(p.stats.fallback.generic_stretch).toBe(1);
      expect(p.stats.placed).toBe(0);
    });
    it("keeps placing a generic inside the band, and extrudes one with sx outside it", () => {
      const p = planCity(
        layerOf([generic("ok", 11, 12), generic("sx", 5, 10.5, 60)]),
        frame,
        wide(),
        all,
      );
      const placed = (p.placements.get("generic/box") ?? []).map((u) => u.id);
      expect(placed).toEqual(["ok"]);
      expect(p.extrude.has("sx")).toBe(true);
      expect(p.stats.fallback.generic_stretch).toBe(1);
    });
    it("facadeInputs gives each drawn extruded building its local ring, heights and facadeFor spec", () => {
      const f = feat(
        {
          id: "g20",
          archetype: "generic",
          height_m: 9,
          display_height_m: 9.6,
          kind: "commercial",
          precinct: "Elmina Valley 2",
        },
        poly(0, 0, 10, 20),
      );
      const layer = layerOf([f, link("b1")]);
      const m = wide();
      const p = planCity(layer, frame, m, all);
      const g = buildCityGeometry(layer, frame, { only: p.extrude });
      const list = facadeInputs(g.footprints, layer, m);
      expect(list).toHaveLength(1);
      const [b] = list;
      expect(b!.heightM).toBeCloseTo(9.6, 6);
      expect(b!.minHeightM).toBe(0);
      expect(b!.ring).toEqual(g.footprints[0]!.ring);
      expect(b!.spec).toEqual(
        facadeFor(
          {
            id: "g20",
            heightM: 9.6,
            kind: "commercial",
            archetype: "generic",
            precinct: "Elmina Valley 2",
          },
          m,
        ),
      );
      expect(b!.spec.storeys).toBe(3);
    });
  });

  describe("roofInputs (Task 8: roofs the roof layer may dress)", () => {
    const m = manifest();
    const big = (id: string, cx: number, extra: Record<string, unknown> = {}) =>
      feat({ id, height_m: 12, kind: "industrial", ...extra }, poly(cx, 0, 30, 50)); // 1500 m2
    const podium = feat({ id: "pod", archetype: "generic", height_m: 8.71 }, poly(300, 0, 60, 100));
    const tower = { id: "k", model: "kanopi", building_id: "pod", match: "traced_outline" };
    const mall = { id: "lm", model: "lakeside_mall", building_id: "mallb" };
    const layer = layerOf(
      [big("f1", 0), big("mallb", 100, { archetype: "mall" }), link("small"), podium],
      [feat(tower, poly(280, 0, 15, 50)), feat(mall, poly(100, 0, 30, 50))],
    );

    it("lists the large extrusions with their ring, height and palette; marks landmarks", () => {
      const g = buildCityGeometry(layer, frame, { only: new Set(["f1", "mallb", "small"]) });
      const list = roofInputs(g.footprints, layer, m, frame);
      const ids = list.map((r) => r.b.id);
      expect(ids).toContain("f1");
      expect(ids).not.toContain("small"); // under 600 m2
      const f1 = list.find((r) => r.b.id === "f1")!;
      expect(f1.b.ring).toEqual(g.footprints.find((f) => f.id === "f1")!.ring);
      expect(f1.b.heightM).toBe(12);
      expect(f1.b.isLandmark).toBe(false);
      expect(f1.palette).toEqual(
        fallbackColours({ id: "f1", kind: "industrial" }, m, m.precinctGroups),
      );
      expect(list.find((r) => r.b.id === "mallb")!.b.isLandmark).toBe(true);
    });

    it("gives the podium under a traced tower a deck with the tower plate, even when it is not extruded", () => {
      const g = buildCityGeometry(layer, frame, { only: new Set(["f1"]) });
      const pod = roofInputs(g.footprints, layer, m, frame).find((r) => r.b.id === "pod")!;
      expect(pod.b.isLandmark).toBe(true);
      expect(pod.b.heightM).toBeCloseTo(8.71, 6);
      expect(pod.deck!.parts.planters).toBeGreaterThan(0);
      expect(pod.deck!.parts.pergola).toBeGreaterThan(0);
      // Planned around the tower plate (x 255..305, z -7.5..7.5): no item centre on it.
      const b = pod.deck!.boxes;
      for (let i = 0; i < b.length; i += 16) {
        const x = b[i + 12]!;
        const z = b[i + 14]!;
        expect(x > 255 && x < 305 && z > -7.5 && z < 7.5).toBe(false);
      }
      expect(
        roofInputs(g.footprints, layer, m, frame).find((r) => r.b.id === "f1")!.deck,
      ).toBeUndefined();
    });
  });
});
