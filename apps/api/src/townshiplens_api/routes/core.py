import copy
import hashlib
import json
import logging
import secrets
import sqlite3
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from townshiplens_spatial import tools
from townshiplens_spatial.models import RouteResult, Site, ToolResult

from .. import geojson, state
from .sim import _store as _sim_store

router = APIRouter()
log = logging.getLogger(__name__)


class RouteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    from_: str = Field(alias="from")
    to: str
    profile: str = "default"
    scenario_id: str | None = None


@router.get("/healthz", responses={503: {"description": "the world did not load"}})
def healthz():
    """Liveness that includes the world: a corrupt seed fails here, not only on every request."""
    try:
        state.get_ctx()
    except Exception:  # noqa: BLE001 - any load failure means not healthy
        log.exception("world failed to load")
        return JSONResponse({"status": "error"}, status_code=503)
    return {"status": "ok"}


@router.get("/site", response_model=Site)
def site() -> Site:
    return state.get_ctx().world.site


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
    key = f"{_BOOT}|{world.site.id}|{world.version}|{lens}|{profile}|{scenario_id or ''}|{live}"
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
    as_of: str | None = None
    attribution: list[str] = []


# (buildings mtime_ns, trees mtime_ns, site mtime_ns, data dir) -> (payload, etag)
_buildings_cache: dict[tuple, tuple[BuildingsLayer, str]] = {}


def clear_buildings_cache() -> None:
    _buildings_cache.clear()


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
    key = (str(data), _mtime(b_path), _mtime(t_path), _mtime(site_path))
    hit = _buildings_cache.get(key)
    if hit is None:
        try:
            site = json.loads(site_path.read_text(encoding="utf-8"))
            payload = BuildingsLayer(
                buildings=_read_collection(b_path),
                trees=_read_collection(t_path),
                as_of=(site.get("buildings") or {}).get("as_of"),
                attribution=list(site.get("attribution") or []),
            )
        except (OSError, ValueError) as e:  # JSONDecodeError and bad shapes are ValueErrors
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
    etag = _etag(world, lens, profile, scenario_id)
    headers = {"ETag": etag, "Cache-Control": CACHE_CONTROL}
    if _matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return geojson.layer(world, lens, profile, scenario_id)


@router.get("/graph")
def graph(profile: str = "default", scenario_id: str | None = None) -> dict:
    return geojson.layer(state.get_ctx().world, "access", profile, scenario_id)


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
    if scenario_id is not None and scenario_id not in {s.id for s in ctx.world.flood.scenarios}:
        raise HTTPException(404, f"unknown scenario {scenario_id}")
    if profile not in ctx.world.profiles:
        raise HTTPException(422, f"unknown profile {profile}")
    r = tools.get_place_details(ctx, place_id, scenario_id, profile, near)
    if not r.ok:
        raise HTTPException(404, f"unknown place {place_id}")
    return r


@router.post("/routes", response_model=RouteResult)
def routes(req: RouteRequest) -> RouteResult:
    """Plan only: this anonymous endpoint never files verification requests (the chat does)."""
    r = tools.plan_route(
        state.get_ctx(), req.from_, req.to, req.profile, req.scenario_id, file_vrs=False
    )
    data = copy.copy(r.data)
    data.pop("verification_requests", None)
    data.setdefault("warnings", [])
    data["warnings"] = list(data["warnings"]) + [w for w in r.warnings if w not in data["warnings"]]
    return RouteResult.model_validate(data)
