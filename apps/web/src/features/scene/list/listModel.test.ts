import { describe, expect, it } from "vitest";
import { groupByType, parseLayer, routeSteps } from "./listModel";

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
});
