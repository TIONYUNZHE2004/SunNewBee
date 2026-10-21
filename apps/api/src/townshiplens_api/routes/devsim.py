"""Developer lens: the Development Simulation plan (spec 2026-10-21 §5.1, ADR 0014).

A Hypothetical Development (not an SDP project) on a real parcel. Every number in the plan comes
from the routing engine; residents' lines are simulated reactions. The plan is deterministic, so
it is computed once per loaded world and cached.
"""

import logging
import threading

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from townshiplens_spatial import devsim
from townshiplens_spatial.devsim_models import (
    DevelopmentBrief,
    DevelopmentPlan,
    DevsimUnavailable,
)

from .. import state

router = APIRouter()
log = logging.getLogger(__name__)

UNAVAILABLE = "development simulation not available for this world"
_lock = threading.Lock()
_cache: dict[tuple[int, int], DevelopmentPlan | None] = {}


class SimulateRequest(BaseModel):
    brief_text: str | None = Field(default=None, max_length=2000)  # ignored apart from the echo


def _plan() -> DevelopmentPlan | None:
    world = state.get_ctx().world
    key = (id(world), world.version)
    with _lock:
        if key not in _cache:
            _cache.clear()  # one world at a time
            try:
                _cache[key] = devsim.build_development_plan(world, DevelopmentBrief())
            except DevsimUnavailable:
                _cache[key] = None
            except devsim.DevsimCheckError:
                # a plan that fails its own honesty check is never shown; the build is
                # deterministic, so the failure is cached (no 1 s rebuild and 500 per request)
                log.exception("development plan failed its check; served as unavailable")
                _cache[key] = None
        return _cache[key]


def clear_cache() -> None:
    with _lock:
        _cache.clear()


@router.post(
    "/developments/simulate",
    response_model=DevelopmentPlan,
    responses={404: {"description": UNAVAILABLE}},
)
def simulate_development(body: SimulateRequest | None = None) -> DevelopmentPlan:
    """The Development Simulation plan for the loaded world: site, routed facts (detour, park and
    mall walks), cast, timeline, bubbles and end card. Illustrative, not a forecast; 404 when the
    world lacks the parcel (e.g. the tiny fixture)."""
    plan = _plan()
    if plan is None:
        raise HTTPException(status_code=404, detail=UNAVAILABLE)
    return plan
