import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../../lib/api";
import { parseManifest } from "../assets/manifest";
import { buildCityGeometry } from "../cityMesh";
import { createFrame } from "../frame";
import { planProps } from "../props/propsPlan";
import { CLAY_PALETTE } from "../shared/clayTokens";
import { boxAround } from "../stream/area";
import { guardTile } from "../stream/clipTile";
import type { TileContent } from "../stream/streamer";
import { allWithin, boundaryOf, CLIP_TOLERANCE_M, insideBoundary } from "./boundary";
import { clipLayer } from "./clipLayer";
import { DRESS_LOD, DRESS_STRIDE, DRESS_WALK_CLEAR_M, planDressing } from "./dressingPlan";
import { detailColour, grassAltShare } from "./groundDetail";
import { dressingFor, GRASS_TONES, LANDCOVER_DRESSING, LANDCOVER_ORDER } from "./landcover";

const SEED = (p: string) => new URL(`../../../../../../../data/seed/elmina/${p}`, import.meta.url);
const HAVE =
  existsSync(SEED("base/landcover.geojson")) && existsSync(SEED("base/boundary.geojson"));
const read = (p: string) => JSON.parse(readFileSync(SEED(p), "utf8"));

describe("AC-A12: the dressing table", () => {
  it("covers every class in the seed's landcover.geojson, with no grey fallback", () => {
    if (!HAVE) return;
    const classes = new Set<string>(
      read("base/landcover.geojson").features.map(
        (f: { properties: { class: string } }) => f.properties.class,
      ),
    );
    expect(classes.size).toBeGreaterThanOrEqual(12);
    for (const c of classes) {
      expect(LANDCOVER_DRESSING[c], c).toBeDefined();
      const d = dressingFor(c);
      expect(d.tones.length, c).toBeGreaterThan(0);
      expect(d.tones[0], c).toBe((CLAY_PALETTE.landcover as Record<string, string>)[c]);
      expect(d.tones[0], c).not.toBe(CLAY_PALETTE.landcoverUnknown);
      // Every class has a rule: props, a plain reason, or both.
      const has = d.trees || d.flowers || d.rows || d.constructionKit || d.parkedCars || d.plain;
      expect(has, c).toBeTruthy();
    }
  });

  it("the table and the draw order name the same classes", () => {
    expect(Object.keys(LANDCOVER_DRESSING).sort()).toEqual([...LANDCOVER_ORDER].sort());
  });

  it("assigns the rules the brief asks for", () => {
    expect(dressingFor("forest").trees).toBe("forest");
    expect(dressingFor("scrub").trees).toBe("scrub");
    expect(dressingFor("oil_palm").trees).toBe("oil_palm");
    expect(dressingFor("grass").flowers).toBe(true);
    expect(dressingFor("farmland").rows).toBe(true);
    expect(dressingFor("construction").constructionKit).toBe(true);
    expect(dressingFor("parking").parkedCars).toBe(true);
    expect(dressingFor("nonsense").tones).toEqual([CLAY_PALETTE.landcoverUnknown]);
  });
});

describe("AC-A12: grass shows two tones", () => {
  it("the table lists two tones and the detail mixes both over a lawn", () => {
    expect(GRASS_TONES[0]).not.toBe(GRASS_TONES[1]);
    expect(dressingFor("grass").tones).toEqual(GRASS_TONES);
    let lo = 0;
    let hi = 0;
    const seen = new Set<string>();
    for (let x = -300; x < 300; x += 7)
      for (let z = -300; z < 300; z += 7) {
        const s = grassAltShare(x, z);
        if (s < 0.05) lo++;
        if (s > 0.95) hi++;
        seen.add(detailColour("grass", GRASS_TONES[0], x, z).getHexString().slice(0, 4));
      }
    expect(lo).toBeGreaterThan(100);
    expect(hi).toBeGreaterThan(100);
    expect(seen.size).toBeGreaterThan(4);
  });
});

describe("AC-A12: no invented buildings", () => {
  it("the drawn building count equals the OSM footprint count in the boundary", () => {
    if (!HAVE || !existsSync(SEED("base/buildings.geojson"))) return;
    const frame = createFrame(read("site.json").center);
    const boundary = boundaryOf(read("base/boundary.geojson").features[0].geometry, frame)!;
    const raw = { buildings: read("base/buildings.geojson") } as unknown as BuildingsLayer;
    // The clipLayer predicate: every footprint vertex within CLIP_TOLERANCE_M of the inside.
    let inBoundary = 0;
    for (const f of raw.buildings.features as {
      geometry: { type: string; coordinates: unknown };
    }[]) {
      const polys =
        f.geometry.type === "Polygon"
          ? [f.geometry.coordinates]
          : f.geometry.type === "MultiPolygon"
            ? (f.geometry.coordinates as unknown[])
            : [];
      const pts = (polys as [number, number][][][]).flatMap((p) =>
        (p[0] ?? []).map(([lon, lat]) => frame.toLocal(lon, lat)),
      );
      if (pts.length > 0 && allWithin(boundary, pts, CLIP_TOLERANCE_M)) inBoundary++;
    }
    const { layer } = clipLayer(raw, boundary, frame);
    const drawn = buildCityGeometry(layer, frame);
    expect(inBoundary).toBeGreaterThan(100);
    expect(drawn.footprints.length + drawn.skipped).toBe(inBoundary);
    expect(drawn.skipped).toBe(0);
  });
});

describe("planDressing on the Elmina seed", () => {
  const frame = HAVE ? createFrame(read("site.json").center) : createFrame([101.5, 3.18]);
  const landcover = HAVE ? read("base/landcover.geojson") : { features: [] };
  const walk =
    HAVE && existsSync(SEED("base/walk.geojson")) ? read("base/walk.geojson") : { features: [] };

  /** Local centre of the first polygon of a class (the hero box of the test). */
  const centreOf = (cls: string): [number, number] => {
    let best: [number, number] = [0, 0];
    let bestA = -1;
    for (const f of landcover.features as {
      properties: { class: string };
      geometry: { type: string; coordinates: any };
    }[]) {
      if (f.properties.class !== cls) continue;
      const polys =
        f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys as [number, number][][][]) {
        const pts = poly[0]!.map(([lon, lat]) => frame.toLocal(lon, lat));
        const xs = pts.map((p) => p[0]);
        const zs = pts.map((p) => p[1]);
        const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
        if (area > bestA) {
          bestA = area;
          best = pts[0]!;
        }
      }
    }
    return best;
  };
  const plan = (cls: string, ring: 0 | 1 | 2 = 0, tier: "low" | "medium" | "high" = "high") => {
    const [cx, cz] = centreOf(cls);
    return planDressing({ landcover, walk, frame, box: boxAround(cx, cz, 400), ring, tier });
  };

  it("dresses grass with flowers, farmland with rows, construction with cones and mounds", () => {
    if (!HAVE) return;
    const g = plan("grass");
    const f = plan("farmland");
    const c = plan("construction");
    expect(g.counts.flowerClumps).toBeGreaterThan(0);
    expect(f.counts.rowStripes).toBeGreaterThan(0);
    expect(c.counts.mounds).toBeGreaterThan(0);
    expect(c.counts.cones).toBeGreaterThan(0);
    for (const p of [g, f, c]) {
      expect(p.tris.length % DRESS_STRIDE).toBe(0);
      expect(p.counts.triangles).toBe(p.tris.length / DRESS_STRIDE);
    }
    console.log(
      "instances per class (ring 0, 800 m box):",
      JSON.stringify({ grass: g.counts, farmland: f.counts, construction: c.counts }),
    );
  });

  it("is deterministic and thins by ring, tier and Low", () => {
    if (!HAVE) return;
    expect(plan("grass").tris).toEqual(plan("grass").tris);
    const r0 = plan("grass", 0).counts.flowerClumps;
    expect(plan("grass", 1).counts.flowerClumps).toBeLessThanOrEqual(DRESS_LOD.flowers[1]);
    expect(plan("grass", 1).counts.flowerClumps).toBeLessThan(r0);
    expect(plan("grass", 2).counts.flowerClumps).toBe(0);
    expect(plan("grass", 0, "medium").counts.flowerClumps).toBeLessThanOrEqual(r0);
    expect(plan("grass", 0, "low").tris.length).toBe(0);
    expect(plan("farmland", 2).counts.triangles).toBeLessThanOrEqual(DRESS_LOD.rowMaxTris[2]);
  });

  it("never puts a piece within 1 m of a walk line, and uses clay tokens only", () => {
    if (!HAVE) return;
    const segs: [[number, number], [number, number]][] = [];
    for (const f of walk.features as {
      geometry: { type: string; coordinates: [number, number][] };
    }[]) {
      if (f.geometry.type !== "LineString") continue;
      const pts = f.geometry.coordinates.map(([lon, lat]) => frame.toLocal(lon, lat));
      for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i]!, pts[i + 1]!]);
    }
    const dist = (x: number, z: number, [a, b]: [[number, number], [number, number]]) => {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
    };
    const rgb = (r: number, g: number, bl: number) =>
      [r, g, bl].map((v) => Math.round(v * 255)).join(",");
    const allowed = new Set(
      [
        ...CLAY_PALETTE.prop.flowers,
        CLAY_PALETTE.dress.farmRow,
        CLAY_PALETTE.dress.farmRowAlt,
        CLAY_PALETTE.dress.mound,
        CLAY_PALETTE.prop.awningRed,
      ].map((h) => {
        const c = new THREE.Color(h);
        return rgb(c.r, c.g, c.b);
      }),
    );
    const boxes = segs.map(([a, b]) => [
      Math.min(a[0], b[0]) - 3,
      Math.max(a[0], b[0]) + 3,
      Math.min(a[1], b[1]) - 3,
      Math.max(a[1], b[1]) + 3,
    ]);
    let checked = 0;
    let minD = Number.POSITIVE_INFINITY;
    for (const cls of ["grass", "farmland", "construction"]) {
      const p = plan(cls);
      for (let t = 0; t < p.tris.length; t += DRESS_STRIDE) {
        for (let v = 0; v < 3; v++) {
          const x = p.tris[t + v * 6]!;
          const z = p.tris[t + v * 6 + 2]!;
          for (let i = 0; i < segs.length; i++) {
            const q = boxes[i]!;
            if (x < q[0]! || x > q[1]! || z < q[2]! || z > q[3]!) continue;
            minD = Math.min(minD, dist(x, z, segs[i]!));
          }
        }
        expect(allowed.has(rgb(p.tris[t + 3]!, p.tris[t + 4]!, p.tris[t + 5]!))).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(minD).toBeGreaterThanOrEqual(DRESS_WALK_CLEAR_M - 0.01);
  }, 60_000);

  it("guardTile keeps only dressing inside the boundary", () => {
    if (!HAVE) return;
    const boundary = boundaryOf(read("base/boundary.geojson").features[0].geometry, frame)!;
    const [cx, cz] = centreOf("grass");
    const tris = plan("grass").tris;
    const content = {
      dressing: { tris, counts: plan("grass").counts },
      kits: new Map(),
      lamps: [],
      agents: [],
      signs: [],
      ribbons: [],
    } as unknown as TileContent;
    const out = guardTile(content, boundary);
    const t = out.dressing?.tris ?? new Float32Array(0);
    for (let o = 0; o < t.length; o += DRESS_STRIDE)
      for (let v = 0; v < 3; v++)
        expect(insideBoundary(boundary, t[o + v * 6]!, t[o + v * 6 + 2]!)).toBe(true);
    expect(Number.isFinite(cx + cz)).toBe(true);
  });
});

describe("scrub is massed with trees", () => {
  it("planProps places shrubs and trees on a scrub polygon, off the walk lines", () => {
    const manifest = parseManifest(
      JSON.parse(
        readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
      ),
    ).manifest!;
    const frame = createFrame([101.5, 3.18]);
    const ll = (x: number, z: number) => frame.toLonLat(x, z);
    const fc = (...features: unknown[]) => ({ type: "FeatureCollection", features });
    const scrub = {
      type: "Feature",
      properties: { class: "scrub", id: "s1" },
      geometry: {
        type: "Polygon",
        coordinates: [[ll(0, 0), ll(120, 0), ll(120, 120), ll(0, 120), ll(0, 0)]],
      },
    };
    const path = {
      type: "Feature",
      properties: { id: "p1", type: "path" },
      geometry: { type: "LineString", coordinates: [ll(0, 60), ll(120, 60)] },
    };
    const plan = planProps({
      walk: fc(path),
      landcover: fc(scrub),
      buildings: fc(),
      parks: fc(),
      trees: fc(),
      places: fc(),
      frame,
      area: { box: boxAround(60, 60, 200), seed: "t" },
      tier: "high",
      caps: { trees: 3000, lamps: 0, furniture: 0, construction: 0 },
      m: manifest,
    });
    const trees = [...plan.kits].filter(([k]) => k.startsWith("trees/")).flatMap(([, l]) => l);
    expect(trees.length).toBeGreaterThan(30);
    for (const t of trees) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(120);
      expect(Math.abs(t.z - 60)).toBeGreaterThanOrEqual(1);
    }
  });
});
