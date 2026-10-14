from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial.models import Evidence


def rec(**kw):
    r = TurnRecord()
    r.evidence["ev-seg-ab.step_count"] = Evidence(
        id="ev-seg-ab.step_count",
        element_id="seg-ab",
        attribute="step_count",
        value=0,
        status="verified",
    )
    for k, v in kw.items():
        setattr(r, k, v)
    return r


def test_validator_accepts_cited():
    a = FinalAnswer(
        answer_status="answered",
        summary="Route confirmed.",
        claims=[
            Claim(
                text="No steps on seg-ab", status="verified", evidence_ids=["ev-seg-ab.step_count"]
            )
        ],
    )
    assert validate_answer(a, rec()) == []


def test_validator_rejects_unseen_evidence():
    a = FinalAnswer(
        answer_status="answered",
        summary="x",
        claims=[Claim(text="ramp ok", status="verified", evidence_ids=["ev-made-up"])],
    )
    assert any("ev-made-up" in e for e in validate_answer(a, rec()))


def test_validator_rejects_safe_word_with_scenario():
    r = rec(scenarios_used={"stage_p3m"})
    for word in ["It is safe to go", "Laluan ini selamat", "这条路很安全"]:
        a = FinalAnswer(answer_status="answered", summary=word, scenario_id="stage_p3m")
        assert validate_answer(a, r), word


def test_validator_requires_scenario_id_when_used():
    a = FinalAnswer(answer_status="answered", summary="Centres listed.")
    assert validate_answer(a, rec(scenarios_used={"stage_p3m"}))


def test_validator_requires_caveat_for_partly_unverified():
    r = rec(routes={"rt-1": {}}, route_status={"rt-1": "partly_unverified"})
    a = FinalAnswer(answer_status="answered", summary="Go this way.", route_id="rt-1")
    assert validate_answer(a, r)


def test_validator_rejects_unknown_route_id():
    a = FinalAnswer(answer_status="answered", summary="x", route_id="rt-nope")
    assert validate_answer(a, rec())


import pytest  # noqa: E402


@pytest.mark.parametrize(
    "text",
    [
        "The path is 30cm deep",
        "Air 30 cm dalam di lorong",
        "路上有30cm深的水",
        "水深30厘米深",
        "depth of 1.2 m",
        "a 2 m depth here",
        "it is knee-deep",
        "30 cm of water",
    ],
)
def test_validator_rejects_depth_phrases(text):
    a = FinalAnswer(answer_status="answered", summary=text, scenario_id="stage_p3m")
    assert any("depth" in e for e in validate_answer(a, rec(scenarios_used={"stage_p3m"}))), text


@pytest.mark.parametrize(
    "text", ["A 1.5 m wide path", "Safety first", "This is unsafe", "safe-house"]
)
def test_validator_no_false_positives(text):
    a = FinalAnswer(answer_status="answered", summary=text, scenario_id="stage_p3m")
    assert validate_answer(a, rec(scenarios_used={"stage_p3m"})) == [], text
