"""Verify-next planner and the belief behind it (Cycle 2, Township World Model).

GET /verify-next ranks the unchecked facts staff should verify first. The plan is verified on
the world model: the number of journeys that would be confirmed comes from simulating the facts
as passing. Open verification requests for planned facts are linked. Nothing is stored.
"""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from townshiplens_spatial import belief, planner
from townshiplens_spatial.impact import FactImpact
from townshiplens_spatial.planner import VerificationPlan

from .. import state

router = APIRouter()


def _prior() -> dict:
    """Regional OSM prior next to the loaded world (absent: Beta(1, 1), no information)."""
    return belief.load_prior(state.data_dir() / "belief_prior.json")


@router.get(
    "/verify-next",
    response_model=VerificationPlan,
    responses={503: {"description": "busy"}},  # 422 (default schema): unknown or non-walking
)
def verify_next(
    profile: str = "wheelchair",
    scope: Literal["suite", "evacuation"] = "evacuation",
    budget: int = Query(15, ge=1, le=planner.MAX_BUDGET),
) -> VerificationPlan:
    """Survey plan: which facts to check first so the most sample journeys would be confirmed.
    The same cached tool the assistant calls (cached per world version and open tickets)."""
    from townshiplens_spatial import tools

    ctx = state.get_ctx()
    if profile not in ctx.world.profiles:
        raise HTTPException(status_code=422, detail=f"unknown profile {profile}")
    res = tools.plan_verifications(ctx, profile, scope, budget)
    if not res.ok:
        busy = any("busy" in w for w in res.warnings)
        raise HTTPException(status_code=503 if busy else 422, detail="; ".join(res.warnings))
    return VerificationPlan.model_validate(res.data)


class BeliefRow(BaseModel):
    edge_type: str
    attribute: str
    alpha: float
    beta: float
    q: float


class BeliefTable(BaseModel):
    rows: list[BeliefRow]
    sources: dict[str, int]
    note: str


@router.get("/belief", response_model=BeliefTable)
def belief_table() -> dict:
    """The planner's belief over unchecked facts: Beta(alpha, beta) per path type and attribute,
    from regional OSM tags (if built) and real staff verifications. Planning only."""
    b = belief.build(state.get_ctx().world, _prior())
    return {
        "rows": b.table(),
        "sources": b.sources,
        "note": "Planning estimate only: never used to mark a path passable or shown to residents.",
    }


@router.get(
    "/verification-requests/{vr_id}/impact",
    response_model=FactImpact,
    responses={404: {"description": "unknown verification request"}, 503: {"description": "busy"}},
)
def ticket_impact(vr_id: str) -> dict:
    """What this check would change (open) or changed (resolved) on the township model: sampled
    journeys, the ticket's own journey and the belief. Staff planning estimate; counts only."""
    from townshiplens_spatial import tools

    res = tools.ticket_impact(state.get_ctx(), vr_id)
    if not res.ok:
        busy = any("busy" in w for w in res.warnings)
        raise HTTPException(status_code=503 if busy else 404, detail="; ".join(res.warnings))
    return res.data
