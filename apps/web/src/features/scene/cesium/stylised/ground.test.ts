import { describe, expect, it, vi } from "vitest";
import { fakeCesium, fakeCollection, fakeEvent } from "./fakeCesium.test-util";
import {
  buildGround,
  type GroundCesium,
  parksFromLayer,
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
    parks: water,
    palette: paletteFor("night"),
  });
  // Per-instance-colour primitives only: base water is a material-based GroundPrimitive.
  const prims = f.primitives.filter((p) => p.kind === "ClassificationPrimitive") as unknown as {
    ready: boolean;
    attrs: Map<string, { color?: unknown }>;
    options: Record<string, unknown>;
  }[];
  return { ...f, prims, groundPrimitives, postRender, requestRender, g };
}
const colourOf = (css: string) => `rgba:${css}`;
const waterColours = (materials: { uniforms: Record<string, unknown> }[]) =>
  [materials[0]?.uniforms.color, materials[0]?.uniforms.shoreColor].map(
    (c) => (c as { css: string }).css,
  );

describe("buildGround", () => {
  it("draws pavements, kerbs and marks for residential/major roads, parks and shoreline", () => {
    const { C, primitives } = fakeCesium();
    const ring: [number, number][] = [
      [101.5, 3.18],
      [101.501, 3.18],
      [101.501, 3.181],
      [101.5, 3.18],
    ];
    const viewer = {
      scene: {
        groundPrimitives: fakeCollection(),
        postRender: fakeEvent(),
        requestRender: vi.fn(),
      },
    };
    buildGround(C as unknown as GroundCesium, viewer, {
      roads,
      water: [[ring]],
      parks: [[ring]],
      palette: paletteFor("day"),
    });
    const ids = primitives.flatMap((p) =>
      ((p.options.geometryInstances as { options: { id: string } }[]) ?? []).map(
        (g) => g.options.id.split(":")[0],
      ),
    );
    for (const k of ["road", "pavement", "kerb", "roadMark", "park", "parkEdge", "water", "shore"])
      expect(ids).toContain(k);
    // only the major road gets pavement (2 sides) and kerb; the footway gets neither
    expect(ids.filter((k) => k === "pavement")).toHaveLength(2);
    expect(ids.filter((k) => k === "kerb")).toHaveLength(2);
  });

  it("only base water shimmers; flood layers are never touched by this module", () => {
    const { g, primitives, materials } = setup();
    const water = primitives.find((p) =>
      (p.options.geometryInstances as { options: { id: string } }[])?.[0]?.options.id.startsWith(
        "water:",
      ),
    );
    const others = primitives.filter((p) => p !== water);
    expect(water?.options.appearance).toHaveProperty("options.material.uniforms.time");
    expect(water?.options).toMatchObject({ allowPicking: false, classificationType: 0 });
    for (const p of others) expect(p.options.appearance).not.toHaveProperty("options.material");
    expect(materials).toHaveLength(1); // the one water material; nothing else is animated
    g.setTime(5);
    expect(materials[0]?.uniforms.time).toBe(5);
    expect(materials[0]?.writes).toEqual(["time"]);
  });

  it("parksFromLayer parses polygons like water and tolerates an empty collection", () => {
    expect(parksFromLayer({ type: "FeatureCollection", features: [] })).toEqual([]);
    expect(parksFromLayer(undefined)).toEqual([]);
  });

  it("draws roads and water as thin, non-pickable classification volumes under the overlays", () => {
    const { primitives, geometries, groundPrimitives } = setup();
    // roadMark, kerb, road, pavement, shore, water parkEdge, park
    expect(primitives.map((p) => p.kind)).toEqual([
      ...Array(4).fill("ClassificationPrimitive"), // roadMark, kerb, road, pavement
      "ClassificationPrimitive", // shore
      "GroundPrimitive", // water (material, see below)
      "ClassificationPrimitive", // parkEdge
      "ClassificationPrimitive", // park
    ]);
    for (const p of primitives) {
      expect(p.options).toMatchObject({ allowPicking: false, asynchronous: true });
    }
    const corridors = geometries.filter((g) => g.kind === "corridor").map((g) => g.options);
    expect(corridors.filter((o) => o.width === 10).length).toBe(1); // the major road
    expect(corridors.filter((o) => o.width === 2.5).length).toBe(1); // the footway
    const polygons = geometries.filter((g) => g.kind === "polygon").map((g) => g.options);
    // The lake surface (water) is a flat polygon for the material primitive; the rest are thin
    // volumes around the flat ellipsoid ground (no tall volumes).
    const volumes = [...corridors, ...polygons.filter((o) => o.height !== undefined)];
    expect(polygons.length - polygons.filter((o) => o.height !== undefined).length).toBe(1);
    for (const o of volumes) {
      expect([o.height, o.extrudedHeight]).toEqual([-VOLUME_HALF_M, VOLUME_HALF_M]);
    }
    expect(geometries.filter((g) => g.kind === "polygon")).toHaveLength(2);
    expect(groundPrimitives.add).toHaveBeenCalledTimes(8);
    // Routes / flood lines (GroundPolylinePrimitives) must draw on top of the roads.
    expect(groundPrimitives.lowerToBottom).toHaveBeenCalledTimes(8);
  });

  it("no water polygons -> no water or shore primitive", () => {
    const { primitives } = setup(false);
    expect(primitives).toHaveLength(6);
  });

  it("theme toggled before the primitives are ready ends on the latest theme once ready", () => {
    const { g, prims, primitives, postRender, requestRender, materials } = setup();
    g.setPalette(paletteFor("day"), true);
    g.setPalette(paletteFor("night"), true);
    g.setPalette(paletteFor("day"), true);
    // Not ready: nothing written yet, one watcher (not one per toggle).
    expect(prims.every((p) => p.attrs.size === 0)).toBe(true);
    expect(postRender.listeners.size).toBe(1);
    postRender.fire();
    expect(prims.every((p) => p.attrs.size === 0)).toBe(true);
    for (const p of prims) p.ready = true;
    postRender.fire();
    const day = paletteFor("day");
    const attr = (id: string) => prims.map((p) => p.attrs.get(id)?.color).find(Boolean);
    expect(attr("road:0")).toBe(colourOf(day.road));
    expect(attr("road:1")).toBe(colourOf(day.road));
    expect(waterColours(materials)).toEqual([day.water, day.shore]);
    expect(attr("pavement:0")).toBe(colourOf(day.pavement));
    expect(postRender.listeners.size).toBe(0);
    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(primitives).toHaveLength(8);
  });

  it("setPalette on ready primitives recolours in place right away; same theme is a no-op", () => {
    const { g, prims, postRender } = setup();
    for (const p of prims) p.ready = true;
    g.setPalette(paletteFor("night"), true); // built as night: nothing to write
    expect(prims[0]!.attrs.size).toBe(0);
    g.setPalette(paletteFor("day"), true);
    expect(prims[2]!.attrs.get("road:1")?.color).toBe(colourOf(paletteFor("day").road));
    expect(postRender.listeners.size).toBe(0);
  });

  it("recolours every part key in place", () => {
    const { g, prims, materials } = setup();
    for (const p of prims) p.ready = true;
    g.setPalette(paletteFor("day"), true);
    g.setPalette(paletteFor("night"), true);
    const night = paletteFor("night");
    expect(waterColours(materials)).toEqual([night.water, night.shore]);
    const attr = (id: string) => prims.map((p) => p.attrs.get(id)?.color).find(Boolean);
    for (const key of [
      "road",
      "pavement",
      "kerb",
      "roadMark",
      "shore",
      "park",
      "parkEdge",
    ] as const)
      expect(attr(`${key}:0`), key).toBe(colourOf(night[key]));
  });

  it("a non-final palette is stored but not written; the final one recolours", () => {
    const { g, prims } = setup();
    for (const p of prims) p.ready = true;
    g.setPalette(paletteFor("day"), false);
    expect(prims[0]!.attrs.size).toBe(0);
    g.setPalette(paletteFor("day"), true);
    expect(prims[2]!.attrs.get("road:0")?.color).toBe(colourOf(paletteFor("day").road));
  });

  it("destroy removes every primitive once, stops watching, and is idempotent", () => {
    const { g, primitives, groundPrimitives, postRender } = setup();
    g.setPalette(paletteFor("day"), true);
    g.destroy();
    g.destroy();
    expect(groundPrimitives.remove).toHaveBeenCalledTimes(8);
    for (const p of primitives) expect(p.destroy).toHaveBeenCalledTimes(1);
    expect(postRender.listeners.size).toBe(0);
    expect(() => g.setPalette(paletteFor("night"), true)).not.toThrow();
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
      parks: [],
      palette: paletteFor("day"),
    });
    expect(f.primitives).toHaveLength(0);
    expect(() => {
      g.setPalette(paletteFor("night"), true);
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
