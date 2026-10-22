import { describe, expect, it } from "vitest";
import { waterPolygons } from "../geo";
import { statusStyle, WATER_COLOR } from "../styles";
import { SCENARIO_FILL_PAINT } from "./waterPaint";

describe("low-lying terrain is never drawn as water (T-029, every renderer)", () => {
  it("the Lite map colours class 'possible' as possibly flooded, river water as water", () => {
    const color = SCENARIO_FILL_PAINT["fill-color"];
    expect(color[1]).toEqual(["==", ["get", "class"], "possible"]);
    expect(color[2]).toBe(statusStyle("flooded_possible").color);
    expect(color[3]).toBe(WATER_COLOR);
  });

  it("waterPolygons marks terrain polygons, which the 3D renderers draw flat and orange", () => {
    const ring = [
      [101.5, 3.1],
      [101.51, 3.1],
      [101.51, 3.11],
      [101.5, 3.1],
    ];
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { class: "possible" },
          geometry: { type: "Polygon", coordinates: [ring] },
        },
        {
          type: "Feature",
          properties: { surface_height_m: 7 },
          geometry: { type: "Polygon", coordinates: [ring] },
        },
      ],
    };
    expect(waterPolygons(fc).map((p) => [p.possible, p.height])).toEqual([
      [true, 0],
      [false, 7],
    ]);
  });
});
