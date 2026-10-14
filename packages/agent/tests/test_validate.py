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


@pytest.mark.parametrize("status", ["blocked", "no_data"])
def test_validator_rejects_answered_for_blocked_or_nodata_route(status):
    r = rec(routes={"rt-1": {}}, route_status={"rt-1": status})
    a = FinalAnswer(
        answer_status="answered",
        summary="Go.",
        route_id="rt-1",
        caveats=["Route status: " + status],
    )
    assert any("answered" in e for e in validate_answer(a, r))
    ok = a.model_copy(update={"answer_status": "partial"})
    assert validate_answer(ok, r) == []


def test_validator_any_partly_unverified_route_needs_caveat_even_without_route_id():
    r = rec(routes={"rt-1": {}}, route_status={"rt-1": "partly_unverified"})
    a = FinalAnswer(answer_status="answered", summary="Done.")
    assert validate_answer(a, r)
    b = a.model_copy(update={"caveats": ["Segment seg-bc not checked yet."]})
    assert validate_answer(b, r) == []


def _flooded(cls="likely_flooded"):
    return rec(
        routes={"rt-1": {}},
        route_status={"rt-1": "confirmed"},
        scenarios_used={"stage_p3m"},
        flooded_endpoints={
            "playground": {
                "flood_class": cls,
                "name": "Urban Park playground",
                "scenario_id": "stage_p3m",
            }
        },
    )


@pytest.mark.parametrize("status", ["answered", "partial"])
def test_validator_requires_caveat_for_likely_flooded_endpoint(status):
    a = FinalAnswer(answer_status=status, summary="Go.", route_id="rt-1", scenario_id="stage_p3m")
    assert any("likely flooded" in e for e in validate_answer(a, _flooded()))
    other = a.model_copy(update={"caveats": ["Some other caveat."]})
    assert validate_answer(other, _flooded())
    for cav in [
        "Urban Park playground is likely flooded in this indicative scenario.",
        "playground: likely flooded",
    ]:
        ok = a.model_copy(update={"caveats": [cav]})
        assert validate_answer(ok, _flooded()) == [], cav


def test_validator_flooded_endpoint_cannot_answer_needs_no_caveat():
    a = FinalAnswer(answer_status="cannot_answer", summary="n/a", scenario_id="stage_p3m")
    assert validate_answer(a, _flooded()) == []


def test_validator_possible_endpoint_requires_caveat_too():
    a = FinalAnswer(
        answer_status="answered", summary="Go.", route_id="rt-1", scenario_id="stage_p3m"
    )
    assert any("possibly flooded" in e for e in validate_answer(a, _flooded("possible")))
    ok = a.model_copy(update={"caveats": ["Urban Park playground may be flooded."]})
    assert validate_answer(ok, _flooded("possible")) == []


@pytest.mark.parametrize("name", ["Taman Selamat", "Safe Haven Hall", "安全公园"])
def test_validator_place_names_do_not_trip_forbidden_words(name):
    r = rec(scenarios_used={"stage_p3m"}, place_names={name})
    a = FinalAnswer(
        answer_status="partial",
        summary=f"{name} is likely flooded.",
        scenario_id="stage_p3m",
        caveats=[f"{name} is likely flooded."],
    )
    assert validate_answer(a, r) == []
    bad = a.model_copy(update={"summary": f"{name} is safe. Selamat."})
    assert any("safe" in e for e in validate_answer(bad, r))
