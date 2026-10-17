"""Answers name the crossings a route uses and never invent traffic lights."""

from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.labels import crossing_note
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.template import template_answer
from townshiplens_agent.validate import claims_traffic_lights, validate_answer
from townshiplens_spatial.models import Evidence

SIGNALS = {"element_id": "c1", "name": None, "crossing": "traffic_signals", "status": "reported"}
UNKNOWN = {"element_id": "c2", "name": None, "crossing": None, "status": "unknown"}
MARKED_OK = {"element_id": "c3", "name": None, "crossing": "marked", "status": "verified"}


def test_note_counts_each_type_and_says_map_data_is_not_checked():
    assert crossing_note({"crossings": []}) is None
    assert crossing_note({"crossings": [SIGNALS, UNKNOWN]}) == (
        "This route uses 2 road crossings: 1 with traffic lights (map data, not checked), "
        "1 with no recorded crossing type."
    )
    assert crossing_note({"crossings": [MARKED_OK]}) == (
        "This route uses 1 road crossing: 1 marked, no traffic lights."
    )


def test_negated_mentions_are_not_claims():
    assert claims_traffic_lights("It crosses at a traffic light.")
    assert claims_traffic_lights("Ada lampu isyarat di simpang itu.")
    assert claims_traffic_lights("路口有红绿灯。")
    assert not claims_traffic_lights("1 marked, no traffic lights.")
    assert not claims_traffic_lights("The crossing has no recorded traffic lights.")
    assert not claims_traffic_lights("Tiada lampu isyarat direkodkan.")


def _rec(crossings):
    r = TurnRecord(tool_calls=["plan_route"])
    r.evidence["ev-1"] = Evidence(
        id="ev-1", element_id="seg-a", attribute="step_count", value=0, status="verified"
    )
    route = {"id": "rt-1", "status": "confirmed", "distance_m": 100.0, "crossings": crossings}
    if note := crossing_note(route):
        route["crossing_note"] = note
    r.routes["rt-1"] = route
    r.route_status["rt-1"] = "confirmed"
    return r


def _answer(summary, caveats=()):
    return FinalAnswer(
        answer_status="answered",
        summary=summary,
        route_id="rt-1",
        caveats=list(caveats),
        claims=[Claim(text="No steps", status="verified", evidence_ids=["ev-1"])],
    )


def test_traffic_lights_claimed_without_data_are_rejected():
    errs = validate_answer(
        _answer("Route status: confirmed. Cross at the traffic lights."), _rec([])
    )
    assert any("traffic lights" in e for e in errs)


def test_the_crossing_note_is_required_and_then_accepted():
    r = _rec([SIGNALS, UNKNOWN])
    errs = validate_answer(_answer("Route status: confirmed."), r)
    assert any("crossing" in e for e in errs)
    note = r.routes["rt-1"]["crossing_note"]
    assert validate_answer(_answer("Route status: confirmed.", [note]), r) == []


def test_lights_may_be_named_when_a_crossing_has_them():
    r = _rec([SIGNALS])
    note = r.routes["rt-1"]["crossing_note"]
    a = _answer("Route status: confirmed. You cross once, at traffic lights.", [note])
    assert validate_answer(a, r) == []


def test_the_template_carries_the_note_and_passes_the_validator():
    r = _rec([SIGNALS, UNKNOWN])
    ans = template_answer(r, "wheelchair route?")
    assert r.routes["rt-1"]["crossing_note"] in ans.caveats
    assert validate_answer(ans, r) == []
