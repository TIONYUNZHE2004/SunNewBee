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


# ---- fix round 1 -------------------------------------------------------------------------


def _real_unknowns(edges, profiles, flood_classes=(None, "possible")):
    from townshiplens_spatial.evaluate import evaluate_edge

    for e in edges:
        for p in profiles:
            for fc in flood_classes:
                res, why = evaluate_edge(e, p, fc)
                for u in why if res == "UNKNOWN" else []:
                    yield e, p, u


def _check_recognised(e, p, u):
    kind = labels.classify_why(u)
    assert kind != "fallback", f"evaluate.py wording is no longer understood by labels.py: {u}"
    core = labels.unknown_core(u)
    assert "_" not in core and "not verified" not in core, core
    if kind == "limit":
        assert labels.profile_label(p.id) in core and "(" in core, core


def test_notes_understand_real_evaluate_output_on_the_tiny_fixture():
    from tests_support import TINY
    from townshiplens_spatial.world import load_world

    w = load_world(TINY)
    n = 0
    for e, p, u in _real_unknowns(w.edges.values(), w.profiles.values()):
        _check_recognised(e, p, u)
        n += 1
    assert n > 0


def test_notes_understand_real_evaluate_output_on_a_seed_sample():
    from townshiplens_agent.settings import ROOT
    from townshiplens_spatial.world import load_world

    seed = ROOT / "data/seed/elmina"
    if not (seed / "site.json").exists():
        pytest.skip("Elmina seed not built")
    w = load_world(seed)
    ids = sorted(w.edges)
    sample = [w.edges[i] for i in ids[:: max(1, len(ids) // 500)]]
    strict = [w.profiles[k] for k in ("stroller", "wheelchair", "older_adult_rest")]
    kinds = set()
    for e, p, u in _real_unknowns(sample, strict):
        _check_recognised(e, p, u)
        kinds.add(labels.classify_why(u))
    assert {"limit", "sidewalk_unchecked", "flood"} <= kinds, kinds


def test_notes_understand_every_evaluate_branch_incl_stale_and_sidewalk_variants():
    from townshiplens_agent.settings import ROOT
    from townshiplens_spatial.models import Claim, Edge
    from townshiplens_spatial.profiles import load_profiles

    profiles = load_profiles(ROOT / "config" / "profiles")
    strict = [profiles[k] for k in ("stroller", "wheelchair", "older_adult_rest")]

    def edge(etype, **claims):
        return Edge(
            id="e", type=etype, from_node="a", to_node="b", coords=[[0, 0], [0, 1]],
            length_m=10, claims=claims,
        )  # fmt: skip

    OLD_DATE = "2019-01-01"
    old = Claim(value=3.0, status="verified", verified_at="2019-01-01")
    cases = [
        edge("footway"),
        edge("footway", incline_pct=old, width_m=old, step_count=old),
        edge("footway", incline_pct=Claim(value=3.0, status="reported")),
        edge("major_road"),
        edge("major_road", sidewalk=Claim(value="both", status="reported")),
        edge("major_road", sidewalk=Claim(value="none", status="reported")),
        edge("major_road", sidewalk=Claim(value="both", status="verified", verified_at=OLD_DATE))
    ]  # fmt: skip
    stale_seen = False
    for e, p, u in _real_unknowns(cases, strict + [profiles["default"]]):
        _check_recognised(e, p, u)
        if u.get("reason") == "stale":
            stale_seen = True
            assert "out of date" in labels.unknown_core(u), u
    assert stale_seen


def test_step_limit_zero_reads_naturally_and_limits_are_not_floats():
    u = {
        "element_id": "x", "attribute": "step_count", "reason": "unknown",
        "why": "stroller needs step_count ≤ 0; not verified",
    }  # fmt: skip
    assert labels.unknown_core(u) == "Stroller: steps not checked yet (no steps allowed)"
    w = {
        "element_id": "x",
        "attribute": "width_m",
        "why": "stroller needs width_m ≥ 0.80; not verified",
    }
    assert labels.unknown_core(w) == "Stroller: width not checked yet (minimum 0.8 m)"


def test_stale_sidewalk_and_generic_say_out_of_date():
    u = {"element_id": "x", "attribute": "sidewalk", "reason": "stale",
         "why": "major road; sidewalk not verified"}  # fmt: skip
    assert labels.unknown_core(u) == "Sidewalk: last check is out of date"


def test_duplicate_lines_collapse_and_more_counts_match_the_request_denominator():
    items = [_u(i, "step_count") for i in range(3)] + [_u(i, "width_m") for i in range(3, 9)]
    for it in items:
        it["element_label"] = "an unnamed footway"
    flood = [
        {"element_id": f"f{i}", "attribute": "flood", "element_label": "Lane", "why": "x"}
        for i in range(4)
    ]
    vrs = [{"element_id": it["element_id"], "attribute": it["attribute"]} for it in items]
    out = labels.unchecked_caveats(items + flood, vrs)
    assert out[0] == "Not checked yet: Steps on an unnamed footway (x3)"
    assert "and 4 more unchecked items" in out  # items 6..9 (non-flood), not flood
    assert "and 4 more possibly flooded paths" in out
    assert out[-1] == "Asked the township team to check all 9 unchecked items."
