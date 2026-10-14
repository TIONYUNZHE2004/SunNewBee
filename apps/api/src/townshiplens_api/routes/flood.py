from datetime import date

from fastapi import APIRouter, HTTPException
from townshiplens_spatial import flood, tools
from townshiplens_spatial.models import AffectedResult, CentreReachability, Scenario, WastePoint

from .. import state

router = APIRouter()


@router.get("/scenarios", response_model=list[Scenario])
def scenarios() -> list[Scenario]:
    return state.get_ctx().world.flood.scenarios


@router.get("/scenarios/{scenario_id}")
def scenario_water(scenario_id: str) -> dict:
    world = state.get_ctx().world
    fc = world.water.get(scenario_id)
    if fc is None:
        raise HTTPException(404, f"unknown scenario {scenario_id}")
    off = world.site.scene.datum_offset_m
    feats = []
    for f in fc.get("features", []):
        props = dict(f.get("properties") or {})
        if "surface_height_m" in props:
            props["surface_height_m"] = props["surface_height_m"] + off
        feats.append({**f, "properties": props})
    return {**fc, "features": feats}


@router.get("/scenarios/{scenario_id}/affected", response_model=AffectedResult)
def affected(scenario_id: str, profile: str = "default") -> AffectedResult:
    world = state.get_ctx().world
    if flood.scenario(world, scenario_id) is None:
        raise HTTPException(404, f"unknown scenario {scenario_id}")
    return flood.affected(world, scenario_id, profile)


@router.get("/evacuation-centres", response_model=list[CentreReachability])
def evac(scenario_id: str | None = None, profile: str = "default", near: str | None = None):
    r = tools.list_evacuation_centres(state.get_ctx(), scenario_id, profile, near)
    return [CentreReachability.model_validate(d) for d in r.data]


@router.get("/waste-points", response_model=list[WastePoint])
def waste(type: str | None = None, near: str | None = None) -> list[WastePoint]:
    r = tools.find_waste_points(state.get_ctx(), type, near)
    return [WastePoint.model_validate(d) for d in r.data]


@router.get("/briefings/flood")
def briefing(scenario_id: str, profile: str = "default") -> dict:
    ctx = state.get_ctx()
    sc = flood.scenario(ctx.world, scenario_id)
    if sc is None:
        raise HTTPException(404, f"unknown scenario {scenario_id}")
    near = None
    if "lakeside-mall" in ctx.world.places:
        near = "lakeside-mall"
    else:
        near = next((p.id for p in ctx.world.places.values() if p.type == "facility"), None)
    centres = tools.list_evacuation_centres(ctx, scenario_id, profile, near).data
    return {
        "scenario": sc.model_dump(mode="json"),
        "affected": flood.affected(ctx.world, scenario_id, profile).model_dump(mode="json"),
        "centres": centres,
        "near_place": near,
        "near_place_name": (ctx.world.places[near].name if near in ctx.world.places else None),
        "as_of": date.today().isoformat(),
        "disclaimer": sc.disclaimer,
    }
