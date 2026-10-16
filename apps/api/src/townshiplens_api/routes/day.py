"""Elmina Day: a simulated day of synthetic residents on the township model (Cycle 10).

Staff-facing rehearsal (the Simulate panel). Every count comes from the engine's trips; the
residents are synthetic and the river levels indicative scenarios, never a forecast."""

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from townshiplens_spatial import tools, twm

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
    spotlight: dict[str, Any]
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


class DayChanges(BaseModel):
    scenario: str
    candidates: list[dict[str, Any]]


class DayCompareRequest(BaseModel):
    actions: list[twm.Action] = Field(min_length=1, max_length=4)


class DayCompare(BaseModel):
    scenario: str
    actions: list[str]
    trips_changed: int
    residents_changed: int
    residents_better: int
    residents_worse: int
    trips_better: int
    trips_worse: int
    baseline: str
    groups: list[dict[str, Any]]
    biggest: list[dict[str, Any]]
    town_hall: list[dict[str, Any]]
    changed_geojson: dict[str, Any]
    voice: dict[str, Any]
    disclaimer: str


def _fail(res) -> HTTPException:
    busy = any("busy" in w for w in res.warnings)
    unknown = any("unknown day scenario" in w for w in res.warnings)
    code = 503 if busy else 404 if unknown else 422
    return HTTPException(status_code=code, detail="; ".join(res.warnings))


@router.get(
    "/day/{scenario_id}/changes",
    response_model=DayChanges,
    responses={404: {"description": "unknown scenario"}, 503: {"description": "busy"}},
)
def day_changes(scenario_id: str) -> dict:
    """Imagined changes worth testing on this day, from its own trips (on a river-rise day the
    flooded stretches the most residents rely on, then busy footways and steps)."""
    res = tools.day_changes(state.get_ctx(), scenario_id)
    if not res.ok:
        raise _fail(res)
    return res.data


@router.post(
    "/day/{scenario_id}/compare",
    response_model=DayCompare,
    responses={404: {"description": "unknown scenario"}, 503: {"description": "busy"}},
)
def day_compare(scenario_id: str, body: DayCompareRequest) -> dict:
    """The same simulated day with and without imagined changes, trip by trip: who gains and
    who loses, by group, and what the spotlight residents would say. Imagined, never a plan."""
    res = tools.day_compare(
        state.get_ctx(), scenario_id, [a.model_dump(mode="json") for a in body.actions]
    )
    if not res.ok:
        raise _fail(res)
    return res.data
