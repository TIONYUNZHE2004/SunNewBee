import { describe, expect, it } from "vitest";
import { groupByStatus, lineFeatures, normalizeLayer, pointFeatures, waterPolygons } from "./geo";

describe("geo", () => {
  it("defaults a missing status to unknown, never ok", () => {
    const d = {
      features: [
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: { id: "e1" },
        },
      ],
    };
    expect(lineFeatures(d)[0]?.status).toBe("unknown");
  });
  it("reads status_for_profile", () => {
    const d = {
      features: [
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: { id: "e1", status_for_profile: "blocked" },
        },
      ],
    };
    expect(lineFeatures(d)[0]?.status).toBe("blocked");
  });
  it("extracts points and skips ones without id", () => {
    const d = {
      features: [
        {
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: { id: "p", name: "P", type: "shop" },
        },
        { geometry: { type: "Point", coordinates: [1, 2] }, properties: {} },
      ],
    };
    expect(pointFeatures(d)).toHaveLength(1);
  });
  it("flattens MultiPolygon with surface height", () => {
    const ring = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    const d = {
      features: [
        {
          geometry: { type: "MultiPolygon", coordinates: [[ring], [ring]] },
          properties: { surface_height_m: 12 },
        },
      ],
    };
    const out = waterPolygons(d);
    expect(out).toHaveLength(2);
    expect(out[0]?.height).toBe(12);
    expect(new Set(out.map((o) => o.key)).size).toBe(2);
  });
  it("tolerates null/empty input", () => {
    expect(lineFeatures(null)).toEqual([]);
    expect(waterPolygons(undefined)).toEqual([]);
  });
  it("normalises raw flood_class / closed for Mapbox", () => {
    const d = {
      features: [
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: { id: "a", flood_class: "likely_flooded" },
        },
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: { id: "b", status_for_profile: "closed" },
        },
      ],
    };
    const out = normalizeLayer(d).features.map((f) => f.properties?.status_for_profile);
    expect(out).toEqual(["flooded_likely", "blocked"]);
  });
  it("groups lines by status", () => {
    const g = groupByStatus([
      {
        id: "a",
        status: "ok",
        coords: [
          [0, 0],
          [1, 1],
        ],
      },
      {
        id: "b",
        status: "ok",
        coords: [
          [1, 1],
          [2, 2],
        ],
      },
      { id: "c", status: "blocked", coords: [[0, 0]] },
    ]);
    expect(g.get("ok")).toHaveLength(2);
    expect(g.has("blocked")).toBe(false);
  });
});
