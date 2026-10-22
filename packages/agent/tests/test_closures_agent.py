"""T-026: management answers about any closure (simulate_closure) and their checks, on the
backend's real closure engine."""

from datetime import date

import pytest
from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.event_course import event_window
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.labels import closure_line
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_agent.validate import closure_claim_errors, event_coverage_errors
from townshiplens_spatial import events, tools, traffic
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SEED = ROOT / "data/seed/elmina"
needs_seed = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
STAFF = AgentSettings(
    _env_file=None, llm_provider="mock", assistant_scope="access_flood", turn_timeout_s=600
)


@pytest.fixture(scope="module")
def seed():
    return load_world(SEED)


@pytest.mark.parametrize(
    "day, want",
    [
        ("next Tuesday", "2026-10-27"),
        ("Selasa depan", "2026-10-27"),
        ("下周二", "2026-10-27"),
        ("Sunday", "2026-10-25"),
        ("周日", "2026-10-25"),
        ("tomorrow", "2026-10-22"),
        ("wednesday", "2026-10-21"),  # today counts
    ],
)
def test_weekday_words_resolve_to_the_next_such_day(day, want):
    starts, ends = event_window("9", "5 pm", day, None, today=date(2026, 10, 21))
    assert starts == f"{want}T09:00:00+08:00" and ends == f"{want}T17:00:00+08:00"


async def _ask(world, tmp_path, q, panel="management"):
    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    rec = TurnRecord()
    req = ChatRequest(message=q, panel=panel)
    evs = [e async for e in run_turn(ctx, req, STAFF, record=rec, memory=SessionMemory())]
    return evs, rec, "".join(e.delta for e in evs if e.type == "text.delta")


@needs_seed
@pytest.mark.parametrize(
    "q, reason, day",
    [
        (
            "What if we close Persiaran Garcinia for a marathon 7-11 am on Sunday?",
            "event",
            "sunday",
        ),
        (
            "Road works on Persiaran Garcinia next Tuesday 9 am-5 pm: what is affected?",
            "works",
            "tuesday",
        ),
        (
            "Kerja jalan di Persiaran Garcinia Selasa depan 9 pagi-5 petang: apa yang terjejas?",
            "works",
            "selasa",
        ),
        ("下周二上午9点到下午5点Persiaran Garcinia道路施工，有什么影响？", "works", "下周二"),
    ],
)
async def test_closure_questions_are_simulated_with_pressure_for_managers(
    seed, tmp_path, q, reason, day
):
    evs, rec, text = await _ask(seed, tmp_path, q)
    call = next(e for e in evs if e.type == "tool.call" and e.name == "simulate_closure")
    assert call.args["reason"] == reason and call.args["closures"][0]["day"] == day
    assert call.args["closures"][0]["road_names"] == ["Persiaran Garcinia"]
    assert evs[-1].model == "mock-scripted" and evs[-1].answer_status == "answered"
    assert "Persiaran Tamarind (detour pressure: high)" in text
    assert "Suggestion:" in text and "had no mapped route before the" in text
    assert events.PRESSURE_DISCLAIMER in text and traffic.config().weights_note in text


@needs_seed
async def test_without_the_backend_tool_events_still_use_simulate_event(
    seed, tmp_path, monkeypatch
):
    monkeypatch.delitem(tools.TOOLS, "simulate_closure")
    evs, rec, _ = await _ask(
        seed, tmp_path, "What if we close Persiaran Garcinia for a marathon 7-11 am?"
    )
    assert "simulate_event" in rec.tool_calls and "simulate_closure" not in rec.tool_calls


@needs_seed
async def test_residents_cannot_run_closure_simulations(seed, tmp_path):
    q = "Road works on Persiaran Garcinia next Tuesday 9 am-5 pm: what is affected?"
    evs, rec, text = await _ask(seed, tmp_path, q, panel="resident")
    assert "simulate_closure" not in rec.tool_calls and "pressure" not in text.lower()


CLOSURE = {
    "event": {"name": "Road works"},
    "reason": "works",
    "trips_total": 63,
    "trips_affected": 7,
    "detour_roads": [
        {"name": "Persiaran Tamarind", "trips": 4, "pressure": "high"},
        {"name": "Jalan Kecil", "trips": 1, "pressure": "low"},
    ],
    "suggestions": [{"kind": "signpost", "text": "Signpost the detour.", "basis": "x=4"}],
    "weights_note": "Peak weights are an assumed travel pattern, not measured.",
}


def _check(summary: str, panel: str = "management") -> list[str]:
    rec = TurnRecord(events=[CLOSURE], panel=panel)
    ans = FinalAnswer(
        answer_status="answered",
        summary=summary,
        claims=[Claim(text="Road works", status="indicative", evidence_ids=["ev-closure-x"])],
    )
    return closure_claim_errors(ans, rec) + event_coverage_errors(ans, rec)


def test_pressure_bands_and_suggestions_as_returned_pass():
    ok = (
        "4 sample trips reroute onto Persiaran Tamarind (detour pressure: high); Jalan Kecil "
        "has low detour pressure. Suggestion: signpost the detour."
    )
    assert _check(ok) == []


@pytest.mark.parametrize(
    "summary, why",
    [
        (
            "Persiaran Tamarind has medium detour pressure. Signpost the detour.",
            "not what the tool",
        ),
        ("Persiaran Tamarind (detour pressure: high). Expect 200 cars on it.", "vehicles"),
        ("Persiaran Tamarind (high pressure). Signpost it and add marshals.", "not returned"),
        ("Persiaran Tamarind takes 4 trips. Signpost the detour.", "pressure band"),
    ],
)
def test_pressure_or_suggestions_the_tool_did_not_return_are_rejected(summary, why):
    assert any(why in e for e in _check(summary))


def test_residents_never_see_detour_pressure():
    rec = TurnRecord(panel="resident", route_closures=[{"id": "c1"}])
    ans = FinalAnswer(answer_status="partial", summary="The detour has high detour pressure.")
    assert any("managers only" in e for e in closure_claim_errors(ans, rec))


def test_a_named_closure_of_any_reason_reads_with_its_reason():
    row = {
        "element_name": "Jalan Kecil",
        "reason": "works",
        "event_name": "Pipe repair",
        "ends_at": "2026-10-27T17:00:00+08:00",
    }
    assert closure_line(row).endswith("— works (Pipe repair)")
    assert closure_line({**row, "reason": "accident", "event_name": None}).endswith("— accident")


def test_chinese_band_words_count_only_next_to_pressure():
    ok = (
        "Persiaran Tamarind 绕行压力为高，有4个样本出行改道，离中心较远。"
        "Suggestion: signpost the detour."
    )
    assert _check(ok) == []
    bad = "Persiaran Tamarind 的绕行压力为中。Suggestion: signpost the detour."
    assert any("not what the tool" in e for e in _check(bad))


@needs_seed
async def test_a_too_long_course_refusal_can_be_relayed(seed, tmp_path):
    q = "We need to close Persiaran Elmina for road works tomorrow 9 am to 5 pm. What is affected?"
    evs, rec, text = await _ask(seed, tmp_path, q)
    assert evs[-1].model == "mock-scripted" and evs[-1].answer_status == "cannot_answer"
    assert "51 mapped segments" in text and "between" in text
    assert rec.validator_errors == []


def test_a_chinese_answer_gives_its_suggestions_in_chinese():
    zh = (
        "Persiaran Garcinia 道路施工期间，63 个样本出行中有 7 个改道。"
        "Persiaran Tamarind 有 4 个样本出行改道（绕行压力为高）。"
        "可考虑在 Persiaran Tamarind 设置指示牌。"
    )
    assert _check(zh) == []


def test_a_road_name_on_several_stretches_may_carry_each_stretch_band():
    rec = TurnRecord(
        events=[
            {
                **CLOSURE,
                "detour_roads": [
                    {"name": "Unnamed paths", "trips": 39, "pressure": "high"},
                    {"name": "Unnamed paths", "trips": 2, "pressure": "low"},
                ],
            }
        ],
        panel="management",
    )
    ok = "39 sample trips reroute onto Unnamed paths (detour pressure: high)."
    bad = "39 sample trips reroute onto Unnamed paths (detour pressure: medium)."
    claim = Claim(text="Road works", status="indicative", evidence_ids=["ev-closure-x"])
    for text, errs in ((ok, 0), (bad, 1)):
        ans = FinalAnswer(answer_status="answered", summary=text, claims=[claim])
        assert len(closure_claim_errors(ans, rec)) == errs


@needs_seed
async def test_managers_get_the_closure_card_intent_residents_never(seed, tmp_path):
    q = "Road works on Persiaran Garcinia next Tuesday 9 am-5 pm: what is affected?"
    evs, _, _ = await _ask(seed, tmp_path, q)
    cards = [e.intent for e in evs if e.type == "scene.intent" and e.intent.kind == "closure.show"]
    assert len(cards) == 1
    card = cards[0].closure
    assert card is not None and card.trips == [] and card.event.reason == "works"
    assert card.detour_roads and all(r.segment_ids for r in card.detour_roads)
    assert any(c.segment_ids for c in card.event.closures)  # the course, for the map
    evs, _, _ = await _ask(seed, tmp_path, q, panel="resident")
    assert not any(e.type == "scene.intent" and e.intent.kind == "closure.show" for e in evs)


MARATHON_Q = (
    "I want to host a 5 km marathon starting at Elmina Valley Central Park on Sunday 6-10 am. "
    "Which roads should we use and what is affected?"
)


@needs_seed
async def test_a_marathon_is_proposed_on_mapped_roads_and_simulated_for_managers(seed, tmp_path):
    evs, rec, text = await _ask(seed, tmp_path, MARATHON_Q)
    call = next(e for e in evs if e.type == "tool.call" and e.name == "simulate_marathon")
    assert call.args["start"] == "Elmina Valley Central Park" and call.args["distance_km"] == 5
    assert call.args["start_time"] == "6am" and call.args["end_time"] == "10am"
    assert "starts_at" not in call.args  # the window is built after the call event
    assert evs[-1].answer_status == "answered" and rec.validator_errors == []
    assert "Proposed 5.1 km loop course from Elmina Valley Central Park" in text
    assert "not an approved route" in text and "detour pressure: high" in text
    card = next(
        e.intent for e in evs if e.type == "scene.intent" and e.intent.kind == "marathon.show"
    )
    assert card.marathon is not None and card.marathon.impact.trips == []
    assert card.marathon.animation.course_coordinates and card.marathon.course.roads
    assert not any(e.type == "scene.intent" and e.intent.kind == "closure.show" for e in evs)


@needs_seed
async def test_residents_cannot_plan_a_marathon(seed, tmp_path):
    evs, rec, text = await _ask(seed, tmp_path, MARATHON_Q, panel="resident")
    assert "simulate_marathon" not in rec.tool_calls and "pressure" not in text.lower()
    assert not any(e.type == "scene.intent" and e.intent.kind == "marathon.show" for e in evs)


def test_trips_on_the_course_are_said_apart_from_trips_without_a_route():
    from townshiplens_agent.template import event_answer

    out = event_answer({**CLOSURE, "trips_on_course": 4, "trips_newly_no_route": 0}, ["ev"])
    assert any("4 sample trips start or end on the closed road" in c for c in out["caveats"])
    ans = FinalAnswer(**out)
    rec = TurnRecord(events=[{**CLOSURE, "trips_on_course": 4}], panel="management")
    assert closure_claim_errors(ans, rec) == []


def test_a_course_length_is_the_tools_or_the_one_asked_for():
    from townshiplens_agent.validate import course_errors

    rec = TurnRecord(
        marathons=[{"course": {"length_m": 5102.7}, "requested_km": 5}], panel="management"
    )
    claim = Claim(text="course", status="indicative", evidence_ids=["ev"])
    for text, n in (
        ("A proposed 5.1 km loop for your 5 km run.", 0),
        ("A proposed 7.5 km loop.", 1),
    ):
        ans = FinalAnswer(answer_status="answered", summary=text, claims=[claim])
        assert len(course_errors(ans, rec)) == n
