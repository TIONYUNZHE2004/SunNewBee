from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial.models import Evidence


def rec(**kw):
    r = TurnRecord(tool_calls=["plan_route"])
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
                text="No steps on Jalan Ab",
                status="verified",
                evidence_ids=["ev-seg-ab.step_count"],
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
    b = a.model_copy(update={"caveats": ["Segment Jalan Bc not checked yet."]})
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


def _ph_rec():
    r = rec()
    r.evidence["ev-ph"] = Evidence(
        id="ev-ph",
        element_id="seg-x",
        attribute="width",
        value=1.2,
        status="verified",
        source_type="team_survey_placeholder",
    )
    return r


def _ph_answer(summary, caveats=()):
    return FinalAnswer(
        answer_status="answered",
        summary=summary,
        caveats=list(caveats),
        claims=[Claim(text="width ok", status="verified", evidence_ids=["ev-ph"])],
    )


def test_placeholder_without_caveat_rejected():
    assert validate_answer(_ph_answer("Route is fine."), _ph_rec())


def test_placeholder_with_caveat_accepted():
    a = _ph_answer("Route is fine.", ["Segment widths are Demo values, not yet surveyed."])
    assert validate_answer(a, _ph_rec()) == []


def test_no_placeholder_unaffected():
    a = FinalAnswer(
        answer_status="answered",
        summary="Staff verified on 2026-10-15.",
        claims=[Claim(text="steps", status="verified", evidence_ids=["ev-seg-ab.step_count"])],
    )
    assert validate_answer(a, rec()) == []


@pytest.mark.parametrize(
    "txt",
    [
        "Staff verified the segments",
        "verified by the team",
        "surveyed on 2026-10-15",
        "verified by our team",
        "facts were verified on 2026-10-15",
        "checked and verified",
        "Staff have verified",
        "team has verified",
        "Verified on 2026-10-15",
        "Staff checked it",
    ],
)
def test_placeholder_rejects_affirmative_verified(txt):
    a = _ph_answer(txt, ["demo values, not yet surveyed"])
    assert validate_answer(a, _ph_rec()), txt


@pytest.mark.parametrize(
    "txt",
    [
        "Route is partly unverified",
        "Not yet verified",
        "unverified",
        "status partly_unverified",
        "segments are not verified",
    ],
)
def test_placeholder_allows_negated_verified(txt):
    a = _ph_answer(txt, ["demo values, not yet surveyed"])
    assert validate_answer(a, _ph_rec()) == []


# --- Task 28: answer-contract hardening -------------------------------------------------


def test_validator_rejects_claim_without_evidence():
    a = FinalAnswer(
        answer_status="answered",
        summary="x",
        claims=[Claim(text="No steps", status="verified", evidence_ids=[])],
    )
    assert any("evidence" in e.lower() for e in validate_answer(a, rec()))


def test_validator_cannot_answer_exempt_from_claim_evidence():
    a = FinalAnswer(
        answer_status="cannot_answer",
        summary="I don't know.",
        claims=[Claim(text="gap", status="unknown", evidence_ids=[])],
    )
    assert validate_answer(a, rec()) == []


@pytest.mark.parametrize(
    "text",
    [
        "Route status: confirmed, 120 m.",
        "The route is confirmed.",
        "The route is blocked.",
        "Route status: no_data",
    ],
)
def test_validator_rejects_contradicting_route_status(text):
    r = rec(routes={"rt-1": {}}, route_status={"rt-1": "partly_unverified"})
    a = FinalAnswer(
        answer_status="partial", summary=text, route_id="rt-1", caveats=["Not checked yet: x"]
    )
    assert any("route status" in e.lower() for e in validate_answer(a, r)), text
    if not text.startswith("Route status"):
        return  # "the route is X" is only checked in the summary's first sentence
    b = FinalAnswer(
        answer_status="partial",
        summary="ok",
        steps=[text],
        route_id="rt-1",
        caveats=["Not checked yet: x"],
    )
    assert any("route status" in e.lower() for e in validate_answer(b, r)), text


def test_validator_accepts_matching_route_status_and_unrelated_confirmed():
    r = rec(routes={"rt-1": {}}, route_status={"rt-1": "partly_unverified"})
    a = FinalAnswer(
        answer_status="partial",
        summary="Route status: partly_unverified. The centre is not confirmed as a PPS.",
        route_id="rt-1",
        caveats=["Not checked yet: x"],
    )
    assert validate_answer(a, r) == []


@pytest.mark.parametrize(
    "text",
    [
        "The segment Jalan Cf is partly_unverified.",
        "no_data for slope on Jalan One.",
        "An alternative route confirmed by staff.",
        "The route is blocked by the flooded playground.",
        "Go ahead. The route is blocked later on.",  # not the first sentence
    ],
)
def test_status_check_ignores_element_level_mentions(text):
    r = rec(routes={"rt-1": {}}, route_status={"rt-1": "confirmed"})
    a = FinalAnswer(answer_status="answered", summary=text, route_id="rt-1")
    assert validate_answer(a, r) == [], text


def test_status_check_catches_space_variant_and_no_route_id():
    r = rec(routes={"rt-1": {}}, route_status={"rt-1": "confirmed"})
    a = FinalAnswer(answer_status="answered", summary="Route status: partly unverified")
    assert any("route status" in e.lower() for e in validate_answer(a, r))


# --- fix round 1: honesty rules hold whether or not a tool ran ---------------------------


def _no_tool_rec():
    return TurnRecord()


def test_no_tool_safe_and_depth_answer_rejected():
    a = FinalAnswer(
        answer_status="answered",
        summary="Yes, Taman Elmina is safe if the river rises 3 m; water there is only 30 cm deep.",
    )
    errs = validate_answer(a, _no_tool_rec())
    assert any("safe" in e for e in errs) and any("depth" in e for e in errs)
    assert any("No tool" in e for e in errs)


def test_no_tool_answer_rejected_but_cannot_answer_ok():
    r = _no_tool_rec()
    assert validate_answer(FinalAnswer(answer_status="partial", summary="Maybe."), r)
    assert validate_answer(FinalAnswer(answer_status="cannot_answer", summary="I can't."), r) == []


def test_forbidden_words_checked_without_scenario():
    a = FinalAnswer(answer_status="answered", summary="This path is safe.")
    assert any("safe" in e for e in validate_answer(a, rec()))


# --- fix round 1: placeholder evidence anywhere in the turn --------------------------------


def _ph_turn():
    r = rec(routes={"rt-1": {}}, route_status={"rt-1": "confirmed"})
    r.evidence["ev-ph"] = Evidence(
        id="ev-ph",
        element_id="seg-ab",
        attribute="width_m",
        value=1.2,
        status="verified",
        source_type="team_survey_placeholder",
    )
    return r


def test_placeholder_uncited_still_blocks_verified_claim():
    a = FinalAnswer(
        answer_status="answered",
        summary="Staff verified every segment; the route is step-free.",
        route_id="rt-1",
        caveats=["demo values, not yet surveyed"],
        claims=[Claim(text="start", status="verified", evidence_ids=["ev-seg-ab.step_count"])],
    )
    assert validate_answer(a, _ph_turn())


def test_placeholder_uncited_route_answer_needs_caveat():
    a = FinalAnswer(
        answer_status="answered",
        summary="Route is step-free.",
        route_id="rt-1",
        claims=[Claim(text="start", status="verified", evidence_ids=["ev-seg-ab.step_count"])],
    )
    assert any("demo values" in e for e in validate_answer(a, _ph_turn()))
    ok = a.model_copy(update={"caveats": ["Segment facts are demo values, not yet surveyed."]})
    assert validate_answer(ok, _ph_turn()) == []


def test_placeholder_uncited_no_route_no_caveat_needed():
    r = rec()
    r.evidence["ev-ph"] = _ph_turn().evidence["ev-ph"]
    a = FinalAnswer(
        answer_status="answered",
        summary="The place exists.",
        claims=[Claim(text="place", status="verified", evidence_ids=["ev-seg-ab.step_count"])],
    )
    assert validate_answer(a, r) == []


def test_raw_element_ids_and_attribute_keys_are_rejected_in_answer_text():
    rec = TurnRecord(tool_calls=["plan_route"])
    for text in (
        "Not checked yet: incline_pct on Jalan X",
        "Not checked yet: Incline (%) on seg-1306543755-2",
        "Stroller needs width_m >= 0.8",
    ):
        ans = FinalAnswer(answer_status="cannot_answer", summary="Nothing.", caveats=[text])
        errs = validate_answer(ans, rec)
        assert any("readable" in e for e in errs), text
    ok = FinalAnswer(
        answer_status="cannot_answer",
        summary="Nothing.",
        caveats=["Not checked yet: Incline (%) on Jalan Hopea U15/17D"],
    )
    assert validate_answer(ok, rec) == []


def test_claim_text_is_checked_for_raw_ids_too():
    rec = TurnRecord(tool_calls=["plan_route"])
    ans = FinalAnswer(
        answer_status="cannot_answer",
        summary="Nothing.",
        claims=[Claim(text="Steps on seg-123-4", status="unknown", evidence_ids=[])],
    )
    assert any("readable" in e for e in validate_answer(ans, rec))


@pytest.mark.parametrize(
    "text",
    [
        "Staff have been asked to check them.",
        "I've asked the team to check.",
        "Asked the township team to check 3 of the 5 unchecked items.",
        "I've noted the gap for the township team.",
    ],
)
def test_asked_wording_needs_a_request_filed_this_turn(text):
    ans = FinalAnswer(answer_status="cannot_answer", summary="Nothing.", caveats=[text])
    assert any("request" in e for e in validate_answer(ans, TurnRecord(tool_calls=["x"])))
    rec = TurnRecord(tool_calls=["x"])
    rec.vrs = [{"element_id": "e", "attribute": "a"}]
    assert not any("request" in e for e in validate_answer(ans, rec))
