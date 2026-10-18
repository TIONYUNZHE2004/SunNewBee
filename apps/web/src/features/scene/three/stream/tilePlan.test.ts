import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../../lib/api";
import { parseManifest } from "../assets/manifest";
import type { RoofInput } from "../assets/plan";
import type { FacadeBuilding } from "../facade/facadeLayer";
import { podiumDeck } from "../facade/podiumDeck";
import { NEUTRAL_COLOURS } from "../fallbackStyle";
import { createFrame } from "../frame";
import { perLayerStats } from "./area";
import { TILE_CAPS } from "./caps";
import {
  bucketFacades,
  bucketRoofs,
  planRoofs,
  planTile,
  type TileInputs,
  warmPlanners,
} from "./tilePlan";
import { tileAt } from "./tiles";

const manifest = parseManifest(
  JSON.parse(
    readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
  ),
).manifest!;

// Far from HERO_CENTRE (no hero boost): local metres from this origin.
const frame = createFrame([101.6, 3.3]);
const ll = (x: number, z: number) => frame.toLonLat(x, z);
const fc = (...features: unknown[]) => ({ type: "FeatureCollection", features });
const line = (id: string, type: string, pts: [number, number][]) => ({
  type: "Feature",
  properties: { id, type },
  geometry: { type: "LineString", coordinates: pts.map(([x, z]) => ll(x, z)) },
});
const building = (id: string, x0: number, z0: number) => ({
  type: "Feature",
  properties: { id, height_m: 12, kind: "retail" },
  geometry: {
    type: "Polygon",
    coordinates: [[ll(x0, z0), ll(x0 + 20, z0), ll(x0 + 20, z0 + 10), ll(x0, z0 + 10), ll(x0, z0)]],
  },
});
const sign = (id: string, b: string, x: number, z: number) => ({
  type: "Feature",
  properties: {
    id,
    text: "Central Mart",
    building_id: b,
    source_url: "https://www.openstreetmap.org/way/1",
    source_label: "OpenStreetMap",
    as_of: "2026-10-17",
  },
  geometry: { type: "Point", coordinates: ll(x, z) },
});
/** Streets every 40 m across tiles (0,0) and (1,0), so every tile has trees, lamps and traffic. */
const walk = fc(
  ...[20, 60, 100, 140, 180, 220].map((z) =>
    line(`s${z}`, "street", [
      [5, z],
      [495, z],
    ]),
  ),
  line("m1", "major_road", [
    [125, 5],
    [125, 245],
  ]),
);
const buildings = {
  attribution: [],
  buildings: fc(building("b1", 40, 30), building("b2", 300, 30)),
  parks: fc(),
  water: fc(),
  trees: fc(),
  landcover: fc(),
  signage: fc(sign("sg1", "b1", 50, 35), sign("sg2", "b2", 310, 35)),
} as unknown as BuildingsLayer;
const facade = (id: string, x: number, z: number): FacadeBuilding => ({
  ring: [
    [x, z],
    [x + 10, z],
    [x + 10, z + 10],
    [x, z + 10],
  ],
  heightM: 9.6,
  minHeightM: 0,
  spec: {
    buildingId: id,
    storeys: 3,
    windowStyle: 0,
    bayM: 3.2,
    groundFloor: "plain",
    palette: {} as never,
  },
});
const inputs = (over: Partial<TileInputs> = {}): TileInputs => ({
  frame,
  walk,
  buildings,
  manifest,
  facades: bucketFacades([facade("f1", 40, 30), facade("f2", 300, 30)]),
  ...over,
});
const t00 = tileAt(10, 10);
const t10 = tileAt(260, 10);
const count = (c: ReturnType<typeof planTile>, prefix: string) =>
  [...c.kits].filter(([k]) => k.startsWith(prefix)).reduce((n, [, l]) => n + l.length, 0);

describe("planTile", () => {
  it("ring 0 at Medium: props, lamps (also in kits), agents, signs, roads and facades of its own tile", () => {
    const c = planTile(inputs(), t00, 0, "medium");
    const trees = count(c, "trees/");
    expect(trees).toBeGreaterThan(0);
    expect(trees).toBeLessThanOrEqual(TILE_CAPS.medium[0].trees);
    expect(c.lamps.length).toBeGreaterThan(0);
    expect(c.lamps.length).toBeLessThanOrEqual(TILE_CAPS.medium[0].lamps);
    expect(count(c, "furniture/lamp_")).toBe(c.lamps.length);
    expect(c.agents.length).toBeGreaterThan(0);
    expect(c.signs.map((s) => s.id)).toEqual(["sg1"]);
    expect(c.ribbons.length).toBeGreaterThan(0);
    expect(c.facades?.map((f) => f.spec.buildingId)).toEqual(["f1"]);
  });

  it("ring 2: trees and roads only (TILE_CAPS), no facades", () => {
    const c = planTile(inputs(), t00, 2, "medium");
    expect(count(c, "trees/")).toBeLessThanOrEqual(TILE_CAPS.medium[2].trees);
    expect(c.lamps).toEqual([]);
    expect(c.agents).toEqual([]);
    expect(c.signs).toEqual([]);
    expect(c.ribbons.length).toBeGreaterThan(0);
    expect(c.facades).toBeUndefined();
  });

  it("Low: roads only (no props, agents, signs or facades)", () => {
    const c = planTile(inputs(), t00, 0, "low");
    expect(c.kits.size).toBe(0);
    expect(c.agents).toEqual([]);
    expect(c.signs).toEqual([]);
    expect(c.facades).toBeUndefined();
    expect(c.ribbons.length).toBeGreaterThan(0);
  });

  it("without the manifest: roads and signs, no props or agents", () => {
    const c = planTile(inputs({ manifest: null }), t00, 0, "medium");
    expect(c.kits.size).toBe(0);
    expect(c.agents).toEqual([]);
    expect(c.signs).toHaveLength(1);
  });

  it("is deterministic per tile key, whatever was planned before", () => {
    const a = planTile(inputs(), t10, 1, "medium");
    planTile(inputs(), t00, 0, "high");
    const b = planTile(inputs(), t10, 1, "medium");
    expect(b.agents.map((x) => x.id)).toEqual(a.agents.map((x) => x.id));
    expect([...b.kits].map(([k, l]) => [k, l.map((p) => p.id)])).toEqual(
      [...a.kits].map(([k, l]) => [k, l.map((p) => p.id)]),
    );
    expect(b.signs.map((s) => s.id)).toEqual(["sg2"]);
  });
});

describe("planTile facades identity", () => {
  it("a tile without facades gets one shared empty list, so its re-plans keep the identity", () => {
    const empty = tileAt(1010, 1010);
    const a = planTile(inputs(), empty, 0, "medium").facades;
    const b = planTile(inputs(), empty, 1, "high").facades;
    expect(a).toEqual([]);
    expect(b).toBe(a);
  });
});

describe("warmPlanners (scope 4: cold caches)", () => {
  it("builds every planner's layer cache once; a later tile plan builds none", () => {
    // Fresh layer objects, so nothing is cached yet.
    const inp = inputs({
      walk: JSON.parse(JSON.stringify(walk)),
      buildings: JSON.parse(JSON.stringify(buildings)),
    });
    const before = perLayerStats.builds;
    warmPlanners(inp);
    const warm = perLayerStats.builds;
    expect(warm).toBeGreaterThan(before);
    planTile(inp, t00, 0, "medium");
    planTile(inp, t10, 1, "high");
    planTile(inp, t00, 2, "medium");
    expect(perLayerStats.builds).toBe(warm);
  });
});

describe("bucketFacades", () => {
  it("groups by the footprint's bbox-centre tile, half-open on a shared edge", () => {
    const m = bucketFacades([facade("a", 10, 10), facade("b", 245, 10), facade("c", 240, 10)]);
    // b spans 245..255: centre 250 belongs to tile 1 (the higher index); c's centre is 245.
    expect(m.get("0,0")?.map((f) => f.spec.buildingId)).toEqual(["a", "c"]);
    expect(m.get("1,0")?.map((f) => f.spec.buildingId)).toEqual(["b"]);
  });
});

describe("planTile roofs (Task 8: dressed roofs at ring <= 1)", () => {
  const roof = (
    id: string,
    x: number,
    z: number,
    over: Partial<RoofInput["b"]> = {},
  ): RoofInput => ({
    b: {
      id,
      ring: [
        [x, z],
        [x + 50, z],
        [x + 50, z + 30],
        [x, z + 30],
      ],
      heightM: 12,
      kind: "industrial",
      ...over,
    },
    palette: NEUTRAL_COLOURS,
  });
  const roofs = bucketRoofs([
    roof("r1", 40, 30),
    roof("mall", 140, 30, { isLandmark: true }),
    roof("r2", 300, 30),
  ]);

  it("ring 0 and ring 1 plan the tile's large roofs (one shared plan); landmarks get none", () => {
    const a = planTile(inputs({ roofs }), t00, 0, "medium").roofs!;
    expect(a.items.map((i) => i.id)).toEqual(["r1"]);
    expect(a.items[0]!.dressing.units.length).toBeGreaterThan(0);
    expect(planTile(inputs({ roofs }), t00, 1, "high").roofs).toBe(a);
    expect(planTile(inputs({ roofs }), t10, 1, "medium").roofs!.items.map((i) => i.id)).toEqual([
      "r2",
    ]);
  });

  it("ring 2, Low and no roof inputs plan none; a tile without large roofs shares one empty plan", () => {
    expect(planTile(inputs({ roofs }), t00, 2, "medium").roofs).toBeUndefined();
    expect(planTile(inputs({ roofs }), t00, 0, "low").roofs).toBeUndefined();
    expect(planTile(inputs(), t00, 0, "medium").roofs).toBeUndefined();
    const empty = tileAt(1010, 1010);
    const e = planTile(inputs({ roofs }), empty, 0, "medium").roofs!;
    expect(e).toEqual({ items: [], decks: [] });
    expect(planTile(inputs({ roofs }), empty, 1, "high").roofs).toBe(e);
  });

  it("a landmark podium carries its deck into the tile plan, with no rooftop units", () => {
    const r = roof("pod", 0, 0, { isLandmark: true });
    const d = podiumDeck(r.b, [])!;
    const plan = planRoofs([{ ...r, deck: d }]);
    expect(plan.items).toEqual([]);
    expect(plan.decks).toEqual([d]);
  });
});
