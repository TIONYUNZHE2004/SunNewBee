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


class DayTrip(BaseModel):
    """One resident's own trip through a rehearsed day (Cycle 19). Times are clock text; every
    outcome comes from the engine. A rehearsal, not a forecast."""

    status: str  # rehearsed | no_data
    scenario: dict[str, Any]
    from_: dict[str, Any] = Field(alias="from")
    to: dict[str, Any]
    profile: str
    leave: str
    stage_at_leave: str | None = None
    reason: str | None = None
    mode: str | None = None
    normal_minutes: int | None = None
    normal_unchecked: int | None = None
    asked: dict[str, Any] | None = None
    cut_by: list[str] = []
    next_clear_leave: str | None = None
    last_ok_leave_before: str | None = None
    track: list[dict[str, Any]] = []
    normal_route: list[list[float]] = []
    cut_lines: list[list[list[float]]] = []
    river_changes: list[list[Any]] = []
    sweep: list[dict[str, Any]] = []
    sweep_counts: dict[str, int] = {}
    disclaimer: str

    model_config = {"populate_by_name": True}


class DayTripRequest(BaseModel):
    """Ends are place ids, or points tapped on the map ("lon,lat"). Points travel in the body,
    never in the URL, so a resident's home never lands in an access log (PDPA)."""

    from_id: str | None = None
    to_id: str | None = None
    from_point: str | None = Field(default=None, max_length=40)
    to_point: str | None = Field(default=None, max_length=40)
    profile: str = "default"
    leave_at: str = "07:30"


@router.post(
    "/day/{scenario_id}/trip",
    response_model=DayTrip,
    response_model_by_alias=True,
    responses={
        404: {"description": "unknown scenario"},
        422: {"description": "invalid ends, profile or time"},
        503: {"description": "busy"},
    },
)
def day_trip(scenario_id: str, body: DayTripRequest) -> dict:
    """Rehearse my trip: a resident's own trip through the rehearsed day, at the asked time and
    every 10 minutes around it (when it got through, when it was cut, and by which street)."""
    res = tools.rehearse_my_trip(
        state.get_ctx(),
        from_id=body.from_id,
        to_id=body.to_id,
        profile=body.profile,
        leave_at=body.leave_at,
        day=scenario_id,
        from_point=body.from_point,
        to_point=body.to_point,
    )
    if not res.ok:
        raise _fail(res)
    return {**res.data, "disclaimer": res.warnings[0] if res.warnings else ""}
