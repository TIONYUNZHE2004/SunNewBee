import logging
import sqlite3
import threading
import time
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from townshiplens_spatial import sim
from townshiplens_spatial.models import ProfileId

from .. import state
from ..auth import StaffOnly
from ..store import SimStore, sim_store

router = APIRouter()
log = logging.getLogger(__name__)
PROGRESS_EVERY_S = 0.5  # throttle progress writes to SQLite


def _store() -> SimStore:
    return sim_store(state.db_path())


def recover_interrupted_runs() -> None:
    """Startup hook: runs left active by a previous process cannot still be running."""
    try:
        n = _store().sweep_interrupted()
        if n:
            log.warning("marked %d interrupted simulation run(s) as failed", n)
    except Exception:  # noqa: BLE001 - a store problem must not stop the API starting
        log.exception("could not sweep interrupted simulation runs")


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


class SimAdvisory(BaseModel):
    """Not a broken invariant: the journey's route runs over the rest limit and the router says
    so (never confirmed). `rest_limit_no_alternative`: no route within the limit exists;
    `rest_search_stopped_early`: the search hit its size cap, so one may exist."""

    kind: str
    task_id: str
    detail: str
    long_segments: int = 0  # segments on the route longer than the limit


class EvacRow(BaseModel):
    profile: str
    scenario_id: str
    # Keys: reachable_confirmed, reachable_partly_unverified, blocked_by_flood,
    # no_mapped_connection, no_centre. blocked_by_flood = a known FAIL cuts every path (a flood
    # class, or at baseline a known barrier).
    counts: dict[str, int]
    total: int


class EvacViolation(BaseModel):
    invariant: str  # E1 monotonicity across river stages, E2 baseline == no scenario
    task_id: str
    profile: str
    origin_id: str
    detail: str


class EvacuationReport(BaseModel):
    """Journeys from a seeded sample of origins to the nearest reachable evacuation centre."""

    rows: list[EvacRow]
    violations: list[EvacViolation]
    origins_sampled: int
    origins_available: int  # places a journey can start from, centres excluded
    origins_excluded_centres: int = 0  # places that are evacuation centres, left out of the sample
    seed: int


class SimReport(BaseModel):
    run_id: str
    created_at: str
    scenario_id: str | None = None
    counts: dict[str, dict[str, int]]
    results: list[SimResult]
    gaps: list[SimGap]
    invariant_violations: list[SimViolation]
    rest_advisories: list[SimAdvisory] = Field(default_factory=list)
    rest_limit_m: float | None = None  # the run's rest limit (older_adult_rest), if any
    rest_long_segments: int = 0  # distinct segments longer than it on the advisory routes
    gaps_truncated: bool = False
    world_version: int = 0
    closure_hash: str | None = None  # hash of the closure set frozen at run start
    evacuation: EvacuationReport | None = None  # absent on runs saved before Task 47


class SimSummary(BaseModel):
    run_id: str
    created_at: str
    scenario_id: str | None = None
    counts: dict[str, dict[str, int]]
    task_count: int
    gap_count: int
    violation_count: int
    world_version: int


class SimStarted(BaseModel):
    run_id: str
    status: Literal["queued"] = "queued"


class SimRun(BaseModel):
    """A run's state. `report` is set only when `status` is `done`."""

    run_id: str
    status: Literal["queued", "running", "done", "failed"]
    created_at: str | None = None
    scenario_id: str | None = None
    progress: str | None = None  # plain words, e.g. "Evacuation journeys: 400 of 1000"
    error: str | None = None
    report: SimReport | None = None


class SimBusy(BaseModel):
    detail: str
    run_id: str  # the run that is already in progress


def _execute(store: SimStore, live_world, run_id: str, body: SimRequest) -> None:
    """Background worker: one run, never raises. Progress and the outcome go to SQLite."""
    last = [0.0]

    def note(text: str, force: bool = False) -> None:
        now = time.monotonic()
        if force or now - last[0] >= PROGRESS_EVERY_S:
            last[0] = now
            store.set_job(run_id, "running", text)

    try:
        note("Planning journeys", True)
        # One consistent view for the whole run: claims, closures and "now" are frozen here,
        # so a staff edit mid-run cannot make two halves of the report disagree.
        with state.world_lock:
            world, closure_hash = sim.snapshot_world(live_world)
        profiles = list(body.profiles) if body.profiles else None
        tasks = sim.default_tasks(world, profiles)
        report = sim.run_suite(
            world,
            tasks,
            body.scenario_id,
            progress=lambda i, n: note(f"Planning journeys: {i} of {n}"),
            run_id=run_id,
        )
        note("Evacuation journeys", True)
        evac = sim.run_evacuation(
            world,
            profiles=profiles,
            progress=lambda i, n: note(f"Evacuation journeys: {i} of {n}"),
        )
        report["evacuation"] = evac
        report["closure_hash"] = closure_hash
        # evacuation violations are critical findings like I1/I2/I7
        report["invariant_violations"] = report["invariant_violations"] + evac["violations"]
        store.save(report)
        store.set_job(run_id, "done", "Done")  # no-op if the job is no longer active
    except Exception:  # noqa: BLE001 - the worker must record any failure
        log.exception("simulation %s failed", run_id)
        try:
            store.set_job(run_id, "failed", None, "The simulation failed. Please try again.")
        except sqlite3.Error:
            log.exception("could not record failure of %s", run_id)


@router.post(
    "/simulations",
    response_model=SimStarted,
    status_code=202,
    dependencies=[StaffOnly],
    responses={409: {"model": SimBusy, "description": "a run is already in progress"}},
)
def run_simulation(body: SimRequest, response: Response):
    """Start a run in the background and return its id; poll `GET /simulations/{run_id}`.

    One run at a time per world: a second POST while one is queued or running gets 409 with the
    running id, so the caller can poll that run instead."""
    world = state.get_ctx().world
    if body.scenario_id and body.scenario_id not in {s.id for s in world.flood.scenarios}:
        raise HTTPException(422, f"unknown scenario {body.scenario_id}")
    store = _store()
    try:
        with store.start_lock:
            if (active := store.active_job()) is not None:
                return JSONResponse(
                    {"detail": f"a simulation is already running ({active})", "run_id": active},
                    status_code=409,
                )
            run_id = sim.new_run_id()
            store.create_job(run_id, datetime.now(UTC).isoformat(), body.scenario_id)
    except sqlite3.Error:
        raise HTTPException(503, "simulation store unavailable") from None
    try:
        threading.Thread(
            target=_execute, args=(store, world, run_id, body), name=f"sim-{run_id}", daemon=True
        ).start()
    except Exception:  # noqa: BLE001 - never leave a job that nothing will run
        store.set_job(run_id, "failed", None, "The simulation could not be started.")
        raise HTTPException(503, "could not start the simulation") from None
    response.headers["Location"] = f"/simulations/{run_id}"
    return SimStarted(run_id=run_id)


@router.get("/simulations", response_model=list[SimSummary])
def list_simulations(limit: Annotated[int, Query(ge=1, le=50)] = 5) -> list[SimSummary]:
    return _store().recent(limit)


@router.get("/simulations/{run_id}", response_model=SimRun)
def get_simulation(run_id: str) -> dict[str, Any]:
    store = _store()
    job = store.job(run_id)
    report = store.get(run_id) if job is None or job["status"] == "done" else None
    if job is None and report is None:
        raise HTTPException(404, f"unknown simulation {run_id}")
    if job is None:  # saved before runs were asynchronous
        return {"run_id": run_id, "status": "done", "report": report}
    return {**job, "report": report}
