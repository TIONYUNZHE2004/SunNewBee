/**
 * T-026 closure simulation, as the fixed contract in tasks/T-026 ("Decisions and API contract")
 * defines it. The backend builds `POST /closures/simulate` in parallel; until it lands these types
 * stand in for the generated client, and the panel says the simulation is not available yet.
 */

export const CLOSURE_REASONS = [
  ["event", "Event"],
  ["works", "Road works"],
  ["accident", "Accident"],
  ["flooding", "Flooding"],
  ["other", "Other"],
] as const;
export type ClosureReason = (typeof CLOSURE_REASONS)[number][0];
export type Pressure = "low" | "medium" | "high";

export interface ClosureSimRequest {
  name: string;
  reason: ClosureReason;
  closures: { road_names: string[]; starts_at: string; ends_at: string }[];
  profiles?: string[];
}

export interface DetourRoad {
  name: string;
  segment_ids: string[];
  trips: number;
  weighted_trips?: number;
  road_class?: string;
  pressure?: Pressure;
}

export interface ClosureSuggestion {
  kind: "signpost" | "marshal" | "crossing_point" | "two_way" | "split" | "reschedule";
  text: string;
  basis: string;
}

export interface ClosureImpact {
  trips_total: number;
  trips_affected: number;
  trips_no_route: number;
  trips_no_route_before: number;
  trips_newly_no_route: number;
  extra_m_median: number | null;
  extra_min_median: number | null;
  places_cut_off: { id: string; name: string }[];
  detour_roads: DetourRoad[];
  suggestions: ClosureSuggestion[];
  /** Course segment ids per closure, when the backend echoes them (map only). */
  closures?: { segment_ids?: string[] }[];
  event?: { name?: string; segment_ids?: string[] };
  weights_note?: string;
  disclaimer: string;
  timing_ms?: number;
}

/** One closure row in the form: roads as typed ("Persiaran X" or "X between A and B"). */
export interface ClosureRow {
  roads: string;
  day: string; // YYYY-MM-DD, Malaysia date
  start: string; // HH:MM
  end: string; // HH:MM
}

export const SITE_OFFSET = "+08:00"; // Malaysia: no daylight saving

/** Validate the form and build the contract body, or say what to fix. */
export function buildSimRequest(
  name: string,
  reason: ClosureReason,
  rows: ClosureRow[],
): { body: ClosureSimRequest } | { error: string } {
  if (rows.length === 0) return { error: "Add at least one closure" };
  const closures: ClosureSimRequest["closures"] = [];
  for (const [i, r] of rows.entries()) {
    const n = rows.length > 1 ? ` (closure ${i + 1})` : "";
    const roads = r.roads
      .split(/[;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (roads.length === 0) return { error: `Name a road or a stretch${n}` };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.day)) return { error: `Pick a day${n}` };
    if (!/^\d{2}:\d{2}$/.test(r.start) || !/^\d{2}:\d{2}$/.test(r.end))
      return { error: `Give a start and an end time${n}` };
    if (r.end <= r.start) return { error: `The end must be after the start${n}` };
    closures.push({
      road_names: roads,
      starts_at: `${r.day}T${r.start}:00${SITE_OFFSET}`,
      ends_at: `${r.day}T${r.end}:00${SITE_OFFSET}`,
    });
  }
  return { body: { name: name.trim() || "Closure", reason, closures } };
}

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

/** The course segment ids the backend echoed (closures[] or event), for the map. */
export function courseSegmentIds(r: ClosureImpact): string[] {
  const ids = [
    ...(r.closures ?? []).flatMap((c) => c.segment_ids ?? []),
    ...(r.event?.segment_ids ?? []),
  ];
  return [...new Set(ids)];
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

export type SimOutcome =
  | { ok: true; result: ClosureImpact }
  | { ok: false; unavailable: boolean; message: string };

/** POST /closures/simulate. A 404 or 405 means the backend has not landed: say so plainly. */
export async function simulateClosures(
  body: ClosureSimRequest,
  fetcher: typeof fetch = fetch,
): Promise<SimOutcome> {
  let res: Response;
  try {
    res = await fetcher("/api/closures/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, unavailable: false, message: "We could not reach the service." };
  }
  if (res.status === 404 || res.status === 405)
    return {
      ok: false,
      unavailable: true,
      message: "Closure simulation is not available on this server yet.",
    };
  if (!res.ok) {
    const detail = await res
      .json()
      .then((j: { detail?: unknown }) => (typeof j.detail === "string" ? j.detail : null))
      .catch(() => null);
    return { ok: false, unavailable: false, message: detail ?? "The simulation could not run." };
  }
  return { ok: true, result: (await res.json()) as ClosureImpact };
}
