import { describe, expect, it, vi } from "vitest";
import { fakeCesium, fakeCollection, fakeLayers, recorder2d } from "./fakeCesium.test-util";
import { buildGround, type GroundCesium, groundDecals, parksFromLayer } from "./ground";
import { paletteFor } from "./palette";

const L = [
  [101.5, 3.18],
  [101.501, 3.18],
];

const roads = [
  { id: "a", coords: L as [number, number][], widthM: 10, kind: "major" as const },
  { id: "b", coords: L as [number, number][], widthM: 2.5, kind: "footway" as const },
];
const ring: [number, number][] = [
  [101.5, 3.18],
  [101.501, 3.18],
  [101.501, 3.181],
  [101.5, 3.18],
];
const water = [[ring]];

type Layer = { alpha: number; show: boolean };

function setup(withWater = true) {
  const f = fakeCesium();
  const groundPrimitives = fakeCollection();
  const imageryLayers = fakeLayers<Layer>();
  const requestRender = vi.fn();
  const viewer = { scene: { groundPrimitives, imageryLayers, requestRender } };
  const g = buildGround(
    f.C as unknown as GroundCesium,
    viewer as unknown as Parameters<typeof buildGround>[1],
    { roads, water: withWater ? water : [], parks: water, palette: paletteFor("night") },
    () => {
      const ctx = recorder2d();
      return { getContext: () => ctx };
    },
  );
  return { ...f, groundPrimitives, layers: imageryLayers, requestRender, g };
}
const waterColours = (materials: { uniforms: Record<string, unknown> }[]) =>
  [materials[0]?.uniforms.color, materials[0]?.uniforms.shoreColor].map(
    (c) => (c as { css: string }).css,
  );

describe("groundDecals", () => {
  it("pavements, kerbs and marks for residential/major roads, parks with edges, shoreline", () => {
    const decals = groundDecals({ roads, water, parks: water });
    const count = (part: string) => decals.filter((d) => d.part === part).length;
    expect(count("road")).toBe(2);
    // only the major road gets pavement (2 sides), kerbs and centre marks; the footway none
    expect(count("pavement")).toBe(2);
    expect(count("kerb")).toBe(2);
    expect(count("roadMark")).toBeGreaterThan(0);
    expect([count("park"), count("parkEdge"), count("shore")]).toEqual([1, 1, 1]);
    expect(decals.find((d) => d.part === "park")?.shape).toBe("fill");
    expect(decals.filter((d) => d.part === "road").map((d) => d.widthM)).toEqual([10, 2.5]);
    for (const d of decals.filter((x) => x.part !== "park")) expect(d.shape).toBe("line");
  });

  it("drops rings with fewer than three points", () => {
    const bad = [[[[101.5, 3.18]]]] as [number, number][][][];
    expect(groundDecals({ roads: [], water: bad, parks: bad })).toEqual([]);
  });
});

describe("buildGround", () => {
  it("decals are globe imagery (no stencil volumes); only base water is a ground primitive", () => {
    const { primitives, layers, groundPrimitives, g } = setup();
    expect(primitives.map((p) => p.kind)).toEqual(["GroundPrimitive"]);
    expect(primitives[0]!.options).toMatchObject({
      allowPicking: false,
      asynchronous: true,
      classificationType: 0,
    });
    expect(layers.list).toHaveLength(1);
    expect(g.layers()).toEqual(layers.list);
    // Routes / flood lines (GroundPolylinePrimitives) must draw on top of the water.
    expect(groundPrimitives.lowerToBottom).toHaveBeenCalledWith(primitives[0]);
  });

  it("only base water shimmers; flood layers are never touched by this module", () => {
    const { g, primitives, materials } = setup();
    expect(primitives[0]?.options.appearance).toHaveProperty("options.material.uniforms.time");
    expect(materials).toHaveLength(1); // the one water material; nothing else is animated
    g.setTime(5);
    expect(materials[0]?.uniforms.time).toBe(5);
    expect(materials[0]?.writes).toEqual(["time"]);
  });

  it("parksFromLayer parses polygons like water and tolerates an empty collection", () => {
    expect(parksFromLayer({ type: "FeatureCollection", features: [] })).toEqual([]);
    expect(parksFromLayer(undefined)).toEqual([]);
  });

  it("no water polygons -> no water primitive, decals still drawn", () => {
    const { primitives, layers } = setup(false);
    expect(primitives).toHaveLength(0);
    expect(layers.list).toHaveLength(1);
  });

  it("water recolours on the final palette only; same palette writes nothing", () => {
    const { g, materials } = setup();
    g.setPalette(paletteFor("day"), false);
    expect(materials[0]!.writes).toEqual([]);
    g.setPalette(paletteFor("night"), true); // built as night
    expect(materials[0]!.writes).toEqual([]);
    g.setPalette(paletteFor("day"), true);
    const day = paletteFor("day");
    expect(waterColours(materials)).toEqual([day.water, day.shore]);
  });

  it("fade crossfades the decal layers (new palette layer under the shown one)", () => {
    const { g, layers } = setup();
    const night = layers.list[0]!;
    g.fade(paletteFor("day"), 0.5);
    expect(layers.list).toHaveLength(2);
    expect(layers.list[1]).toBe(night);
    expect(night.alpha).toBeCloseTo(0.5, 9);
    g.fade(paletteFor("day"), 1);
    expect(layers.list).toHaveLength(1);
    expect(layers.list[0]).not.toBe(night);
  });

  it("destroy removes the water and every layer once, and is idempotent", () => {
    const { g, primitives, groundPrimitives, layers } = setup();
    g.fade(paletteFor("day"), 0.5);
    g.destroy();
    g.destroy();
    expect(groundPrimitives.remove).toHaveBeenCalledTimes(1);
    for (const p of primitives) expect(p.destroy).toHaveBeenCalledTimes(1);
    expect(layers.list).toEqual([]);
    expect(() => {
      g.setPalette(paletteFor("night"), true);
      g.fade(paletteFor("night"), 1);
    }).not.toThrow();
  });

  it("no roads and no water -> nothing created, no throw", () => {
    const f = fakeCesium();
    const layers = fakeLayers<Layer>();
    const viewer = {
      scene: { groundPrimitives: fakeCollection(), imageryLayers: layers, requestRender: vi.fn() },
    };
    const g = buildGround(
      f.C as unknown as GroundCesium,
      viewer as unknown as Parameters<typeof buildGround>[1],
      { roads: [], water: [], parks: [], palette: paletteFor("day") },
    );
    expect(f.primitives).toHaveLength(0);
    expect(layers.list).toHaveLength(0);
    expect(() => {
      g.setPalette(paletteFor("night"), true);
      g.fade(paletteFor("night"), 1);
      g.destroy();
    }).not.toThrow();
  });
});
