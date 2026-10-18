"""Audit F2 (measurements must come from tools) and F3 (no guarantees or "no risk")."""

import pytest
from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.facts import extract_facts, tool_values, unsupported
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.validate import (
    measurement_errors,
    overclaim_errors,
    payload_numbers,
    validate_answer,
)
from townshiplens_spatial.models import Evidence


def rec():
    r = TurnRecord(tool_calls=["plan_route"])
    r.evidence["ev-1"] = Evidence(
        id="ev-1", element_id="seg-a", attribute="width_m", value=1.5, status="verified"
    )
    r.routes["rt-1"] = {"id": "rt-1", "distance_m": 440.6, "est_minutes": 6.3}
    r.route_status["rt-1"] = "confirmed"
    r.scenarios_used = {"stage_p3m"}  # licenses "+3 m"
    return r


def ans(summary, status="answered"):
    return FinalAnswer(
        answer_status=status,
        summary=summary,
        route_id="rt-1",
        claims=[Claim(text="Width recorded", status="verified", evidence_ids=["ev-1"])],
    )


@pytest.mark.parametrize(
    "text",
    [
        "Route status: confirmed. The route is 440.6 m.",
        "Route status: confirmed. It is about 440 m.",
        "Route status: confirmed. It is under 450 m.",
        "Route status: confirmed. It is about 0.44 km.",
        "Route status: confirmed. Allow about 6 minutes.",
        "Route status: confirmed. The path is 1.5 m wide.",
        "Route status: confirmed. If the river rises +3 m nothing changes here.",
        "Route status: confirmed. 路线约440米，步行约6分钟。",
        "Route status: confirmed. It is about 0.4 km.",
    ],
)
def test_engine_numbers_and_their_roundings_pass(text):
    assert measurement_errors(ans(text), rec()) == []


@pytest.mark.parametrize(
    "text",
    [
        "Route status: confirmed. It is 950 m long.",
        "Route status: confirmed. It takes 2 minutes.",
        "Route status: confirmed. The ramp slope is 5%.",
        "Route status: confirmed. It is 1.2 km.",
        "Route status: confirmed. 路线约900米。",
    ],
)
def test_invented_measurements_are_rejected(text):
    errs = measurement_errors(ans(text), rec())
    assert errs and "do not match this turn's tool results" in errs[0]


def test_place_names_are_not_measured_but_refusals_are():
    # T-001: a refusal licenses no assertion (audit A2 "refusal bypass").
    assert measurement_errors(ans("It is 950 m long.", "cannot_answer"), rec())
    r = rec()
    r.place_names = {"Jalan 3 Km"}
    assert measurement_errors(ans("Route status: confirmed. Via Jalan 3 Km."), r) == []


@pytest.mark.parametrize(
    "text",
    [
        "I guarantee there are no steps.",
        "There is no risk on this route.",
        "The path is totally accessible.",
        "It is completely step-free.",
        "Laluan ini dijamin selesa.",
        "Tiada risiko di laluan ini.",
        "这条路没有危险。",
        "我保证没有台阶。",
        # A4: a negation in an earlier clause does not negate the promise.
        "No steps, so I guarantee this route is accessible.",
        "No steps; I guarantee it.",
        "No steps — guaranteed.",
        "There are no steps I guarantee it.",
        "It isn't steep, and I guarantee it.",
        "Tiada tangga, jadi saya jamin laluan ini sesuai.",
        "没有台阶，所以我保证可以通行。",
        "没有台阶我保证。",
        # A4: paraphrases of "no risk".
        "There is zero risk on this route.",
        "Risk is zero here.",
        "You can go without any risk.",
        "Nothing to worry about.",
        "Risiko sifar di laluan ini.",
        "Sifar risiko.",
        "这条路零风险。",
        "不会有任何风险。",
    ],
)
def test_overclaims_are_rejected(text):
    assert overclaim_errors(text, TurnRecord())


@pytest.mark.parametrize(
    "text",
    [
        "No staff-reported closure is on record. That is not a guarantee.",
        "A closure is a staff report, not a guarantee.",
        "We cannot guarantee the ramp slope.",
        "Kami tidak dapat menjamin cerun tanjakan.",
        "我们无法保证坡度。",
        "We can't guarantee the slope.",
        "This does not guarantee access.",
        "There is no guarantee the lift works.",
        "Ini bukan jaminan.",
        "这不是保证。",
        "我不能做出保证。",
        "No steps are recorded on this route.",
        "The route is confirmed on demo values.",
    ],
)
def test_negated_promises_and_plain_answers_pass(text):
    assert overclaim_errors(text, TurnRecord()) == []


def test_payload_numbers_skip_ids_and_geometry():
    out = payload_numbers(
        {
            "id": "seg-123",
            "route_id": "rt-9",
            "geometry": {"coordinates": [[101.5, 3.18]]},
            "distance_m": 440.6,
            "label": "River +3 m (indicative)",
            "items": [1, 2],
        }
    )
    assert {440.6, 3.0, 2.0} <= out
    assert 101.5 not in out and 123.0 not in out and 9.0 not in out


def test_the_whole_validator_rejects_an_invented_distance():
    errs = validate_answer(ans("Route status: confirmed. It is 950 m long."), rec())
    assert any("950 m" in e for e in errs)


def test_nearest_whole_minute_needs_about():
    # Live check (T-001): the model wrote "about 2 minutes" for a 1.7 min walk.
    r = rec()
    r.routes["rt-1"] = {"id": "rt-1", "distance_m": 119.8, "est_minutes": 1.7}
    assert measurement_errors(ans("Route status: confirmed. About 2 minutes."), r) == []
    assert measurement_errors(ans("Route status: confirmed. It takes 2 minutes."), r)
    assert measurement_errors(ans("Route status: confirmed. Under 2 minutes."), r) == []
    assert measurement_errors(ans("Route status: confirmed. Over 2 minutes."), r)
    assert measurement_errors(ans("Route status: confirmed. About 1 km."), r)  # 0.12 km


# T-001 subject binding (facts.py "Subjects").
def test_zh_segment_counts_are_not_step_counts():
    assert extract_facts("两段无名人行道的台阶未核实。") == []
    assert [(f.kind, f.value) for f in extract_facts("路线有99级台阶。")] == [("steps", 99.0)]
    assert [(f.noun, f.value) for f in extract_facts("有两个厕所。")] == [("toilet", 2.0)]
    assert [(f.noun, f.value) for f in extract_facts("There is one bench.")] == [("bench", 1.0)]


def test_counts_are_of_distinct_things_and_tagged_by_subject():
    unknowns = [
        {"element_id": "seg-1", "attribute": a, "element_label": "an unnamed ramp"}
        for a in ("step_count", "incline_pct", "width_m")
    ]
    v = tool_values({"unknowns": unknowns, "crossings": [{"id": "x"}, {"id": "y"}]})
    assert v["count:ramp"] == {1.0}  # three unchecked facts on one ramp
    assert v["count:crossing"] == {2.0}
    route = {"from_place": "a", "to_place": "b", "distance_m": 440.6, "est_minutes": 6.3}
    tagged = tool_values(route, resolve=lambda pid: {"a": {"parking"}, "b": {"playground"}}[pid])
    assert tagged["length:parking"] == tagged["length:playground"] == {440.6}
    assert "length:toilet" not in tagged
    rows = tool_values({"data": [{"name": "x", "walk_m": 58.5}]}, subject={"toilet"})
    assert rows["count:toilet"] == {1.0} and rows["length:toilet"] == {58.5}


def test_subject_rule_needs_every_named_category():
    values = {"length": {440.6}, "length:parking": {440.6}, "length:playground": {440.6}}
    assert unsupported("From the car park to the playground: 440.6 m.", values) == []
    assert unsupported("The toilet is 440.6 m from the car park.", values) == ["440.6 m"]
    assert unsupported("It is 440.6 m.", values) == []  # no subject named: plain kind rule
