import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseManifest } from "../assets/manifest";
import { createFrame } from "../frame";
import { capFor } from "./caps";
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
  centre: O,
  radiusM: 1200,
  tier: "high" as const,
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
    const med = plan({ ...dense, tier: "medium" });
    expect(ofAsset(med, "trees")).toHaveLength(capFor("medium", "trees"));
    const lamps = count(med, "furniture/lamp_single") + count(med, "furniture/lamp_double");
    expect(lamps).toBeLessThanOrEqual(capFor("medium", "lamps"));
    expect(all(plan({ ...dense, tier: "low" }))).toEqual([]);
  });

  it("keeps the nearest props when a cap bites", () => {
    const dense: Partial<In> = {
      landcover: fc(poly({ class: "forest" }, -500, -500, 1000, 1000)),
    };
    const kept = ofAsset(plan({ ...dense, tier: "medium" }), "trees");
    const full = ofAsset(plan({ ...dense, tier: "high" }), "trees");
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

  it("keeps everything inside the radius", () => {
    const p = plan({ ...scene, radiusM: 150 });
    expect(all(p).length).toBeGreaterThan(10);
    for (const q of all(p)) expect(Math.hypot(q.x, q.z)).toBeLessThanOrEqual(150 + 1e-6);
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
});
