from townshiplens_agent.record import TurnRecord
from townshiplens_agent.template import template_answer
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial.models import Evidence


def test_template_always_validates():
    r = TurnRecord(tool_calls=["find_place"])
    a = template_answer(r, "anything")
    assert a.answer_status == "cannot_answer" and validate_answer(a, r) == []


def test_template_partly_unverified_route_validates():
    r = TurnRecord(tool_calls=["find_place"])
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
    assert a.caveats[0].startswith("Not checked yet: Steps on") and "seg-" not in a.caveats[0]
    assert validate_answer(a, r) == []


def test_template_scenario_validates():
    r = TurnRecord(tool_calls=["find_place"])
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
    r = TurnRecord(tool_calls=["find_place"])
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
    r = TurnRecord(tool_calls=["find_place"])
    r.routes["rt-1"] = {}
    a = template_answer(r, "q")
    assert validate_answer(a, r) == []
    assert "None" not in a.summary and a.answer_status == "partial"


@pytest.mark.parametrize("cls", ["likely_flooded", "possible"])
def test_template_flooded_endpoint_caveat(cls):
    r = TurnRecord(tool_calls=["find_place"])
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
    r = TurnRecord(tool_calls=["find_place"])
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
    a = template_answer(TurnRecord(tool_calls=["find_place"]), "Where is the town hall annex?")
    assert a.answer_status == "cannot_answer" and "town hall annex" in a.summary.lower()


def test_cannot_answer_names_missing_attribute():
    r = TurnRecord(tool_calls=["find_place"])
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
    r = TurnRecord(tool_calls=["find_place"])
    r.scenarios_used.add("stage_p3m")
    a = template_answer(r, "Is the playground safe in a flood?")
    assert validate_answer(a, r) == []


def test_template_no_data_route_says_data_gap():
    r = TurnRecord(tool_calls=["plan_route"])
    r.routes["rt-1"] = {"unknowns": []}
    r.route_status["rt-1"] = "no_data"
    a = template_answer(r, "route?")
    text = " ".join([a.summary, *a.caveats])
    assert "No mapped connection" in text and "(data gap)" in text
    assert "unverified" not in text and "blocked" not in text
    assert validate_answer(a, r) == []


def _capped_record(n=12, filed=0):
    r = TurnRecord(tool_calls=["plan_route"])
    r.routes["rt-1"] = {
        "distance_m": 10,
        "unknowns": [
            {"attribute": "step_count", "element_id": f"seg-{i}", "element_label": f"Lane {i}"}
            for i in range(n)
        ],
    }
    r.route_status["rt-1"] = "partly_unverified"
    r.vrs = [
        {"element_id": f"seg-{i}", "attribute": "step_count", "created": True} for i in range(filed)
    ]
    return r


def test_template_caps_unchecked_items_and_counts_items():
    r = _capped_record(12, filed=10)
    a = template_answer(r, "route?")
    text = " ".join(a.caveats)
    assert "Lane 4" in text and "Lane 5" not in text and "seg-" not in text
    assert "and 7 more unchecked items" in text
    assert "Asked the township team to check 10 of the 12 unchecked items." in " ".join(a.caveats)
    assert "staff have been asked" not in " ".join(a.caveats)
    assert validate_answer(a, r) == []


def test_template_claims_no_request_when_none_was_filed():
    a = template_answer(_capped_record(12, filed=0), "route?")
    assert "Asked the township team" not in " ".join(a.caveats)
    assert "and 7 more unchecked items" in " ".join(a.caveats)


def test_template_counts_items_not_segments():
    r = TurnRecord(tool_calls=["plan_route"])
    r.routes["rt-1"] = {
        "unknowns": [
            {"attribute": a, "element_id": f"seg-{i}", "element_label": f"Lane {i}"}
            for i in range(3)
            for a in ("incline_pct", "width_m")
        ]
    }
    r.route_status["rt-1"] = "partly_unverified"
    text = " ".join(template_answer(r, "route?").caveats)
    assert "and 1 more unchecked item" in text and "items" not in text


# --- Task 41 fix round 1 (R30 I-2) ------------------------------------------------------------
def _rest_route(**extra):
    return {
        "distance_m": 222.4,
        "unknowns": [],
        "rest_limit_m": 100,
        "rest_limit_met": False,
        "max_gap_between_rest_m": 111.2,
        "rest_points": [],
        "rest_points_unverified": [],
        **extra,
    }


def test_template_rest_gap_only_route_names_the_gap():
    r = TurnRecord(tool_calls=["plan_route"])
    r.routes["rt-1"] = _rest_route()
    r.route_status["rt-1"] = "partly_unverified"
    a = template_answer(r, "route?")
    assert "Longest stretch without a rest point is about 110 m (limit 100 m)." in a.caveats
    assert not [c for c in a.caveats if "segments are still unverified" in c.lower()]
    assert a.answer_status == "partial" and validate_answer(a, r) == []


def test_template_names_unverified_rest_points():
    r = TurnRecord(tool_calls=["plan_route"])
    r.routes["rt-1"] = _rest_route(
        rest_limit_met=True,
        max_gap_between_rest_m=60.0,
        rest_points=[{"place_id": "b1", "name": "Bench by the pond", "status": "unverified"}],
        rest_points_unverified=["b1"],
    )
    r.route_status["rt-1"] = "partly_unverified"
    a = template_answer(r, "route?")
    assert any("Rest point not checked yet: Bench by the pond" in c for c in a.caveats)
    assert not [c for c in a.caveats if "segments are still unverified" in c.lower()]
    assert validate_answer(a, r) == []


def test_template_still_says_segments_unverified_when_there_are_unknowns():
    r = TurnRecord(tool_calls=["plan_route"])
    r.routes["rt-1"] = _rest_route(unknowns=[{"attribute": "incline_pct", "element_id": "s"}])
    r.route_status["rt-1"] = "partly_unverified"
    a = template_answer(r, "route?")
    assert "Some segments are still unverified." in a.caveats
    assert any(c.startswith("Longest stretch without a rest point") for c in a.caveats)
