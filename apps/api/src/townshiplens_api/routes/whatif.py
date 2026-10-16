"""Township World Model what-ifs without the LLM (the What-if Lab panel on the Management view).

Same engine and the same tool functions the assistant calls (`tools.simulate_what_if`,
`tools.suggest_interventions`). Nothing is stored and the real township never changes.
"""

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from townshiplens_spatial import tools, twm

from .. import state

router = APIRouter()


class WhatIfRequest(BaseModel):
    actions: list[twm.Action] = Field(default_factory=list, max_length=twm.MAX_ACTIONS)
    profile: str = "wheelchair"
    scope: Literal["journey", "suite", "evacuation"] = "evacuation"
    from_id: str | None = None
    to_id: str | None = None
    # The scenario on screen: the "before" state. Use a set_river_stage action to imagine a rise.
    scenario_id: str | None = Field(default=None, pattern=r"^(baseline|stage_p[1-5]m)$")


class WhatIfResponse(BaseModel):
    profile: str
    scope: str
    scenario_id: str | None
    actions: list[twm.Action]
    action_labels: list[str]
    summary: dict[str, int]
    counts_before: dict[str, dict[str, int]]
    counts_after: dict[str, dict[str, int]]
    changed: list[dict[str, Any]]
    changed_truncated: bool
    touched: list[str]
    diff_geojson: dict[str, Any]
    evidence_id: str
    disclaimer: str


class Candidate(BaseModel):
    action: twm.Action
    label: str
    journeys_using_it: int | None = None


class Suggestions(BaseModel):
    profile: str
    candidates: list[Candidate]
    river_stages: list[str]


@router.post(
    "/what-if",
    response_model=WhatIfResponse,
    responses={422: {"description": "illegal or invalid actions"}},
)
def what_if(body: WhatIfRequest) -> dict[str, Any]:
    """Imagine changes on a copy of the township and compare journeys before and after."""
    res = tools.simulate_what_if(
        state.get_ctx(),
        actions=[a.model_dump() for a in body.actions],
        profile=body.profile,
        scope=body.scope,
        from_id=body.from_id,
        to_id=body.to_id,
        scenario_id=body.scenario_id,
    )
    if not res.ok:
        raise HTTPException(status_code=422, detail="; ".join(res.warnings))
    d = res.data
    return {
        **{k: d[k] for k in WhatIfResponse.model_fields if k in d},
        "evidence_id": res.evidence[0].id,
    }


@router.get("/what-if/suggestions", response_model=Suggestions)
def what_if_suggestions(profile: str = "wheelchair", near_place: str | None = None) -> dict:
    """Engine-proposed what-if actions with readable labels (ramps, verifications, keystones)."""
    res = tools.suggest_interventions(state.get_ctx(), profile=profile, near_place=near_place)
    if not res.ok:
        raise HTTPException(status_code=422, detail="; ".join(res.warnings))
    return {"profile": profile, **res.data}
