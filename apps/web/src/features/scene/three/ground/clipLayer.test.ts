import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../../lib/api";
import { createFrame } from "../frame";
import { boundaryOf, CLIP_TOLERANCE_M, outsideBy, type P } from "./boundary";
import { clipLayer, clipWalk } from "./clipLayer";

const frame = createFrame([101.5, 3.18]);
const ll = (x: number, z: number) => frame.toLonLat(x, z) as P;
const sq = (x0: number, z0: number, x1: number, z1: number): P[] => [
  ll(x0, z0),
  ll(x1, z0),
  ll(x1, z1),
  ll(x0, z1),
  ll(x0, z0),
];
const B = boundaryOf({ type: "Polygon", coordinates: [sq(-100, -100, 100, 100)] }, frame)!;
const poly = (id: string, ring: P[], extra: Record<string, unknown> = {}) => ({
  type: "Feature",
  properties: { id, ...extra },
  geometry: { type: "Polygon", coordinates: [ring] },
});
const point = (id: string, x: number, z: number) => ({
  type: "Feature",
  properties: { id },
  geometry: { type: "Point", coordinates: ll(x, z) },
});
const fc = (features: unknown[]) => ({ type: "FeatureCollection", features });

describe("clipLayer (synthetic)", () => {
  const layer = {
    buildings: fc([
      poly("in", sq(-50, -50, -40, -40)),
      poly("edge-ok", sq(90, 0, 104, 10)), // 4 m over: kept
      poly("edge-far", sq(90, 20, 110, 30)), // 10 m over: dropped
      poly("out", sq(200, 200, 210, 210)),
    ]),
    trees: fc([point("t-in", 0, 0), point("t-out", 101, 0)]),
    water: fc([poly("w", sq(50, -20, 150, 20))]),
    parks: fc([poly("p", sq(-300, -300, -200, -200))]),
    landcover: fc([poly("lc", sq(-150, -10, 150, 10), { class: "grass" })]),
    signage: fc([point("s-in", 1, 1), point("s-out", 0, 300)]),
    landmarks: fc([poly("lm", sq(-10, -10, 10, 10))]),
    as_of: null,
    attribution: [],
  } as unknown as BuildingsLayer;
  const { layer: out, stats } = clipLayer(layer, B, frame);
  const ids = (x: unknown) =>
    (x as { features: { properties: { id: string } }[] }).features.map((f) => f.properties.id);

  it("keeps buildings within 5 m and counts the dropped ones", () => {
    expect(ids(out.buildings)).toEqual(["in", "edge-ok"]);
    expect(stats.buildings).toEqual({ kept: 2, dropped: 2 });
    expect(ids(out.landmarks)).toEqual(["lm"]);
  });
  it("keeps trees and signs inside only", () => {
    expect(ids(out.trees)).toEqual(["t-in"]);
    expect(ids(out.signage)).toEqual(["s-in"]);
  });
  it("cuts polygons to the outline and drops outside ones", () => {
    expect(ids(out.parks)).toEqual([]);
    expect(stats.water).toEqual({ kept: 1, dropped: 0, cut: 1 });
    const lc = out.landcover as unknown as {
      features: { properties: Record<string, unknown>; geometry: { coordinates: P[][] } }[];
    };
    expect(lc.features).toHaveLength(1);
    expect(lc.features[0]!.properties.class).toBe("grass");
    for (const [lon, lat] of lc.features[0]!.geometry.coordinates[0]!) {
      const [x, z] = frame.toLocal(lon, lat);
      expect(Math.abs(x)).toBeLessThanOrEqual(100.001);
      expect(Math.abs(z)).toBeLessThanOrEqual(10.001);
    }
  });
  it("leaves the input untouched", () => {
    expect(ids(layer.buildings)).toHaveLength(4);
  });
});

describe("clipWalk", () => {
  it("cuts lines to inside runs and keeps inside points", () => {
    const walk = fc([
      {
        type: "Feature",
        properties: { id: "a", type: "street" },
        geometry: { type: "LineString", coordinates: [ll(-50, 0), ll(50, 0)] },
      },
      {
        type: "Feature",
        properties: { id: "b", type: "street" },
        geometry: { type: "LineString", coordinates: [ll(0, 0), ll(200, 0)] },
      },
      {
        type: "Feature",
        properties: { id: "c" },
        geometry: { type: "LineString", coordinates: [ll(200, 0), ll(300, 0)] },
      },
      point("p-in", 0, 0),
      point("p-out", 300, 0),
    ]);
    const out = clipWalk(walk, B, frame) as unknown as {
      features: { properties: { id: string }; geometry: { coordinates: P[] } }[];
    };
    expect(out.features.map((f) => f.properties.id)).toEqual(["a", "b", "p-in"]);
    expect(out.features[0]).toBe(walk.features[0]);
    const end = out.features[1]!.geometry.coordinates[1]!;
    expect(frame.toLocal(end[0], end[1])[0]).toBeCloseTo(100, 3);
  });
});

describe("the Elmina seed (AC-A5 data half)", () => {
  const seed = (p: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../../../../../data/seed/elmina/${p}`, import.meta.url), "utf8"),
    );
  const site = seed("site.json");
  const f = createFrame(site.center);
  const b = boundaryOf(seed("base/boundary.geojson").features[0].geometry, f)!;
  const polygonsOnly = (x: { features: { geometry: { type: string } }[] }) =>
    fc(
      x.features.filter((g) => g.geometry.type === "Polygon" || g.geometry.type === "MultiPolygon"),
    );
  const layer = {
    buildings: seed("base/buildings.geojson"),
    trees: seed("base/trees.geojson"),
    water: polygonsOnly(seed("base/hydrology.geojson")),
    parks: polygonsOnly(seed("base/parks.geojson")),
    landcover: seed("base/landcover.geojson"),
    signage: seed("base/signage.geojson"),
    landmarks: seed("base/landmarks.geojson"),
    as_of: null,
    attribution: [],
  } as unknown as BuildingsLayer;
  const { layer: out, stats } = clipLayer(layer, b, f);

  const worst = (x: unknown) => {
    let w = 0;
    const visit = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === "number") {
        const [px, pz] = f.toLocal(c[0] as number, c[1] as number);
        w = Math.max(w, outsideBy(b, px, pz));
      } else if (Array.isArray(c)) for (const k of c) visit(k);
    };
    for (const g of (x as { features: { geometry: { coordinates: unknown } }[] }).features)
      visit(g.geometry.coordinates);
    return w;
  };

  it("no building, landmark, tree, sign or polygon vertex lies more than 5 m outside", () => {
    expect(worst(out.buildings)).toBeLessThanOrEqual(CLIP_TOLERANCE_M);
    expect(worst(out.landmarks)).toBeLessThanOrEqual(CLIP_TOLERANCE_M);
    expect(worst(out.trees)).toBe(0);
    expect(worst(out.signage)).toBe(0);
    for (const k of ["landcover", "parks", "water"] as const)
      expect(worst(out[k]), k).toBeLessThanOrEqual(0.5);
  });
  it("drops the buildings outside Elmina and keeps the township (counts recorded)", () => {
    // Recorded in the A-T4 report: the seed has 7803 buildings (radius 3500 m around the centre).
    expect(stats.buildings.kept + stats.buildings.dropped).toBe(7803);
    expect(stats.buildings.kept).toBeGreaterThan(1000);
    expect(stats.landmarks.kept).toBe(2);
    console.info("A-T4 clip stats (Elmina seed):", JSON.stringify(stats));
  });
});
