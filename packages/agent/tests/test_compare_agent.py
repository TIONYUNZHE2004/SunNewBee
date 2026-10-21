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
