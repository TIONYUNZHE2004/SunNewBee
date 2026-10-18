import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseManifest } from "../assets/manifest";
import { createFrame } from "../frame";
import { type Box, boxAround, seedFor } from "../stream/area";
import { tileAt } from "../stream/tiles";
import { capFor, PROP_CAPS } from "./caps";
import { planProps } from "./propsPlan";

const manifest = parseManifest(
  JSON.parse(
    readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
  ),
).manifest!;

const O: [number, number] = [101.5, 3.18];
const frame = createFrame(O);
const ll = (x: number, z: number) => frame.toLonLat(x, z);
const fc = (...features: unknown[]) => ({ type: "FeatureCollection", features });
const line = (type: string, pts: [number, number][], id = "w1") => ({
  type: "Feature",
  properties: { id, type },
  geometry: { type: "LineString", coordinates: pts.map(([x, z]) => ll(x, z)) },
});
const poly = (props: Record<string, unknown>, x0: number, z0: number, w: number, h: number) => ({
  type: "Feature",
  properties: props,
  geometry: {
    type: "Polygon",
    coordinates: [[ll(x0, z0), ll(x0 + w, z0), ll(x0 + w, z0 + h), ll(x0, z0 + h), ll(x0, z0)]],
  },
});
const point = (props: Record<string, unknown>, x: number, z: number) => ({
  type: "Feature",
  properties: props,
  geometry: { type: "Point", coordinates: ll(x, z) },
});

const base = {
  walk: fc(),
  landcover: fc(),
  buildings: fc(),
  parks: fc(),
  trees: fc(),
  places: fc(),
  frame,
  // The P3 hero circle fixture (r = 1200 m) becomes a single 2,400 m box.
  area: { box: boxAround(0, 0, 1200), seed: "t" },
  tier: "high" as const,
  caps: PROP_CAPS.high,
  m: manifest,
};
type In = Parameters<typeof planProps>[0];
type Out = ReturnType<typeof planProps>;
const plan = (over: Partial<In>): Out => planProps({ ...base, ...over });
const all = (p: Out) => [...p.kits.values()].flat();
const count = (p: Out, key: string) => p.kits.get(key)?.length ?? 0;
const ofAsset = (p: Out, asset: string) =>
  [...p.kits].filter(([k]) => k.startsWith(`${asset}/`)).flatMap(([, l]) => l);

describe("planProps", () => {
  const scene: Partial<In> = {
    walk: fc(
      line(
        "street",
        [
          [-300, 0],
          [300, 0],
        ],
        "s1",
      ),
      line(
        "major_road",
        [
          [0, -300],
          [0, 300],
        ],
        "m1",
      ),
    ),
    landcover: fc(
      poly({ class: "grass" }, 40, 40, 150, 150),
      poly({ class: "forest" }, -300, 40, 100, 100),
      poly({ class: "oil_palm" }, -300, -200, 100, 100),
      poly({ class: "construction" }, 50, -250, 95, 95),
    ),
    buildings: fc(poly({ id: "b1" }, -100, 10, 30, 30)),
    parks: fc(poly({ id: "p1" }, 40, 40, 150, 150)),
    trees: fc(point({ id: "t1" }, 60, -60), point({ id: "t2" }, -50, -80)),
    places: fc(
      point({ id: "pl1", type: "shelter", name: "x" }, 100, 20),
      point({ id: "pl2", type: "playground", name: "y" }, 120, 120),
    ),
  };

  it("is deterministic", () => {
    expect(plan(scene)).toEqual(plan(scene));
    expect(all(plan(scene)).length).toBeGreaterThan(100);
  });

  it("respects medium caps and gives an empty plan on low", () => {
    const dense: Partial<In> = {
      ...scene,
      landcover: fc(
        poly({ class: "forest" }, -500, -500, 900, 900),
        poly({ class: "oil_palm" }, 0, 0, 900, 900),
      ),
    };
    const med = plan({ ...dense, tier: "medium", caps: PROP_CAPS.medium });
    expect(ofAsset(med, "trees")).toHaveLength(capFor("medium", "trees"));
    const lamps = count(med, "furniture/lamp_single") + count(med, "furniture/lamp_double");
    expect(lamps).toBeLessThanOrEqual(capFor("medium", "lamps"));
    expect(all(plan({ ...dense, tier: "low" }))).toEqual([]);
    expect(all(plan({ ...dense, caps: PROP_CAPS.low }))).toEqual([]);
  });

  it("keeps the nearest props when a cap bites", () => {
    const dense: Partial<In> = {
      landcover: fc(poly({ class: "forest" }, -500, -500, 1000, 1000)),
    };
    const kept = ofAsset(plan({ ...dense, caps: PROP_CAPS.medium }), "trees");
    const full = ofAsset(plan({ ...dense, caps: PROP_CAPS.high }), "trees");
    expect(kept.length).toBeLessThan(full.length);
    const far = Math.max(...kept.map((t) => Math.hypot(t.x, t.z)));
    const dropped = full.filter((t) => !kept.some((k) => k.id === t.id));
    expect(Math.min(...dropped.map((t) => Math.hypot(t.x, t.z)))).toBeGreaterThanOrEqual(
      far - 1e-6,
    );
  });

  it("keeps trees 1.5 m off buildings and off ribbons", () => {
    const p = plan({
      ...scene,
      buildings: fc(poly({ id: "bx" }, 20, -8, 40, 14), poly({ id: "b1" }, -100, 10, 30, 30)),
    });
    const trees = ofAsset(p, "trees");
    expect(trees.length).toBeGreaterThan(50);
    for (const t of trees) {
      // building bx spans x 20..60, z -8..6, buffered by 1.5 m
      expect(t.x > 18.5 && t.x < 61.5 && t.z > -9.5 && t.z < 7.5).toBe(false);
      // the street ribbon at z=0 is 6 m wide and the cross road at x=0 is 10 m wide;
      // median palms sit on the major road by design
      const median = t.variant === "royal_palm" && Math.abs(t.x) < 0.01;
      if (!median) {
        expect(Math.abs(t.z) > 3 || Math.abs(t.x) > 300).toBe(true);
        expect(Math.abs(t.x) > 5 || Math.abs(t.z) > 300).toBe(true);
      }
    }
  });

  it("a 100 m street gets 6 trees per kerb (18 m spacing, inclusive ends) and 4 lamps", () => {
    const p = plan({
      walk: fc(
        line("street", [
          [-50, 0],
          [50, 0],
        ]),
      ),
    });
    const trees = ofAsset(p, "trees");
    expect(trees.filter((t) => t.z > 0)).toHaveLength(6);
    expect(trees.filter((t) => t.z < 0)).toHaveLength(6);
    for (const t of trees) expect(Math.abs(Math.abs(t.z) - 4.5)).toBeLessThan(1e-6);
    expect(count(p, "furniture/lamp_single")).toBe(4);
  });

  it("a 9,000 m2 construction plot gets one tower crane, a 1,000 m2 plot none", () => {
    const big = plan({ landcover: fc(poly({ class: "construction" }, 100, 100, 95, 95)) });
    expect(count(big, "construction/tower_crane")).toBe(1);
    expect(count(big, "construction/excavator")).toBe(1);
    expect(count(big, "construction/site_cabin")).toBe(1);
    expect(count(big, "construction/material_stack")).toBe(2);
    // the high cap (12) keeps the site's machines first and fills the rest with hoardings
    expect(count(big, "construction/hoarding_6m")).toBeGreaterThan(0);
    const small = plan({ landcover: fc(poly({ class: "construction" }, 100, 100, 32, 31)) });
    expect(count(small, "construction/tower_crane")).toBe(0);
    expect(count(small, "construction/excavator")).toBe(0);
    expect(count(small, "construction/site_cabin")).toBe(1);
  });

  it("puts oil palms only on oil_palm land", () => {
    const p = plan({
      landcover: fc(
        poly({ class: "oil_palm" }, 100, 100, 80, 80),
        poly({ class: "forest" }, -200, -200, 80, 80),
      ),
    });
    const oil = p.kits.get("trees/oil_palm") ?? [];
    expect(oil.length).toBeGreaterThan(50);
    for (const o of oil) expect(o.x >= 100 && o.x <= 180 && o.z >= 100 && o.z <= 180).toBe(true);
  });

  it("keeps everything inside the box, half-open", () => {
    const box: Box = { x0: -150, z0: -150, x1: 150, z1: 150 };
    const p = plan({ ...scene, area: { box, seed: "t" } });
    expect(all(p).length).toBeGreaterThan(10);
    for (const q of all(p))
      expect(q.x >= box.x0 && q.x < box.x1 && q.z >= box.z0 && q.z < box.z1).toBe(true);
  });

  it("only uses kit keys that exist in the manifest", () => {
    for (const k of plan(scene).kits.keys()) {
      const [a, v] = k.split("/");
      expect(manifest.assets[a!]?.variants[v!], k).toBeDefined();
    }
  });

  it("places bus shelters, benches, bins and bollards by place type", () => {
    const p = plan({
      places: fc(
        point({ id: "pl1", type: "shelter", name: "x" }, 100, 20),
        point({ id: "pl2", type: "playground", name: "y" }, 120, 120),
        point({ id: "pl3", type: "school", name: "z", entrance_ids: ["e1", "e2"] }, -100, 100),
        point({ id: "pl4", type: "clinic", name: "c", entrance_ids: ["e3"] }, 0, 100),
      ),
    });
    expect(count(p, "furniture/bus_shelter")).toBe(1);
    expect(count(p, "furniture/bench")).toBeGreaterThanOrEqual(2);
    expect(count(p, "furniture/bin")).toBe(count(p, "furniture/bench"));
    expect(count(p, "furniture/bollard")).toBe(10);
  });

  it("a dense forest at the centre does not starve street, OSM or park trees", () => {
    const p = plan({
      caps: PROP_CAPS.medium,
      landcover: fc(
        poly({ class: "forest" }, -400, -400, 800, 800),
        poly({ class: "oil_palm" }, 400, -400, 400, 800),
      ),
      walk: fc(
        line("street", [
          [-1000, 500],
          [1000, 500],
        ]),
      ),
      trees: fc(point({ id: "o1" }, 700, 700), point({ id: "o2" }, 710, 700)),
      parks: fc(poly({ id: "pk" }, 500, 600, 200, 200)),
    });
    const trees = ofAsset(p, "trees");
    expect(trees).toHaveLength(capFor("medium", "trees"));
    const near = (t: { id: string }, pre: string) => t.id.startsWith(pre);
    expect(trees.filter((t) => near(t, "st:")).length).toBeGreaterThan(5);
    expect(trees.filter((t) => near(t, "ot:"))).toHaveLength(2);
    expect(trees.filter((t) => near(t, "pk:")).length).toBeGreaterThan(2);
    expect(trees.filter((t) => near(t, "fo:")).length).toBeGreaterThan(2);
  });

  it("avoids a long road segment whose midpoint is outside the radius", () => {
    // A 5 km footway at z=1150 from x=-1500 to 3500: its midpoint (1000, 1150) is 1523 m from
    // the centre, beyond radius + 200, yet the segment crosses the disc (|x| < 343 at z=1150).
    const p = plan({
      walk: fc(
        line("footway", [
          [-1500, 1150],
          [3500, 1150],
        ]),
      ),
      landcover: fc(poly({ class: "forest" }, -300, 1100, 600, 100)),
    });
    const trees = ofAsset(p, "trees");
    expect(trees.length).toBeGreaterThan(20);
    // a footway ribbon is 2.5 m wide: no tree may sit inside it
    for (const t of trees) expect(Math.abs(t.z - 1150)).toBeGreaterThanOrEqual(1.25);
    // and the forest does reach the ribbon's neighbourhood, so the check is not vacuous
    expect(trees.some((t) => Math.abs(t.z - 1150) < 4)).toBe(true);
  });

  it("samples a polygon listed as both a park and grass once", () => {
    const land = fc(poly({ class: "grass" }, 40, 40, 150, 150));
    const once = plan({ landcover: land });
    const twice = plan({ landcover: land, parks: fc(poly({ id: "p" }, 40, 40, 150, 150)) });
    expect(ofAsset(twice, "trees").length).toBe(ofAsset(once, "trees").length);
  });

  it("under a tight cap every site keeps its cabin before any site gets extra machines", () => {
    const sites: [number, number][] = [
      [100, 100],
      [-300, 100],
      [500, 500],
    ];
    const p = plan({
      caps: { ...PROP_CAPS.high, construction: 3 },
      landcover: fc(...sites.map(([x, z]) => poly({ class: "construction" }, x, z, 95, 95))),
    });
    const built = ofAsset(p, "construction");
    expect(built).toHaveLength(3);
    expect(count(p, "construction/site_cabin")).toBe(3);
    for (const [x0, z0] of sites)
      expect(
        built.filter((q) => q.x >= x0 - 2 && q.x <= x0 + 97 && q.z >= z0 - 2 && q.z <= z0 + 97),
      ).toHaveLength(1);
  });

  it("rings the entrances of a mall with bollards", () => {
    const p = plan({
      places: fc(
        point({ id: "ml", type: "mall", name: "m", entrance_ids: ["e1", "e2", "e3"] }, 50, 50),
      ),
    });
    expect(count(p, "furniture/bollard")).toBe(15);
  });

  it("keeps trees at least 2.5 m apart", () => {
    const trees = ofAsset(plan(edgeScene), "trees");
    expect(trees.length).toBeGreaterThan(200);
    for (let i = 0; i < trees.length; i++)
      for (let j = i + 1; j < trees.length; j++)
        expect(
          Math.hypot(trees[i]!.x - trees[j]!.x, trees[i]!.z - trees[j]!.z),
        ).toBeGreaterThanOrEqual(2.5 - 1e-9);
  });
});

/** Everything crosses the shared edges x = 0 and z = 0 of the four quadrant tiles. */
const edgeScene: Partial<In> = {
  walk: fc(
    line(
      "street",
      [
        [-240, 1],
        [240, -1],
      ],
      "s1",
    ),
    line(
      "major_road",
      [
        [0, -240],
        [0, 240],
      ],
      "m1",
    ),
    line(
      "street",
      [
        [-120, -240],
        [-118, 240],
      ],
      "s2",
    ),
  ),
  landcover: fc(
    poly({ class: "grass" }, 20, 20, 120, 120),
    poly({ class: "forest" }, -90, -90, 120, 70),
    poly({ class: "oil_palm" }, -200, 60, 230, 100),
    poly({ class: "construction" }, 30, -150, 95, 95),
    poly({ class: "construction" }, -60, -230, 120, 60),
  ),
  buildings: fc(poly({ id: "b1" }, -40, 10, 30, 30), poly({ id: "b2" }, 5, -40, 30, 20)),
  parks: fc(poly({ id: "p1" }, -60, 100, 120, 80)),
  trees: fc(point({ id: "t1" }, 0, -60), point({ id: "t2" }, -0.5, -80), point({ id: "t3" }, 1, 1)),
  places: fc(
    point({ id: "pl1", type: "shelter", name: "x" }, 1, 20),
    point({ id: "pl2", type: "playground", name: "y" }, -2, 120),
    point({ id: "pl3", type: "school", name: "z", entrance_ids: ["e1", "e2"] }, 3, -3),
  ),
};
const BIG = { trees: 1e6, lamps: 1e6, furniture: 1e6, construction: 1e6 };
const Q: Box[] = [
  { x0: -250, z0: -250, x1: 0, z1: 0 },
  { x0: 0, z0: -250, x1: 250, z1: 0 },
  { x0: -250, z0: 0, x1: 0, z1: 250 },
  { x0: 0, z0: 0, x1: 250, z1: 250 },
];
const U: Box = { x0: -250, z0: -250, x1: 250, z1: 250 };
const byId = <T extends { id: string }>(l: T[]) => [...l].sort((a, b) => (a.id < b.id ? -1 : 1));
const placements = (p: Out) => byId(all(p));

describe("planProps per tile box", () => {
  const at = (box: Box, seed = "t") => plan({ ...edgeScene, caps: BIG, area: { box, seed } });

  it("four tiles planned separately give exactly the placements of their union", () => {
    const parts = Q.map((b, i) => placements(at(b, `q${i}`)));
    const union = placements(at(U, "u"));
    expect(union.length).toBeGreaterThan(300);
    // No duplicates: every id is placed by one tile only.
    const ids = parts.flat().map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    // No gaps: the same set, placement for placement.
    expect(byId(parts.flat())).toEqual(union);
    // Not vacuous: props sit on both sides of the shared edges.
    for (const s of [1, -1]) {
      expect(union.some((q) => s * q.x >= 0 && Math.abs(q.x) < 3)).toBe(true);
      expect(union.some((q) => s * q.z >= 0 && Math.abs(q.z) < 3)).toBe(true);
    }
  });

  it("each kit bucket splits the same way (the kits, not just the ids)", () => {
    const union = at(U);
    for (const [key, list] of union.kits) {
      const split = Q.flatMap((b) => at(b).kits.get(key) ?? []);
      expect(byId(split), key).toEqual(byId(list));
    }
  });

  it("is deterministic per tile key, whatever was planned before", () => {
    const tile = tileAt(10, 10);
    const area = { box: tile.box, seed: seedFor(tile.key, "props") };
    const first = plan({ ...edgeScene, area, caps: PROP_CAPS.medium });
    plan({ ...edgeScene, area: { box: Q[0]!, seed: "x" }, caps: PROP_CAPS.medium });
    expect(plan({ ...edgeScene, area, caps: PROP_CAPS.medium })).toEqual(first);
    expect(all(first).length).toBeGreaterThan(20);
  });

  it("streets just outside a shared edge still put their kerb trees and lamps across it", () => {
    // Streets parallel to the shared edges, 3–6 m outside them: their far-kerb trees (4.5 m off
    // the centre line) and lamps (3.8 m) land in the neighbouring tile.
    const seam: Partial<In> = {
      walk: fc(
        ...[3, -4.5, 6].map((x, i) =>
          line(
            "street",
            [
              [x, -240],
              [x, 240],
            ],
            `sx${i}`,
          ),
        ),
        ...[-3, 5].map((z, i) =>
          line(
            "street",
            [
              [-240, z],
              [240, z],
            ],
            `sz${i}`,
          ),
        ),
      ),
    };
    const kerb = (box: Box) =>
      byId(
        all(plan({ ...seam, caps: BIG, area: { box, seed: "t" } })).filter(
          (q) => q.asset === "trees" || q.variant.startsWith("lamp"),
        ),
      );
    const parts = Q.flatMap((b) => kerb(b));
    const union = kerb(U);
    expect(new Set(parts.map((q) => q.id)).size).toBe(parts.length);
    expect(byId(parts)).toEqual(union);
    // Not vacuous: the x = 3 street's west-kerb trees and lamps sit in the west tiles.
    const west = union.filter((q) => q.id.includes(":sx0:") && q.x < 0);
    expect(west.some((q) => q.asset === "trees")).toBe(true);
    expect(west.some((q) => q.variant.startsWith("lamp"))).toBe(true);
  });

  it("each tile keeps only points inside its own half-open box, edge points included", () => {
    // The major road's median palms and lamps run along x = 0, the shared edge.
    let onEdge = 0;
    for (const box of Q)
      for (const q of all(at(box))) {
        expect(q.x >= box.x0 && q.x < box.x1 && q.z >= box.z0 && q.z < box.z1).toBe(true);
        if (Math.abs(q.x) < 1e-6) onEdge++;
      }
    expect(onEdge).toBeGreaterThan(5);
  });
});
