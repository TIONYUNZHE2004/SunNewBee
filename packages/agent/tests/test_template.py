from townshiplens_agent.record import TurnRecord
from townshiplens_agent.template import template_answer
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial.models import Evidence


def test_template_always_validates():
    r = TurnRecord()
    a = template_answer(r, "anything")
    assert a.answer_status == "cannot_answer" and validate_answer(a, r) == []


def test_template_partly_unverified_route_validates():
    r = TurnRecord()
    r.evidence["ev-seg-ab.step_count"] = Evidence(
        id="ev-seg-ab.step_count",
        element_id="seg-ab",
        attribute="step_count",
        value=0,
        status="verified",
    )
    r.routes["rt-1"] = {
        "distance_m": 120,
        "unknowns": [{"attribute": "step_count", "element_id": "seg-bc"}],
    }
    r.route_status["rt-1"] = "partly_unverified"
    a = template_answer(r, "route?")
    assert a.answer_status == "partial" and a.route_id == "rt-1"
    assert "seg-bc" in a.caveats[0]
    assert validate_answer(a, r) == []


def test_template_scenario_validates():
    r = TurnRecord()
    r.scenarios_used.add("stage_p3m")
    a = template_answer(r, "x")
    assert a.scenario_id == "stage_p3m" and validate_answer(a, r) == []


import itertools  # noqa: E402

import pytest  # noqa: E402


@pytest.mark.parametrize(
    "status,unknowns,scn",
    list(
        itertools.product(
            ["confirmed", "partly_unverified", "blocked", "no_data"],
            [False, True],
            [False, True],
        )
    ),
)
def test_template_every_status_validates(status, unknowns, scn):
    r = TurnRecord()
    r.evidence["ev-x"] = Evidence(
        id="ev-x", element_id="seg-a", attribute="note", value="safe 30 cm deep", status="verified"
    )
    r.routes["rt-1"] = {
        "distance_m": 50,
        "unknowns": [{"attribute": "step_count", "element_id": "seg-bc"}] if unknowns else [],
    }
    r.route_status["rt-1"] = status
    if scn:
        r.scenarios_used.add("stage_p3m")
    a = template_answer(r, "q")
    assert validate_answer(a, r) == []
    if status != "confirmed":
        assert a.answer_status == "partial" and a.caveats


def test_template_missing_status_and_distance():
    r = TurnRecord()
    r.routes["rt-1"] = {}
    a = template_answer(r, "q")
    assert validate_answer(a, r) == []
    assert "None" not in a.summary and a.answer_status == "partial"


@pytest.mark.parametrize("cls", ["likely_flooded", "possible"])
def test_template_flooded_endpoint_caveat(cls):
    r = TurnRecord()
    r.routes["rt-1"] = {"distance_m": 50, "unknowns": []}
    r.route_status["rt-1"] = "confirmed"
    r.scenarios_used.add("stage_p3m")
    r.flooded_endpoints["playground"] = {
        "flood_class": cls,
        "name": "Urban Park playground",
        "scenario_id": "stage_p3m",
    }
    a = template_answer(r, "q")
    assert validate_answer(a, r) == []
    assert "Urban Park playground" in a.caveats[0]
    if cls == "likely_flooded":
        assert a.answer_status == "partial" and "likely flooded" in a.caveats[0]


def test_template_placeholder_evidence_validates():
    r = TurnRecord()
    r.evidence["ev-ph"] = Evidence(
        id="ev-ph",
        element_id="seg-ab",
        attribute="width",
        value=1.2,
        status="verified",
        source_type="team_survey_placeholder",
    )
    r.routes["rt-1"] = {"distance_m": 50, "unknowns": []}
    r.route_status["rt-1"] = "confirmed"
    a = template_answer(r, "route?")
    assert any("demo values, not yet surveyed" in c for c in a.caveats)
    assert validate_answer(a, r) == []


def test_cannot_answer_names_unresolved_query():
    a = template_answer(TurnRecord(), "Where is the town hall annex?")
    assert a.answer_status == "cannot_answer" and "town hall annex" in a.summary.lower()


def test_cannot_answer_names_missing_attribute():
    r = TurnRecord()
    r.evidence["ev-wp-ewaste.status"] = Evidence(
        id="ev-wp-ewaste.status",
        element_id="wp-ewaste",
        attribute="status",
        value="unknown",
        status="unknown",
    )
    a = template_answer(r, "x")
    assert "status" in a.summary and "wp-ewaste" in a.summary
    assert validate_answer(a, r) == []


def test_cannot_answer_does_not_echo_forbidden_words_in_flood_turn():
    r = TurnRecord()
    r.scenarios_used.add("stage_p3m")
    a = template_answer(r, "Is the playground safe in a flood?")
    assert validate_answer(a, r) == []
