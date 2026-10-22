import { describe, expect, it } from "vitest";
import { createFrame } from "../scene/three/frame";
import { floodBuildingHits } from "./floodBuildings";
import type { FloodShape } from "./floodPresentation";

const frame = createFrame([0, 0]);
const ring = (a: number, b: number, c: number, d: number): [number, number][] => [
  [a, b],
  [c, b],
  [c, d],
  [a, d],
  [a, b],
];
const building = (id: string, rings: [number, number][][]) => ({
  properties: { id, height_m: 10 },
  geometry: {
    type: "Polygon",
    coordinates: rings.map((r) => r.map(([x, z]) => frame.toLonLat(x, z))),
  },
});
const water = (
  rings: [number, number][][],
  kind: "possible" | "likely_flooded" = "likely_flooded",
): FloodShape => ({ rings, kind });

describe("reached building tags", () => {
  it("uses footprint intersections, not a centroid or a place name, and ignores possible terrain", () => {
    const buildings = {
      features: [
        building("edge", [ring(0, 0, 20, 20)]),
        building("outside", [ring(30, 30, 40, 40)]),
      ],
    };
    const shapes = [water([ring(19, -10, 21, 30)])];
    expect(floodBuildingHits(buildings, shapes, frame).map((b) => b.id)).toEqual(["edge"]);
    expect(floodBuildingHits(buildings, [water([ring(0, 0, 50, 50)], "possible")], frame)).toEqual(
      [],
    );
  });
  it("does not claim a building when water is entirely in its courtyard", () => {
    const buildings = {
      features: [building("courtyard", [ring(0, 0, 30, 30), ring(5, 5, 25, 25)])],
    };
    expect(floodBuildingHits(buildings, [water([ring(10, 10, 20, 20)])], frame)).toEqual([]);
  });
});
