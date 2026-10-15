import { optionLabel } from "../manage/attributeCatalogue";

/** How many of the facts a profile relies on are not yet checked. Words, patterns and colour all
 * carry the band; none of them says anything is unsafe or inaccessible. */
export type GapBand = "checked" | "some" | "many";

export interface GapBandStyle {
  label: string;
  color: string;
  width: number;
  alpha: number;
  /** Pattern, so a band is never told apart by colour alone. */
  pattern: "solid" | "dashed" | "dotted";
}

export const GAP_BANDS: Record<GapBand, GapBandStyle> = {
  checked: {
    label: "Fully checked",
    color: "#4A6B8A",
    width: 2,
    alpha: 0.6,
    pattern: "solid",
  },
  some: { label: "Some facts missing", color: "#805AD5", width: 4, alpha: 1, pattern: "dashed" },
  many: { label: "Many facts missing", color: "#44337A", width: 6, alpha: 1, pattern: "dotted" },
};
export const GAP_BAND_ORDER: GapBand[] = ["checked", "some", "many"];

/** Cesium PolylineDash params (16-bit on/off mask) for the patterned bands. */
export const GAP_CESIUM_DASH: Partial<
  Record<GapBand, { dashLength: number; dashPattern: number }>
> = {
  some: { dashLength: 16, dashPattern: 0xfff0 },
  many: { dashLength: 12, dashPattern: 0xf000 },
};

export const GAP_HELP =
  "Facts not yet checked on paths and places, for the profile you chose. It shows what our records do not yet cover, nothing more.";

/** Profiles with facts that decide a route (hard limits, sidewalks). Default and drive have none,
 * so the gap map has nothing to say for them. */
const GAP_PROFILES = ["stroller", "wheelchair", "older_adult_rest"];
export const gapsApplicable = (profile: string): boolean => GAP_PROFILES.includes(profile);
/** The overlay is drawn only when it is on and the profile has facts to check. */
export const gapsActive = (visible: boolean, profile: string): boolean =>
  visible && gapsApplicable(profile);
export const GAP_PROFILE_NOTE =
  "The gap map shows facts that matter for stroller, wheelchair and older-adult travel. Pick one of those profiles to see gaps.";

/**
 * Band from the share of relevant facts that are not yet checked: none = fully checked, up to
 * half = some missing, more than half = many missing. Null when no fact is relevant to the
 * profile (nothing to check, so nothing to claim: such edges are not drawn as "fully checked").
 */
export function gapBand(unknownCount: number, relevantCount: number): GapBand | null {
  if (relevantCount <= 0) return null;
  if (unknownCount <= 0) return "checked";
  return unknownCount / relevantCount > 0.5 ? "many" : "some";
}

export interface GapItem {
  id: string;
  kind: "segment" | "place" | "entrance" | "amenity";
  name: string;
  type: string;
  unknown: number;
  stale: number;
  reported: number;
  relevant: number;
  demand: number;
  attributes: string[];
  band: GapBand | null;
  coords: [number, number][];
}

type Feature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown> | null;
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Tolerant parser for GET /layers/gaps. */
export function parseGaps(data: unknown): GapItem[] {
  const out: GapItem[] = [];
  for (const f of ((data as { features?: Feature[] } | null)?.features ?? []).filter(Boolean)) {
    const p = f.properties ?? {};
    const id = String(p.id ?? "");
    if (!id) continue;
    const isLine = f.geometry?.type === "LineString";
    const type = String(p.type ?? (isLine ? "path" : "other"));
    const unknown = num(p.unknown_count);
    const relevant = num(p.relevant_count);
    out.push({
      id,
      kind: isLine ? "segment" : (String(p.kind ?? "place") as GapItem["kind"]),
      name: p.name ? String(p.name) : `Unnamed ${type.replace(/_/g, " ")}`,
      type,
      unknown,
      stale: num(p.stale_count),
      reported: num(p.reported_count),
      relevant,
      demand: num(p.demand),
      attributes: Array.isArray(p.unknown_attributes) ? p.unknown_attributes.map(String) : [],
      band: gapBand(unknown, relevant),
      coords: isLine ? ((f.geometry?.coordinates as [number, number][]) ?? []) : [],
    });
  }
  return out;
}

/** Items with something not yet checked, most-asked-about first, then most facts missing. */
export function biggestGaps(items: GapItem[], limit = 10): GapItem[] {
  return items
    .filter((i) => i.unknown > 0)
    .sort(
      (a, b) =>
        b.demand - a.demand ||
        b.unknown - a.unknown ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

export const attributeNames = (attrs: string[]): string => attrs.map(optionLabel).join(", ");

/** One-line summary for a row. */
export function gapSummary(i: GapItem): string {
  const facts = `${i.unknown} ${i.unknown === 1 ? "fact" : "facts"} not yet checked`;
  const stale = i.stale > 0 ? `, ${i.stale} out of date` : "";
  const reported = i.reported > 0 ? `, ${i.reported} only reported` : "";
  const asked =
    i.demand > 0 ? `. Asked about ${i.demand} ${i.demand === 1 ? "time" : "times"}` : "";
  return `${facts}${stale}${reported}${asked}`;
}

/** The gap layer as GeoJSON with each line's band in `gap_band`, for the Mapbox renderer. Lines
 * with no relevant fact (band null) are left out, never drawn as fully checked. */
export function gapLines(data: unknown): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const i of parseGaps(data)) {
    if (i.kind !== "segment" || !i.band || i.coords.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: i.coords },
      properties: { id: i.id, gap_band: i.band },
    });
  }
  return { type: "FeatureCollection", features };
}
