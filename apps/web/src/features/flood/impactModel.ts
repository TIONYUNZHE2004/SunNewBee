import type { Schemas } from "@tl/api-client";
import { statusStyle } from "../scene/styles";

export type AffectedResult = Schemas["AffectedResult"];
export type FloodPlace = Schemas["FloodPlace"];
export type ImpactKind = "flooded" | "cut_off";

/** T-024 marker wording and look: the labels are the API's, never "safe", never a depth. The
 * flooded colour is the map legend's "Likely flooded"; cut off uses the "not checked" amber. */
export const IMPACT_STYLE: Readonly<
  Record<ImpactKind, { glyph: string; label: string; color: string }>
> = {
  flooded: {
    glyph: "!",
    label: "Likely flooded (indicative)",
    color: statusStyle("flooded_likely").color,
  },
  cut_off: {
    glyph: "⚠",
    label: "Cut off: no mapped way in or out (indicative)",
    color: statusStyle("unknown").color,
  },
};

export const INDICATIVE_NOTE = "Indicative scenario, not a forecast.";
export const FLASH_FLOOD_NOTE = "Flash floods from heavy rain are not shown.";

export interface ImpactMarker {
  id: string;
  name: string;
  /** The place type (street furniture is folded in the card's lists). */
  type: string;
  coord: [number, number];
  kind: ImpactKind;
}

export interface ImpactSummary {
  flooded: number;
  cutOff: number;
  /** "141.6 km" or "320 m" of likely flooded mapped paths. */
  pathLength: string;
  /** T-029: places and paths marked `possible` (low-lying terrain), from the same response. */
  possiblePlaces: number;
  possiblePaths: number;
  markers: ImpactMarker[];
}

/** "320 m" under a kilometre, else "1.2 km" (one decimal); no depth, only path length. */
export function formatPathLength(m: number): string {
  if (!(m > 0)) return "0 m";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

const marker = (p: FloodPlace, kind: ImpactKind): ImpactMarker | null => {
  const [lon, lat] = p.lonlat;
  return typeof lon === "number" && typeof lat === "number"
    ? { id: p.id, name: p.name, type: p.type, coord: [lon, lat], kind }
    : null;
};

/** The summary card's numbers and the map's markers, straight from `GET /scenarios/{id}/affected`. */
export function impactSummary(a: AffectedResult | null | undefined): ImpactSummary | null {
  if (!a) return null;
  const flooded = a.flooded_places ?? [];
  const cut = a.cut_off_places ?? [];
  return {
    flooded: flooded.length,
    cutOff: cut.length,
    pathLength: formatPathLength(a.flooded_path_m ?? 0),
    possiblePlaces: a.possible_place_count ?? 0,
    possiblePaths: a.possible_path_count ?? 0,
    markers: [
      ...flooded.map((p) => marker(p, "flooded")),
      ...cut.map((p) => marker(p, "cut_off")),
    ].filter((m): m is ImpactMarker => m !== null),
  };
}

/** Only `possible` marks (low-lying terrain, T-029): say those, not "0 likely flooded". */
export const possibleOnly = (s: ImpactSummary) =>
  s.flooded === 0 && s.pathLength === "0 m" && s.possiblePlaces + s.possiblePaths > 0;

/** "3 places" / "1 place". */
export const placesWord = (n: number) => `${n} ${n === 1 ? "place" : "places"}`;

/** Street furniture: counted after the named places in the card's lists (agent: same set). */
export const SMALL_FEATURE_TYPES: ReadonlySet<string> = new Set([
  "shelter",
  "seating",
  "bench",
  "waste_basket",
  "toilet",
]);

/**
 * A card list: places first (named before "(unnamed, OSM)" ones), street furniture as one count,
 * so every row is still counted. The map keeps every marker. Only furniture: listed as is.
 */
export function listRows(rows: readonly ImpactMarker[]): { places: ImpactMarker[]; small: number } {
  const small = rows.filter((m) => SMALL_FEATURE_TYPES.has(m.type));
  const places = rows.filter((m) => !SMALL_FEATURE_TYPES.has(m.type));
  if (places.length === 0) return { places: [...rows], small: 0 };
  const unnamed = (m: ImpactMarker) => (m.name.includes("(unnamed") ? 1 : 0);
  return { places: [...places].sort((a, b) => unnamed(a) - unnamed(b)), small: small.length };
}
