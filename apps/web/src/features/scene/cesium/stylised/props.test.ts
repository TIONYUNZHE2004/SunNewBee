import { describe, expect, it } from "vitest";
import { fakeCesium, fakeCollection } from "./fakeCesium.test-util";
import type { Road } from "./ground";
import { scatterTrees } from "./model";
import { paletteFor } from "./palette";
import { buildProps, type Car, kerbCars, type PropsCesium, streetTrees, type Tree } from "./props";

const M_PER_DEG = 111_320;
// A 400 m east-west residential street, a 400 m major road and a 400 m footway.
const street = (
  id: string,
  widthM: number,
  y = 3.18,
  kind: Road["kind"] = widthM === 6 ? "residential" : widthM === 10 ? "major" : "footway",
): Road => ({
  id,
  coords: [
    [101.5, y],
    [101.5 + 400 / (M_PER_DEG * Math.cos((y * Math.PI) / 180)), y],
  ],
  widthM,
  kind,
});

describe("residential detection uses the road kind, not its width", () => {
  it("a residential street of any width gets cars/trees; a 6 m footway does not", () => {
    const res5 = street("res5", 5, 3.18, "residential");
    const foot6 = street("foot6", 6, 3.19, "footway");
    expect(kerbCars([res5], "s", { density: 1 }).length).toBeGreaterThan(0);
    expect(streetTrees([res5], "s", { keep: 1 }).length).toBeGreaterThan(0);
    expect(kerbCars([foot6], "s", { density: 1 })).toEqual([]);
    expect(streetTrees([foot6], "s", { keep: 1 })).toEqual([]);
  });
});

describe("kerbCars", () => {
  const roads = [street("res", 6), street("major", 10, 3.19), street("foot", 2.5, 3.2)];

  it("parks cars only on residential/service streets, deterministically", () => {
    const a = kerbCars(roads, "elmina");
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(kerbCars(roads, "elmina"));
    expect(kerbCars(roads, "other")).not.toEqual(a);
    // Every car is beside the residential street (y = 3.18), none on the major road or footway.
    for (const c of a) expect(Math.abs(c.lat - 3.18) * M_PER_DEG).toBeLessThan(3.5);
  });

  it("parks at the kerb (offset from the centre line), heading along the street", () => {
    for (const c of kerbCars(roads, "elmina")) {
      const off = Math.abs(c.lat - 3.18) * M_PER_DEG;
      expect(off).toBeGreaterThan(1);
      expect(Math.abs(Math.sin(c.headingRad))).toBeLessThan(1e-6); // east-west street
      expect([0, 1, 2]).toContain(c.tone);
    }
  });

  it("respects the cap", () => {
    const many = Array.from({ length: 50 }, (_, i) => street(`s${i}`, 6, 3.18 + i * 0.001));
    expect(kerbCars(many, "elmina", { max: 7 })).toHaveLength(7);
  });
});

describe("streetTrees", () => {
  it("lines residential streets outside the carriageway, deterministic and capped", () => {
    const roads = [street("res", 6), street("foot", 2.5, 3.2)];
    const t = streetTrees(roads, "elmina");
    expect(t.length).toBeGreaterThan(3);
    expect(t).toEqual(streetTrees(roads, "elmina"));
    for (const p of t) {
      const off = Math.abs(p.lat - 3.18) * M_PER_DEG;
      expect(off).toBeGreaterThan(3); // beyond the 3 m half-width
      expect(off).toBeLessThan(8);
      expect(p.h).toBeGreaterThanOrEqual(4);
    }
    expect(streetTrees(roads, "elmina", { max: 2 })).toHaveLength(2);
  });

  it("park scatter (Task 1 scatterTrees) stays deterministic for reuse here", () => {
    const park: [number, number][] = [
      [101.5, 3.18],
      [101.502, 3.18],
      [101.502, 3.182],
      [101.5, 3.182],
      [101.5, 3.18],
    ];
    expect(scatterTrees([park], "elmina", 20)).toEqual(scatterTrees([park], "elmina", 20));
  });
});

const trees: Tree[] = [
  { lon: 101.5, lat: 3.18, h: 6 },
  { lon: 101.501, lat: 3.18, h: 5 },
  { lon: 101.502, lat: 3.18, h: 7 },
];
const cars: Car[] = [
  { lon: 101.5, lat: 3.181, headingRad: 0, tone: 0 },
  { lon: 101.5, lat: 3.182, headingRad: 1, tone: 2 },
];

const AT = { lon: 101.5, lat: 3.18 };

function setup(theme: "day" | "night" = "night") {
  const f = fakeCesium();
  const collection = fakeCollection();
  const out = buildProps(
    f.C as unknown as PropsCesium,
    { trees, cars, palette: paletteFor(theme), at: AT },
    collection,
  );
  return { ...f, collection, out };
}

describe("buildProps", () => {
  it("never creates a pickable prop", () => {
    const { primitives } = setup();
    expect(primitives.length).toBeGreaterThan(0);
    for (const p of primitives) {
      expect(p.kind).toBe("Primitive");
      expect(p.options).toMatchObject({ allowPicking: false, asynchronous: true, shadows: 2 });
    }
  });

  it("instances: two canopies colours + trunks for trees, body + cabin per car", () => {
    const { primitives } = setup();
    const n = primitives.reduce((s, p) => s + (p.options.geometryInstances as unknown[]).length, 0);
    expect(n).toBe(trees.length * 2 + cars.length * 2);
  });

  it("setTheme mutates colours in place (before ready) and ends on the latest theme", () => {
    const { out, primitives, materials } = setup("night");
    const before = primitives.length;
    out.setTheme("day");
    out.setTheme("night");
    out.setTheme("day");
    const day = paletteFor("day");
    const colours = materials.map((m) => (m.uniforms.color as { css: string }).css);
    for (const c of colours) {
      expect([...day.tree, day.trunk, ...day.car]).toContain(c);
    }
    expect(primitives).toHaveLength(before);
  });

  it("uses flat lit materials and setTheme rewrites the light uniforms", () => {
    const { out, primitives, materials } = setup("night");
    for (const p of primitives)
      expect((p.options.appearance as { options: Record<string, unknown> }).options).toMatchObject({
        flat: true,
        translucent: false,
      });
    out.setTheme("day");
    const day = paletteFor("day");
    for (const m of materials) {
      expect(m.writes).toEqual(expect.arrayContaining(["color", "keyColor", "horizonColor"]));
      expect(m.uniforms.keyColor).toEqual({ css: day.light.key });
      expect(m.uniforms.horizonColor).toEqual({ css: day.horizon });
    }
  });

  it("destroy removes and destroys once, idempotent; empty input creates nothing", () => {
    const { out, primitives, collection } = setup();
    out.destroy();
    out.destroy();
    expect(collection.remove).toHaveBeenCalledTimes(primitives.length);
    for (const p of primitives) expect(p.destroy).toHaveBeenCalledTimes(1);
    const f = fakeCesium();
    const empty = buildProps(f.C as unknown as PropsCesium, {
      trees: [],
      cars: [],
      palette: paletteFor("day"),
      at: AT,
    });
    expect(f.primitives).toHaveLength(0);
    expect(() => {
      empty.setTheme("night");
      empty.destroy();
    }).not.toThrow();
  });
});
