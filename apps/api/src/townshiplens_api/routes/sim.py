import hmac
import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field
from townshiplens_spatial import sim
from townshiplens_spatial.models import ProfileId

from .. import state
from ..settings import DEFAULT_STAFF_TOKEN, ApiSettings
from ..store import SimStore

router = APIRouter()
_stores: dict[str, SimStore] = {}


def _store() -> SimStore:
    path = ApiSettings().database_url.removeprefix("sqlite:///")
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
    unknowns: list[dict[str, str]] = Field(default_factory=list)


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


class SimSummary(BaseModel):
    run_id: str
    created_at: str
    scenario_id: str | None = None
    counts: dict[str, dict[str, int]]
    task_count: int
    gap_count: int
    violation_count: int


def _summary(r: dict[str, Any]) -> SimSummary:
    return SimSummary(
        run_id=r["run_id"],
        created_at=r["created_at"],
        scenario_id=r.get("scenario_id"),
        counts=r["counts"],
        task_count=len(r["results"]),
        gap_count=len(r["gaps"]),
        violation_count=len(r["invariant_violations"]),
    )


def _auth(token: str | None) -> None:
    configured = ApiSettings().staff_token
    if not configured or configured == DEFAULT_STAFF_TOKEN:
        raise HTTPException(503, "staff token not configured")
    if token is None or not hmac.compare_digest(token.encode(), configured.encode()):
        raise HTTPException(401, "staff token required")


@router.post("/simulations", response_model=SimReport)
def run_simulation(
    body: SimRequest, x_staff_token: Annotated[str | None, Header()] = None
) -> dict[str, Any]:
    _auth(x_staff_token)
    world = state.get_ctx().world
    if body.scenario_id and body.scenario_id not in {s.id for s in world.flood.scenarios}:
        raise HTTPException(422, f"unknown scenario {body.scenario_id}")
    tasks = sim.default_tasks(world)
    if body.profiles:
        tasks = [t for t in tasks if t["profile"] in body.profiles]
    report = sim.run_suite(world, tasks, body.scenario_id)
    try:
        _store().save(report)
    except sqlite3.Error:
        raise HTTPException(503, "simulation store unavailable") from None
    return report


@router.get("/simulations", response_model=list[SimSummary])
def list_simulations(limit: Annotated[int, Query(ge=1, le=50)] = 5) -> list[SimSummary]:
    return [_summary(r) for r in _store().recent(limit)]


@router.get("/simulations/{run_id}", response_model=SimReport)
def get_simulation(run_id: str) -> dict[str, Any]:
    r = _store().get(run_id)
    if r is None:
        raise HTTPException(404, f"unknown simulation {run_id}")
    return r
