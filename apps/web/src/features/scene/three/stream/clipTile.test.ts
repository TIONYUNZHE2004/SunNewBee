import { readFileSync } from "node:fs";
import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../../lib/api";
import type { Placement } from "../assets/fit";
import { parseManifest } from "../assets/manifest";
import { buildCityGeometry } from "../cityMesh";
import { createFrame } from "../frame";
import { boundaryOf, CLIP_TOLERANCE_M, outsideBy, type P } from "../ground/boundary";
import { clipLayer, clipWalk } from "../ground/clipLayer";
import { landcoverMesh } from "../ground/landcover";
import type { Ribbon } from "../ground/ribbons";
import { guardRibbon, guardTile, guardTriangles } from "./clipTile";
import type { TileContent } from "./streamer";
import { planTile, type TileInputs } from "./tilePlan";
import { TILE_M, tileOf } from "./tiles";

const sqFrame = createFrame([101.5, 3.18]);
const ll = (x: number, z: number) => sqFrame.toLonLat(x, z) as P;
const SQ = boundaryOf(
  {
    type: "Polygon",
    coordinates: [[ll(-100, -100), ll(100, -100), ll(100, 100), ll(-100, 100), ll(-100, -100)]],
  },
  sqFrame,
)!;
const pl = (id: string, x: number, z: number): Placement => ({
  id,
  asset: "trees",
  variant: "a",
  x,
  z,
  yaw: 0,
  sx: 1,
  sy: 1,
  sz: 1,
  palette: ["#000000", "#000000", "#000000"],
});

describe("guardTile (synthetic)", () => {
  const ribbon: Ribbon = {
    kind: "residential",
    // Two quads: one inside, one reaching 20 m past x = 100.
    positions: Float32Array.from([
      0, 0, 0, 10, 0, 0, 0, 0, 10, 10, 0, 10, 95, 0, 0, 120, 0, 0, 95, 0, 10, 120, 0, 10,
    ]),
    indices: Uint32Array.from([0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6]),
  };
  it("drops ground triangles with a vertex more than 5 m outside, keeps identity otherwise", () => {
    expect(guardRibbon(ribbon, SQ)!.indices).toEqual(Uint32Array.from([0, 1, 2, 1, 3, 2]));
    const inside: Ribbon = { ...ribbon, indices: Uint32Array.from([0, 1, 2]) };
    expect(guardRibbon(inside, SQ)).toBe(inside);
    const tris = Float32Array.from([
      0, 0, 0, 1, 0, 0, 0, 0, 1, 99, 0, 0, 104, 0, 0, 99, 0, 1, 99, 0, 0, 106, 0, 0, 99, 0, 1,
    ]);
    expect(guardTriangles(tris, SQ).length).toBe(18);
  });
  it("keeps only points inside, re-deriving lamps from the kept kits", () => {
    const lamp = pl("l-out", 101, 0);
    const c: TileContent = {
      kits: new Map([
        ["trees/a", [pl("t-in", 0, 0), pl("t-out", 150, 0)]],
        ["furniture/lamp_single/a", [lamp]],
      ]),
      lamps: [lamp],
      agents: [],
      signs: [],
      ribbons: [ribbon],
      parking: { stalls: Float32Array.from([0, 0, 0, 150, 0, 0]), cars: [pl("c", 150, 0)] },
      tracks: Float32Array.from([0, 0, 50, 0, 90, 0, 104, 0]),
    };
    const g = guardTile(c, SQ);
    expect([...g.kits.keys()]).toEqual(["trees/a"]);
    expect(g.kits.get("trees/a")!.map((p) => p.id)).toEqual(["t-in"]);
    expect(g.lamps).toEqual([]);
    expect(g.parking!.stalls).toEqual(Float32Array.from([0, 0, 0]));
    expect(g.parking!.cars).toEqual([]);
    expect(g.tracks).toEqual(Float32Array.from([0, 0, 50, 0]));
    expect(guardTile(c, null)).toBe(c);
  });
});

/** Every display vertex of one tile's content (x, z), with the kind it belongs to. */
function* tileVertices(c: TileContent): Generator<[string, number, number]> {
  for (const [k, list] of c.kits) for (const p of list) yield [`kit:${k}`, p.x, p.z];
  for (const s of c.signs) yield ["sign", s.x, s.z];
  for (const r of c.ribbons) {
    const used = new Set(r.indices);
    for (const v of used) yield ["ribbon", r.positions[v * 3]!, r.positions[v * 3 + 2]!];
  }
  const s = c.verges?.strips;
  if (s) for (let o = 0; o < s.length; o += 3) yield ["verge", s[o]!, s[o + 2]!];
  for (const p of c.verges?.shrubs ?? []) yield ["shrub", p.x, p.z];
  const st = c.parking?.stalls;
  if (st) for (let o = 0; o < st.length; o += 3) yield ["stall", st[o]!, st[o + 1]!];
  for (const p of c.parking?.cars ?? []) yield ["car", p.x, p.z];
  const t = c.tracks;
  if (t) for (let o = 0; o < t.length; o += 2) yield ["track", t[o]!, t[o + 1]!];
  for (const a of c.agents)
    for (let o = 0; o < a.path.length; o += 2) yield ["agent", a.path[o]!, a.path[o + 1]!];
}

describe("the Elmina seed: no display vertex more than 5 m outside (AC-A5)", () => {
  const seed = (p: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../../../../../data/seed/elmina/${p}`, import.meta.url), "utf8"),
    );
  const site = seed("site.json");
  const frame = createFrame(site.center);
  const b = boundaryOf(seed("base/boundary.geojson").features[0].geometry, frame)!;
  const polygonsOnly = (x: { features: { geometry: { type: string } }[] }) => ({
    type: "FeatureCollection",
    features: x.features.filter((g) => g.geometry.type === "Polygon"),
  });
  const raw = {
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
  const layer = clipLayer(raw, b, frame).layer;
  // The access layer the planners read: walk LineStrings and place points.
  const access = {
    type: "FeatureCollection",
    features: [...seed("base/walk.geojson").features, ...seed("base/places.geojson").features],
  };
  const walk = clipWalk(access, b, frame);
  const manifest = parseManifest(
    JSON.parse(
      readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
    ),
  ).manifest!;

  it("city extrusions, parks, water and land cover meshes", () => {
    const worst = (g: THREE.BufferGeometry) => {
      const p = g.getAttribute("position");
      let w = 0;
      for (let i = 0; i < (p?.count ?? 0); i++)
        w = Math.max(w, outsideBy(b, p!.getX(i), p!.getZ(i)));
      return w;
    };
    const city = buildCityGeometry(layer, frame);
    expect(worst(city.buildings)).toBeLessThanOrEqual(CLIP_TOLERANCE_M);
    expect(worst(city.parks)).toBeLessThanOrEqual(1);
    expect(worst(city.water)).toBeLessThanOrEqual(1);
    expect(
      worst(landcoverMesh(layer.landcover as unknown as GeoJSON.FeatureCollection, frame)),
    ).toBeLessThanOrEqual(1);
  });

  it("every streamed tile (High, ring 0): props, lamps, signs, roads, verges, lots, agents", () => {
    const inputs: TileInputs = {
      frame,
      walk,
      buildings: layer,
      manifest,
      facades: null,
      boundary: b,
    };
    const [x0, z0, x1, z1] = b.box;
    const counts: Record<string, number> = {};
    let worst = 0;
    let worstKind = "";
    let tiles = 0;
    for (let i = Math.floor(x0 / TILE_M) - 1; i <= Math.floor(x1 / TILE_M) + 1; i++)
      for (let j = Math.floor(z0 / TILE_M) - 1; j <= Math.floor(z1 / TILE_M) + 1; j++) {
        tiles++;
        const c = planTile(inputs, tileOf(i, j), 0, "high");
        for (const [kind, x, z] of tileVertices(c)) {
          const k = kind.split(":")[0]!;
          counts[k] = (counts[k] ?? 0) + 1;
          const o = outsideBy(b, x, z);
          // Points (kits, signs, shrubs, cars, stalls, agents) inside; ground within 5 m.
          const tol = k === "ribbon" || k === "verge" || k === "track" ? CLIP_TOLERANCE_M : 0;
          if (o - tol > worst) {
            worst = o - tol;
            worstKind = kind;
          }
        }
      }
    console.info("A-T4 tile sweep:", JSON.stringify({ tiles, counts, worst, worstKind }));
    expect(worst, worstKind).toBe(0);
    expect(counts.ribbon ?? 0).toBeGreaterThan(1000);
    expect(counts.kit ?? 0).toBeGreaterThan(1000);
    expect(counts.agent ?? 0).toBeGreaterThan(100);
  }, 240_000);
});
