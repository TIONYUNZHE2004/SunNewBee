import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import { boundaryOf, insideBoundary } from "../ground/boundary";
import { distSeg } from "../props/polyGeom";
import {
  DECOR_KEEPOUT_M,
  DECOR_MODELS,
  type DressItem,
  FACT_MODELS,
  type FactKind,
  factBenches,
  factItems,
  MODEL_RADIUS_M,
  planDecorProps,
  planFactProps,
  walkLines,
} from "./dressingPlan";

const frame = createFrame([101.5, 3.18]);
const ll = (x: number, z: number) => frame.toLonLat(x, z);
const line = (id: string, type: string, pts: [number, number][], extra = {}) => ({
  type: "Feature",
  properties: { id, type, ...extra },
  geometry: { type: "LineString", coordinates: pts.map(([x, z]) => ll(x, z)) },
});
const point = (id: string, kind: string, x: number, z: number, extra = {}) => ({
  type: "Feature",
  properties: { id, kind, ...extra },
  geometry: { type: "Point", coordinates: ll(x, z) },
});
/** A crossing claim as in walk.geojson (`claims.crossing`). */
const marked = (value: string, status = "reported") => ({
  claims: { crossing: { value, status, evidence_type: "osm_import" } },
});
const fc = (features: unknown[]) => ({ type: "FeatureCollection", features });
const square = (x0: number, z0: number, x1: number, z1: number) => ({
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [[ll(x0, z0), ll(x1, z0), ll(x1, z1), ll(x0, z1), ll(x0, z0)]],
  },
});

describe("fact props (AC-B7): one per data feature, each with its source id", () => {
  const walk = fc([
    line("seg-road", "street", [
      [-100, 0],
      [100, 0],
    ]),
    line(
      "seg-x",
      "crossing",
      [
        [10, -5],
        [10, 5],
      ],
      marked("marked"),
    ),
    // access-layer shape: flat crossing / crossing_status
    line(
      "seg-x2",
      "crossing",
      [
        [40, -5.5],
        [40, 5.5],
      ],
      { crossing: "marked", crossing_status: "verified" },
    ),
  ]);
  const furniture = fc([
    point("osm-node-1", "bench", 0, 8),
    point("osm-node-2", "bus_stop", 20, 0),
    point("osm-node-3", "shelter", -20, 9),
    point("osm-node-4", "traffic_signals", 30, 0.5),
    point("osm-node-5", "picnic_table", -40, 12),
    point("", "bench", 0, 20),
    point("osm-node-6", "kiosk", 0, 20),
    point("osm-node-7", "crossing", 0, 20),
  ]);

  it("draws exactly one prop per valid feature and per crossing edge", () => {
    const plan = planFactProps({ furniture, walk, frame });
    const count = (k: FactKind) => plan.props.filter((p) => p.kind === k).length;
    expect(count("crossing")).toBe(2);
    expect(count("bench")).toBe(1);
    expect(count("picnic_table")).toBe(1);
    expect(count("bus_stop")).toBe(1);
    expect(count("shelter")).toBe(1);
    expect(count("traffic_signals")).toBe(1);
    expect(plan.stats.invalid).toBe(3);
    for (const p of plan.props)
      for (const it of p.items) {
        expect(it.sourceId).toBe(p.sourceId);
        expect(FACT_MODELS).toContain(it.model);
      }
  });

  it("factBenches: the drawn benches (not picnic tables) as journey seats, facing the path", () => {
    const plan = planFactProps({ furniture, walk, frame });
    const b = factBenches(plan);
    expect(b).toHaveLength(1);
    const item = plan.props.find((p) => p.kind === "bench")?.items[0];
    expect(b[0]).toEqual({ id: "osm-node-1", x: item?.x, z: item?.z, yaw: item?.yaw });
  });

  it("fix round 1: stripes only where the claim says marked; unmarked / unknown / no id get none", () => {
    const pts: [number, number][] = [
      [60, -5],
      [60, 5],
    ];
    const w = fc([
      line("x-marked", "crossing", pts, marked("marked")),
      line("x-zebra", "crossing", pts, { crossing: "zebra", crossing_status: "reported" }),
      line("x-unmarked", "crossing", pts, marked("unmarked")),
      line("x-signals", "crossing", pts, marked("traffic_signals")),
      line("x-no", "crossing", pts, marked("no")),
      line("x-unknown", "crossing", pts),
      line("x-contested", "crossing", pts, marked("marked", "contested")),
      line("x-stale", "crossing", pts, marked("marked", "stale")),
      line("", "crossing", pts, marked("marked")),
      {
        ...line("x", "crossing", pts, marked("marked")),
        properties: { type: "crossing", ...marked("marked") },
      },
    ]);
    const plan = planFactProps({ furniture: fc([]), walk: w, frame });
    expect(plan.props.map((p) => p.sourceId).sort()).toEqual(["x-marked", "x-zebra"]);
    expect(plan.stats.unmarked).toBe(6);
    expect(plan.stats.invalid).toBe(2);
    for (const it of factItems(plan)) expect(it.sourceId).not.toMatch(/^walk#/);
    // a line without an id keeps a planning key but never a source id
    const ls = walkLines(w, frame);
    expect(ls.at(-1)!.sourceId).toBeNull();
    expect(ls.at(-1)!.id).toMatch(/^walk#/);
  });

  it("zebra bars run across the crossing at the bar pitch", () => {
    const plan = planFactProps({ furniture: fc([]), walk, frame });
    const x = plan.props.find((p) => p.sourceId === "seg-x")!;
    expect(x.items.length).toBe(10);
    for (const it of x.items) {
      expect(it.x).toBeCloseTo(10, 6);
      expect(Math.abs(it.z)).toBeLessThanOrEqual(5);
    }
    // the bar's +z runs along the crossing (north-south here)
    expect(Math.abs(Math.sin(x.items[0]!.yaw))).toBeLessThan(1e-6);
  });

  it("a prop standing on a road is set just past the kerb, facing it", () => {
    const plan = planFactProps({ furniture, walk, frame });
    const bus = plan.props.find((p) => p.sourceId === "osm-node-2")!.items[0]!;
    expect(Math.abs(bus.z)).toBeCloseTo(3.6, 6); // half of 6 m + 0.6
    const sig = plan.props.find((p) => p.sourceId === "osm-node-4")!.items[0]!;
    expect(sig.z).toBeCloseTo(3.5, 6); // its side of the line
    // A bench well off the road keeps its data position.
    const bench = plan.props.find((p) => p.sourceId === "osm-node-1")!.items[0]!;
    expect([bench.x, bench.z]).toEqual([expect.closeTo(0, 6), expect.closeTo(8, 6)]);
    // +z faces the road (toward -z here)
    expect(Math.cos(bench.yaw)).toBeCloseTo(-1, 6);
  });

  it("drops features outside the boundary", () => {
    const b = boundaryOf(square(-30, -30, 30, 30).geometry, frame)!;
    const plan = planFactProps({ furniture, walk, frame, boundary: b });
    expect(plan.props.map((p) => p.sourceId).sort()).toEqual([
      "osm-node-1",
      "osm-node-2",
      "osm-node-3",
      "seg-x",
    ]);
    expect(plan.stats.outside).toBe(3);
  });
});

describe("decorative props (AC-B8)", () => {
  const walk = fc([
    line("seg-road", "street", [
      [-150, 0],
      [150, 0],
    ]),
    line("seg-major", "major_road", [
      [0, -150],
      [0, 150],
    ]),
    line("seg-park-path", "footway", [
      [30, 40],
      [120, 40],
    ]),
    line("seg-x", "crossing", [
      [50, -5],
      [50, 5],
    ]),
  ]);
  const parks = fc([square(20, 20, 140, 120)]);
  const box = [-150, -150, 150, 150] as [number, number, number, number];
  const decor = planDecorProps({ walk, parks, frame, box });

  it("places every decorative kind, and only decorative kinds", () => {
    const models = new Set(decor.map((d) => d.model));
    for (const m of DECOR_MODELS) expect(models.has(m), m).toBe(true);
    for (const d of decor) {
      expect(DECOR_MODELS as readonly string[]).toContain(d.model);
      expect((FACT_MODELS as readonly string[]).includes(d.model)).toBe(false);
      expect(d.sourceId).toBeUndefined();
    }
  });

  it("never within 1 m of a walk line (from the footprint edge)", () => {
    const lines = walkLines(walk, frame);
    for (const d of decor) {
      let best = Number.POSITIVE_INFINITY;
      for (const l of lines)
        for (let i = 1; i < l.pts.length; i++)
          best = Math.min(best, distSeg(d.x, d.z, l.pts[i - 1]!, l.pts[i]!));
      expect(best, d.key).toBeGreaterThanOrEqual(DECOR_KEEPOUT_M + MODEL_RADIUS_M[d.model] - 1e-9);
    }
    // the crossing breaks the kerb edging around it
    expect(decor.some((d) => d.model === "kerb" && Math.abs(d.x - 50) < 1.5)).toBe(false);
  });

  it("is deterministic and tiles: two halves plan the same items as the whole", () => {
    const again = planDecorProps({ walk, parks, frame, box });
    expect(again).toEqual(decor);
    const west = planDecorProps({ walk, parks, frame, box: [-150, -150, 0, 150] });
    const east = planDecorProps({ walk, parks, frame, box: [0, -150, 150, 150] });
    const key = (d: DressItem) => d.key;
    expect([...west, ...east].map(key).sort()).toEqual(decor.map(key).sort());
  });

  it("keeps out of water: base water and landcover water (F3)", () => {
    const inPark = (d: DressItem) => d.x > 20 && d.x < 140 && d.z > 20 && d.z < 120;
    expect(decor.some(inPark)).toBe(true);
    const lake = square(20, 20, 140, 120);
    const water = planDecorProps({ walk, parks, frame, box, water: fc([lake]) });
    expect(water.filter(inPark)).toEqual([]);
    const cls = { ...lake, properties: { class: "water" } };
    const land = planDecorProps({ walk, parks, frame, box, landcover: fc([cls]) });
    expect(land.filter(inPark)).toEqual([]);
    const other = { ...lake, properties: { class: "residential" } };
    expect(planDecorProps({ walk, parks, frame, box, landcover: fc([other]) })).toEqual(decor);
  });

  it("keeps out of building footprints and the boundary's outside", () => {
    const buildings = fc([square(-150, 3, 150, 20)]);
    const inB = planDecorProps({ walk, parks, frame, box, buildings });
    expect(inB.some((d) => d.z > 3 && d.z < 20 && Math.abs(d.x) < 150)).toBe(false);
    const b = boundaryOf(square(-60, -60, 60, 60).geometry, frame)!;
    const cut = planDecorProps({ walk, parks, frame, box, boundary: b });
    expect(cut.length).toBeGreaterThan(0);
    for (const d of cut) expect(insideBoundary(b, d.x, d.z)).toBe(true);
  });
});

describe("AC-B7 on the Elmina seed: drawn fact props match the data inside the boundary", () => {
  const seed = (p: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../../../../../data/seed/elmina/${p}`, import.meta.url), "utf8"),
    );
  const site = seed("site.json");
  const f = createFrame(site.center);
  const boundary = boundaryOf(seed("base/boundary.geojson").features[0].geometry, f)!;
  const walk = seed("base/walk.geojson");
  const furniture = seed("base/street_furniture.geojson");
  const plan = planFactProps({ furniture, walk, frame: f, boundary });
  const drawn = (k: FactKind) => plan.props.filter((p) => p.kind === k).length;

  it("one prop per street furniture feature, per kind (site.json counts)", () => {
    const counts = site.street_furniture.counts as Record<string, number>;
    expect(furniture.features.length).toBe(site.street_furniture.count);
    for (const k of ["traffic_signals", "bus_stop", "shelter", "bench", "picnic_table"] as const)
      expect(drawn(k), k).toBe(counts[k]);
    expect(plan.stats.invalid).toBe(0);
  });

  it("fix round 1: one zebra per crossing edge inside the boundary whose claim says marked", () => {
    type Raw = {
      properties: {
        id: string;
        type: string;
        claims?: { crossing?: { value: string; status: string } };
      };
      geometry: { coordinates: [number, number][] };
    };
    const raw = (walk.features as Raw[]).filter((x) => x.properties.type === "crossing");
    const inside = raw.filter((x) =>
      x.geometry.coordinates.every(([lon, lat]) =>
        insideBoundary(boundary, ...f.toLocal(lon, lat)),
      ),
    );
    expect(inside.length).toBeGreaterThan(50);
    const isMarked = (x: Raw) => {
      const c = x.properties.claims?.crossing;
      return (
        !!c && ["marked", "zebra"].includes(c.value) && ["reported", "verified"].includes(c.status)
      );
    };
    const want = inside
      .filter(isMarked)
      .map((x) => x.properties.id)
      .sort();
    const got = plan.props
      .filter((p) => p.kind === "crossing")
      .map((p) => p.sourceId)
      .sort();
    expect(got).toEqual(want);
    // every other crossing inside (unmarked or no claim) gets no stripes
    expect(plan.stats.unmarked).toBe(inside.length - want.length);
    const striped = new Set(
      factItems(plan)
        .filter((i) => i.model === "zebra")
        .map((i) => i.sourceId),
    );
    for (const x of inside.filter((y) => !isMarked(y)))
      expect(striped.has(x.properties.id)).toBe(false);
  });

  it("every instance carries its source id; ids are unique per prop", () => {
    const items = factItems(plan);
    expect(items.every((i) => typeof i.sourceId === "string" && i.sourceId.length > 0)).toBe(true);
    const ids = plan.props.map((p) => p.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
    const want = new Set([
      ...furniture.features.map((x: { properties: { id: string } }) => x.properties.id),
      ...walkLines(walk, f)
        .filter((l) => l.type === "crossing")
        .map((l) => l.sourceId),
    ]);
    for (const id of ids) expect(want.has(id), id).toBe(true);
    // a moved prop stays near its data point (at most the widest half road + 1.4 m)
    for (const p of plan.props)
      if (p.kind !== "crossing") {
        const it0 = p.items[0]!;
        expect(
          Math.hypot(it0.x - p.anchor[0], it0.z - p.anchor[1]),
          p.sourceId,
        ).toBeLessThanOrEqual(6.4);
      }
  });
});
