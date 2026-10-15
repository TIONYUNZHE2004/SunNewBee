import type { Schemas } from "@tl/api-client";
import { optionLabel } from "../tickets/attributeCatalogue";

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
  /** Of the unchecked facts, how many are demo values (not yet surveyed). */
  demo: number;
  relevant: number;
  demand: number;
  /** Journeys the latest simulation says checking this would confirm. */
  journey: number;
  named: boolean;
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
    // Partial<GapProperties>: a renamed API field is a type error here, not a silent zero.
    const p: Partial<Schemas["GapProperties"]> = f.properties ?? {};
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
      demo: num(p.demo_count),
      relevant,
      demand: num(p.demand),
      journey: num(p.journey_impact),
      named: !!p.name,
      attributes: Array.isArray(p.unknown_attributes) ? p.unknown_attributes.map(String) : [],
      band: gapBand(unknown, relevant),
      coords: isLine ? ((f.geometry?.coordinates as [number, number][]) ?? []) : [],
    });
  }
  return out;
}

export interface GapRow {
  key: string;
  kind: "street" | "unnamed" | "place";
  label: string;
  detail: string;
  /** Open verification demand, summed over the row. */
  demand: number;
  /** Journeys the latest simulation says checking these facts would confirm. */
  journey: number;
  /** Facts not yet checked, summed over the row. */
  unknown: number;
  stale: number;
  reported: number;
  count: number;
  attributes: string[];
  firstId: string;
  /** Where to look: the first segment's midpoint, null for places. */
  at: [number, number] | null;
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const midpoint = (c: [number, number][]): [number, number] | null =>
  c[Math.floor(c.length / 2)] ?? null;

function suffix(demand: number, journey: number): string {
  const asked = demand > 0 ? `. Asked about ${plural(demand, "time", "times")}` : "";
  const j =
    journey > 0
      ? `. Checking would confirm ${plural(journey, "journey", "journeys")} in the latest test run`
      : "";
  return asked + j;
}

/** Each place is a row; named paths collapse to one row per street name, and every unnamed path
 * into a single row. Only items with something not yet checked count. */
export function gapRows(items: GapItem[], limit = 10): GapRow[] {
  const rows: GapRow[] = [];
  const groups = new Map<string, GapItem[]>();
  const unnamed: GapItem[] = [];
  for (const i of items) {
    if (i.unknown <= 0) continue;
    if (i.kind !== "segment") {
      rows.push({
        key: i.id,
        kind: "place",
        label: i.name,
        detail: gapSummary(i),
        demand: i.demand,
        journey: i.journey,
        unknown: i.unknown,
        stale: i.stale,
        reported: i.reported,
        count: 1,
        attributes: i.attributes,
        firstId: i.id,
        at: null,
      });
    } else if (i.named) groups.set(i.name, [...(groups.get(i.name) ?? []), i]);
    else unnamed.push(i);
  }
  const segRow = (
    key: string,
    kind: "street" | "unnamed",
    label: string,
    segs: GapItem[],
  ): GapRow => {
    const unknown = segs.reduce((n, s) => n + s.unknown, 0);
    const demand = segs.reduce((n, s) => n + s.demand, 0);
    const journey = segs.reduce((n, s) => n + s.journey, 0);
    const first = [...segs].sort(
      (a, b) => b.demand - a.demand || b.journey - a.journey || a.id.localeCompare(b.id),
    )[0] as GapItem;
    const uniform = segs.every((s) => s.unknown === first.unknown);
    const facts = uniform
      ? `${plural(first.unknown, "fact", "facts")} each not yet checked`
      : `${plural(unknown, "fact", "facts")} not yet checked in total`;
    return {
      key,
      kind,
      label,
      detail: `${plural(segs.length, "path segment", "path segments")}, ${facts}${suffix(demand, journey)}`,
      demand,
      journey,
      unknown,
      stale: segs.reduce((n, s) => n + s.stale, 0),
      reported: segs.reduce((n, s) => n + s.reported, 0),
      count: segs.length,
      attributes: [...new Set(segs.flatMap((s) => s.attributes))],
      firstId: first.id,
      at: midpoint(first.coords),
    };
  };
  for (const [name, segs] of groups) rows.push(segRow(`street:${name}`, "street", name, segs));
  if (unnamed.length > 0)
    rows.push(
      segRow(
        "unnamed",
        "unnamed",
        `${unnamed.length.toLocaleString("en-US")} unnamed path segments`,
        unnamed,
      ),
    );
  return rows
    .sort(
      (a, b) =>
        b.demand - a.demand ||
        b.journey - a.journey ||
        b.unknown - a.unknown ||
        a.label.localeCompare(b.label) ||
        a.key.localeCompare(b.key),
    )
    .slice(0, limit);
}

const PROFILE_WORDS: Record<string, string> = {
  stroller: "stroller",
  wheelchair: "wheelchair",
  older_adult_rest: "older-adult",
};

/** One plain sentence with the computed numbers for the active profile, so a near-uniform map
 * reads as a finding. Empty when no path has a fact that matters for the profile. */
export function gapSummaryLine(items: GapItem[], profile: string): string {
  const paths = items.filter((i) => i.kind === "segment" && i.relevant > 0);
  if (paths.length === 0) return "";
  const open = paths.filter((i) => i.unknown > 0).length;
  const n = (v: number) => v.toLocaleString("en-US");
  const who = PROFILE_WORDS[profile] ?? profile;
  const demo = paths.filter((i) => i.demo > 0).length;
  const demoNote = demo > 0 ? ` ${n(demo)} of them rest on demo values, not yet surveyed.` : "";
  if (open === 0)
    return `Every path has its facts checked for ${who} travel (${n(paths.length)} paths).`;
  if (open / paths.length > 0.5)
    return `Most paths are not yet checked: ${n(open)} of ${n(paths.length)} for ${who} travel.${demoNote}`;
  return `${n(open)} of ${n(paths.length)} paths have facts not yet checked for ${who} travel.${demoNote}`;
}

export const attributeNames = (attrs: string[]): string => attrs.map(optionLabel).join(", ");

/** One-line summary for a row. */
export function gapSummary(i: GapItem): string {
  const facts = `${i.unknown} ${i.unknown === 1 ? "fact" : "facts"} not yet checked`;
  const stale = i.stale > 0 ? `, ${i.stale} out of date` : "";
  const reported = i.reported > 0 ? `, ${i.reported} only reported` : "";
  const demo =
    i.demo > 0 ? `, ${i.demo} demo ${i.demo === 1 ? "value" : "values"}, not yet surveyed` : "";
  const asked =
    i.demand > 0 ? `. Asked about ${i.demand} ${i.demand === 1 ? "time" : "times"}` : "";
  return `${facts}${stale}${reported}${demo}${asked}`;
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
