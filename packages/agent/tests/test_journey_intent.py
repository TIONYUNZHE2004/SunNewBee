"""`journey.play` scene intent (spec 2026-10-19-resident-journey-simulation-design.md §6.2, D-T2).

The server attaches the JourneyPlan from the route plan_route returned this turn, as it attaches
route geometry for `route.highlight`; the model only names the route and the start time.
"""

import asyncio
import json

import pytest
from pydantic import ValidationError
from tests_support import TINY
from townshiplens_agent import run as run_mod
from townshiplens_agent.agent import Deps, call_tool
from townshiplens_agent.answer import FinalAnswer
from townshiplens_agent.events import ChatRequest, SceneIntent
from townshiplens_agent.record import TurnRecord
from townshiplens_spatial import tools
from townshiplens_spatial.journey import JourneyEvidenceError, build_journey
from townshiplens_spatial.models import Route
from townshiplens_spatial.routing import plan_route
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world


@pytest.fixture
def ctx(tmp_path):
    return tools.Ctx(world=load_world(TINY), vrs=VerificationStore(str(tmp_path / "vr.db")))


async def _planned(ctx, a="park-b", b="kiosk", profile="older_adult_rest"):
    deps = Deps(
        ctx=ctx,
        rec=TurnRecord(queue=asyncio.Queue()),
        request=ChatRequest(message="x", profile=profile),
    )
    out = await call_tool(deps, "plan_route", from_id=a, to_id=b, profile=profile)
    return deps.rec, out["data"]["routes"][0]["id"]


def _answer(*intents) -> FinalAnswer:
    return FinalAnswer.model_validate(
        {"answer_status": "partial", "summary": "ok", "scene_intents": list(intents)}
    )


def _intents(ans, rec, ctx):
    return [e.intent for e in run_mod._answer_events(ans, rec, ctx) if e.type == "scene.intent"]


async def test_journey_play_gets_the_server_built_plan(ctx):
    rec, rid = await _planned(ctx)
    ans = _answer(
        {"kind": "route.highlight", "route_id": rid},
        {"kind": "journey.play", "route_id": rid, "start_time": "15:20"},
    )
    hl, play = _intents(ans, rec, ctx)
    assert hl.kind == "route.highlight" and hl.geojson and hl.journey is None
    assert play.kind == "journey.play" and play.route_id == rid and play.start_time == "15:20"
    route = plan_route(ctx.world, "park-b", "kiosk", "older_adult_rest").routes[0]
    assert play.journey == build_journey(ctx.world, route, "older_adult_rest", "15:20")
    assert [e.kind for e in play.journey.events] == ["verified", "rest", "gap", "arrive"]


async def test_journey_play_needs_a_route_returned_this_turn_and_a_start_time(ctx, caplog):
    rec, rid = await _planned(ctx)
    ans = _answer(
        {"kind": "journey.play", "route_id": "rt-not-this-turn", "start_time": "15:20"},
        {"kind": "journey.play", "route_id": rid},
    )
    with caplog.at_level("WARNING", logger="townshiplens_agent.run"):
        assert _intents(ans, rec, ctx) == []
    assert "rt-not-this-turn" in caplog.text and "was not returned this turn" in caplog.text
    assert "no start_time" in caplog.text


def test_start_time_is_local_hh_mm():
    with pytest.raises(ValidationError):
        SceneIntent(kind="journey.play", route_id="rt-1", start_time="3pm")
    assert SceneIntent(kind="journey.play", route_id="rt-1", start_time="08:05").journey is None


async def test_the_model_cannot_supply_a_journey(ctx):
    rec, rid = await _planned(ctx)
    forged = {"route_id": rid, "events": [{"kind": "verified", "title": "All clear"}]}
    play = {"kind": "journey.play", "route_id": rid, "start_time": "09:00", "journey": forged}
    ans = _answer(play)
    (play,) = _intents(ans, rec, ctx)
    assert all(e.title != "All clear" for e in play.journey.events)
    # The model-facing schema stays small: the plan is never something the model writes.
    schema = json.dumps(FinalAnswer.model_json_schema())
    assert "JourneyPlan" not in schema and "JourneyEvent" not in schema
    assert "journey.play" in schema and "start_time" in schema


async def test_a_journey_evidence_bug_drops_the_intent_not_the_turn(ctx, monkeypatch):
    rec, rid = await _planned(ctx)

    def broken(*a, **k):
        raise JourneyEvidenceError("unknown", "seg-cf", "ev-x")

    monkeypatch.setattr(run_mod, "build_journey", broken)
    ans = _answer(
        {"kind": "route.highlight", "route_id": rid},
        {"kind": "journey.play", "route_id": rid, "start_time": "15:20"},
    )
    assert [i.kind for i in _intents(ans, rec, ctx)] == ["route.highlight"]


async def test_recorded_route_dict_rebuilds_the_same_route(ctx):
    """rec.routes holds the tool's JSON (with readable labels added): it must validate back to
    the route the REST endpoint plans, so both paths build the same plan (AC-D4)."""
    rec, rid = await _planned(ctx, "park-b", "kiosk", "stroller")
    rebuilt = Route.model_validate(rec.routes[rid])
    fresh = plan_route(ctx.world, "park-b", "kiosk", "stroller").routes[0]
    assert build_journey(ctx.world, rebuilt, "stroller", "07:00") == build_journey(
        ctx.world, fresh, "stroller", "07:00"
    )
