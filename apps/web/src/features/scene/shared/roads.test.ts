import { describe, expect, it } from "vitest";
import { roadsFromWalk, waterFromLayer } from "./roads";

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
