import type { Schemas } from "@tl/api-client";

export type FloodScenario = Pick<
  Schemas["Scenario"],
  "id" | "label" | "method" | "dem" | "margin_m" | "created" | "disclaimer"
>;
export interface FloodEdge {
  id: string;
  name: string;
  flood_class: string;
}

export const FALLBACK_DISCLAIMER =
  "Indicative scenario based on a terrain model. Not a forecast, and not an official flood map.";

export const classLabel = (c: string): string =>
  c === "likely_flooded"
    ? "Likely flooded"
    : c === "possible"
      ? "Possibly flooded"
      : "Flood class unknown";

const METHODS: Record<string, string> = {
  REM: "Relative elevation above mapped OSM drainage (REM)",
  HAND: "Height above nearest drainage (HAND)",
};
export const methodLabel = (m: string): string => METHODS[m] ?? m;

export const demLabel = (d: string): string =>
  /GLO-30/.test(d) && !/\(30 m\)/.test(d) ? `${d} (30 m)` : d;

/** "River +3 m" or "River +3 m (indicative)" both read "(indicative)" once. */
export const indicativeLabel = (label: string): string =>
  /indicative/i.test(label) ? label : `${label} (indicative)`;

export interface FloodPathView {
  heading: string;
  scenario: string;
  className: string;
  method: string | null;
  dem: string | null;
  margin: string | null;
  generated: string;
  datesNote: string;
  disclaimer: string;
}

/** Provenance of one flood-coloured path. Never carries a water depth. */
export function floodPathView(edge: FloodEdge, s: FloodScenario | undefined): FloodPathView {
  const margin =
    typeof s?.margin_m === "number" ? `within ${s.margin_m} m of the modelled water surface` : null;
  return {
    heading: edge.name || "This path",
    scenario: s ? indicativeLabel(s.label) : "Flood scenario (indicative)",
    className: classLabel(edge.flood_class),
    method: s?.method ? methodLabel(s.method) : null,
    dem: s?.dem ? demLabel(s.dem) : null,
    margin,
    generated: s?.created ? `Scenario generated ${s.created}` : "Generation date not recorded",
    datesNote: "Source data dates are not recorded.",
    disclaimer: s?.disclaimer || FALLBACK_DISCLAIMER,
  };
}
