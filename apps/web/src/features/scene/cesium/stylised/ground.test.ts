import { describe, expect, it, vi } from "vitest";
import { fakeCesium, fakeCollection, fakeEvent } from "./fakeCesium.test-util";
import {
  buildGround,
  type GroundCesium,
  roadsFromWalk,
  VOLUME_HALF_M,
  waterFromLayer,
} from "./ground";
import { paletteFor } from "./palette";

const line = (id: string, type: string | undefined, coords: unknown) => ({
  type: "Feature",
  geometry: { type: "LineString", coordinates: coords },
  properties: { id, type },
});
const L = [
  [101.5, 3.18],
  [101.501, 3.18],
];

describe("roadsFromWalk", () => {
  it("sets width by segment type", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        line("a", "major_road", L),
        line("b", "residential", L),
        line("c", "service", L),
        line("d", "street", L),
        line("e", "footway", L),
        line("f", "path", L),
        line("g", "track", L),
        line("h", undefined, L),
      ],
    };
    const w = Object.fromEntries(roadsFromWalk(fc).map((r) => [r.id, r.widthM]));
    expect(w).toEqual({ a: 10, b: 6, c: 6, d: 6, e: 2.5, f: 2.5, g: 3, h: 3 });
    const k = Object.fromEntries(roadsFromWalk(fc).map((r) => [r.id, r.kind]));
    expect(k).toEqual({
      a: "major",
      b: "residential",
      c: "residential",
      d: "residential",
      e: "footway",
      f: "footway",
      g: "other",
      h: "other",
    });
  });

  it("drops non-LineString features, bad coordinates and degenerate lines", () => {
    const fc = {
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [101.5, 3.18] },
          properties: {},
        },
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[...L, [101.5, 3.181], L[0]]] },
          properties: { id: "poly" },
        },
        line("nan", "street", [
          [101.5, 3.18],
          [Number.NaN, 3.18],
        ]),
        line("one", "street", [[101.5, 3.18]]),
        line("same", "street", [
          [101.5, 3.18],
          [101.5, 3.18],
        ]),
        line("ok", "street", L),
        { geometry: null },
        null,
      ],
    };
    expect(roadsFromWalk(fc).map((r) => r.id)).toEqual(["ok"]);
    expect(roadsFromWalk(null)).toEqual([]);
    expect(roadsFromWalk({ features: "nope" })).toEqual([]);
  });

  it("keeps coordinates as lon/lat pairs and is deterministic", () => {
    const fc = { features: [line("ok", "street", L)] };
    expect(roadsFromWalk(fc)).toEqual(roadsFromWalk(fc));
    expect(roadsFromWalk(fc)[0]!.coords).toEqual(L);
  });
});

const roads = [
  { id: "a", coords: L as [number, number][], widthM: 10, kind: "major" as const },
  { id: "b", coords: L as [number, number][], widthM: 2.5, kind: "footway" as const },
];
const water = [
  [
    [
      [101.5, 3.18],
      [101.501, 3.18],
      [101.501, 3.181],
      [101.5, 3.18],
    ],
  ] as [number, number][][],
];

function setup(withWater = true) {
  const f = fakeCesium();
  const groundPrimitives = fakeCollection();
  const postRender = fakeEvent();
  const requestRender = vi.fn();
  const viewer = { scene: { groundPrimitives, postRender, requestRender } };
  const g = buildGround(f.C as unknown as GroundCesium, viewer, {
    roads,
    water: withWater ? water : [],
    palette: paletteFor("night"),
  });
  const prims = f.primitives as unknown as {
    ready: boolean;
    attrs: Map<string, { color?: unknown }>;
    options: Record<string, unknown>;
  }[];
  return { ...f, prims, groundPrimitives, postRender, requestRender, g };
}
const colourOf = (css: string) => `rgba:${css}`;

describe("buildGround", () => {
  it("draws roads and water as thin, non-pickable classification volumes under the overlays", () => {
    const { primitives, geometries, groundPrimitives } = setup();
    expect(primitives.map((p) => p.kind)).toEqual([
      "ClassificationPrimitive",
      "ClassificationPrimitive",
    ]);
    for (const p of primitives) {
      expect(p.options).toMatchObject({ allowPicking: false, asynchronous: true });
    }
    const corridors = geometries.filter((g) => g.kind === "corridor").map((g) => g.options);
    expect(corridors.map((o) => o.width)).toEqual([10, 2.5]);
    for (const o of [
      ...corridors,
      ...geometries.filter((g) => g.kind === "polygon").map((g) => g.options),
    ]) {
      // Thin volumes around the flat ellipsoid ground (no tall GroundPrimitive volumes).
      expect([o.height, o.extrudedHeight]).toEqual([-VOLUME_HALF_M, VOLUME_HALF_M]);
    }
    expect(geometries.filter((g) => g.kind === "polygon")).toHaveLength(1);
    expect(groundPrimitives.add).toHaveBeenCalledTimes(2);
    // Routes / flood lines (GroundPolylinePrimitives) must draw on top of the roads.
    expect(groundPrimitives.lowerToBottom).toHaveBeenCalledTimes(2);
  });

  it("no water polygons -> no water primitive", () => {
    const { primitives } = setup(false);
    expect(primitives).toHaveLength(1);
  });

  it("theme toggled before the primitives are ready ends on the latest theme once ready", () => {
    const { g, prims, primitives, postRender, requestRender } = setup();
    g.setTheme("day");
    g.setTheme("night");
    g.setTheme("day");
    // Not ready: nothing written yet, one watcher (not one per toggle).
    expect(prims.every((p) => p.attrs.size === 0)).toBe(true);
    expect(postRender.listeners.size).toBe(1);
    postRender.fire();
    expect(prims.every((p) => p.attrs.size === 0)).toBe(true);
    for (const p of prims) p.ready = true;
    postRender.fire();
    const day = paletteFor("day");
    expect(prims[0]!.attrs.get("road:0")?.color).toBe(colourOf(day.road));
    expect(prims[0]!.attrs.get("road:1")?.color).toBe(colourOf(day.road));
    expect(prims[1]!.attrs.get("water:0")?.color).toBe(colourOf(day.water));
    expect(postRender.listeners.size).toBe(0);
    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(primitives).toHaveLength(2);
  });

  it("setTheme on ready primitives recolours in place right away; same theme is a no-op", () => {
    const { g, prims, postRender } = setup();
    for (const p of prims) p.ready = true;
    g.setTheme("night"); // built as night: nothing to write
    expect(prims[0]!.attrs.size).toBe(0);
    g.setTheme("day");
    expect(prims[0]!.attrs.get("road:1")?.color).toBe(colourOf(paletteFor("day").road));
    expect(postRender.listeners.size).toBe(0);
  });

  it("destroy removes every primitive once, stops watching, and is idempotent", () => {
    const { g, primitives, groundPrimitives, postRender } = setup();
    g.setTheme("day");
    g.destroy();
    g.destroy();
    expect(groundPrimitives.remove).toHaveBeenCalledTimes(2);
    for (const p of primitives) expect(p.destroy).toHaveBeenCalledTimes(1);
    expect(postRender.listeners.size).toBe(0);
    expect(() => g.setTheme("night")).not.toThrow();
  });

  it("no roads and no water -> nothing created, no throw", () => {
    const f = fakeCesium();
    const viewer = {
      scene: {
        groundPrimitives: fakeCollection(),
        postRender: fakeEvent(),
        requestRender: vi.fn(),
      },
    };
    const g = buildGround(f.C as unknown as GroundCesium, viewer, {
      roads: [],
      water: [],
      palette: paletteFor("day"),
    });
    expect(f.primitives).toHaveLength(0);
    expect(() => {
      g.setTheme("night");
      g.destroy();
    }).not.toThrow();
  });
});

describe("waterFromLayer", () => {
  const ring = [
    [101.5, 3.18],
    [101.51, 3.18],
    [101.51, 3.19],
    [101.5, 3.18],
  ];
  it("keeps Polygon and MultiPolygon, drops lines, junk and undefined", () => {
    const fc = {
      features: [
        { geometry: { type: "Polygon", coordinates: [ring] } },
        {
          geometry: {
            type: "MultiPolygon",
            coordinates: [[ring], [ring]],
          },
        },
        { geometry: { type: "LineString", coordinates: ring } },
        {
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [1, "x"],
                [2, 2],
                [3, 3],
              ],
            ],
          },
        },
        { geometry: null },
        null,
      ],
    };
    expect(waterFromLayer(fc)).toHaveLength(3);
    expect(waterFromLayer(undefined)).toEqual([]);
    expect(waterFromLayer({ features: "no" })).toEqual([]);
  });
});
