import copy
import hashlib
import json
import logging
import re
import secrets
import sqlite3
from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from townshiplens_spatial import tools
from townshiplens_spatial.journey import JourneyEvidenceError, build_journey
from townshiplens_spatial.models import (
    HHMM_PATTERN,
    BoundaryRef,
    CompareResult,
    JourneyPlan,
    Route,
    RouteResult,
    Site,
    ToolResult,
)
from townshiplens_spatial.routing import CENTRE_PREFIX

from .. import geojson, state
from ..selection import require_selection
from .sim import _store as _sim_store

router = APIRouter()
log = logging.getLogger(__name__)


class RouteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    from_: str = Field(alias="from")
    to: str
    profile: str = "default"
    scenario_id: str | None = None


class JourneyRequest(BaseModel):
    from_id: str = Field(max_length=200)
    to_id: str = Field(max_length=200)
    profile: str
    start_time: str = Field(pattern=HHMM_PATTERN)  # local "HH:MM"
    scenario_id: str | None = None


class NoJourney(BaseModel):
    """Why there is no journey to play: the route status and a plain message."""

    route_status: Literal["blocked", "no_data"]
    message: str
    warnings: list[str] = Field(default_factory=list)


# no_data is a data gap, never "blocked" or "not reachable" (AGENTS.md honesty invariants).
_NO_JOURNEY = {
    "no_data": "No mapped connection (data gap)",
    "blocked": "Every mapped path is cut by a known barrier",
}


@router.get("/healthz", responses={503: {"description": "the world did not load"}})
def healthz():
    """Liveness that includes the world: a corrupt seed fails here, not only on every request."""
    try:
        state.get_ctx()
    except Exception:  # noqa: BLE001 - any load failure means not healthy
        log.exception("world failed to load")
        return JSONResponse({"status": "error"}, status_code=503)
    from .. import warm

    # "warm": the world-model screens' default requests are cached (instant on stage).
    return {"status": "ok", "world_model": warm.public_status()}


class SiteBoundary(BoundaryRef):
    """The display-only Elmina outline with its geometry, for the stylised renderer's clip and
    diorama slab. Routing, evaluation and answers never read it. `geometry` is null when the file
    is missing, unreadable or not one Polygon / MultiPolygon."""

    geometry: dict[str, Any] | None = None


class SiteInfo(Site):
    boundary: SiteBoundary | None = None


# (boundary path, mtime_ns) -> geometry
_boundary_cache: dict[tuple[str, int], dict[str, Any] | None] = {}


def _boundary_geometry(ref: BoundaryRef) -> dict[str, Any] | None:
    data = state.data_dir().resolve()
    path = (data / ref.file).resolve()
    if not path.is_relative_to(data) or not path.is_file():
        return None
    key = (str(path), _mtime(path))
    if key in _boundary_cache:
        return _boundary_cache[key]
    geom: dict[str, Any] | None = None
    try:
        fc = json.loads(path.read_text(encoding="utf-8"))
        feats = fc.get("features") if isinstance(fc, dict) else None
        g = feats[0].get("geometry") if isinstance(feats, list) and len(feats) == 1 else None
        if isinstance(g, dict) and g.get("type") in ("Polygon", "MultiPolygon"):
            geom = g
    except (OSError, ValueError, AttributeError, TypeError) as e:
        log.warning("boundary unreadable: %s", e)
    _boundary_cache.clear()
    _boundary_cache[key] = geom
    return geom


@router.get("/site", response_model=SiteInfo)
def site() -> SiteInfo:
    s = state.get_ctx().world.site
    out = SiteInfo.model_validate(s.model_dump(exclude={"boundary"}))
    if s.boundary is not None:
        out.boundary = SiteBoundary(
            **s.boundary.model_dump(), geometry=_boundary_geometry(s.boundary)
        )
    return out


THRESHOLD_BASIS = "our engineering default (no published source)"


class ProfileInfo(BaseModel):
    """Read-only profile parameters, for the 'Assumptions' section. No secrets, no per-user data."""

    id: str
    label: str
    hard: dict[str, float]
    soft: dict[str, float]
    max_rest_free_run_m: float | None = None
    allowed_types: list[str] | None = None
    speed_kmh: float | None = None
    stub: bool = False
    # Walking profiles on a major_road: a sidewalk claim of "none" is FAIL or UNKNOWN; a missing
    # claim is always UNKNOWN, so strict profiles need a verified sidewalk there.
    no_sidewalk_is: str = "UNKNOWN"
    threshold_basis: str = THRESHOLD_BASIS


@router.get("/profiles", response_model=list[ProfileInfo])
def profiles() -> list[ProfileInfo]:
    return [
        ProfileInfo(**p.model_dump(include=set(ProfileInfo.model_fields) - {"threshold_basis"}))
        for p in state.get_ctx().world.profiles.values()
    ]


# world.version restarts at 0 on every boot, so scope validators to this process.
_BOOT = secrets.token_hex(4)
CACHE_CONTROL = "private, max-age=0, must-revalidate"


def _etag(world, lens: str, profile: str, scenario_id: str | None) -> str:
    """Cheap validator: layer content is a pure function of these inputs (claims only change
    through refresh_claim / set_closures, which bump world.version, plus closures that start or
    expire on the clock), so never serialise the layer."""
    # Closures switch on and off with the clock, not only with world.version: sign the live set.
    live = ",".join(c.id for c in world.active_closures())
    key = (
        f"{_BOOT}|{world.site.id}|{world.version}|{date.today().isoformat()}|"
        f"{lens}|{profile}|{scenario_id or ''}|{live}"
    )
    return f'"{hashlib.sha1(key.encode()).hexdigest()[:20]}"'


def _matches(header: str | None, etag: str) -> bool:
    if not header:
        return False
    cands = [t.strip().removeprefix("W/") for t in header.split(",")]
    return "*" in cands or etag in cands


def _open_demand(ctx) -> dict[str, int]:
    out: dict[str, int] = {}
    for vr in ctx.vrs.list("open"):
        out[vr.element_id] = out.get(vr.element_id, 0) + vr.demand
    return out


class GapProperties(BaseModel):
    """Per element: how many facts are not yet checked for the profile, and why it matters."""

    id: str
    kind: str
    type: str
    name: str | None = None
    relevant_count: int
    unknown_count: int
    stale_count: int
    reported_count: int
    demo_count: int  # of the unchecked facts, how many are demo values (not yet surveyed)
    unknown_attributes: list[str]
    demand: int  # open verification-request demand
    journey_impact: int  # journeys the latest simulation says checking this would confirm


class GapFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: dict[str, Any]
    properties: GapProperties


class GapsLayer(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[GapFeature]


def _journey_impact(profile: str) -> tuple[str, dict[str, int]]:
    """(latest run id, element id -> impact) for gaps whose profiles include `profile`. This is
    sim.py's own ranking (which unknowns would confirm the most journeys), read from the store."""
    try:
        store = _sim_store()
        recent = store.recent(1)
        report = store.get(recent[0]["run_id"]) if recent else None
    except sqlite3.Error:
        return "", {}
    if not report:
        return "", {}
    out: dict[str, int] = {}
    for g in report.get("gaps", []):
        if profile in g.get("affected_profiles", []):
            out[g["element_id"]] = out.get(g["element_id"], 0) + int(g["impact"])
    return report["run_id"], out


@router.get(
    "/layers/gaps",
    response_model=GapsLayer,
    responses={304: {"description": "Not modified"}},
)
def gaps_layer(request: Request, response: Response, profile: str = "default"):
    """Gap map: per walk edge and place, how many relevant facts are not yet checked, how many
    are stale or only reported, open verification demand and simulated journey impact. Declared
    before /layers/{lens} so it wins."""
    ctx = state.get_ctx()
    require_selection(ctx.world, profile)
    demand = _open_demand(ctx)
    run_id, impact = _journey_impact(profile)
    # Demand and the latest sim run change without a world.version bump: both are validators.
    sig = ",".join(f"{k}:{v}" for k, v in sorted(demand.items())) + "|" + run_id
    etag = _etag(ctx.world, "gaps", profile, sig)
    headers = {"ETag": etag, "Cache-Control": CACHE_CONTROL}
    if _matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return geojson.gaps_layer(ctx.world, demand, profile, impact)


class BuildingsLayer(BaseModel):
    """OSM building footprints and trees for the stylised 3D city (display only)."""

    buildings: dict[str, Any]  # GeoJSON FeatureCollection of Polygons
    trees: dict[str, Any]  # GeoJSON FeatureCollection of Points
    # Decorative base water (lake/riverbank polygons from OSM hydrology). Display only: this is
    # NOT a flood scenario and says nothing about water depth or extent in any event.
    water: dict[str, Any] = {"type": "FeatureCollection", "features": []}
    # Display-only park/green outlines (OSM). Never a fact.
    parks: dict[str, Any] = {"type": "FeatureCollection", "features": []}
    # Display-only land cover (ESA WorldCover / OSM), signage text and landmark markers. Signs
    # are filtered server-side: no text, source_url or as_of means the sign is never served.
    landcover: dict[str, Any] = {"type": "FeatureCollection", "features": []}
    signage: dict[str, Any] = {"type": "FeatureCollection", "features": []}
    landmarks: dict[str, Any] = {"type": "FeatureCollection", "features": []}
    as_of: str | None = None
    attribution: list[str] = []


# (data dir, mtime_ns of landcover, signage, landmarks, buildings, trees, site, hydrology, parks)
# -> (payload, etag)
_buildings_cache: dict[tuple, tuple[BuildingsLayer, str]] = {}


def clear_buildings_cache() -> None:
    _buildings_cache.clear()
    _furniture_cache.clear()


def _mtime(path) -> int:
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return 0


def _read_collection(path) -> dict[str, Any]:
    if not path.exists():
        return {"type": "FeatureCollection", "features": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("features"), list):
        raise ValueError(f"{path.name} is not a FeatureCollection")
    return data


def _polygons_only(fc: dict[str, Any]) -> dict[str, Any]:
    keep = [
        f
        for f in fc["features"]
        if isinstance(f, dict)
        and isinstance(f.get("geometry"), dict)
        and f["geometry"].get("type") in ("Polygon", "MultiPolygon")
    ]
    return {"type": "FeatureCollection", "features": keep}


_SIGN_REQUIRED = ("text", "source_url", "as_of")
# Mapper notes and placeholders are never sign text. Duplicated from data/scripts/build_signage.py
# JUNK (the API does not import data/scripts); a test in data/scripts/tests keeps them equal.
SIGN_JUNK = re.compile(r"unnamed|not osv|google maps|fixme|\btodo\b|\?|^\W*$", re.I)


def _sourced_signs_only(fc: dict[str, Any]) -> dict[str, Any]:
    """Honesty gate (ADR 0013): a sign without text, a source and an as-of date, or whose text is
    a mapper note (SIGN_JUNK), is never served."""

    def ok(f: Any) -> bool:
        props = f.get("properties") if isinstance(f, dict) else None
        if not isinstance(props, dict):
            return False
        if not all(isinstance(props.get(k), str) and props[k].strip() for k in _SIGN_REQUIRED):
            return False
        return not SIGN_JUNK.search(props["text"].strip())

    return {"type": "FeatureCollection", "features": [f for f in fc["features"] if ok(f)]}


@router.get(
    "/layers/buildings",
    response_model=BuildingsLayer,
    responses={
        304: {"description": "Not modified"},
        404: {"description": "no buildings seed for this world"},
        502: {"description": "the buildings seed is unreadable"},
    },
)
def buildings_layer(request: Request, response: Response):
    """OSM buildings and trees. Declared before /layers/{lens} so it wins. 404 when the world has
    no base/buildings.geojson (the client then falls back to the plain scene)."""
    data = state.data_dir()
    b_path, t_path = data / "base" / "buildings.geojson", data / "base" / "trees.geojson"
    if not b_path.exists():
        raise HTTPException(404, "no buildings data for this world")
    site_path = data / "site.json"
    h_path = data / "base" / "hydrology.geojson"
    p_path = data / "base" / "parks.geojson"
    lc_path = data / "base" / "landcover.geojson"
    sg_path = data / "base" / "signage.geojson"
    lm_path = data / "base" / "landmarks.geojson"
    key = (
        str(data),
        _mtime(lc_path),
        _mtime(sg_path),
        _mtime(lm_path),
        _mtime(b_path),
        _mtime(t_path),
        _mtime(site_path),
        _mtime(h_path),
        _mtime(p_path),
    )
    hit = _buildings_cache.get(key)
    if hit is None:
        try:
            site = json.loads(site_path.read_text(encoding="utf-8"))
            if not isinstance(site, dict):
                raise ValueError("site.json is not an object")
            payload = BuildingsLayer(
                buildings=_read_collection(b_path),
                trees=_read_collection(t_path),
                water=_polygons_only(_read_collection(h_path)),
                parks=_polygons_only(_read_collection(p_path)),
                landcover=_read_collection(lc_path),
                signage=_sourced_signs_only(_read_collection(sg_path)),
                landmarks=_read_collection(lm_path),
                as_of=(site.get("buildings") or {}).get("as_of"),
                attribution=list(site.get("attribution") or []),
            )
        except (
            OSError,
            ValueError,
            TypeError,
            AttributeError,
            RecursionError,
        ) as e:
            log.warning("buildings seed unreadable: %s", e)
            raise HTTPException(502, "buildings data is unreadable") from e
        etag = f'"{hashlib.sha1(repr(key).encode()).hexdigest()[:20]}"'
        _buildings_cache.clear()
        hit = _buildings_cache[key] = (payload, etag)
    payload, etag = hit
    headers = {"ETag": etag, "Cache-Control": CACHE_CONTROL}
    if _matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return payload


class StreetFurnitureLayer(BaseModel):
    """Fact-bearing street furniture for the stylised 3D city (display only, B-T6/B-T7): one Point
    per OSM traffic signal, bus stop, shelter, bench or picnic table inside the outline, plus seed
    seating / shelter places that coincide with none of them (`source: seed_place`). Each feature
    carries its source `id` and `kind`. Routing, evaluation and answers never read it."""

    furniture: dict[str, Any]  # GeoJSON FeatureCollection of Points
    as_of: str | None = None
    attribution: list[str] = []


FURNITURE_KINDS = frozenset({"traffic_signals", "bus_stop", "shelter", "bench", "picnic_table"})
# (data dir, mtime_ns of street_furniture, site) -> (payload, etag)
_furniture_cache: dict[tuple, tuple[StreetFurnitureLayer, str]] = {}


def _finite(v: Any) -> bool:
    return (
        isinstance(v, int | float) and not isinstance(v, bool) and v == v and abs(v) != float("inf")
    )


def _sourced_points_only(fc: dict[str, Any]) -> dict[str, Any]:
    """Honesty gate (AC-B7): a prop is drawn only for a feature with a source id, a known kind and
    a finite Point, so the client never draws one without its source."""

    def ok(f: Any) -> bool:
        if not isinstance(f, dict):
            return False
        props, geom = f.get("properties"), f.get("geometry")
        if not isinstance(props, dict) or not isinstance(geom, dict):
            return False
        pid = props.get("id")
        if not isinstance(pid, str) or not pid.strip() or props.get("kind") not in FURNITURE_KINDS:
            return False
        c = geom.get("coordinates")
        return (
            geom.get("type") == "Point"
            and isinstance(c, list)
            and len(c) >= 2
            and _finite(c[0])
            and _finite(c[1])
        )

    return {"type": "FeatureCollection", "features": [f for f in fc["features"] if ok(f)]}


@router.get(
    "/layers/street_furniture",
    response_model=StreetFurnitureLayer,
    responses={
        304: {"description": "Not modified"},
        404: {"description": "no street furniture seed for this world"},
        502: {"description": "the street furniture seed is unreadable"},
    },
)
def street_furniture_layer(request: Request, response: Response):
    """Street furniture points (display only). Declared before /layers/{lens} so it wins. 404 when
    the world has no base/street_furniture.geojson (the client then draws no fact props)."""
    data = state.data_dir()
    f_path, site_path = data / "base" / "street_furniture.geojson", data / "site.json"
    if not f_path.exists():
        raise HTTPException(404, "no street furniture data for this world")
    key = (str(data), _mtime(f_path), _mtime(site_path))
    hit = _furniture_cache.get(key)
    if hit is None:
        try:
            site = json.loads(site_path.read_text(encoding="utf-8"))
            if not isinstance(site, dict):
                raise ValueError("site.json is not an object")
            payload = StreetFurnitureLayer(
                furniture=_sourced_points_only(_read_collection(f_path)),
                as_of=(site.get("street_furniture") or {}).get("as_of"),
                attribution=list(site.get("attribution") or []),
            )
        except (OSError, ValueError, TypeError, AttributeError, RecursionError) as e:
            log.warning("street furniture seed unreadable: %s", e)
            raise HTTPException(502, "street furniture data is unreadable") from e
        etag = f'"{hashlib.sha1(repr(key).encode()).hexdigest()[:20]}"'
        _furniture_cache.clear()
        hit = _furniture_cache[key] = (payload, etag)
    payload, etag = hit
    headers = {"ETag": etag, "Cache-Control": CACHE_CONTROL}
    if _matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return payload


@router.get(
    "/layers/{lens}",
    response_model=dict[str, Any],
    responses={304: {"description": "Not modified"}},
)
def layers(
    lens: str,
    request: Request,
    response: Response,
    profile: str = "default",
    scenario_id: str | None = None,
):
    if lens not in geojson.LENSES:
        raise HTTPException(404, f"unknown lens {lens}")
    world = state.get_ctx().world
    require_selection(world, profile, scenario_id)
    etag = _etag(world, lens, profile, scenario_id)
    headers = {"ETag": etag, "Cache-Control": CACHE_CONTROL}
    if _matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return geojson.layer(world, lens, profile, scenario_id)


@router.get("/graph")
def graph(profile: str = "default", scenario_id: str | None = None) -> dict:
    world = state.get_ctx().world
    require_selection(world, profile, scenario_id)
    return geojson.layer(world, "access", profile, scenario_id)


@router.get("/places", response_model=ToolResult)
def places(q: str = Query("", max_length=200)) -> ToolResult:
    return tools.find_place(state.get_ctx(), q)


@router.get("/places/{place_id}", response_model=ToolResult)
def place(
    place_id: str,
    scenario_id: str | None = None,
    profile: str = "default",
    near: str | None = Query(None, max_length=120),
) -> ToolResult:
    ctx = state.get_ctx()
    # A bad parameter is an error, not a "data gap" row on the card (same as /briefings/flood).
    require_selection(ctx.world, profile, scenario_id)
    r = tools.get_place_details(ctx, place_id, scenario_id, profile, near)
    if not r.ok:
        raise HTTPException(404, f"unknown place {place_id}")
    return r


@router.post("/routes", response_model=RouteResult)
def routes(req: RouteRequest) -> RouteResult:
    """Plan only: this anonymous endpoint never files verification requests (the chat does)."""
    ctx = state.get_ctx()
    require_selection(ctx.world, req.profile, req.scenario_id)
    r = tools.plan_route(ctx, req.from_, req.to, req.profile, req.scenario_id, file_vrs=False)
    data = copy.copy(r.data)
    data.pop("verification_requests", None)
    data.setdefault("warnings", [])
    data["warnings"] = list(data["warnings"]) + [w for w in r.warnings if w not in data["warnings"]]
    return RouteResult.model_validate(data)


@router.post("/routes/compare", response_model=CompareResult)
def routes_compare(req: RouteRequest) -> CompareResult:
    """Fastest route next to the profile's route (navigation compare, demo polish B3): stop
    point, known-fact reasons, unchecked stretches, points of interest and `confirm_n`. Like
    POST /routes it never files verification requests, so `vr` is always null."""
    ctx = state.get_ctx()
    require_selection(ctx.world, req.profile, req.scenario_id)
    r = tools.compare_routes(ctx, req.from_, req.to, req.profile, req.scenario_id, file_vrs=False)
    if not r.ok:
        raise HTTPException(422, "; ".join(r.warnings) or "cannot compare these routes")
    return CompareResult.model_validate(r.data)


def _known_place(world, pid: str) -> bool:
    """A place id, or an evacuation-centre target (`__centre__<id>`) as plan_route takes it."""
    if pid in world.places:
        return True
    return pid.startswith(CENTRE_PREFIX) and pid[len(CENTRE_PREFIX) :] in world.centres


@router.post(
    "/journeys",
    response_model=JourneyPlan,
    responses={
        404: {"description": "unknown place or scenario"},
        409: {"model": NoJourney, "description": "no route to play (route status and why)"},
        422: {"description": "unknown profile or bad start time"},
        500: {"description": "a journey event without route evidence (a data or rule bug)"},
    },
)
def journeys(req: JourneyRequest) -> JourneyPlan | JSONResponse:
    """The journey for the recommended route between two places (spec 2026-10-19 §6.2).

    Planned per request, like POST /routes (no route store, no verification requests filed).
    The chat attaches the same plan to `journey.play` for the same endpoints, profile, scenario
    and start time."""
    ctx = state.get_ctx()
    require_selection(ctx.world, req.profile, req.scenario_id)
    for pid in (req.from_id, req.to_id):
        if not _known_place(ctx.world, pid):
            raise HTTPException(404, f"unknown place {pid}")
    r = tools.plan_route(ctx, req.from_id, req.to_id, req.profile, req.scenario_id, file_vrs=False)
    data = r.data if isinstance(r.data, dict) else {}
    warnings = list(dict.fromkeys([*data.get("warnings", []), *r.warnings]))
    routes = data.get("routes") or []
    if not routes:
        status = data.get("status", "no_data")
        status = status if status in _NO_JOURNEY else "no_data"
        body = NoJourney(route_status=status, message=_NO_JOURNEY[status], warnings=warnings)
        # The body is NoJourney itself (as the OpenAPI 409 declares), not {"detail": ...}.
        return JSONResponse(body.model_dump(), status_code=409)
    route = Route.model_validate(routes[0])
    try:
        return build_journey(ctx.world, route, req.profile, req.start_time)
    except JourneyEvidenceError as e:
        log.error("journey for %s failed: %s", route.id, e)
        raise HTTPException(500, f"Journey could not be built: {e}") from e
