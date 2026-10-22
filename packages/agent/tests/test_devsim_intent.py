"""`development.play` scene intent (developer lens, ADR 0014, spec 2026-10-21 §5.2).

The server attaches the DevelopmentPlan from simulate_development, as it attaches a JourneyPlan for
journey.play; the web contract is DevelopmentPlayIntent = {kind, plan?, brief_text}.
"""

import asyncio
import importlib.util
import json
from pathlib import Path

import pytest
from tests_support import TINY
from townshiplens_agent import run as run_mod
from townshiplens_agent.agent import Deps, call_tool
from townshiplens_agent.answer import FinalAnswer
from townshiplens_agent.developments import BRIEF
from townshiplens_agent.events import ChatRequest, SceneIntent, SceneIntentEvent
from townshiplens_agent.record import TurnRecord
from townshiplens_spatial import tools
from townshiplens_spatial.devsim_models import DevelopmentPlan, DevsimUnavailable
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

FIXTURE = (
    Path(__file__).resolve().parents[3] / "apps/web/src/features/devsim/fixtures/plan.elmina.json"
)
HAS_DEVSIM = importlib.util.find_spec("townshiplens_spatial.devsim") is not None


def plan_fixture() -> DevelopmentPlan:
    return DevelopmentPlan.model_validate_json(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture
def ctx(tmp_path):
    return tools.Ctx(world=load_world(TINY), vrs=VerificationStore(str(tmp_path / "vr.db")))


@pytest.fixture
def with_plan(monkeypatch):
    monkeypatch.setattr(tools, "_build_development_plan", lambda world, brief: plan_fixture())


@pytest.fixture
def without_plan(monkeypatch):
    def boom(world, brief):
        raise DevsimUnavailable("no parcel")

    monkeypatch.setattr(tools, "_build_development_plan", boom)


async def _simulated(ctx):
    deps = Deps(
        ctx=ctx,
        rec=TurnRecord(queue=asyncio.Queue()),
        request=ChatRequest(message=BRIEF, profile="default"),
    )
    await call_tool(deps, "simulate_development")
    return deps.rec


def _answer(*intents) -> FinalAnswer:
    return FinalAnswer.model_validate(
        {"answer_status": "partial", "summary": "ok", "scene_intents": list(intents)}
    )


def _intents(ans, rec, ctx):
    return [e.intent for e in run_mod._answer_events(ans, rec, ctx) if e.type == "scene.intent"]


def test_intent_kind_is_declared_and_round_trips():
    it = SceneIntent(kind="development.play", plan=plan_fixture(), brief_text=BRIEF)
    wire = json.loads(SceneIntentEvent(intent=it).model_dump_json())
    got = wire["intent"]
    assert got["kind"] == "development.play"
    assert got["brief_text"] == BRIEF
    assert got["plan"]["world"] == it.plan.world
    back = SceneIntentEvent.model_validate(wire)
    assert back.intent.plan == it.plan
    assert back.intent.brief_text == BRIEF


def test_model_cannot_write_a_plan():
    # the model-facing intent has no plan field; an unknown kind is still rejected
    ans = _answer({"kind": "development.play"})
    assert ans.scene_intents[0].kind == "development.play"
    assert not hasattr(ans.scene_intents[0], "plan")


async def test_server_attaches_the_plan(ctx, with_plan):
    rec = await _simulated(ctx)
    [it] = _intents(_answer({"kind": "development.play"}), rec, ctx)
    assert it.kind == "development.play"
    assert it.brief_text == BRIEF
    assert it.plan == plan_fixture()


async def test_unavailable_world_emits_the_intent_without_a_plan(ctx, without_plan):
    rec = await _simulated(ctx)
    assert rec.developments[-1]["available"] is False
    [it] = _intents(_answer({"kind": "development.play"}), rec, ctx)
    assert it.plan is None
    assert it.brief_text == BRIEF
    assert json.loads(SceneIntentEvent(intent=it).model_dump_json())["intent"]["plan"] is None


async def test_dropped_when_the_tool_did_not_run(ctx):
    assert _intents(_answer({"kind": "development.play"}), TurnRecord(), ctx) == []


@pytest.mark.skipif(not HAS_DEVSIM, reason="townshiplens_spatial.devsim (BE lane) not merged")
async def test_real_plan_on_the_tiny_fixture_is_unavailable(ctx):
    # no parcel in the tiny world: the real builder raises DevsimUnavailable
    rec = await _simulated(ctx)
    assert rec.developments[-1]["available"] is False
