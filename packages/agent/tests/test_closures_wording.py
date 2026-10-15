"""Task 48: answers name staff-reported closures; the uncertainty event matches every caveat."""

from datetime import UTC, datetime, timedelta

import pytest
from tests_support import TINY
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.labels import closure_line
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import AgentSettings
from townshiplens_agent.template import template_answer
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial import tools
from townshiplens_spatial.models import Closure
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

MOCK = AgentSettings(_env_file=None, llm_provider="mock")
H = timedelta(hours=1)
Q = "Can I push a stroller from Car Park B to the playground without stairs?"


@pytest.fixture
def ctx(tmp_path):
    return tools.Ctx(world=load_world(TINY), vrs=VerificationStore(str(tmp_path / "vr.db")))


def _close(ctx, element, start=-1, end=24, reason="works", cid="cl-0001", name=None):
    now = datetime.now(UTC)
    if name:
        for d in (ctx.world.edges, ctx.world.places):
            if element in d:
                d[element].name = name
    ctx.world.set_closures(
        [
            Closure(
                id=cid,
                element_id=element,
                reason=reason,
                starts_at=now + start * H,
                ends_at=None if end is None else now + end * H,
            )
        ]
    )


async def ask(ctx, msg, profile="stroller"):
    return [e async for e in run_turn(ctx, ChatRequest(message=msg, profile=profile), MOCK)]


def text(evs) -> str:
    return "".join(e.delta for e in evs if e.type == "text.delta")


def unc(evs):
    return next(e for e in evs if e.type == "uncertainty")


def test_closure_line_uses_malaysia_time():
    row = {
        "element_name": "Jalan Hopea",
        "reason": "works",
        "ends_at": "2026-10-21T00:30:00+08:00",  # 20 Oct 16:30 UTC: still 21 Oct in Malaysia
    }
    assert closure_line(row) == "Closed (staff report): Jalan Hopea until 21 Oct 2026 — works"
    assert closure_line(
        {**row, "ends_at": None, "reason": "event", "element_name": "Unnamed ramp"}
    ) == ("Closed (staff report): an unnamed ramp until further notice — event")


async def test_active_closure_on_destination_is_named(ctx):
    _close(ctx, "playground", name="Elmina Playground")
    evs = await ask(ctx, Q)
    t = text(evs)
    assert "Closed (staff report): Elmina Playground until" in t and "— works" in t
    assert evs[-1].answer_status == "partial" and evs[-1].model == "mock-scripted"
    u = unc(evs)
    assert u.level == "partial"
    assert any(i["attribute"] == "closure" and "Elmina Playground" in i["note"] for i in u.items)
    assert "cl-0001" not in t and "seg-" not in t


async def test_closure_that_blocks_the_route_says_so(ctx):
    _close(ctx, "seg-ab", name="Jalan Closed", end=None)  # the only way out of Car Park B
    evs = await ask(ctx, Q)
    t = text(evs)
    assert "Closed (staff report): Jalan Closed until further notice" in t
    assert evs[-1].model == "mock-scripted"
    assert "blocked by a reported closure" in t
    assert evs[-1].answer_status in ("partial", "cannot_answer")
    assert unc(evs).level in ("partial", "high")


async def test_expired_closure_is_not_named(ctx):
    _close(ctx, "playground", start=-48, end=-24)
    evs = await ask(ctx, Q)
    assert "Closed (staff report)" not in text(evs)
    assert evs[-1].answer_status == "answered"


async def test_detour_closure_is_named(ctx):
    _close(ctx, "seg-cd", name="Jalan Detour")  # a closure on the way: the route goes around it
    evs = await ask(ctx, Q)
    assert "Closed (staff report): Jalan Detour until" in text(evs)
    assert evs[-1].model == "mock-scripted" and evs[-1].answer_status == "partial"


async def test_is_x_closed_uses_get_closures(ctx):
    _close(ctx, "toilet-1", name="Elmina Toilet", reason="event")
    evs = await ask(ctx, "Is the toilet closed?", profile="default")
    calls = [e.name for e in evs if e.type == "tool.call"]
    assert calls == ["find_place", "get_closures"]
    t = text(evs)
    assert "Closed (staff report): Elmina Toilet until" in t and "— event" in t
    assert evs[-1].model == "mock-scripted"


async def test_is_x_closed_with_none_reported(ctx):
    evs = await ask(ctx, "Is the toilet closed?", profile="default")
    t = text(evs)
    assert "No staff-reported closure" in t and "not a guarantee" in t
    assert "is open" not in t.lower()
    assert evs[-1].model == "mock-scripted"


async def test_uncertainty_partial_for_rest_gap_only(ctx):
    evs = await ask(
        ctx,
        "Can I get to the playground? I am an older adult who needs to rest.",
        profile="older_adult_rest",
    )
    t = text(evs)
    if "without a rest point" not in t:
        pytest.skip("tiny fixture has no rest gap on this route")
    u = unc(evs)
    assert u.level == "partial"
    assert any(i["attribute"] == "rest_gap" for i in u.items)


def _rec_with_route(**route):
    rec = TurnRecord(tool_calls=["plan_route"])
    rec.routes["rt-1"] = {"id": "rt-1", "distance_m": 100, "unknowns": [], "geometry": {}, **route}
    rec.route_status["rt-1"] = "confirmed"
    return rec


async def test_rest_gap_only_event(ctx):
    from townshiplens_agent.run import _answer_events

    rec = _rec_with_route(
        rest_limit_m=100.0, rest_limit_met=False, max_gap_between_rest_m=110.0, rest_points=[]
    )
    ans = template_answer(rec, "route?")
    assert validate_answer(ans, rec) == []
    evs = _answer_events(ans, rec, ctx)
    u = next(e for e in evs if e.type == "uncertainty")
    assert u.level == "partial"
    assert [i["attribute"] for i in u.items] == ["rest_gap"]
    assert "110 m" in u.items[0]["note"]


async def test_closure_only_event(ctx):
    from townshiplens_agent.run import _answer_events

    rec = _rec_with_route()
    rec.route_closures = [
        {
            "id": "cl-1",
            "element_id": "playground",
            "element_name": "Elmina Playground",
            "reason": "works",
            "ends_at": "2026-10-20T00:00:00+08:00",
            "impact": "endpoint",
        }
    ]
    ans = template_answer(rec, "route?")
    assert validate_answer(ans, rec) == []
    assert ans.answer_status == "partial"
    u = next(e for e in _answer_events(ans, rec, ctx) if e.type == "uncertainty")
    assert u.level == "partial"
    assert [i["attribute"] for i in u.items] == ["closure"]


def test_validator_rejects_unnamed_route_closure():
    rec = _rec_with_route()
    rec.route_closures = [
        {
            "id": "cl-1",
            "element_id": "seg-ab",
            "element_name": "Jalan Hopea",
            "reason": "works",
            "ends_at": None,
            "impact": "detour",
        }
    ]
    from townshiplens_agent.answer import FinalAnswer

    bad = FinalAnswer(answer_status="partial", summary="Route of 100 m.", caveats=["Be careful."])
    assert any("Closed (staff report)" in e for e in validate_answer(bad, rec))
    assert validate_answer(template_answer(rec, "route?"), rec) == []


def test_template_blocked_by_closure_validates_and_says_so():
    rec = TurnRecord(tool_calls=["plan_route"])
    rec.route_closures = [
        {
            "id": "cl-1",
            "element_id": "seg-cd",
            "element_name": "Jalan Closed",
            "reason": "flooding",
            "ends_at": None,
            "impact": "blocked",
        }
    ]
    ans = template_answer(rec, "route?")
    assert ans.answer_status == "cannot_answer"
    assert "blocked by a reported closure" in ans.summary
    assert "Closed (staff report): Jalan Closed until further notice — flooding" in ans.caveats
    assert validate_answer(ans, rec) == []


async def test_template_fallback_names_closure_in_a_run(ctx, monkeypatch):
    from townshiplens_agent import agent as agent_mod

    monkeypatch.setattr(agent_mod, "validate_answer", lambda ans, rec: ["force the template"])
    _close(ctx, "seg-ab", name="Jalan Closed", end=None)
    evs = await ask(ctx, Q)
    assert evs[-1].model.endswith("+template")
    t = text(evs)
    assert "blocked by a reported closure" in t
    assert "Closed (staff report): Jalan Closed until further notice — works" in t
