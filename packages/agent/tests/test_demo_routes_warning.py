"""Codex finding (PR #36 comment 6341828535): a closure / marathon simulation whose sample routes
use demo values must say "demo values, not yet surveyed" (AGENTS.md honesty invariant)."""

from townshiplens_agent.answer import FinalAnswer
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.template import event_answer
from townshiplens_agent.validate import DEMO_ROUTES_WARNING, PLACEHOLDER_CAVEAT, validate_answer

IMPACT = {
    "event": {"name": "Proposed marathon", "reason": "event", "closures": []},
    "trips_total": 63,
    "trips_affected": 7,
    "trips_no_route": 45,
    "trips_no_route_before": 42,
    "trips_newly_no_route": 3,
    "trips_on_course": 0,
    "extra_m_median": 82.5,
    "detour_roads": [],
    "suggestions": [],
    "places_cut_off": [],
    "warnings": [DEMO_ROUTES_WARNING],
}


def _rec(impact) -> TurnRecord:
    rec = TurnRecord()
    rec.events.append(impact)
    return rec


def test_an_answer_dropping_the_demo_warning_is_rejected():
    ans = FinalAnswer(answer_status="answered", summary="7 of 63 sample trips change route.")
    errs = validate_answer(ans, _rec(IMPACT))
    assert any("sample routes use demo values" in e for e in errs)
    ok = FinalAnswer(
        answer_status="answered",
        summary="7 of 63 sample trips change route.",
        caveats=[DEMO_ROUTES_WARNING],
    )
    assert not any("sample routes use demo values" in e for e in validate_answer(ok, _rec(IMPACT)))
    # no demo warning from the engine: no caveat needed
    plain = {**IMPACT, "warnings": []}
    assert not any("sample routes use demo values" in e for e in validate_answer(ans, _rec(plain)))


def test_the_template_carries_the_engine_warning():
    out = event_answer(IMPACT, ["ev-1"])
    assert DEMO_ROUTES_WARNING in out["caveats"]
    assert PLACEHOLDER_CAVEAT in DEMO_ROUTES_WARNING
    assert DEMO_ROUTES_WARNING not in event_answer({**IMPACT, "warnings": []}, ["ev-1"])["caveats"]
