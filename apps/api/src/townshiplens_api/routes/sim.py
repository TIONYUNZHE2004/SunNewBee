import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from townshiplens_spatial import sim
from townshiplens_spatial.models import ProfileId

from .. import state
from ..auth import StaffOnly
from ..store import SimStore

router = APIRouter()
_stores: dict[str, SimStore] = {}


def _store() -> SimStore:
    path = state.db_path()
    if path not in _stores:
        _stores[path] = SimStore(path)
    return _stores[path]


class SimRequest(BaseModel):
    scenario_id: str | None = None
    profiles: list[ProfileId] | None = None


class SimResult(BaseModel):
    task_id: str
    outcome: str
    route_id: str | None = None
    unknowns: list[dict[str, str]] = Field(default_factory=list)  # {element_id, attribute}


class SimGap(BaseModel):
    element_id: str
    attribute: str
    impact: int
    affected_profiles: list[str]
    example_task_ids: list[str]


class SimViolation(BaseModel):
    invariant: str
    task_id: str
    detail: str


class SimReport(BaseModel):
    run_id: str
    created_at: str
    scenario_id: str | None = None
    counts: dict[str, dict[str, int]]
    results: list[SimResult]
    gaps: list[SimGap]
    invariant_violations: list[SimViolation]
    gaps_truncated: bool = False
    world_version: int = 0


class SimSummary(BaseModel):
    run_id: str
    created_at: str
    scenario_id: str | None = None
    counts: dict[str, dict[str, int]]
    task_count: int
    gap_count: int
    violation_count: int
    world_version: int


@router.post("/simulations", response_model=SimReport, dependencies=[StaffOnly])
def run_simulation(body: SimRequest) -> dict[str, Any]:
    world = state.get_ctx().world
    if body.scenario_id and body.scenario_id not in {s.id for s in world.flood.scenarios}:
        raise HTTPException(422, f"unknown scenario {body.scenario_id}")
    tasks = sim.default_tasks(world, list(body.profiles) if body.profiles else None)
    report = sim.run_suite(world, tasks, body.scenario_id)
    try:
        _store().save(report)
    except sqlite3.Error:
        raise HTTPException(503, "simulation store unavailable") from None
    return report


@router.get("/simulations", response_model=list[SimSummary])
def list_simulations(limit: Annotated[int, Query(ge=1, le=50)] = 5) -> list[SimSummary]:
    return _store().recent(limit)


@router.get("/simulations/{run_id}", response_model=SimReport)
def get_simulation(run_id: str) -> dict[str, Any]:
    r = _store().get(run_id)
    if r is None:
        raise HTTPException(404, f"unknown simulation {run_id}")
    return r
