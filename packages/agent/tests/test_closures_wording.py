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


# ---- fix round 1 -------------------------------------------------------------------------


def _invariant(evs):
    u = unc(evs)
    done = evs[-1]
    if done.answer_status == "cannot_answer":
        assert u.level == "high"
        return
    assert (u.level == "partial") == bool(u.items), (u.level, u.items, text(evs))


TINY_CASES = [
    ("Can I push a stroller from Car Park B to the playground without stairs?", "stroller", None),
    ("Can I push a stroller from Car Park B to the kiosk without stairs?", "stroller", None),
    ("Where can I recycle batteries?", "default", None),
    ("Is the toilet closed?", "default", "toilet-1"),
    ("Is the toilet closed?", "default", None),
    ("Is the playground closed?", "default", "playground"),
    (
        "Can I push a stroller from Car Park B to the playground without stairs?",
        "stroller",
        "seg-ab",
    ),
    (
        "Can I push a stroller from Car Park B to the playground without stairs?",
        "stroller",
        "playground",
    ),
]


@pytest.mark.parametrize("msg,profile,closed", TINY_CASES)
async def test_partial_iff_items_tiny(ctx, msg, profile, closed):
    if closed:
        _close(ctx, closed, name="Closed Thing", end=None)
    _invariant(await ask(ctx, msg, profile))


async def test_partial_iff_items_inapp_prompts(tmp_path):
    from test_inapp_prompts import ALL, SEED

    if not (SEED / "site.json").exists():
        pytest.skip("Elmina seed not built")
    world = load_world(SEED)
    for msg, profile, scenario in ALL:
        c = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
        req = ChatRequest(message=msg, profile=profile, scenario_id=scenario)
        _invariant([e async for e in run_turn(c, req, MOCK)])


async def test_get_closures_rows_become_items(ctx):
    _close(ctx, "playground", name="Elmina Playground")
    evs = await ask(ctx, "Is the playground closed?", profile="default")
    u = unc(evs)
    assert u.items[0]["attribute"] == "closure" and "Elmina Playground" in u.items[0]["note"]
    assert {i["attribute"] for i in u.items} <= {"closure", "caveat"}


async def test_blocked_by_closure_does_not_claim_unverified_segments(ctx):
    _close(ctx, "seg-ab", name="Jalan Closed", end=None)
    for forced in (False, True):
        if forced:
            from townshiplens_agent import agent as agent_mod

            agent_mod.validate_answer = lambda ans, rec: ["force the template"]
        try:
            t = text(await ask(ctx, Q))
        finally:
            if forced:
                from townshiplens_agent.validate import validate_answer

                agent_mod.validate_answer = validate_answer
        assert "blocked by a reported closure" in t and "Jalan Closed" in t
        assert "unverified" not in t.lower(), t


def _rows(**kw):
    row = {
        "id": "cl-1",
        "element_id": "seg-ab",
        "element_name": "Jalan Hopea",
        "reason": "works",
        "ends_at": "2026-10-20T00:00:00+08:00",
        "active": True,
        "impact": "detour",
    }
    return {**row, **kw}


def _answer(**kw):
    from townshiplens_agent.answer import FinalAnswer

    return FinalAnswer(**{"answer_status": "partial", "summary": "Route of 100 m.", **kw})


def test_validator_name_must_come_with_marker_and_date():
    rec = _rec_with_route()
    rec.route_closures = [_rows()]
    line = closure_line(_rows())
    assert validate_answer(_answer(caveats=[line]), rec) == []
    # name in the summary, marker and date elsewhere: not one line
    bad = _answer(
        summary="Along Jalan Hopea.", caveats=["Closed (staff report): until 20 Oct 2026"]
    )
    assert validate_answer(bad, rec)
    # short or incidental name is not enough without the date
    assert validate_answer(_answer(caveats=["Closed (staff report): Jalan Hopea"]), rec)


def test_validator_two_same_named_closures_need_their_own_dates():
    rec = _rec_with_route()
    a, b = _rows(id="a"), _rows(id="b", ends_at="2026-10-25T00:00:00+08:00")
    rec.route_closures = [a, b]
    assert validate_answer(_answer(caveats=[closure_line(a)]), rec)
    assert validate_answer(_answer(caveats=[closure_line(a), closure_line(b)]), rec) == []


def test_validator_rejects_it_is_open_when_closure_on_record():
    rec = TurnRecord(tool_calls=["find_place", "get_closures"])
    rec.asked_closures = [_rows(element_name="Elmina Playground")]
    bad = _answer(answer_status="answered", summary="The playground is open.")
    assert any("never say it is open" in e for e in validate_answer(bad, rec))
    omit = _answer(summary="Nothing to report.")
    assert any("must be named" in e for e in validate_answer(omit, rec))
    ok = _answer(summary="Closure on record.", caveats=[closure_line(rec.asked_closures[0])])
    assert validate_answer(ok, rec) == []


async def test_inferred_entrance_is_in_the_answer_text_and_validated(ctx):
    p = ctx.world.places["playground"]
    ctx.world.places["playground"] = p.model_copy(
        update={"node_inferred": True, "entrance_ids": []}
    )
    evs = await ask(ctx, Q)
    t = text(evs)
    assert "nearest mapped path to" in t and "its entrance is not mapped" in t
    assert evs[-1].model == "mock-scripted"
    assert any(i["attribute"] == "entrance" for i in unc(evs).items)


def test_validator_requires_inferred_entrance_caveat():
    rec = _rec_with_route()
    rec.inferred_notes = [
        "Route ends at the nearest mapped path to Park; its entrance is not mapped."
    ]
    assert validate_answer(_answer(caveats=["Something else."]), rec)
    assert validate_answer(_answer(caveats=[rec.inferred_notes[0]]), rec) == []
    assert validate_answer(template_answer(rec, "route?"), rec) == []
