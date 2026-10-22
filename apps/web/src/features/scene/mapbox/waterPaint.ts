import { statusStyle, WATER_COLOR } from "../styles";

/** Scenario polygons on the Lite map: river water in the water colour; T-029 low-lying terrain
 * (class "possible") in the "possibly flooded" colour, never drawn as water. */
export const SCENARIO_FILL_PAINT = {
  "fill-color": [
    "case",
    ["==", ["get", "class"], "possible"],
    statusStyle("flooded_possible").color,
    WATER_COLOR,
  ],
  "fill-opacity": ["case", ["==", ["get", "class"], "possible"], 0.35, 0.45],
} as const;
