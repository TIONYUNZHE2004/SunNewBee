"""Navigation compare in the assistant (demo polish B4, AC-B12): mock, template, validator and
the route.compare intent payload."""

import pytest
from tests_support import TINY
from townshiplens_agent.compare_intent import compare_payload
from townshiplens_agent.events import ChatRequest, SceneIntent
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_agent.template import template_answer
from townshiplens_agent.validate import compare_errors, validate_answer
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SEED = ROOT / "data/seed/elmina"
needs_seed = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
MOCK = AgentSettings(_env_file=None, llm_provider="mock")
TINY_Q = "Wheelchair route from Car Park B to the toilet?"
CORRIDOR_Q = "Wheelchair route from Elmina Lakeside Mall to Surau Kiambang?"


@pytest.fixture(scope="module")
def tiny():
    return load_world(TINY)


@pytest.fixture(scope="module")
def seed():
    return load_world(SEED)


async def _turn(world, tmp_path, message, profile="default", scenario=None):
    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    rec = TurnRecord()
    req = ChatRequest(message=message, profile=profile, scenario_id=scenario)
    evs = [e async for e in run_turn(ctx, req, MOCK, record=rec)]
    return evs, rec, ctx


def _text(evs) -> str:
    return "".join(e.delta for e in evs if e.type == "text.delta")


def _calls(evs) -> list[str]:
    return [e.name for e in evs if e.type == "tool.call"]


def _intents(evs):
    return [e.intent for e in evs if e.type == "scene.intent"]


async def test_mobility_route_question_compares(tiny, tmp_path):
    evs, rec, ctx = await _turn(tiny, tmp_path, TINY_Q, "wheelchair")
    assert _calls(evs) == ["find_place", "find_place", "compare_routes"]
    assert evs[-1].model == "mock-scripted"  # the mock's own answer passed the validator
    d = rec.compares[-1]
    rid = d["recommended"]["id"]
    kinds = [i.kind for i in _intents(evs)]
    assert kinds[:2] == ["route.compare", "route.highlight"]
    cmp_intent, hl = _intents(evs)[:2]
    assert cmp_intent.route_id == hl.route_id == rid
    # the payload is the recorded tool data, never model-written
    assert cmp_intent.compare == compare_payload(tiny, d)
    assert cmp_intent.compare.recommended.coordinates == d["recommended"]["geometry"]["coordinates"]
    assert cmp_intent.compare.stop.edge_id == d["stop"]["edge_id"]
    text = _text(evs)
    assert "not checked yet; it did not count for or against this route" in text
    assert f"{d['extra_minutes']:g} min more than the fastest route" in text
    # the ticket: one VR event, a place-names-only summary (PDPA)
    vrs = [e for e in evs if e.type == "verification.requested"]
    assert [(v.element_id, v.attribute) for v in vrs] == [
        (d["vr"]["target_id"], d["vr"]["attribute"])
    ]
    stored = ctx.vrs.get(d["vr"]["id"])
    assert stored.question_summary == "wheelchair route Car Park B -> Park toilet"


async def test_template_answer_from_the_same_record_passes(tiny, tmp_path):
    _, rec, _ = await _turn(tiny, tmp_path, TINY_Q, "wheelchair")
    ans = template_answer(rec, TINY_Q)
    assert validate_answer(ans, rec) == []
    assert [i.kind for i in ans.scene_intents][:2] == ["route.compare", "route.highlight"]
    assert "fastest route" in ans.summary
    assert any("did not count for or against" in c for c in ans.caveats)


async def test_validator_rejects_numbers_not_from_compare(tiny, tmp_path):
    _, rec, _ = await _turn(tiny, tmp_path, TINY_Q, "wheelchair")
    good = template_answer(rec, TINY_Q)
    bad = good.model_copy(update={"summary": good.summary.replace("min more", "min more (9 min)")})
    assert compare_errors(bad, rec)
    assert validate_answer(bad, rec)


async def test_validator_wants_the_unchecked_stretch_named(tiny, tmp_path):
    _, rec, _ = await _turn(tiny, tmp_path, TINY_Q, "wheelchair")
    good = template_answer(rec, TINY_Q)
    silent = good.model_copy(
        update={
            "caveats": [c for c in good.caveats if "not checked" not in c.lower()],
            "steps": [s for s in good.steps if "not checked" not in s.lower()],
        }
    )
    assert any("not checked yet" in e for e in compare_errors(silent, rec))


async def test_validator_checks_the_compare_route_id(tiny, tmp_path):
    _, rec, _ = await _turn(tiny, tmp_path, TINY_Q, "wheelchair")
    good = template_answer(rec, TINY_Q)
    wrong = good.model_copy(
        update={
            "scene_intents": [
                SceneIntent(kind="route.compare", route_id="rt-nope"),
                *good.scene_intents[1:],
            ]
        }
    )
    assert any("route.compare" in e for e in compare_errors(wrong, rec))


async def test_default_profile_route_question_is_unchanged(tiny, tmp_path):
    evs, rec, _ = await _turn(tiny, tmp_path, "How do I walk from Car Park B to the toilet?")
    assert _calls(evs) == ["find_place", "find_place", "plan_route"]
    assert not rec.compares
    assert "route.compare" not in [i.kind for i in _intents(evs)]


async def test_flood_scenario_keeps_plan_route(tiny, tmp_path):
    evs, _, _ = await _turn(tiny, tmp_path, TINY_Q, "wheelchair", scenario="stage_p1m")
    assert "compare_routes" not in _calls(evs)
    assert "plan_route" in _calls(evs)


async def test_same_path_falls_back_to_plan_route(tiny, tmp_path):
    """The shortest walk already works: no comparison, no compare ticket, today's answer."""
    q = "Can I push a stroller from Car Park B to the playground without stairs?"
    evs, rec, _ = await _turn(tiny, tmp_path, q, "stroller")
    assert _calls(evs) == ["find_place", "find_place", "compare_routes", "plan_route"]
    assert rec.compares[-1]["same_path"] is True and rec.compares[-1]["vr"] is None
    assert "route.compare" not in [i.kind for i in _intents(evs)]


@needs_seed
async def test_elmina_corridor_compare(seed, tmp_path):
    """AC-B12 on the demo corridor (B5): the golden case nav-compare-wheelchair, in detail."""
    evs, rec, ctx = await _turn(seed, tmp_path, CORRIDOR_Q, "wheelchair")
    assert _calls(evs) == ["find_place", "find_place", "compare_routes"]
    assert evs[-1].model == "mock-scripted" and evs[-1].answer_status == "partial"
    kinds = [i.kind for i in _intents(evs)]
    assert kinds == ["route.compare", "route.highlight", "journey.play"]
    c = _intents(evs)[0].compare
    assert (c.from_place.name, c.to_place.name) == ("Elmina Lakeside Mall", "Surau Kiambang")
    assert c.stop.edge_id == "seg-1346147887-0" and c.stop.value == 3
    assert c.reasons.fastest.steps == 3 and c.reasons.recommended.steps == 0
    assert [u.attribute for u in c.unchecked] == ["incline_pct"]
    assert c.vr is not None and c.vr.target_id == c.unchecked[0].edge_id
    assert c.confirm_n is not None
    text = _text(evs)
    assert "demo values, not yet surveyed" in text
    assert "The fastest route has 3 steps" in text
    assert ctx.vrs.get(c.vr.id).question_summary == (
        "wheelchair route Elmina Lakeside Mall -> Surau Kiambang"
    )
    assert validate_answer(template_answer(rec, CORRIDOR_Q), rec) == []


# ------------------------------------------------------------------ fix round 1 (review)


def _close(world, element, cid="cl-0001"):
    from datetime import UTC, datetime, timedelta

    from townshiplens_spatial.models import Closure

    now = datetime.now(UTC)
    world.set_closures(
        [
            Closure(
                id=cid,
                element_id=element,
                reason="works",
                starts_at=now - timedelta(hours=1),
                ends_at=now + timedelta(hours=24),
            )
        ]
    )


async def test_compare_answer_names_a_closed_destination(tmp_path):
    """Review Important 1: the plan_route path names a closed destination; so must compare."""
    world = load_world(TINY)
    _close(world, "toilet-1")
    evs, rec, _ = await _turn(world, tmp_path, TINY_Q, "wheelchair")
    assert "compare_routes" in _calls(evs)
    t = _text(evs)
    assert "Closed (staff report): " in t and "— works" in t
    assert evs[-1].model == "mock-scripted"
    assert rec.route_closures and rec.route_closures[0]["impact"] == "endpoint"
    # the validator asks for the closure line on a compare answer too
    ans = template_answer(rec, TINY_Q)
    assert validate_answer(ans, rec) == []
    silent = ans.model_copy(
        update={"caveats": [c for c in ans.caveats if "Closed (staff report)" not in c]}
    )
    assert any("staff-reported closure" in e for e in validate_answer(silent, rec))


async def test_compare_answer_names_a_closure_it_detours_around(tmp_path):
    """seg-cf is on the recommended route; closed, compare finds another way and says why."""
    world = load_world(TINY)
    _close(world, "seg-cf")
    evs, rec, _ = await _turn(world, tmp_path, TINY_Q, "wheelchair")
    assert _calls(evs) == ["find_place", "find_place", "compare_routes"]
    assert [i.kind for i in _intents(evs)][:1] == ["route.compare"]
    rows = rec.compares[-1]["closures"]
    assert [r["impact"] for r in rows] == ["detour"]
    assert "Closed (staff report): " in _text(evs)
    assert evs[-1].model == "mock-scripted"
    # no journey is played past a reported closure (same rule as plan_route answers)
    assert "journey.play" not in [i.kind for i in _intents(evs)]


async def test_validator_wants_each_stretch_with_its_length(tiny, tmp_path):
    """Review minor: each unchecked stretch is named with its attribute and length."""
    _, rec, _ = await _turn(tiny, tmp_path, TINY_Q, "wheelchair")
    good = template_answer(rec, TINY_Q)
    u = rec.compares[-1]["unchecked"][0]
    wrong = good.model_copy(
        update={"caveats": [c.replace(f"{u['length_m']:g} m", "999 m") for c in good.caveats]}
    )
    assert any("unchecked stretch" in e for e in compare_errors(wrong, rec))
    assert compare_errors(good, rec) == []


async def test_no_route_compare_intent_without_a_recommended_route(tiny, tmp_path):
    """A compare without a recommended route (blocked) never reaches the client as route.compare."""
    world = load_world(TINY)
    _close(world, "seg-ab")
    evs, rec, _ = await _turn(world, tmp_path, TINY_Q, "wheelchair")
    assert rec.compares[-1]["recommended"] is None
    assert "route.compare" not in [i.kind for i in _intents(evs)]


# ------------------------------------------------------------------ final review I-3 (R46)


async def _deps(world, tmp_path, scenario=None):
    import asyncio

    from townshiplens_agent.agent import Deps

    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    req = ChatRequest(message=TINY_Q, profile="wheelchair", scenario_id=scenario)
    return Deps(ctx=ctx, rec=TurnRecord(queue=asyncio.Queue()), request=req)


ENDS = {"from_id": "park-b", "to_id": "toilet-1", "profile": "wheelchair"}


@pytest.mark.parametrize("strict", [False, True])
async def test_ui_scenario_is_not_injected_into_compare_routes(tiny, tmp_path, strict):
    """A compare is a dry-day comparison: the scenario on screen never reaches compare_routes,
    with or without strict selection (run_turn always turns it on)."""
    from townshiplens_agent.agent import SCENARIO_TOOLS, call_tool

    assert "compare_routes" not in SCENARIO_TOOLS
    deps = await _deps(tiny, tmp_path, scenario="stage_p1m")
    deps.rec.strict_selection = strict
    await call_tool(deps, "compare_routes", **ENDS)
    calls = []
    while not deps.rec.queue.empty():
        ev = deps.rec.queue.get_nowait()
        if getattr(ev, "type", None) == "tool.call":
            calls.append(ev)
    assert [c.args.get("scenario_id") for c in calls] == [None]
    assert deps.rec.scenarios_used == set()
    assert deps.rec.compares[-1]["recommended"]["scenario_id"] is None


@pytest.mark.parametrize("explicit", [False, True])
async def test_compare_under_a_flood_scenario_falls_back_to_the_route_answer(
    tiny, tmp_path, explicit
):
    """R46: once a tool ran with a flood scenario this turn (plan_route with the scenario on
    screen, or compare_routes given one), there is no compare answer: the validator refuses
    route.compare, the template answers from the route, and run.py drops the intent."""
    from townshiplens_agent.agent import call_tool
    from townshiplens_agent.compare_intent import compare_for
    from townshiplens_agent.run import _answer_events

    deps = await _deps(tiny, tmp_path, scenario="stage_p1m")
    if explicit:
        await call_tool(deps, "compare_routes", **ENDS, scenario_id="stage_p1m")
    else:
        await call_tool(deps, "compare_routes", **ENDS)
        await call_tool(deps, "plan_route", **ENDS)  # the scenario on screen is injected
    rec = deps.rec
    assert "stage_p1m" in rec.scenarios_used and rec.compares
    rid = rec.compares[-1]["recommended"]["id"]
    assert compare_for(rec, rid) is None
    ans = template_answer(rec, TINY_Q)
    assert "route.compare" not in [i.kind for i in ans.scene_intents]
    assert "fastest route" not in ans.summary
    assert validate_answer(ans, rec) == []
    forced = ans.model_copy(
        update={
            "scene_intents": [SceneIntent(kind="route.compare", route_id=rid), *ans.scene_intents]
        }
    )
    assert any("dry-day" in e for e in compare_errors(forced, rec))
    evs = _answer_events(forced, rec, deps.ctx, "stage_p1m", "en")
    assert "route.compare" not in [e.intent.kind for e in evs if e.type == "scene.intent"]
