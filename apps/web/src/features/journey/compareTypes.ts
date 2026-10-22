/**
 * The `route.compare` scene intent (demo polish spec §5.1 / §5.3): fastest route against the
 * profile's recommended route, with the stop point, known-fact reasons, unchecked stretches, POIs
 * and the survey ticket.
 *
 * Mirrors the agent's `RouteCompare` wire model (packages/agent events.py, generated as
 * `components["schemas"]["RouteCompare"]` in packages/api-client): `SceneIntent.compare` on a
 * `route.compare` intent, with `from_place` / `to_place` and each route's `coordinates` +
 * `segments`. `asCompareIntent` reads it loosely so a malformed intent never throws.
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
  /** Not on the wire today; read when present (B8 stop edge length). */
  length_m?: number;
}

export interface CompareRoute {
  id: string;
  status: CompareStatus;
  distance_m: number;
  est_minutes: number;
  segments: CompareSegment[];
  /** [lon, lat] in travel order. */
  coordinates: [number, number][];
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
  /** The stop fact rests on team_survey_placeholder evidence: "Demo value · not surveyed" (R45). */
  demo: boolean;
}

/** A reason field that can be flagged as a demo value (`ReasonSet.demo_fields`). */
export type ReasonField =
  | "steps"
  | "max_incline_pct"
  | "min_width_m"
  | "covered_share"
  | "rest_stops"
  | "distance_m"
  | "minutes";

/**
 * Known-fact reasons; a field is null when no edge on the route has a known value for it.
 * `steps` is null ("Not checked yet") unless every edge's step count is known (R44).
 */
export interface ReasonSet {
  steps: number | null;
  max_incline_pct: number | null;
  min_width_m: number | null;
  covered_share: number | null;
  rest_stops: number | null;
  distance_m: number;
  minutes: number;
  /** The non-null fields whose value rests on team_survey_placeholder evidence (R45). */
  demo_fields: ReasonField[];
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
  /** The intent's `route_id` (= `recommended.id`); null when the intent carries none. */
  route_id: string | null;
  from_place: ComparePlace;
  to_place: ComparePlace;
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
  if (!Array.isArray(x.coordinates)) return null;
  return {
    ...(x as unknown as CompareRoute),
    est_minutes: num(x.est_minutes) ?? 0,
    segments: Array.isArray(x.segments) ? (x.segments as CompareSegment[]) : [],
  };
}

function reasonSet(x: unknown): ReasonSet | null {
  if (!isObj(x)) return null;
  const demo = Array.isArray(x.demo_fields)
    ? x.demo_fields.filter((f): f is ReasonField => typeof f === "string")
    : [];
  return { ...(x as unknown as ReasonSet), demo_fields: demo };
}

function place(x: unknown): ComparePlace {
  if (!isObj(x)) return { id: "", name: "" };
  return {
    id: typeof x.id === "string" ? x.id : "",
    name: typeof x.name === "string" ? x.name : "",
  };
}

/**
 * A `route.compare` scene intent, or null for any other intent. The payload sits under
 * `intent.compare` (B4); a payload handed in flat (tests, the hook) is read the same way.
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
    route_id: typeof i.route_id === "string" ? i.route_id : (recommended?.id ?? null),
    from_place: place(d.from_place),
    to_place: place(d.to_place),
    status: (d.status as CompareStatus) ?? recommended?.status ?? "no_data",
    profile: (d.profile as CompareProfile) ?? "wheelchair",
    same_path: d.same_path === true,
    fastest,
    recommended,
    stop: isObj(d.stop)
      ? { ...(d.stop as unknown as CompareStop), demo: d.stop.demo === true }
      : null,
    reasons: { fastest: reasonSet(reasons.fastest), recommended: reasonSet(reasons.recommended) },
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
    // A compare is a dry-day comparison (R46): a flood stop never plays as a plain barrier.
    c.stop?.attribute !== "flood" &&
    c.status !== "no_data" &&
    c.status !== "blocked"
  );
}
