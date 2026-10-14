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
