import { describe, expect, it } from "vitest";
import { groupByType, parseCentres, parseLayer, parseWaste, routeSteps } from "./listModel";

const fc = {
  features: [
    {
      geometry: { type: "Point", coordinates: [1, 1] },
      properties: { id: "a", name: "A", type: "park" },
    },
    {
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      properties: { id: "e1", claims: { w: { status: "unknown" } } },
    },
    {
      geometry: {
        type: "LineString",
        coordinates: [
          [1, 1],
          [2, 2],
        ],
      },
      properties: { id: "e2", flood_class: "likely_flooded" },
    },
  ],
};

describe("listModel", () => {
  it("parses tolerant layer data and handles garbage", () => {
    const { places, edges } = parseLayer(fc);
    expect(places).toHaveLength(1);
    expect(edges.map((e) => e.status)).toEqual(["unknown", "flooded_likely"]);
    expect(parseLayer(null)).toEqual({ places: [], edges: [] });
  });
  it("groups and orders route steps", () => {
    const { places, edges } = parseLayer(fc);
    expect(groupByType(places)[0]?.[0]).toBe("park");
    const steps = routeSteps(
      {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
      },
      edges,
    );
    expect(steps.map((s) => s.id)).toEqual(["e1", "e2"]);
  });

  it("reads status_for_profile first, for all five values", () => {
    for (const v of ["ok", "unknown", "blocked", "flooded_likely", "flooded_possible"]) {
      const { edges } = parseLayer({
        features: [
          {
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            properties: { id: "x", status_for_profile: v, status: "ok", flood_class: "possible" },
          },
        ],
      });
      expect(edges[0]?.status).toBe(v);
    }
  });
  it("ignores invalid status_for_profile and falls back to unknown when nothing is known", () => {
    const { edges } = parseLayer({
      features: [
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: { id: "a", status_for_profile: "bogus" },
        },
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: { id: "b" },
        },
      ],
    });
    expect(edges.map((e) => e.status)).toEqual(["unknown", "unknown"]);
  });
});

describe("lens sections", () => {
  const flood = {
    features: [
      { geometry: { type: "LineString", coordinates: [] }, properties: { id: "e" } },
      {
        geometry: { type: "Point", coordinates: [1, 1] },
        properties: { id: "evc-a", kind: "evac_centre", type: "official_pps", name: "School" },
      },
      {
        geometry: { type: "Point", coordinates: [1, 2] },
        properties: { id: "evc-b", kind: "evac_centre", type: "osm_candidate", name: "Hall" },
      },
    ],
  };
  it("lists centres with source labels", () => {
    expect(parseCentres(flood)).toEqual([
      { id: "evc-a", name: "School", sourceLabel: "Official PPS" },
      {
        id: "evc-b",
        name: "Hall",
        sourceLabel: "Candidate (OSM), not an official relief centre",
      },
    ]);
    expect(parseCentres(null)).toEqual([]);
  });
  it("lists waste points with status", () => {
    const w = {
      features: [
        {
          geometry: { type: "Point", coordinates: [1, 1] },
          properties: { id: "wp-1", kind: "waste_point", type: "e_waste_drop_off", name: "Box" },
        },
        {
          geometry: { type: "Point", coordinates: [1, 1] },
          properties: { id: "wp-2", kind: "waste_point", name: "Bin", status: "verified" },
        },
      ],
    };
    expect(parseWaste(w).map((x) => [x.id, x.statusLabel])).toEqual([
      ["wp-1", "Status: unknown"],
      ["wp-2", "Status: verified"],
    ]);
  });
});
