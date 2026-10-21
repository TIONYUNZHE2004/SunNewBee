/**
 * The `route.compare` scene intent (demo polish spec §5.1 / §5.3): fastest route against the
 * profile's recommended route, with the stop point, known-fact reasons, unchecked stretches, POIs
 * and the survey ticket.
 *
 * Mirrors `CompareResult` (packages/spatial/src/townshiplens_spatial/models.py) plus what the
 * intent adds for the web: `from` / `to` names and each route's `geometry` + `segments`. Kept in
 * this one file so it can be aligned with the generated `SceneIntent` once the agent intent (B4)
 * lands in `packages/api-client`; until then `asCompareIntent` reads an intent loosely.
 */

export type CompareStatus = "confirmed" | "likely_ok" | "partly_unverified" | "blocked" | "no_data";
export type CompareProfile = "default" | "stroller" | "wheelchair" | "older_adult_rest" | "drive";
export type PoiKind = "kerb" | "covered_start" | "incline" | "seating" | "unknown" | "arrival";

export interface ComparePlace {
  id: string;
  name: string;
}

export interface CompareSegment {
  edge_id: string;
  /** PASS | FAIL | UNKNOWN under the route's own profile. */
  eval: string;
  [k: string]: unknown;
}

export interface CompareRoute {
  id: string;
  status: CompareStatus;
  distance_m: number;
  est_minutes: number;
  segments: CompareSegment[];
  /** GeoJSON LineString, coordinates [lon, lat]. */
  geometry: { type: "LineString"; coordinates: [number, number][] };
  evidence_ids?: string[];
  demo_evidence?: boolean;
  [k: string]: unknown;
}

/** The first known FAIL along the fastest route under the requested profile. */
export interface CompareStop {
  edge_id: string;
  /** Distance from the route start to the start of that edge. */
  at_m: number;
  attribute: string;
  value: unknown;
  limit: number | null;
  evidence_id: string | null;
}

/** Known-fact reasons; a field is null when no edge on the route has a known value for it. */
export interface ReasonSet {
  steps: number | null;
  max_incline_pct: number | null;
  min_width_m: number | null;
  covered_share: number | null;
  rest_stops: number | null;
  distance_m: number | null;
  minutes: number | null;
}

export interface UncheckedStretch {
  edge_id: string;
  attribute: string;
  start_m: number;
  end_m: number;
  length_m: number;
}

export interface Poi {
  kind: PoiKind;
  /** Distance along the recommended route. */
  at_m: number;
  value: unknown;
  evidence_ids: string[];
  /** Cites team_survey_placeholder evidence: "Demo value · not surveyed". */
  demo: boolean;
}

export interface CompareVr {
  id: string;
  created: boolean;
  target_id: string;
  attribute: string;
}

export interface CompareIntent {
  kind: "route.compare";
  from: ComparePlace;
  to: ComparePlace;
  status: CompareStatus;
  profile: CompareProfile;
  same_path: boolean;
  fastest: CompareRoute | null;
  recommended: CompareRoute | null;
  stop: CompareStop | null;
  reasons: { fastest: ReasonSet | null; recommended: ReasonSet | null };
  extra_minutes: number | null;
  unchecked: UncheckedStretch[];
  pois: Poi[];
  vr: CompareVr | null;
  confirm_n: number | null;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object";
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

function route(x: unknown): CompareRoute | null {
  if (!isObj(x) || typeof x.id !== "string" || num(x.distance_m) === null) return null;
  const g = x.geometry as { coordinates?: unknown } | undefined;
  if (!isObj(g) || !Array.isArray(g.coordinates)) return null;
  return {
    ...(x as unknown as CompareRoute),
    segments: Array.isArray(x.segments) ? (x.segments as CompareSegment[]) : [],
  };
}

function place(x: unknown, fallbackId: string): ComparePlace {
  if (isObj(x))
    return {
      id: typeof x.id === "string" ? x.id : fallbackId,
      name: typeof x.name === "string" ? x.name : "",
    };
  return { id: fallbackId, name: "" };
}

/**
 * A `route.compare` scene intent, or null for any other intent. Read loosely: the generated
 * `SceneIntent` learns this kind only when the API client is regenerated. The compare fields may
 * sit on the intent itself or under `compare` (whichever the agent settles on).
 */
export function asCompareIntent(i: unknown): CompareIntent | null {
  if (!isObj(i) || i.kind !== "route.compare") return null;
  const d = (isObj(i.compare) ? i.compare : i) as Record<string, unknown>;
  const fastest = route(d.fastest);
  const recommended = route(d.recommended);
  if (!fastest && !recommended) return null;
  const reasons = isObj(d.reasons) ? d.reasons : {};
  const list = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  return {
    kind: "route.compare",
    from: place(i.from ?? d.from, recommended?.from_place as string),
    to: place(i.to ?? d.to, recommended?.to_place as string),
    status: (d.status as CompareStatus) ?? recommended?.status ?? "no_data",
    profile: (d.profile as CompareProfile) ?? "wheelchair",
    same_path: d.same_path === true,
    fastest,
    recommended,
    stop: isObj(d.stop) ? (d.stop as unknown as CompareStop) : null,
    reasons: {
      fastest: isObj(reasons.fastest) ? (reasons.fastest as unknown as ReasonSet) : null,
      recommended: isObj(reasons.recommended)
        ? (reasons.recommended as unknown as ReasonSet)
        : null,
    },
    extra_minutes: num(d.extra_minutes),
    unchecked: list<UncheckedStretch>(d.unchecked),
    pois: list<Poi>(d.pois),
    vr: isObj(d.vr) ? (d.vr as unknown as CompareVr) : null,
    confirm_n: num(d.confirm_n),
  };
}

/**
 * True when the compare playback (split screen) has something to show: two different routes and a
 * recommended route that exists. A `same_path`, `no_data` or `blocked` compare plays today's
 * journey (or nothing) instead (spec §5.1: "the UI then skips the split screen").
 */
export function isPlayableCompare(c: CompareIntent | null | undefined): c is CompareIntent & {
  fastest: CompareRoute;
  recommended: CompareRoute;
} {
  return (
    !!c &&
    !!c.fastest &&
    !!c.recommended &&
    !c.same_path &&
    c.status !== "no_data" &&
    c.status !== "blocked"
  );
}
