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
