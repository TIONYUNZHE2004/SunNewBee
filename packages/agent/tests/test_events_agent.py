"""T-025: management event answers (simulate_event) and their checks."""

import pytest
from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.event_course import CourseError, course_segments, event_window
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_agent.validate import event_errors
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SEED = ROOT / "data/seed/elmina"
needs_seed = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
STAFF = AgentSettings(
    _env_file=None, llm_provider="mock", assistant_scope="access_flood", turn_timeout_s=600
)
Q = "What if we close Persiaran Garcinia for a marathon 7-11 am?"


@pytest.fixture(scope="module")
def seed():
    return load_world(SEED)


@needs_seed
def test_a_named_road_resolves_to_its_mapped_segments(seed):
    segs = course_segments(seed, ["persiaran garcinia"], None)
    assert segs and all(seed.edges[s].name == "Persiaran Garcinia" for s in segs)


@needs_seed
@pytest.mark.parametrize(
    "road, why",
    [
        ("Jalan Zzyzx Qwerty", "No mapped road"),
        ("Persiaran Hill", "Which road do you mean"),  # Hill Park or Hillpark
        ("Persiaran Elmina", "one event can close at most 40"),  # 51 segments
    ],
)
def test_unknown_ambiguous_or_long_courses_are_asked_about(seed, road, why):
    with pytest.raises(CourseError, match=why):
        course_segments(seed, [road], None)


def test_event_window_is_local_time_and_needs_an_end_after_the_start():
    assert event_window("7", "11 am", "2026-10-25", "Asia/Kuala_Lumpur") == (
        "2026-10-25T07:00:00+08:00",
        "2026-10-25T11:00:00+08:00",
    )
    assert event_window("19:30", "9pm", "2026-10-25", None)[0].startswith("2026-10-25T19:30")
    for args in (("11", "7 am", None), ("7", "11", "25 Oct")):
        with pytest.raises(CourseError):
            event_window(*args, None)


EVENT = {
    "event": {"name": "Marathon"},
    "trips_total": 63,
    "trips_affected": 7,
    "trips_no_route": 45,
    "trips_no_route_before": 42,
    "trips_newly_no_route": 3,
    "per_profile": {"drive": {"trips_total": 21, "trips_affected": 5}},
    "detour_roads": [{"name": "Persiaran Tamarind", "trips": 4}],
    "places_cut_off": [{"id": "p1", "name": "Parking (unnamed, OSM)"}],
    "trips": [{"before_m": 812.0, "after_m": 900.0}],
}


def _check(summary: str) -> list[str]:
    rec = TurnRecord(events=[EVENT], place_names={"Persiaran Tamarind"})
    ans = FinalAnswer(
        answer_status="answered",
        summary=summary,
        claims=[Claim(text="Marathon", status="indicative", evidence_ids=["ev-event-x"])],
    )
    return event_errors(ans, rec)


@pytest.mark.parametrize(
    "summary",
    [
        "7 of 63 sample trips change route and 3 newly have no mapped route.",
        "4 sample trips reroute onto Persiaran Tamarind.",
        "45 trips have no mapped route, 42 of them already before the event (data gaps).",
        "No traffic jams or crowds are modelled.",
    ],
)
def test_event_answer_numbers_from_the_tool_pass(summary):
    assert _check(summary) == []


@pytest.mark.parametrize(
    "summary, why",
    [
        ("12 sample trips change route.", "not in the event simulation"),
        ("45 trips have no mapped route during the marathon.", "before the event"),
        ("Expect traffic jams of 20 minutes on Persiaran Tamarind.", "never predict jams"),
        ("Crowds of 2,000 runners will block the road.", "never predict jams"),
    ],
)
def test_event_answer_inventions_are_rejected(summary, why):
    errs = _check(summary)
    assert errs and any(why in e for e in errs)


@needs_seed
async def test_management_event_question_is_simulated_and_checked(seed, tmp_path):
    ctx = tools.Ctx(world=seed, vrs=VerificationStore(str(tmp_path / "vr.db")))
    rec = TurnRecord()
    req = ChatRequest(message=Q, panel="management")
    evs = [e async for e in run_turn(ctx, req, STAFF, record=rec, memory=SessionMemory())]
    call = next(e for e in evs if e.type == "tool.call" and e.name == "simulate_event")
    assert call.args["road_names"] == ["Persiaran Garcinia"] and call.args["start"] == "7"
    assert "starts_at" not in call.args  # the date is filled in after: recordings stay stable
    text = "".join(e.delta for e in evs if e.type == "text.delta")
    assert evs[-1].model == "mock-scripted" and evs[-1].answer_status == "answered"
    assert "sample trips" in text and "Persiaran Tamarind" in text
    assert "had no mapped route before the event" in text
    assert "Estimate from mapped roads and sample trips, not traffic counts." in text
    # residents cannot run event simulations (scope B+)
    rec = TurnRecord()
    evs = [
        e
        async for e in run_turn(
            ctx, ChatRequest(message=Q), STAFF, record=rec, memory=SessionMemory()
        )
    ]
    assert "simulate_event" not in rec.tool_calls and evs[-1].answer_status == "cannot_answer"
