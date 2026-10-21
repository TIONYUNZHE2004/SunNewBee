import type { Schemas } from "@tl/api-client";

/**
 * T-026 closure simulation results, typed from the generated client. A management answer brings
 * one in its `closure.show` intent (T-028: the chat replaces the closure form): the result card
 * under the answer and the map lines come from here.
 */

export type ClosureImpact = Schemas["ClosureImpact"];
export type DetourRoad = Schemas["DetourRoad"];
export type ClosureSuggestion = Schemas["EventSuggestion"];
export type Pressure = DetourRoad["pressure"];

/** Detour pressure colours (managers only): legend green / amber / orange; the course is red. */
export const PRESSURE_STYLE: Readonly<
  Record<Pressure, { color: string; label: string; tone: "ok" | "amber" | "peach" }>
> = {
  low: { color: "#2F855A", label: "Low detour pressure", tone: "ok" },
  medium: { color: "#B7791F", label: "Medium detour pressure", tone: "amber" },
  high: { color: "#DD6B20", label: "High detour pressure", tone: "peach" },
};
export const COURSE_STYLE = { color: "#C53030", width: 9, label: "Closed course" } as const;

const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;

/** The result card's lines: every number is the API's; old data gaps are kept apart. */
export function resultLines(r: ClosureImpact): {
  affected: string;
  newly: string;
  gaps: string | null;
  extra: string | null;
} {
  return {
    affected: `${r.trips_affected} of ${n(r.trips_total, "sample trip", "sample trips")} change route`,
    newly: `${n(r.trips_newly_no_route, "trip", "trips")} newly without a mapped route`,
    gaps: r.trips_no_route_before
      ? `${r.trips_no_route_before} of the ${r.trips_total} had no mapped route before the closure (data gaps, not the closure)`
      : null,
    extra:
      r.extra_m_median != null
        ? `Rerouted trips go about ${r.extra_m_median} m further (median)`
        : null,
  };
}

/** The closed course: the segment ids the engine resolved for each window, for the map. */
export function courseSegmentIds(r: ClosureImpact): string[] {
  return [...new Set(r.event.closures.flatMap((c) => c.segment_ids ?? []))];
}

/** The card lists the first detour rows as the engine ordered them; the rest are counted. */
export const DETOUR_ROWS = 5;

/** Each suggestion text once. */
export function uniqueSuggestions(r: ClosureImpact): ClosureSuggestion[] {
  return [...new Map(r.suggestions.map((s) => [s.text, s])).values()];
}

const BASIS_WORDS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [
    /^detour_roads\[(.+)\]\.weighted_trips=(.+)$/,
    (m) => `${m[2]} weighted sample trips on ${m[1]}`,
  ],
  [/^detour_roads\[(.+)\]\.trips=(.+)$/, (m) => `${m[2]} sample trips reroute onto ${m[1]}`],
  [/^detour_roads\[(.+)\]\.oneway_segments=(.+)$/, (m) => `${m[2]} one-way segments on ${m[1]}`],
  [/^weighted_trips=(.+)$/, (m) => `${m[1]} weighted`],
  [/^capacity\[(.+)\]=(.+)$/, (m) => `${m[1]} road capacity ${m[2]}`],
  [/^places_cut_off count=(.+)$/, (m) => `${m[1]} ${m[1] === "1" ? "place" : "places"} cut off`],
  [/^mapped_junction=.+$/, () => "one mapped junction on the closure boundary"],
  [/^trips_affected=(.+)$/, (m) => `${m[1]} sample trips affected`],
  [/^trips_total=(.+)$/, (m) => `${m[1]} sample trips in all`],
  [/^active_segments=(.+)$/, (m) => `${m[1]} closed segments`],
];

/** A suggestion's basis in plain words for managers ("8 weighted sample trips on X; …");
 * an unknown term is kept as the engine wrote it, never dropped. */
export function basisWords(basis: string): string {
  return basis
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      for (const [re, say] of BASIS_WORDS) {
        const m = t.match(re);
        if (m) return say(m);
      }
      return t;
    })
    .join("; ");
}

type Edge = { id: string; coords: [number, number][] };

/** Map lines from the access layer's edge geometry: the course in red, detours by pressure. */
export function closureFeatures(r: ClosureImpact, edges: readonly Edge[]) {
  const byId = new Map(edges.map((e) => [e.id, e.coords]));
  const line = (id: string, props: Record<string, unknown>) => {
    const c = byId.get(id);
    return c && c.length >= 2
      ? {
          type: "Feature" as const,
          properties: props,
          geometry: { type: "LineString" as const, coordinates: c },
        }
      : null;
  };
  const feats = [
    ...courseSegmentIds(r).map((id) => line(id, { closure: "course" })),
    ...r.detour_roads.flatMap((d) =>
      d.segment_ids.map((id) => line(id, { closure: "detour", pressure: d.pressure ?? "low" })),
    ),
  ];
  return { type: "FeatureCollection" as const, features: feats.filter((f) => f !== null) };
}
