"""The demo qualifier is no estimate hedge (demo polish fix round 1, review Important 2).

Only the journey line "No known barrier on the step-free path (demo values, not yet surveyed)."
passes on a route with map estimates, and only when the turn holds placeholder evidence."""

import pytest
from townshiplens_agent.answer import FinalAnswer
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.route_binding import estimate_text_errors
from townshiplens_agent.validate import estimate_claim_errors
from townshiplens_spatial.models import Evidence

JOURNEY_LINE = "No known barrier on the step-free path (demo values, not yet surveyed)."
PROBES = [
    "This route is step-free and wheelchair accessible (demo values, not yet surveyed).",
    "This route is step-free, not yet surveyed.",
    "The whole route is barrier-free and accessible, with demo values for two segments.",
]


def _rec(placeholder: bool) -> TurnRecord:
    rec = TurnRecord()
    rec.routes["rt-1"] = {
        "id": "rt-1",
        "status": "likely_ok",
        "access_metres": {"likely_ok": 400.0},
        "maneuvers": [{"access_level": "likely_ok"}],
    }
    rec.route_status["rt-1"] = "likely_ok"
    if placeholder:
        rec.evidence["ev-seg-1.step_count"] = Evidence(
            id="ev-seg-1.step_count",
            element_id="seg-1",
            attribute="step_count",
            value=0,
            status="verified",
            source_type="team_survey_placeholder",
        )
    return rec


def _ans(line: str) -> FinalAnswer:
    return FinalAnswer(answer_status="partial", summary="Route.", caveats=[line], route_id="rt-1")


@pytest.mark.parametrize("placeholder", [False, True])
@pytest.mark.parametrize("line", PROBES)
def test_demo_phrase_does_not_hedge_access_claims(line, placeholder):
    rec = _rec(placeholder)
    assert estimate_text_errors(line, rec)
    assert estimate_claim_errors(_ans(line), rec)


def test_journey_line_passes_with_placeholder_evidence():
    rec = _rec(placeholder=True)
    assert estimate_text_errors(JOURNEY_LINE, rec) == []
    assert estimate_claim_errors(_ans(JOURNEY_LINE), rec) == []


def test_journey_line_needs_placeholder_evidence():
    rec = _rec(placeholder=False)
    assert estimate_text_errors(JOURNEY_LINE, rec)
    assert estimate_claim_errors(_ans(JOURNEY_LINE), rec)
