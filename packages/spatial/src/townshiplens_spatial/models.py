"""Canonical data and IO models. Names follow docs/04-architecture/README.md."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator

ClaimStatus = Literal["unknown", "reported", "verified", "stale", "contested"]
EvalResult = Literal["PASS", "FAIL", "UNKNOWN"]
RouteStatus = Literal["confirmed", "partly_unverified", "blocked", "no_data"]
FloodClass = Literal["likely_flooded", "possible", "unlikely"]
ProfileId = Literal["default", "stroller", "wheelchair", "older_adult_rest", "drive"]
Lens = Literal["access", "flood", "waste"]
LonLat = list[float]  # [lon, lat]


class Claim(BaseModel):
    value: Any = None
    status: ClaimStatus = "unknown"
    evidence_type: str | None = None
    method: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)
    verified_by: str | None = None
    verified_at: str | None = None  # ISO date
    ttl_days: int | None = None
    notes: str | None = None


def photo_url(claim: Claim) -> str | None:
    """Public URL of the newest uploaded photo attached to a claim (GET /evidence/{id})."""
    last = claim.evidence_ids[-1] if claim.evidence_ids else ""
    return f"/evidence/{last}" if re.fullmatch(r"[0-9a-f]{32}", last) else None


class Evidence(BaseModel):
    id: str  # "ev-<element_id>.<attribute>" or "ev-scn-<scenario_id>" or "ev-place-<place_id>"
    element_id: str
    attribute: str
    value: Any = None
    status: ClaimStatus | FloodClass | Literal["indicative"]
    verified_at: str | None = None
    source_type: str | None = None
    source_url: str | None = None
    photo_url: str | None = None


DEFAULT_TIMEZONE = "Asia/Kuala_Lumpur"


def utcnow() -> datetime:
    """The one clock closures use; tests replace it to move time without a restart."""
    return datetime.now(UTC)


def site_tz(name: str | None = None):
    try:
        return ZoneInfo(name or DEFAULT_TIMEZONE)
    except ZoneInfoNotFoundError:  # no tzdata installed: Malaysia has no DST, so +08:00 is exact
        return timezone(timedelta(hours=8))


ClosureReason = Literal["works", "event", "flooding", "other"]


def _utc(v: Any) -> Any:
    """Naive datetimes are read as UTC so window comparisons never mix naive and aware."""
    if isinstance(v, str):
        v = datetime.fromisoformat(v.replace("Z", "+00:00"))
    if isinstance(v, datetime) and v.tzinfo is None:
        return v.replace(tzinfo=UTC)
    return v


class Closure(BaseModel):
    """A staff-reported closure of one edge or place (Task 46). Never verified data: it is a
    report, shown as "Reported closure (staff)". Active while starts_at <= now < ends_at."""

    id: str
    element_id: str
    reason: ClosureReason
    starts_at: datetime
    ends_at: datetime | None = None  # None = until further notice
    note: str | None = None
    created_by: Literal["staff", "whatif"] = "staff"
    # "whatif": imagined by the township world model (twm.ClosePath); never stored or shown as
    # a staff report.
    source: Literal["staff_report", "whatif"] = "staff_report"
    created_at: datetime | None = None

    _norm = field_validator("starts_at", "ends_at", "created_at", mode="before")(_utc)

    def is_active(self, now: datetime | None = None) -> bool:
        now = now or utcnow()
        return self.starts_at <= now and (self.ends_at is None or now < self.ends_at)

    def label(self, tz: str | None = None) -> str:
        """ "Closed: works until 20 Oct 2026" with the date in the site's time zone."""
        if self.source == "whatif":
            return "Closed in this what-if (not a real closure)"
        until = fmt_day(self.ends_at, tz) if self.ends_at else "further notice"
        return f"Closed: {self.reason} until {until}"


def fmt_day(d: datetime, tz: str | None = None) -> str:
    local = d.astimezone(site_tz(tz))
    return f"{local.day} {local.strftime('%b %Y')}"


def active_closures(closures: list[Closure], now: datetime | None = None) -> list[Closure]:
    now = now or utcnow()
    return [c for c in closures if c.is_active(now)]


class Edge(BaseModel):
    id: str
    type: str  # footway|sidewalk|crossing|steps|ramp|path|street|...
    from_node: str
    to_node: str
    coords: list[LonLat]
    length_m: float
    name: str | None = None
    claims: dict[str, Claim] = Field(default_factory=dict)
    # Staff-reported closures (not yet expired); evaluate_edge ignores any outside its window.
    closures: list[Closure] = Field(default_factory=list)


class Place(BaseModel):
    id: str
    kind: Literal["place", "entrance", "amenity"] = "place"
    type: str  # facility|parking|toilet|seating|shelter|playground|school|...
    name: str
    aliases: list[str] = Field(default_factory=list)
    coord: LonLat
    node_id: str | None = None
    # True when node_id is the nearest walk node to an OSM area (Task 43), not a mapped entrance.
    node_inferred: bool = False
    entrance_ids: list[str] = Field(default_factory=list)
    claims: dict[str, Claim] = Field(default_factory=dict)
    closures: list[Closure] = Field(default_factory=list)


class DeepSpot(BaseModel):
    id: str
    lens: Lens
    name: str
    bbox: list[float]  # [w, s, e, n]


class SceneConfig(BaseModel):
    hero: str = "cesium_google_photoreal"
    fallback: str = "cesium_osm_buildings"
    lite: str = "mapbox_standard"
    datum_offset_m: float = 0.0
    home: dict[str, float] = Field(
        default_factory=lambda: {"lon": 101.5099, "lat": 3.1813, "range_m": 6000}
    )


class Site(BaseModel):
    id: str
    name: str
    township: str
    center: LonLat
    bbox: list[float]  # [w, s, e, n]
    deep_spots: list[DeepSpot] = Field(default_factory=list)
    timezone: str = DEFAULT_TIMEZONE  # IANA zone for every date shown to residents and staff
    lenses: list[Lens] = Field(default_factory=lambda: ["access", "flood", "waste"])
    scene: SceneConfig = Field(default_factory=SceneConfig)
    profiles: list[ProfileId] = Field(
        default_factory=lambda: ["default", "stroller", "wheelchair", "older_adult_rest", "drive"]
    )
    attribution: list[str] = Field(default_factory=list)
    data_as_of: str | None = None


class Scenario(BaseModel):
    id: str  # baseline | stage_p1m..stage_p5m
    label: str
    stage_m: float
    method: str = "HAND"
    dem: str = "Copernicus GLO-30"
    margin_m: float | None = None  # omitted when the scenario does not state one
    created: str | None = None
    disclaimer: str
    links: list[dict[str, str]] = Field(default_factory=list)


class FloodBundle(BaseModel):
    scenarios: list[Scenario]
    edge_classes: dict[str, dict[str, FloodClass]] = Field(
        default_factory=dict
    )  # scenario -> edge -> class
    place_classes: dict[str, dict[str, FloodClass]] = Field(
        default_factory=dict
    )  # scenario -> place -> class


class EvacCentre(BaseModel):
    id: str
    place_id: str | None = None
    name: str
    coord: LonLat
    node_id: str | None = None
    # True when node_id comes from an area snap (Task 43): the entrance is not mapped.
    node_inferred: bool = False
    source: Literal["official_pps", "osm_candidate"]
    capacity: int | None = None
    evidence_url: str | None = None
    notes: str | None = None


class WastePoint(BaseModel):
    id: str
    name: str
    type: Literal[
        "bin", "recycling_drop_off", "e_waste_drop_off", "composting_site", "programme_site"
    ]
    coord: LonLat
    accepted_items: list[str] = Field(default_factory=list)
    status: ClaimStatus = "unknown"
    verified_at: str | None = None
    source_url: str | None = None


class RouteSegment(BaseModel):
    edge_id: str
    eval: EvalResult
    flood_class: FloodClass | None = None


class Route(BaseModel):
    id: str  # "rt-<hash>"
    status: RouteStatus
    from_place: str
    to_place: str
    target_node: str
    profile: ProfileId
    scenario_id: str | None = None
    distance_m: float
    est_minutes: float
    segments: list[RouteSegment]
    unknowns: list[dict[str, str]] = Field(default_factory=list)  # {element_id, attribute, why}
    # {place_id, node_id, name, status: verified|unverified}; rest points recorded absent are
    # left out.
    rest_points: list[dict[str, Any]] = Field(default_factory=list)
    max_gap_between_rest_m: float | None = None
    # Profiles with max_rest_free_run_m (older_adult_rest): the limit, and whether this route
    # keeps every stretch between rest points within it. None for profiles without a limit.
    rest_limit_m: float | None = None
    rest_limit_met: bool | None = None
    # Unverified rest points (no claim / OSM only, unknown, stale, contested) this route needs to
    # stay within the limit; non-empty means the route is at most partly_unverified.
    rest_points_unverified: list[str] = Field(default_factory=list)
    geometry: dict[str, Any]  # GeoJSON LineString
    evidence_ids: list[str] = Field(default_factory=list)
    # True when any fact this route rests on is `team_survey_placeholder` evidence. The status is
    # unchanged (the evaluation is right); this lets the UI and agent say "confirmed on demo
    # values, not yet surveyed".
    demo_evidence: bool = False


class RouteResult(BaseModel):
    status: RouteStatus
    routes: list[Route]  # routes[0] = recommended; optional routes[1] = shorter lenient alternative
    blocked_reasons: list[dict[str, str]] = Field(default_factory=list)
    # Staff-reported closures responsible for this answer: on the route they forced a detour from,
    # or that the route would need. Never truncated (blocked_reasons is capped at 5).
    closures: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    # Profiles with max_rest_free_run_m only (else None): routes[0]'s longest stretch without
    # a rest point, and the profile's limit.
    max_rest_gap_m: float | None = None
    rest_limit_m: float | None = None
    # The rest-constrained search hit MAX_REST_LABELS: a route within the limit may exist.
    rest_search_truncated: bool = False
    demo_evidence: bool = False  # routes[0].demo_evidence (False when there is no route)


class ToolResult(BaseModel):
    ok: bool
    data: Any = None
    evidence: list[Evidence] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class VerificationRequest(BaseModel):
    id: str  # "vr-0001"
    element_id: str
    attribute: str
    reason: Literal[
        "unknown",
        "stale",
        "contradicted",
        "no_route_unverified_segment",
        "missing_place",
        "user_report",
    ]
    status: Literal["open", "in_progress", "resolved", "rejected"] = "open"
    demand: int = 1
    question_summary: str | None = None
    created_at: str
    resolved_at: str | None = None
    resolution: dict[str, Any] | None = None


class AffectedResult(BaseModel):
    scenario_id: str
    # Briefing items, capped: places {id, name, kind}; paths grouped by name {name, kind, count}
    likely: list[dict[str, Any]]
    possible: list[dict[str, Any]]
    isolated_components: list[dict[str, Any]]  # {id, node_count, place_count, sample_*}
    disclaimer: str
    likely_total: int = 0  # underlying elements (places + path edges), before grouping/capping
    possible_total: int = 0
    isolated_total: int = 0
    # The same totals split: places and path segments are never counted together as "places".
    likely_place_count: int = 0
    likely_path_count: int = 0
    possible_place_count: int = 0
    possible_path_count: int = 0
    likely_place_ids: list[str] = Field(default_factory=list)  # full id lists for evidence / map
    possible_place_ids: list[str] = Field(default_factory=list)
    likely_edge_ids: list[str] = Field(default_factory=list)
    possible_edge_ids: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class CentreReachability(BaseModel):
    centre: EvacCentre
    reachable: bool
    # "closed": a staff-reported closure is in force on the centre's place (Task 55, R33); the
    # centre is never reachable, whatever the paths to it say. `closure` carries the closure line.
    route_status: RouteStatus | Literal["closed"]
    closure: str | None = None
    route_id: str | None = None
    distance_m: float | None = None


class Profile(BaseModel):
    id: ProfileId
    label: str
    hard: dict[str, float] = Field(default_factory=dict)
    soft: dict[str, float] = Field(default_factory=dict)
    max_rest_free_run_m: float | None = None
    flood: dict[str, str] = Field(default_factory=dict)
    note: str | None = None
    stub: bool = False
    # Vehicle profiles: only these edge types are usable (None = every type), and the route's
    # est_minutes uses speed_kmh instead of walking pace.
    allowed_types: list[str] | None = None
    speed_kmh: float | None = None
    # Shown on every route/answer for this profile; the route is never "confirmed".
    standing_warning: str | None = None
    # Walking profiles on a `major_road` edge whose sidewalk claim is "none": FAIL (cannot use the
    # carriageway) or UNKNOWN. A missing sidewalk claim is always UNKNOWN.
    no_sidewalk_is: Literal["FAIL", "UNKNOWN"] = "UNKNOWN"
