"""Canonical data and IO models. Names follow docs/04-architecture/README.md."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field

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


class Edge(BaseModel):
    id: str
    type: str  # footway|sidewalk|crossing|steps|ramp|path|street|...
    from_node: str
    to_node: str
    coords: list[LonLat]
    length_m: float
    name: str | None = None
    claims: dict[str, Claim] = Field(default_factory=dict)


class Place(BaseModel):
    id: str
    kind: Literal["place", "entrance", "amenity"] = "place"
    type: str  # facility|parking|toilet|seating|shelter|playground|school|...
    name: str
    aliases: list[str] = Field(default_factory=list)
    coord: LonLat
    node_id: str | None = None
    entrance_ids: list[str] = Field(default_factory=list)
    claims: dict[str, Claim] = Field(default_factory=dict)


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
    margin_m: float = 0.5
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
    rest_points: list[dict[str, Any]] = Field(default_factory=list)
    max_gap_between_rest_m: float | None = None
    geometry: dict[str, Any]  # GeoJSON LineString
    evidence_ids: list[str] = Field(default_factory=list)


class RouteResult(BaseModel):
    status: RouteStatus
    routes: list[Route]  # routes[0] = recommended; optional routes[1] = shorter lenient alternative
    blocked_reasons: list[dict[str, str]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


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
    likely_place_ids: list[str] = Field(default_factory=list)  # full id lists for evidence / map
    possible_place_ids: list[str] = Field(default_factory=list)
    likely_edge_ids: list[str] = Field(default_factory=list)
    possible_edge_ids: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class CentreReachability(BaseModel):
    centre: EvacCentre
    reachable: bool
    route_status: RouteStatus
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
