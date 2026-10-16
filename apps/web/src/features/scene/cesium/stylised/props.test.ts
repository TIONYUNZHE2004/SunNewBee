import { describe, expect, it, vi } from "vitest";
import { fakeCesium, fakeCollection, fakeEvent } from "./fakeCesium.test-util";
import type { Road } from "./ground";
import { scatterTrees } from "./model";
import { paletteFor } from "./palette";
import {
  buildProps,
  type Car,
  kerbCars,
  POOL_ALPHA,
  type PropsCesium,
  type PropsGroundScene,
  streetLamps,
  streetTrees,
  type Tree,
} from "./props";
import type { RoofItem } from "./roofs";

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

describe("streetLamps", () => {
  it("lamps line residential and major roads only, seeded", () => {
    const roads = [street("r", 6, 3.18, "residential"), { ...street("f", 2.5, 3.19, "footway") }];
    const lamps = streetLamps(roads, "s");
    expect(lamps.length).toBeGreaterThan(8);
    expect(lamps.every((l) => Math.abs(l.lat - 3.18) * M_PER_DEG < 10)).toBe(true);
    expect(streetLamps(roads, "s")).toEqual(lamps);
    expect(streetLamps([street("m", 10, 3.2, "major")], "s").length).toBeGreaterThan(0);
    expect(streetLamps([street("r", 6, 3.18, "residential")], "s", { max: 3 })).toHaveLength(3);
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
      expect([0, 1, 2, 3, 4]).toContain(c.tone);
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
  { lon: 101.5, lat: 3.18, h: 6, tier2: false },
  { lon: 101.501, lat: 3.18, h: 5, tier2: true },
  { lon: 101.502, lat: 3.18, h: 7, tier2: false },
];
const cars: Car[] = [
  { lon: 101.5, lat: 3.181, headingRad: 0, tone: 0 },
  { lon: 101.5, lat: 3.182, headingRad: 1, tone: 4 },
];

const AT = { lon: 101.5, lat: 3.18 };

const lamps = [
  { lon: 101.5, lat: 3.1801 },
  { lon: 101.5005, lat: 3.1801 },
];
const roofItems: RoofItem[] = [
  { lon: 101.5, lat: 3.18, z: 13, kind: "ac", sizeM: 1.2 },
  { lon: 101.5, lat: 3.18, z: 13, kind: "tank", sizeM: 1.6 },
];

const isPool = (p: { kind: string }) => p.kind === "ClassificationPrimitive";

function setup(theme: "day" | "night" = "night", range = 1500, sway = true) {
  const f = fakeCesium();
  // Keep the colour object (with its alpha) as the attribute value so tests can read it.
  Object.assign(f.C.ColorGeometryInstanceAttribute, {
    fromColor: (c: unknown) => ({ value: c }),
    toValue: (c: unknown) => c,
  });
  const collection = fakeCollection();
  const ground = {
    groundPrimitives: fakeCollection(),
    postRender: fakeEvent(),
    requestRender: vi.fn(),
  };
  const out = buildProps(
    f.C as unknown as PropsCesium,
    {
      trees,
      cars,
      lamps,
      roofItems,
      palette: paletteFor(theme),
      at: AT,
      detailRangeM: range,
      sway,
    },
    collection,
    ground as unknown as PropsGroundScene,
  );
  return { ...f, collection, ground, out };
}

describe("buildProps", () => {
  it("never creates a pickable prop", () => {
    const { primitives } = setup();
    expect(primitives.length).toBeGreaterThan(0);
    for (const p of primitives) {
      expect(p.kind).toBe(isPool(p) ? "ClassificationPrimitive" : "Primitive");
      expect(p.options).toMatchObject({ allowPicking: false, asynchronous: true });
      // Solid props cast shadows; the light pool is a flat ground decal.
      if (!isPool(p)) expect(p.options.shadows).toBe(2);
    }
  });

  it("only canopies get the swaying vertex shader and the textured vertex format", () => {
    const { primitives, geometries } = setup();
    const vs = (p: (typeof primitives)[number]) =>
      String(
        (p.options.appearance as { options?: { vertexShaderSource?: string } })?.options
          ?.vertexShaderSource ?? "",
      );
    const swaying = primitives.filter((p) => vs(p).includes("TL_SWAY"));
    expect(swaying.length).toBeGreaterThan(0);
    expect(swaying.length).toBeLessThanOrEqual(3); // one per canopy tone
    for (const p of swaying) {
      expect(p.options.appearance).toMatchObject({
        options: { materialSupport: { vertexFormat: { textured: true } } },
      });
    }
    for (const p of primitives.filter((q) => !swaying.includes(q))) {
      expect(vs(p)).toBe(""); // trunks, cars, lamps, pools and roof items stay still
    }
    expect(geometries.find((g) => g.kind === "ellipsoid")?.options.vertexFormat).toEqual({
      textured: true,
    });
  });

  it("with sway off (Motion off / reduced motion) no canopy gets the swaying shader", () => {
    const { primitives, geometries } = setup("day", 1500, false);
    for (const p of primitives) {
      const vs = (p.options.appearance as { options?: { vertexShaderSource?: string } })?.options
        ?.vertexShaderSource;
      expect(String(vs ?? "")).not.toContain("TL_SWAY");
    }
    expect(geometries.find((g) => g.kind === "ellipsoid")?.options.vertexFormat).toEqual({
      basic: true,
    });
  });

  it("instances: two canopies colours + trunks for trees, body + cabin per car", () => {
    const { primitives } = setup();
    const n = primitives.reduce((s, p) => s + (p.options.geometryInstances as unknown[]).length, 0);
    // canopies (+1 tier-2) and trunks, body + cabin per car, post + head per lamp, pools, roof items
    expect(n).toBe(trees.length * 2 + 1 + cars.length * 2 + lamps.length * 3 + roofItems.length);
  });

  it("setPalette mutates colours in place (before ready) and ends on the latest theme", () => {
    const { out, primitives, materials } = setup("night");
    const before = primitives.length;
    out.setPalette(paletteFor("day"), true);
    out.setPalette(paletteFor("night"), true);
    out.setPalette(paletteFor("day"), true);
    const day = paletteFor("day");
    const colours = materials.map((m) => (m.uniforms.color as { css: string }).css);
    for (const c of colours) {
      expect([
        ...day.tree,
        day.trunk,
        ...day.car,
        day.lampPost,
        day.lampHead,
        day.lightPool,
        day.roofItem,
      ]).toContain(c);
    }
    expect(primitives).toHaveLength(before);
  });

  it("uses flat lit materials and setPalette rewrites the light uniforms", () => {
    const { out, primitives, materials } = setup("night");
    for (const p of primitives.filter((q) => !isPool(q)))
      expect((p.options.appearance as { options: Record<string, unknown> }).options).toMatchObject({
        flat: true,
        translucent: false,
      });
    out.setPalette(paletteFor("day"), true);
    const day = paletteFor("day");
    for (const m of materials.filter((x) => x.type === "fabric")) {
      expect(m.writes).toEqual(expect.arrayContaining(["color", "keyColor", "horizonColor"]));
      expect(m.uniforms.keyColor).toEqual({ css: day.light.key });
      expect(m.uniforms.horizonColor).toEqual({ css: day.horizon });
    }
  });

  it("setTime writes the time uniform on every lit material; setPalette keeps it", () => {
    const { out, materials } = setup("day");
    const lit = materials.filter((m) => m.type === "fabric");
    expect(lit.length).toBeGreaterThan(0);
    out.setTime(7);
    for (const m of lit) expect(m.uniforms.time).toBe(7);
    out.setPalette(paletteFor("night"), true);
    for (const m of lit) {
      expect(m.uniforms.time).toBe(7);
      expect(m.uniforms.cloudShadow).toBe(0);
    }
    // The light pool (plain Color material) has no time uniform.
    for (const m of materials.filter((x) => x.type !== "fabric"))
      expect(m.uniforms).not.toHaveProperty("time");
  });

  it("pools are one flat classification band in groundPrimitives, lowered under the overlays", () => {
    const { primitives, ground, collection } = setup("night");
    const pools = primitives.filter(isPool);
    expect(pools).toHaveLength(1);
    const pool = pools[0]!;
    expect(ground.groundPrimitives.add).toHaveBeenCalledWith(pool);
    expect(ground.groundPrimitives.lowerToBottom).toHaveBeenCalledWith(pool);
    expect(collection.add).not.toHaveBeenCalledWith(pool);
    expect(pool.options.appearance).toMatchObject({ options: { flat: true, translucent: true } });
    const instances = pool.options.geometryInstances as {
      options: { attributes: { color: { value: { css: string; alpha: number } } } };
    }[];
    const night = paletteFor("night");
    for (const i of instances)
      expect(i.options.attributes.color.value).toEqual({
        css: night.lightPool,
        alpha: POOL_ALPHA * night.glow,
      });
  });

  it("lamp heads glow, pools fade with the palette and hide by day", () => {
    const { out, primitives, materials, ground } = setup("night");
    const pool = primitives.find(isPool) as (typeof primitives)[number] & {
      attrs: Map<string, { color?: unknown }>;
    };
    expect(pool.show).toBe(true);
    const head = materials.find((m) => "glow" in m.uniforms)!;
    expect(head.uniforms.glow).toBe(paletteFor("night").glow);
    out.setPalette(paletteFor("day"), true);
    expect(head.uniforms.glow).toBe(0);
    expect(pool.show).toBe(false);
    // Not ready yet: the colour lands once it is.
    pool.ready = true;
    ground.postRender.fire();
    expect(pool.attrs.get("pool:0")?.color).toEqual({ css: paletteFor("day").lightPool, alpha: 0 });
    expect(ground.postRender.listeners.size).toBe(0);
    const dusk = paletteFor("dusk");
    out.setPalette(dusk, true);
    expect(pool.show).toBe(true);
    expect(pool.attrs.get("pool:1")?.color).toEqual({
      css: dusk.lightPool,
      alpha: POOL_ALPHA * dusk.glow,
    });
  });

  it("lamps, pools and roof items carry a distance condition and vanish on the Low tier", () => {
    const { primitives } = setup("night", 1500);
    const near = primitives.filter((p) =>
      (p.options.geometryInstances as { options: { attributes?: unknown } }[]).every(
        (i) => i.options.attributes,
      ),
    );
    expect(near).toHaveLength(4); // posts, heads, roof items, pools
    const low = setup("night", 0);
    expect(low.primitives.some(isPool)).toBe(false);
    const n = low.primitives.reduce(
      (s, p) => s + (p.options.geometryInstances as unknown[]).length,
      0,
    );
    expect(n).toBe(trees.length * 2 + 1 + cars.length * 2);
  });

  it("destroy removes and destroys once, idempotent; empty input creates nothing", () => {
    const { out, primitives, collection, ground } = setup();
    out.destroy();
    out.destroy();
    expect(collection.remove).toHaveBeenCalledTimes(primitives.length - 1);
    expect(ground.groundPrimitives.remove).toHaveBeenCalledTimes(1);
    for (const p of primitives) expect(p.destroy).toHaveBeenCalledTimes(1);
    const f = fakeCesium();
    const empty = buildProps(f.C as unknown as PropsCesium, {
      trees: [],
      cars: [],
      lamps: [],
      roofItems: [],
      palette: paletteFor("day"),
      at: AT,
      detailRangeM: 1500,
    });
    expect(f.primitives).toHaveLength(0);
    expect(() => {
      empty.setPalette(paletteFor("night"), true);
      empty.destroy();
    }).not.toThrow();
  });
});
