import copy
import hashlib
import secrets
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from townshiplens_spatial import tools
from townshiplens_spatial.models import RouteResult, Site, ToolResult

from .. import geojson, state

router = APIRouter()


class RouteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    from_: str = Field(alias="from")
    to: str
    profile: str = "default"
    scenario_id: str | None = None


@router.get("/healthz")
def healthz() -> dict[str, str]:
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
    through refresh_claim, which bumps world.version), so never serialise the layer."""
    key = f"{_BOOT}|{world.site.id}|{world.version}|{lens}|{profile}|{scenario_id or ''}"
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


@router.get(
    "/layers/gaps",
    response_model=dict[str, Any],
    responses={304: {"description": "Not modified"}},
)
def gaps_layer(request: Request, response: Response, profile: str = "default"):
    """Gap map: per walk edge and place, how many relevant facts are not yet checked, how many
    are stale, and the open verification demand. Declared before /layers/{lens} so it wins."""
    ctx = state.get_ctx()
    demand = _open_demand(ctx)
    # Demand changes without a world.version bump, so it is part of the validator.
    sig = ",".join(f"{k}:{v}" for k, v in sorted(demand.items()))
    etag = _etag(ctx.world, "gaps", profile, sig)
    headers = {"ETag": etag, "Cache-Control": CACHE_CONTROL}
    if _matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return geojson.gaps_layer(ctx.world, demand, profile)


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
    near: str | None = None,
) -> ToolResult:
    r = tools.get_place_details(state.get_ctx(), place_id, scenario_id, profile, near)
    if not r.ok:
        raise HTTPException(404, f"unknown place {place_id}")
    return r


@router.post("/routes", response_model=RouteResult)
def routes(req: RouteRequest) -> RouteResult:
    r = tools.plan_route(
        state.get_ctx(), req.from_, req.to, req.profile, req.scenario_id, "api request"
    )
    data = copy.copy(r.data)
    data.pop("verification_requests", None)
    data.setdefault("warnings", [])
    data["warnings"] = list(data["warnings"]) + [w for w in r.warnings if w not in data["warnings"]]
    return RouteResult.model_validate(data)
