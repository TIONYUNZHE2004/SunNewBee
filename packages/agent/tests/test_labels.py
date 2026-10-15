"""Resident-readable wording: labels, notes and honest request counts."""

import pytest
from townshiplens_agent import labels
from townshiplens_agent.answer import FinalAnswer
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.validate import validate_answer


def test_status_labels_are_readable():
    assert labels.status_label("confirmed") == "confirmed"
    assert labels.status_label("partly_unverified") == "partly unverified"
    assert labels.status_label("blocked") == "blocked"
    assert labels.status_label("no_data") == "no mapped connection (data gap)"


@pytest.mark.parametrize("status", ["confirmed", "partly_unverified", "blocked", "no_data"])
def test_validator_accepts_every_readable_label(status):
    rec = TurnRecord(tool_calls=["plan_route"])
    rec.routes["rt-1"] = {"unknowns": []}
    rec.route_status["rt-1"] = status
    caveats = ["Some segments are still unverified."] if status == "partly_unverified" else []
    ok = FinalAnswer(
        answer_status="partial",
        summary=f"Route status: {labels.status_label(status)}",
        route_id="rt-1",
        caveats=caveats,
    )
    assert validate_answer(ok, rec) == []
    other = "blocked" if status != "blocked" else "confirmed"
    bad = ok.model_copy(update={"summary": f"Route status: {labels.status_label(other)}"})
    assert any("contradiction" in e for e in validate_answer(bad, rec))


def test_attribute_and_element_labels():
    assert labels.attribute_label("incline_pct") == "Incline (%)"
    assert labels.attribute_label("flood") == "Flood"
    assert "_" not in labels.attribute_label("some_new_key")
    assert labels.element_label("Jalan Hopea U15/17D", "footway") == "Jalan Hopea U15/17D"
    assert labels.element_label(None, "footway") == "an unnamed footway"
    assert labels.element_label("", "street") == "an unnamed street"
    assert labels.element_label(None, "major_road") == "an unnamed major road"


def test_note_for_a_hard_limit_reads_like_a_sentence():
    u = {
        "element_id": "seg-1",
        "attribute": "incline_pct",
        "why": "stroller needs incline_pct ≤ 8.3; not verified",
    }
    note = labels.unknown_note(u, "Jalan Hopea U15/17D")
    assert note == "Stroller: incline not checked yet (limit 8.3%) on Jalan Hopea U15/17D"
    w = {
        "element_id": "seg-1",
        "attribute": "width_m",
        "why": "wheelchair needs width_m ≥ 0.9; not verified",
    }
    assert labels.unknown_note(w, "an unnamed footway") == (
        "Wheelchair: width not checked yet (minimum 0.9 m) on an unnamed footway"
    )
    s = {
        "element_id": "x",
        "attribute": "step_count",
        "why": "stroller needs step_count ≤ 0; not verified",
    }
    assert labels.unknown_note(s, "Lakeside Walk").startswith("Stroller: steps not checked yet")


@pytest.mark.parametrize(
    "why",
    [
        "major road; sidewalk not verified",
        "major road; sidewalk only reported (one_side), not verified",
        "major road with no sidewalk mapped; walking means the carriageway or verge",
        "possibly flooded in this scenario",
        "something never seen before; _odd_",
    ],
)
def test_notes_never_show_raw_keys_or_ids(why):
    attr = "flood" if "flooded" in why else "sidewalk"
    note = labels.unknown_note({"element_id": "seg-99", "attribute": attr, "why": why}, "Jalan X")
    assert "_" not in note and "seg-" not in note and "not verified" not in note


def _u(i, attr="incline_pct"):
    return {"element_id": f"seg-{i}", "attribute": attr, "why": "x"}


def test_request_sentence_counts_exactly():
    items = [_u(i) for i in range(56)]
    vrs = [{"element_id": f"seg-{i}", "attribute": "incline_pct"} for i in range(10)]
    assert labels.request_sentence(items, vrs) == (
        "Asked the township team to check 10 of the 56 unchecked items."
    )
    assert labels.request_sentence(items[:3], vrs[:3]) == (
        "Asked the township team to check all 3 unchecked items."
    )
    assert labels.request_sentence(items[:1], vrs[:1]) == (
        "Asked the township team to check this item."
    )
    assert labels.request_sentence(items, []) is None  # nothing filed: claim nothing
    flood = [{"element_id": "seg-1", "attribute": "flood", "why": "possibly flooded"}]
    assert labels.request_sentence(flood, vrs) is None  # flood unknowns never file a VR


def test_request_sentence_counts_items_not_segments():
    items = [_u(1, "incline_pct"), _u(1, "width_m"), _u(1, "incline_pct")]  # 2 distinct items
    vrs = [{"element_id": "seg-1", "attribute": "incline_pct"}]
    assert labels.request_sentence(items, vrs) == (
        "Asked the township team to check 1 of the 2 unchecked items."
    )


@pytest.mark.parametrize("named", ["confirmed", "partly_unverified", "blocked", "no_data"])
def test_validator_reads_every_readable_label_as_that_status(named):
    other = "confirmed" if named != "confirmed" else "blocked"
    rec = TurnRecord(tool_calls=["plan_route"])
    rec.routes["rt-1"] = {"unknowns": []}
    rec.route_status["rt-1"] = other
    ans = FinalAnswer(
        answer_status="partial",
        summary=f"Route status: {labels.status_label(named)}",
        route_id="rt-1",
        caveats=["c"],
    )
    assert any("contradiction" in e for e in validate_answer(ans, rec))
