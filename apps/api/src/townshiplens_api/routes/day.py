"""Elmina Day: a simulated day of synthetic residents on the township model (Cycle 10).

Staff-facing rehearsal (the Simulate panel). Every count comes from the engine's trips; the
residents are synthetic and the river levels indicative scenarios, never a forecast."""

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from townshiplens_spatial import tools

from .. import state

router = APIRouter()


class DayScenario(BaseModel):
    id: str
    label: str
    summary: str
    hero: str
    day: str


class DayReport(BaseModel):
    scenario: dict[str, Any]
    population: dict[str, Any]
    assumptions: list[str]
    paces_m_per_min: dict[str, float]
    headline: dict[str, int]
    groups: list[dict[str, Any]]
    school: dict[str, int]
    health: dict[str, int]
    places: list[dict[str, Any]]
    timeline: list[dict[str, Any]]
    tracks: dict[str, Any]
    disclaimer: str
    world_version: int


@router.get("/day/scenarios", response_model=list[DayScenario])
def day_scenarios() -> list[dict]:
    return tools.day_scenarios(state.get_ctx())


@router.get(
    "/day/{scenario_id}",
    response_model=DayReport,
    responses={404: {"description": "unknown scenario"}, 503: {"description": "busy"}},
)
def day_report(scenario_id: str) -> dict:
    """One simulated day: 5,000 synthetic residents, counts by group, timeline and map tracks."""
    res = tools.day_rehearsal(state.get_ctx(), scenario_id)
    if not res.ok:
        busy = any("busy" in w for w in res.warnings)
        raise HTTPException(status_code=503 if busy else 404, detail="; ".join(res.warnings))
    return res.data
