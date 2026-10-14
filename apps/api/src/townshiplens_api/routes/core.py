import copy

from fastapi import APIRouter, HTTPException, Query
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


@router.get("/layers/{lens}")
def layers(lens: str, profile: str = "default", scenario_id: str | None = None) -> dict:
    if lens not in geojson.LENSES:
        raise HTTPException(404, f"unknown lens {lens}")
    return geojson.layer(state.get_ctx().world, lens, profile, scenario_id)


@router.get("/graph")
def graph(profile: str = "default", scenario_id: str | None = None) -> dict:
    return geojson.layer(state.get_ctx().world, "access", profile, scenario_id)


@router.get("/places", response_model=ToolResult)
def places(q: str = Query("", max_length=200)) -> ToolResult:
    return tools.find_place(state.get_ctx(), q)


@router.get("/places/{place_id}", response_model=ToolResult)
def place(place_id: str) -> ToolResult:
    r = tools.get_place_details(state.get_ctx(), place_id)
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
