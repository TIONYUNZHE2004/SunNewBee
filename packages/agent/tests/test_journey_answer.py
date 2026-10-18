"""Journey answers (spec 2026-10-19-resident-journey-simulation-design.md §6.3, D-T3).

AC-D5: the validator rejects a `journey.play` whose route was not returned this turn (or that has
no start time), and an answer whose rest count or unchecked-place count contradicts the plan; the
mock and template answers for the demo question pass.
AC-D6: no card title, card body or answer says "safe" / "selamat" / "安全" or a water depth;
"verified" only for verified, non-demo facts; demo facts carry the demo wording. The UI strings
are scanned in D-T7 (web); this file scans every backend-owned string.
"""

import asyncio
import re

import pytest
from tests_support import TINY
from townshiplens_agent.agent import Deps, call_tool
from townshiplens_agent.answer import FinalAnswer
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.journeys import JOURNEY_START, journey_facts, start_time_for
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import answer_text, run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_agent.template import template_answer
from townshiplens_agent.validate import DEPTH, FORBIDDEN, journey_errors, validate_answer
from townshiplens_spatial import tools
from townshiplens_spatial.journey import DEMO_NOTE
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SEED = ROOT / "data/seed/elmina"
DEMO_Q = "My mum uses a walker. Can she walk from Harmoni 1 to Lakeside Mall Car Park B?"
HARMONI_1, CAR_PARK_B = "osm-way-909868201", "park-b"
MOCK = AgentSettings(_env_file=None, llm_provider="mock")
needs_seed = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
# The §2 table: kinds in order (AC-D1 checks titles and distances in the spatial tests).
DEMO_KINDS = [
    "covered",
    "unknown",
    "gap",
    "unknown",
    "verified",
    "rest",
    "unknown",
    "rest",
    "rest",
    "arrive",
]


@pytest.fixture(scope="module")
def seed():
    return load_world(SEED)


@pytest.fixture(scope="module")
def tiny():
    return load_world(TINY)


async def _turn(world, tmp_path, message, profile="default", settings=MOCK):
    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    rec = TurnRecord()
    req = ChatRequest(message=message, profile=profile)
    evs = [e async for e in run_turn(ctx, req, settings, record=rec)]
    return evs, rec, ctx


def _text(evs) -> str:
    return "".join(e.delta for e in evs if e.type == "text.delta")


def _intents(evs):
    return [e.intent for e in evs if e.type == "scene.intent"]


async def _planned(world, tmp_path, a, b, profile):
    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    deps = Deps(ctx=ctx, rec=TurnRecord(queue=asyncio.Queue()), request=ChatRequest(message="x"))
    out = await call_tool(deps, "plan_route", from_id=a, to_id=b, profile=profile)
    return deps.rec, out["data"]["routes"][0]


# ------------------------------------------------------------------ the demo question (seed)


@needs_seed
async def test_mock_resolves_the_demo_places_by_name_and_plays_the_journey(seed, tmp_path):
    evs, rec, _ = await _turn(seed, tmp_path, DEMO_Q, "older_adult_rest")
    calls = [e for e in evs if e.type == "tool.call"]
    assert [c.name for c in calls] == ["find_place", "find_place", "plan_route"]
    assert calls[2].args["from_id"] == HARMONI_1 and calls[2].args["to_id"] == CAR_PARK_B
    assert calls[2].args["profile"] == "older_adult_rest"
    kinds = [i.kind for i in _intents(evs)]
    assert kinds == ["route.highlight", "journey.play"]
    hl, play = _intents(evs)
    assert play.route_id == hl.route_id and play.start_time == JOURNEY_START == "09:00"
    assert [e.kind for e in play.journey.events] == DEMO_KINDS
    assert evs[-1].type == "done" and evs[-1].answer_status == "partial"
    assert not evs[-1].model.endswith("+template")
    assert rec.validator_errors == []  # the mock answer passes first time (AC-D5)


@needs_seed
async def test_demo_answer_has_the_prototype_content(seed, tmp_path):
    evs, rec, _ = await _turn(seed, tmp_path, DEMO_Q, "older_adult_rest")
    text = _text(evs)
    low = text.lower()
    # Prototype bubble: distance and time, no known barrier with the rest stops (demo values),
    # the unchecked places by name, and the stretch with no mapped rest stop.
    assert "about 966 m" in text and "about 14 min" in text
    assert "no known barrier on the step-free path" in low
    assert "3 rest stops on the way" in low
    assert "demo values, not yet surveyed" in low
    assert "not checked yet: 3 places on the way" in low
    assert "the persiaran elmina crossing" in low and "a ramp" in low
    assert "longest stretch without a rest point is about 640 m" in low
    assert "asked the township team" in low  # verification requests were filed this turn
    assert not FORBIDDEN.search(text) and not DEPTH.search(text)


@needs_seed
async def test_template_answer_states_the_same_facts(seed, tmp_path):
    evs, rec, ctx = await _turn(seed, tmp_path, DEMO_Q, "older_adult_rest")
    ans = template_answer(rec, DEMO_Q)
    assert validate_answer(ans, rec) == []
    kinds = [i.kind for i in ans.scene_intents]
    assert kinds == ["route.highlight", "journey.play"]
    assert ans.scene_intents[1].start_time == JOURNEY_START
    text = answer_text(ans, None, rec).lower()
    assert "3 rest stops on the way" in text
    assert "not checked yet: 3 places on the way" in text
    assert "demo values, not yet surveyed" in text


@needs_seed
async def test_route_facts_shown_to_the_model_match_the_plan(seed, tmp_path):
    rec, route = await _planned(seed, tmp_path, HARMONI_1, CAR_PARK_B, "older_adult_rest")
    plan = rec.journeys[route["id"]]
    facts = route["journey"]
    assert facts == journey_facts(plan)
    assert facts["rest_stops"] == sum(e.kind == "rest" for e in plan.events) == 3
    assert facts["unchecked_places"] == sum(e.kind == "unknown" for e in plan.events) == 3
    names = ["Crossing Persiaran Elmina", "Persiaran Tamarind", "Ramp"]
    assert facts["unchecked_place_names"] == names


# ------------------------------------------------------------------ route questions (tiny)


async def test_route_questions_emit_journey_play_after_route_highlight(tiny, tmp_path):
    q = "Can I push a stroller from Car Park B to the kiosk without stairs?"
    evs, rec, _ = await _turn(tiny, tmp_path, q, "stroller")
    kinds = [i.kind for i in _intents(evs)]
    assert kinds == ["route.highlight", "journey.play"]
    play = _intents(evs)[1]
    assert play.journey is not None and play.journey.route_id == _intents(evs)[0].route_id
    assert rec.validator_errors == []


async def test_a_question_time_sets_the_start_time():
    assert start_time_for("can she walk there at 3pm?") == "15:00"
    assert start_time_for("leaving 08:15 from car park b") == "08:15"
    assert start_time_for(DEMO_Q.lower()) == JOURNEY_START


# ------------------------------------------------------------------ validator rules (AC-D5)


def _ans(route_id, *intents, summary="Car Park B to Park kiosk: route partly unverified.", **kw):
    return FinalAnswer.model_validate(
        {
            "answer_status": "partial",
            "summary": summary,
            "route_id": route_id,
            "scene_intents": [{"kind": "route.highlight", "route_id": route_id}, *intents],
            **kw,
        }
    )


async def test_journey_play_must_name_a_route_returned_this_turn(tiny, tmp_path):
    rec, route = await _planned(tiny, tmp_path, "park-b", "kiosk", "stroller")
    rid = route["id"]
    bad = _ans(rid, {"kind": "journey.play", "route_id": "rt-elsewhere", "start_time": "09:00"})
    assert any("rt-elsewhere" in e and "this turn" in e for e in journey_errors(bad, rec))
    assert any("journey.play" in e for e in validate_answer(bad, rec))
    none = _ans(rid, {"kind": "journey.play", "start_time": "09:00"})
    assert any("route" in e for e in journey_errors(none, rec))
    ok = _ans(
        rid,
        {"kind": "journey.play", "route_id": rid, "start_time": "09:00"},
        caveats=["Segment facts are demo values, not yet surveyed."],  # tiny has demo facts
    )
    assert journey_errors(ok, rec) == []


async def test_journey_play_needs_a_start_time(tiny, tmp_path):
    rec, route = await _planned(tiny, tmp_path, "park-b", "kiosk", "stroller")
    bad = _ans(route["id"], {"kind": "journey.play", "route_id": route["id"]})
    assert any("start_time" in e for e in journey_errors(bad, rec))


async def test_journey_play_without_a_plan_is_rejected(tiny, tmp_path):
    rec, route = await _planned(tiny, tmp_path, "park-b", "kiosk", "stroller")
    del rec.journeys[route["id"]]  # e.g. building the plan failed (logged)
    play = {"kind": "journey.play", "route_id": route["id"], "start_time": "09:00"}
    bad = _ans(route["id"], play)
    assert any("no journey" in e.lower() for e in journey_errors(bad, rec))


@needs_seed
@pytest.mark.parametrize(
    "line,ok",
    [
        ("No known barrier on the step-free path, with 3 rest stops on the way.", True),
        ("There are 2 rest stops on the way.", False),
        ("She passes four benches.", False),
        ("Rest stops mapped on this route: 5.", False),
        ("Not checked yet: 3 places on the way, including a ramp.", True),
        ("Not checked yet: 2 places on the way.", False),
        ("There are 5 unchecked places on this route.", False),
        ("Not checked yet: Incline (%) on Ramp; and 25 more unchecked items.", True),  # items
        ("The route runs past 2 places to eat.", True),  # not about rest or checks
    ],
)
async def test_counts_must_match_the_plan(seed, tmp_path, line, ok):
    rec, route = await _planned(seed, tmp_path, HARMONI_1, CAR_PARK_B, "older_adult_rest")
    summary = "Harmoni 1 to Car Park B: route partly unverified."
    ans = _ans(route["id"], summary=summary, steps=[line])
    errs = journey_errors(ans, rec)
    assert (errs == []) is ok, errs


@needs_seed
async def test_counts_are_checked_against_the_answer_route_even_without_journey_play(
    seed, tmp_path
):
    rec, route = await _planned(seed, tmp_path, HARMONI_1, CAR_PARK_B, "older_adult_rest")
    ans = FinalAnswer(
        answer_status="partial",
        summary="Not checked yet: 7 places on the way.",
        route_id=route["id"],
    )
    assert any("unchecked" in e.lower() for e in journey_errors(ans, rec))


@needs_seed
async def test_demo_plan_needs_the_demo_phrase_and_no_verified_word(seed, tmp_path):
    rec, route = await _planned(seed, tmp_path, HARMONI_1, CAR_PARK_B, "older_adult_rest")
    rid = route["id"]
    play = {"kind": "journey.play", "route_id": rid, "start_time": "09:00"}
    no_phrase = _ans(rid, play)
    assert any("demo values, not yet surveyed" in e for e in journey_errors(no_phrase, rec))
    verified = _ans(
        rid,
        play,
        steps=["The step-free path is verified."],
        caveats=["Demo values, not yet surveyed."],
    )
    assert any("verified" in e.lower() for e in journey_errors(verified, rec))


# ------------------------------------------------------------------ wording scan (AC-D6)

_VERIFIED = re.compile(r"(?<!un)\bverified\b", re.IGNORECASE)


def _scan_plan(plan) -> list[str]:
    bad = []
    for e in plan.events:
        for s in (e.title, e.body):
            if FORBIDDEN.search(s) or DEPTH.search(s):
                bad.append(f"{e.kind} {s!r}: safe/depth wording")
            if _VERIFIED.search(s) and (e.status != "verified" or e.demo):
                bad.append(f"{e.kind} {s!r}: 'verified' on a non-verified or demo fact")
        if e.kind == "verified" and e.demo and DEMO_NOTE not in e.body:
            bad.append(f"{e.title!r}: demo verified card without {DEMO_NOTE!r}")
    return bad


def _scan_answer(text: str, demo: bool) -> list[str]:
    bad = []
    if FORBIDDEN.search(text) or DEPTH.search(text):
        bad.append("safe/depth wording")
    if demo and _VERIFIED.search(text):
        bad.append("'verified' with demo evidence")
    if demo and "demo values, not yet surveyed" not in text.lower():
        bad.append("demo evidence without 'demo values, not yet surveyed'")
    return bad


@needs_seed
async def test_wording_scan_over_the_demo_plan_and_answers(seed, tmp_path):
    evs, rec, _ = await _turn(seed, tmp_path, DEMO_Q, "older_adult_rest")
    play = _intents(evs)[1]
    assert _scan_plan(play.journey) == []
    demo = any(e.demo for e in play.journey.events)
    assert demo
    assert _scan_answer(_text(evs), demo) == []
    tmpl = template_answer(rec, DEMO_Q)
    assert _scan_answer(answer_text(tmpl, None, rec), demo) == []


@pytest.mark.parametrize(
    "a,b,profile",
    [
        ("park-b", "kiosk", "stroller"),
        ("park-b", "kiosk", "older_adult_rest"),
        ("park-b", "playground", "wheelchair"),
        ("park-b", "lakeside-mall", "default"),
        ("kiosk", "toilet-1", "older_adult_rest"),
    ],
)
async def test_wording_scan_over_tiny_plans_and_template(tiny, tmp_path, a, b, profile):
    rec, route = await _planned(tiny, tmp_path, a, b, profile)
    plan = rec.journeys[route["id"]]
    assert _scan_plan(plan) == []
    tmpl = template_answer(rec, f"from {a} to {b}")
    assert validate_answer(tmpl, rec) == []
    demo = any(e.source_type == "team_survey_placeholder" for e in rec.evidence.values())
    assert _scan_answer(answer_text(tmpl, None, rec), demo) == []
