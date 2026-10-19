import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../../lib/api";
import { toBuildings } from "../../shared/model";
import { displayHeight } from "../cityMesh";
import { drawnObstacles } from "../clearance";
import { createFrame } from "../frame";
import { boundaryOf } from "../ground/boundary";
import { clipLayer } from "../ground/clipLayer";
import { modelBoxesOf, modelCellsOf } from "./drawnBounds";
import { type AssetLibrary, loadAssetLibrary } from "./library";
import { type AssetSpec, type Manifest, parseManifest } from "./manifest";
import { type CityPlan, coverOf, planCity } from "./plan";
import { buildWalkIndex, walkCoverPoint } from "./walkCover";

type Pt = [number, number];

describe("planCity keeps stand-ins off the walk (9.1 F1)", () => {
  const frame = createFrame([101.5, 3.18]);
  const ll = (r: Pt[]) => [...r, r[0]!].map(([x, z]) => frame.toLonLat(x, z));
  const feat = (props: Record<string, unknown>, ring: Pt[]) => ({
    type: "Feature",
    properties: props,
    geometry: { type: "Polygon", coordinates: [ll(ring)] },
  });
  const layerOf = (buildings: unknown[], landmarks: unknown[] = []) =>
    ({
      buildings: { type: "FeatureCollection", features: buildings },
      landmarks: { type: "FeatureCollection", features: landmarks },
    }) as unknown as BuildingsLayer;
  const walkOf = (...lines: Pt[][]) =>
    buildWalkIndex(
      {
        type: "FeatureCollection",
        features: lines.map((l) => ({
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: l.map(([x, z]) => frame.toLonLat(x, z)) },
        })),
      },
      frame,
    );
  const spec = (over: Partial<AssetSpec>): AssetSpec => ({
    group: "archetype",
    file: "a.glb",
    bytes: 1,
    repeat: "none",
    frontage: "short",
    fit: { xz: [0.75, 1.35], y: [0.6, 1.6] },
    decorative: false,
    placement: null,
    jitter: {},
    variantByGroup: { default: "box" },
    palettes: { default: [["#111111", "#222222", "#333333"]] },
    variants: { box: { size: [10, 9, 20], lods: [{ node: "b", tris: 1, maxM: null }] } },
    ...over,
  });
  const m: Manifest = {
    version: 1,
    as_of: "x",
    precinctGroups: [],
    assets: {
      block: spec({}),
      lakeside_mall: spec({
        group: "landmark",
        placement: "anchor",
        variantByGroup: {},
        variants: { main: { size: [100, 9, 100], lods: [{ node: "l", tris: 1, maxM: null }] } },
      }),
    },
    landmarks: { lakeside_mall: { anchor: frame.toLonLat(500, 0) } },
  };
  const all = () => true;
  // A 10 x 20 m block with a 3 x 4 m notch cut from one corner (fill 0.94): its stand-in is the
  // full 10 x 20 m OBB, so it covers the notch.
  const notched: Pt[] = [
    [-5, -10],
    [5, -10],
    [5, 6],
    [2, 6],
    [2, 10],
    [-5, 10],
  ];
  const b = feat({ id: "b", archetype: "block", height_m: 9 }, notched);
  const through = walkOf([
    [0, -20],
    [0, 20],
  ]); // through the outline: a passage, not a cover
  const inNotch = walkOf([
    [3.5, 4],
    [3.5, 14],
  ]); // through the notch: outside the outline, under the stand-in

  it("places the stand-in when no walk edge lies under it outside its outline", () => {
    const plan = planCity(layerOf([b]), frame, m, all, null, { walk: through });
    expect(plan.placements.get("block/box")).toHaveLength(1);
    expect(plan.extrude.has("b")).toBe(false);
    expect(plan.stats.walkCover).toEqual([]);
  });

  it("draws the extruded OSM footprint when the stand-in would cover a walk edge outside it", () => {
    const plan = planCity(layerOf([b]), frame, m, all, null, { walk: inNotch });
    expect(plan.placements.size).toBe(0);
    expect(plan.extrude.has("b")).toBe(true);
    expect(plan.stats.fallback.walk_cover).toBe(1);
    expect(plan.stats.walkCover).toEqual(["b"]);
    // without a walk layer nothing changes (no check)
    expect(planCity(layerOf([b]), frame, m, all).placements.get("block/box")).toHaveLength(1);
  });

  it("drops a landmark over an uncovered walk edge; its building is planned like any other", () => {
    const lm = feat({ id: "lm", model: "lakeside_mall", building_id: "b" }, notched);
    const near = walkOf([
      [530, -60],
      [530, 60],
    ]); // under the 100 m anchor model at x = 500, far from the building
    const kept = planCity(layerOf([b], [lm]), frame, m, all, null, { walk: through });
    expect(kept.landmarks).toHaveLength(1);
    expect(kept.placements.size).toBe(0);
    const plan = planCity(layerOf([b], [lm]), frame, m, all, null, { walk: near });
    expect(plan.landmarks).toHaveLength(0);
    expect(plan.stats.walkCover).toEqual(["lm"]);
    expect(plan.placements.get("block/box")).toHaveLength(1); // drawn: counted once
  });

  it("coverOf is null without walk LineStrings", () => {
    expect(coverOf(null, frame)).toBeNull();
    expect(coverOf({ type: "FeatureCollection", features: [] }, frame)).toBeNull();
  });
});

const SEED = (p: string) => new URL(`../../../../../../../data/seed/elmina/${p}`, import.meta.url);
const CITY = (p: string) => new URL(`../../../../../public/city/${p}`, import.meta.url);
const HAVE =
  existsSync(SEED("base/buildings.geojson")) &&
  existsSync(SEED("base/walk.geojson")) &&
  existsSync(CITY("manifest.json"));

/**
 * The seed with every committed glb loaded (the same drawn bounds the clearance uses): no stand-in
 * covers a walk edge its outline does not, the Lakeside Mall model among them, and the drawn
 * building count still equals the footprint count (AC-A12).
 */
describe.skipIf(!HAVE)("seed: no stand-in over an uncovered walk edge (9.1 F1)", () => {
  const read = (u: URL) => JSON.parse(readFileSync(u, "utf8"));
  const site = read(SEED("site.json"));
  const frame = createFrame(site.center);
  const boundary = boundaryOf(read(SEED("base/boundary.geojson")).features[0].geometry, frame)!;
  const raw = {
    buildings: read(SEED("base/buildings.geojson")),
    landmarks: read(SEED("base/landmarks.geojson")),
  } as unknown as BuildingsLayer;
  const { layer } = clipLayer(raw, boundary, frame);
  const m = parseManifest(read(CITY("manifest.json"))).manifest!;
  const walkFc = read(SEED("base/walk.geojson"));
  let lib: AssetLibrary;
  let before: CityPlan;
  let after: CityPlan;
  const fact = new Map(
    toBuildings(layer.buildings, displayHeight).buildings.map((b) => [
      b.id,
      b.ring.map(([lon, lat]) => frame.toLocal(lon, lat)),
    ]),
  );

  beforeAll(async () => {
    lib = await loadAssetLibrary(m, {
      loadGlb: async (url) => {
        const buf = readFileSync(CITY(url.replace(/^\/city\//, "")));
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      },
    });
    const boxOf = modelBoxesOf(lib, m);
    const cellsOf = modelCellsOf(lib);
    before = planCity(layer, frame, m, lib.has, boundary);
    after = planCity(layer, frame, m, lib.has, boundary, coverOf(walkFc, frame, boxOf, cellsOf));
    const changed = after.stats.walkCover ?? [];
    console.info(
      `9.1 F1 walk cover: ${changed.length} stand-ins fall back (${changed.join(", ")}); ` +
        `archetype buildings ${before.stats.placed} -> ${after.stats.placed}, ` +
        `landmarks ${before.landmarks.length} -> ${after.landmarks.length}`,
      JSON.stringify(before.stats.fallback),
      JSON.stringify(after.stats.fallback),
    );
  }, 120_000);

  it("the Lakeside Mall model no longer stands over the park path", () => {
    expect(lib.failed).toEqual([]);
    expect(before.landmarks.map((p) => p.id)).toContain("elmina-lakeside-mall");
    expect(after.landmarks.map((p) => p.id)).not.toContain("elmina-lakeside-mall");
    expect(after.stats.walkCover).toContain("elmina-lakeside-mall");
  });

  it("no placed archetype unit or landmark covers a walk edge outside its outline", () => {
    const walk = coverOf(walkFc, frame)!.walk;
    const boxOf = modelBoxesOf(lib, m);
    const cellsOf = modelCellsOf(lib);
    const landmarkRing = new Map<string, Pt[][]>();
    for (const f of (
      layer.landmarks as {
        features: Array<{ properties: Record<string, unknown>; geometry: { coordinates: Pt[][] } }>;
      }
    ).features) {
      const p = f.properties;
      const bid = typeof p.building_id === "string" ? p.building_id : null;
      const own = f.geometry.coordinates[0]!.map(([lon, lat]) => frame.toLocal(lon, lat));
      landmarkRing.set(String(p.id), [...(bid && fact.has(bid) ? [fact.get(bid)!] : []), own]);
    }
    const bad: string[] = [];
    for (const [key, list] of after.placements) {
      const asset = key.split("/")[0]!;
      for (const u of list) {
        const bid = u.id.split("#")[0]!;
        const rings = drawnObstacles({ ...u, asset }, m, false, boxOf).map((o) => o.ring);
        if (walkCoverPoint(rings, [fact.get(bid)!], walk)) bad.push(u.id);
      }
    }
    for (const p of after.landmarks) {
      const rings = drawnObstacles(p, m, true, boxOf, cellsOf).map((o) => o.ring);
      if (walkCoverPoint(rings, landmarkRing.get(p.id) ?? [], walk)) bad.push(p.id);
    }
    expect(bad).toEqual([]);
  });

  it("every footprint is still drawn exactly once (AC-A12), and only the stand-ins changed", () => {
    const drawnIds = (plan: CityPlan) => {
      const ids = new Set(plan.extrude);
      for (const list of plan.placements.values())
        for (const u of list) ids.add(u.id.split("#")[0]!);
      return ids;
    };
    const taken = (plan: CityPlan) => {
      const out = new Set<string>();
      for (const f of (
        layer.landmarks as { features: Array<{ properties: Record<string, unknown> }> }
      ).features) {
        const p = f.properties;
        if (
          plan.landmarks.some((l) => l.id === p.id) &&
          p.match !== "traced_outline" &&
          typeof p.building_id === "string"
        )
          out.add(p.building_id);
      }
      return out;
    };
    for (const plan of [before, after]) {
      const ids = drawnIds(plan);
      for (const id of taken(plan)) ids.add(id);
      expect(ids.size).toBe(fact.size);
      expect(plan.extrude.size + plan.stats.placed + taken(plan).size).toBe(fact.size);
    }
    // the mall's building is drawn again by its own outline: its "mall" archetype cannot fit the
    // outline (no_fit), so it is the extruded OSM footprint at its display height
    expect(after.extrude.has("w1308938137")).toBe(true);
    expect(after.stats.fallback.no_fit).toBe((before.stats.fallback.no_fit ?? 0) + 1);
    // every other change is a walk_cover fallback: placed before, extruded now
    const moved = [...after.extrude].filter((id) => !before.extrude.has(id));
    expect(before.extrude.size).toBeLessThan(after.extrude.size);
    expect(moved.sort()).toEqual(
      ["w1308938137", ...(after.stats.walkCover ?? []).filter((id) => fact.has(id))].sort(),
    );
  });
});
