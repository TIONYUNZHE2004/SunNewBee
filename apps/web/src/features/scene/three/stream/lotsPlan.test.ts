import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../../lib/api";
import type { Placement } from "../assets/fit";
import { parseManifest } from "../assets/manifest";
import { BOOKMARKS } from "../bookmarks";
import { createFrame } from "../frame";
import { CARS_DAY, STALL_D_M, STALL_STRIDE, STALL_W_M } from "../ground/parking";
import { planConstructionSites, sitesOf, TRACK_STRIDE } from "../props/construction";
import { perLayerStats } from "./area";
import { TILE_CAPS, TRIS_PER, tileCap } from "./caps";
import { capCars, planTileLots } from "./lotsPlan";
import { farView } from "./streamer";
import { planTile, type TileInputs, warmPlanners } from "./tilePlan";
import { activeTiles, tileAt } from "./tiles";

const MANIFEST_URL = new URL("../../../../../public/city/manifest.json", import.meta.url);
const manifest = parseManifest(JSON.parse(readFileSync(MANIFEST_URL, "utf8"))).manifest!;

// Far from HERO_CENTRE (no hero boost): local metres from this origin.
const frame = createFrame([101.6, 3.3]);
const ll = (x: number, z: number) => frame.toLonLat(x, z);
const fc = (...features: unknown[]) => ({ type: "FeatureCollection", features });
type Rect = [number, number, number, number];
const rect = (cls: string, [x0, z0, x1, z1]: Rect) => ({
  type: "Feature",
  properties: { class: cls },
  geometry: {
    type: "Polygon",
    coordinates: [[ll(x0, z0), ll(x1, z0), ll(x1, z1), ll(x0, z1), ll(x0, z0)]],
  },
});
const inRect = ([x0, z0, x1, z1]: Rect, x: number, z: number, tol = 1e-3) =>
  x >= x0 - tol && x <= x1 + tol && z >= z0 - tol && z <= z1 + tol;

/** A 100 x 80 m lot in tile (0,0); a 20 x 30 m lot in tile (0,1); a 150 x 200 m (30,000 m2) site across tiles (0,0) and (1,0). */
const LOT: Rect = [20, 120, 120, 200];
const SMALL_LOT: Rect = [20, 300, 40, 330];
const SITE: Rect = [150, 20, 300, 220];
const walk = fc({
  type: "Feature",
  properties: { id: "s1", type: "street" },
  geometry: {
    type: "LineString",
    coordinates: [
      [5, 60],
      [245, 60],
    ].map(([x, z]) => ll(x!, z!)),
  },
});
const layers = () =>
  ({
    attribution: [],
    buildings: fc(),
    parks: fc(),
    water: fc(),
    trees: fc(),
    landcover: fc(
      rect("grass", [0, 0, 10, 10]),
      rect("parking", LOT),
      rect("parking", SMALL_LOT),
      rect("construction", SITE),
    ),
    signage: fc(),
  }) as unknown as BuildingsLayer;
const buildings = layers();
const inputs = (over: Partial<TileInputs> = {}): TileInputs => ({
  frame,
  walk,
  buildings,
  manifest,
  facades: null,
  ...over,
});
const t00 = tileAt(10, 10);
const t10 = tileAt(260, 10);
const t01 = tileAt(10, 260);
const kitList = (kits: Map<string, Placement[]>, prefix: string) =>
  [...kits].filter(([k]) => k.startsWith(prefix)).flatMap(([, l]) => l);

describe("planTile parking (Task 10b)", () => {
  it("stalls and parked cars lie only inside parking polygons, per tile", () => {
    const c = planTile(inputs(), t00, 0, "medium");
    const stalls = c.parking!.stalls;
    expect(stalls.length / STALL_STRIDE).toBeGreaterThan(20);
    expect(stalls.length / STALL_STRIDE).toBeLessThanOrEqual(
      tileCap("medium", 0, "parking", t00, frame),
    );
    for (let i = 0; i < stalls.length; i += STALL_STRIDE)
      expect(inRect(LOT, stalls[i]!, stalls[i + 1]!)).toBe(true);
    const cars = c.parking!.cars;
    expect(cars.length).toBeGreaterThan(0);
    for (const car of cars) expect(inRect(LOT, car.x, car.z)).toBe(true);
    // The tile with no lot draws none; the small lot belongs to its own tile only.
    expect(planTile(inputs(), t10, 0, "medium").parking).toBeUndefined();
    const small = planTile(inputs(), t01, 0, "medium").parking!;
    for (let i = 0; i < small.stalls.length; i += STALL_STRIDE)
      expect(inRect(SMALL_LOT, small.stalls[i]!, small.stalls[i + 1]!)).toBe(true);
  });

  it("parked cars are static vehicles-kit placements (the kit buckets), never motion agents", () => {
    const c = planTile(inputs(), t00, 0, "medium");
    const cars = c.parking!.cars;
    const kitCars = kitList(c.kits, "vehicles/");
    expect(kitCars.map((p) => p.id).sort()).toEqual(cars.map((p) => p.id).sort());
    for (const p of kitCars) {
      expect(["vehicles/hatchback", "vehicles/sedan", "vehicles/mpv"]).toContain(
        `${p.asset}/${p.variant}`,
      );
      expect(manifest.assets[p.asset]!.decorative).toBe(true);
    }
    const carIds = new Set(cars.map((p) => p.id));
    expect(c.agents.some((a) => carIds.has(a.id) || a.id.startsWith("pk:"))).toBe(false);
  });

  it("parked cars stay within their own per-tile cap (the budget counts them per car)", () => {
    for (const tier of ["medium", "high"] as const)
      for (const ring of [0, 1] as const) {
        const c = planTile(inputs(), t00, ring, tier);
        expect(c.parking!.cars.length).toBeLessThanOrEqual(
          tileCap(tier, ring, "parked", t00, frame),
        );
      }
    expect(TRIS_PER.parked[0]).toBeGreaterThanOrEqual(Math.max(...[676, 676, 696])); // hatchback / sedan / mpv LOD0
    expect(TILE_CAPS.medium[2].parked).toBe(0);
  });

  it("the night weight is read at plan time: night parks fewer cars than day, within the share bounds", () => {
    const day = planTile(inputs({ night: () => 0 }), t01, 0, "high").parking!;
    const night = planTile(inputs({ night: () => 1 }), t01, 0, "high").parking!;
    const n = day.stalls.length / STALL_STRIDE;
    expect(n).toBeGreaterThan(10);
    expect(day.cars.length).toBeLessThan(tileCap("high", 0, "parked", t01, frame)); // not cap-bound
    expect(night.cars.length).toBeLessThan(day.cars.length);
    expect(day.cars.length / n).toBeGreaterThan(0.45);
    expect(day.cars.length / n).toBeLessThanOrEqual(CARS_DAY + 0.2);
    expect(night.cars.length / n).toBeLessThan(0.6);
  });

  it("parked cars sit in their stalls: the kit yaw turns model +z (the cars' long axis) along the stall depth", () => {
    // The vehicles kit: the parked variants are long along model z (the motion layer's front axis).
    const glb = readFileSync(
      new URL("../../../../../public/city/kits/vehicles.glb", import.meta.url),
    );
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"));
    for (const v of ["hatchback", "sedan", "mpv"]) {
      const node = json.nodes.find((n: { name?: string }) => n.name === `vehicles__${v}__LOD0`);
      const acc = json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION];
      expect(acc.max[2] - acc.min[2]).toBeGreaterThan(1.5 * (acc.max[0] - acc.min[0]));
    }
    const c = planTile(inputs(), t00, 0, "high");
    const { stalls, cars } = c.parking!;
    const y = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    for (const car of cars) {
      let k = -1;
      for (let i = 0; i < stalls.length; i += STALL_STRIDE)
        if (Math.abs(stalls[i]! - car.x) < 1e-3 && Math.abs(stalls[i + 1]! - car.z) < 1e-3) k = i;
      expect(k).toBeGreaterThanOrEqual(0);
      const yaw = stalls[k + 2]!;
      // As cityInstances composes a kit instance: rotate about +y by the placement yaw.
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q.setFromAxisAngle(y, car.yaw));
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      // The motion layer's heading convention (yaw = atan2(dx, dz)) gives back the same yaw.
      const back = Math.atan2(fwd.x, fwd.z);
      expect(Math.cos(back - car.yaw)).toBeCloseTo(1, 9);
      // Nose along the stall depth (within the 0.05 rad skew).
      expect(fwd.x * Math.sin(yaw) + fwd.z * Math.cos(yaw)).toBeGreaterThan(Math.cos(0.06));
      // A 4.2 x 1.9 m car body stays inside its 2.5 x 5 m stall and the lot.
      for (const [a, b] of [
        [2.1, 0.95],
        [2.1, -0.95],
        [-2.1, 0.95],
        [-2.1, -0.95],
      ] as const) {
        const px = car.x + fwd.x * a + side.x * b;
        const pz = car.z + fwd.z * a + side.z * b;
        const along = (px - car.x) * Math.sin(yaw) + (pz - car.z) * Math.cos(yaw);
        const across = (px - car.x) * Math.cos(yaw) - (pz - car.z) * Math.sin(yaw);
        expect(Math.abs(along)).toBeLessThanOrEqual(STALL_D_M / 2);
        expect(Math.abs(across)).toBeLessThanOrEqual(STALL_W_M / 2);
        expect(inRect(LOT, px, pz)).toBe(true);
      }
    }
  });
});

describe("capCars", () => {
  const car = (id: string): Placement => ({
    id,
    asset: "vehicles",
    variant: "sedan",
    x: 0,
    z: 0,
    yaw: 0,
    sx: 1,
    sy: 1,
    sz: 1,
    palette: ["#000", "#000", "#000"],
  });
  const all = Array.from({ length: 40 }, (_, i) => car(`pk:0.0:${i}:0`));
  it("keeps at most cap cars, a deterministic hash-picked subset in the planner's order", () => {
    const a = capCars(all, 9);
    expect(a).toHaveLength(9);
    expect(capCars(all, 9)).toEqual(a);
    const idx = a.map((c) => all.indexOf(c));
    expect(idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]!))).toBe(true);
    // Spread, not the first nine.
    expect(idx[idx.length - 1]!).toBeGreaterThan(9);
    expect(capCars(all, 100)).toBe(all);
    expect(capCars(all, 0)).toEqual([]);
  });
});

describe("planTile construction (Task 10b)", () => {
  it("is planned once: the props planner's construction cap is 0 while planTileLots streams it", () => {
    for (const [tile, tier] of [
      [t00, "medium"],
      [t10, "high"],
    ] as const) {
      const c = planTile(inputs(), tile, 0, tier);
      const placed = kitList(c.kits, "construction/");
      expect(placed.length).toBeGreaterThan(0);
      const ids = placed.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      const sites = sitesOf(
        (buildings.landcover as unknown as { features: GeoJSON.Feature[] }).features.filter(
          (f) => f.properties?.class === "construction",
        ),
        frame,
      );
      const expected = planConstructionSites(
        sites,
        tile.box,
        tileCap(tier, 0, "construction", tile, frame),
        manifest,
      );
      expect(placed.length).toBe(expected.count);
      expect(ids.sort()).toEqual(
        [...expected.kits.values()]
          .flat()
          .map((p) => p.id)
          .sort(),
      );
    }
  });

  it("earth tracks stay inside the site; the gravel tint lists every site touching the tile", () => {
    for (const tile of [t00, t10]) {
      const c = planTile(inputs(), tile, 0, "medium");
      expect(c.gravel?.map((s) => s.poly[0]!.length)).toEqual([4]);
      const tr = c.tracks!;
      expect(tr.length).toBeGreaterThan(0);
      for (let i = 0; i < tr.length; i += TRACK_STRIDE) {
        expect(inRect(SITE, tr[i]!, tr[i + 1]!, 0.01)).toBe(true);
        expect(inRect(SITE, tr[i + 2]!, tr[i + 3]!, 0.01)).toBe(true);
      }
    }
    // Both tiles name the same site object (the layer draws it once, by id).
    expect(planTile(inputs(), t00, 0, "medium").gravel![0]).toBe(
      planTile(inputs(), t10, 1, "medium").gravel![0],
    );
    expect(planTile(inputs(), t01, 0, "medium").gravel).toBeUndefined();
  });

  it("ring 2 keeps the ground (tracks, gravel) but places no construction props, stalls or cars", () => {
    const c = planTile(inputs(), t00, 2, "medium");
    expect(kitList(c.kits, "construction/")).toEqual([]);
    expect(kitList(c.kits, "vehicles/")).toEqual([]);
    expect(c.parking).toBeUndefined();
    expect(c.tracks!.length).toBeGreaterThan(0);
    expect(c.gravel).toHaveLength(1);
  });
});

describe("planTile lots: Low, far view, no manifest, determinism, warm caches", () => {
  it("Low and no manifest plan none of it", () => {
    for (const c of [
      planTile(inputs(), t00, 0, "low"),
      planTile(inputs({ manifest: null }), t00, 0, "medium"),
    ]) {
      expect(c.parking).toBeUndefined();
      expect(c.tracks).toBeUndefined();
      expect(c.gravel).toBeUndefined();
      expect(c.kits.size).toBe(0);
    }
    expect(planTileLots(inputs(), t00, 0, "low").kits.size).toBe(0);
  });

  it("beyond 1500 m (far view) none of it shows: trees and roads only", () => {
    const v = farView(planTile(inputs(), t00, 0, "medium"));
    expect(v.parking).toBeUndefined();
    expect(v.tracks).toBeUndefined();
    expect(v.gravel).toBeUndefined();
    expect([...v.kits.keys()].every((k) => k.startsWith("trees/"))).toBe(true);
  });

  it("is deterministic per tile, whatever was planned before", () => {
    const a = planTile(inputs(), t00, 0, "medium");
    planTile(inputs(), t10, 1, "high");
    const b = planTile(inputs(), t00, 0, "medium");
    expect([...b.parking!.stalls]).toEqual([...a.parking!.stalls]);
    expect(b.parking!.cars.map((p) => p.id)).toEqual(a.parking!.cars.map((p) => p.id));
    expect([...b.tracks!]).toEqual([...a.tracks!]);
  });

  it("warmPlanners lays out every lot and site: a later tile plan builds no layer cache", () => {
    const inp = inputs({
      walk: JSON.parse(JSON.stringify(walk)),
      buildings: layers(),
    });
    warmPlanners(inp);
    const warm = perLayerStats.builds;
    planTile(inp, t00, 0, "medium");
    planTile(inp, t10, 1, "high");
    planTile(inp, t01, 0, "medium");
    expect(perLayerStats.builds).toBe(warm);
  });
});

// Wave 4b (ruling P4-X): one stream budget with verges and parked cars both counted must still show
// them where it matters. Measured on the committed Elmina seed at the hero-mid bookmark, Medium.
describe("hero-mid on the Elmina seed, Medium (wave 4b budget)", () => {
  const SEED = "../../../../../../../data/seed/elmina/";
  const rj = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
  const site = rj(`${SEED}site.json`);
  const seedFrame = createFrame(site.center);
  const seed: TileInputs = {
    frame: seedFrame,
    walk: rj(`${SEED}base/walk.geojson`),
    buildings: {
      ...layers(),
      buildings: rj(`${SEED}base/buildings.geojson`),
      landcover: rj(`${SEED}base/landcover.geojson`),
    } as unknown as BuildingsLayer,
    manifest,
    facades: null,
  };
  const b = BOOKMARKS["hero-mid"];
  const [x, z] = seedFrame.toLocal(b.centre[0], b.centre[1]);
  const active = activeTiles({ x, z }, b.rangeM);

  it("parked cars fill at least 25 % of ring 0's stalls, by day and by night", () => {
    const ring0 = active.filter((a) => a.ring === 0);
    expect(ring0).toHaveLength(1);
    for (const night of [0, 1]) {
      const p = planTile({ ...seed, night: () => night }, ring0[0]!.tile, 0, "medium").parking!;
      const stalls = p.stalls.length / STALL_STRIDE;
      expect(stalls).toBeGreaterThan(50);
      expect(p.cars.length / stalls).toBeGreaterThanOrEqual(0.25);
    }
  });

  it("verges show on ring 0; none on ring 1 at Medium (ruling P4-Z: hitch budget)", () => {
    const pieces = (ring: 0 | 1) =>
      active
        .filter((a) => a.ring === ring)
        .reduce(
          (n, a) => n + (planTile(seed, a.tile, ring, "medium").verges?.strips.length ?? 0) / 18,
          0,
        );
    expect(pieces(0)).toBeGreaterThan(500);
    expect(pieces(1)).toBe(0);
  });
});
