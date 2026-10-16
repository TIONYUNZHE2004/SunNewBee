"""Cycles 5-6 review: the honesty rules hold in Bahasa Melayu and Chinese too.

Every case here was reproduced against the validator before the fix (review findings A1-A9, B1,
C2). A rule that only bites in English lets a translated answer cross the line."""

import pytest
from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.validate import text_errors, validate_answer
from townshiplens_spatial.models import Evidence

PARK = "Elmina Urban Park"


def _rec(**kw):
    r = TurnRecord(tool_calls=["plan_route"])
    r.evidence["ev-a"] = Evidence(
        id="ev-a", element_id="seg-a", attribute="step_count", value=0, status="verified"
    )
    for k, v in kw.items():
        setattr(r, k, v)
    return r


def _placeholder_rec(**kw):
    r = _rec(**kw)
    r.evidence["ev-p"] = Evidence(
        id="ev-p",
        element_id="seg-p",
        attribute="incline_pct",
        value=3,
        status="verified",
        source_type="team_survey_placeholder",
    )
    return r


def _ans(summary, caveats=(), **kw):
    return FinalAnswer(
        answer_status=kw.pop("answer_status", "answered"),
        summary=summary,
        caveats=list(caveats),
        claims=[Claim(text="x", status="verified", evidence_ids=["ev-a"])],
        **kw,
    )


def _flooded(cls):
    return _rec(
        routes={"rt-1": {}},
        route_status={"rt-1": "confirmed"},
        scenarios_used={"stage_p3m"},
        flooded_endpoints={"park": {"flood_class": cls, "name": PARK, "scenario_id": "stage_p3m"}},
    )


# A1: a likely-flooded endpoint keeps its strength in every language.
@pytest.mark.parametrize(
    "caveat",
    [
        f"{PARK} is possibly flooded in this indicative scenario.",
        f"{PARK} mungkin dinaiki air dalam senario indikatif ini.",
        f"{PARK} kemungkinan dilanda air.",
        f"{PARK}可能被淹（指示性情景）。",
        f"{PARK}可能受淹（likely flooded）。".replace("likely flooded", "可能"),
    ],
)
def test_likely_flooded_endpoint_cannot_be_weakened(caveat):
    a = _ans("Go.", [caveat], route_id="rt-1", scenario_id="stage_p3m")
    assert any("likely flooded" in e for e in validate_answer(a, _flooded("likely_flooded")))


@pytest.mark.parametrize(
    "caveat",
    [
        f"{PARK} is likely flooded in this indicative scenario.",
        f"{PARK} besar kemungkinan dinaiki air dalam senario indikatif ini.",
        f"{PARK}很可能被淹（指示性情景）。",
    ],
)
def test_likely_flooded_endpoint_in_each_language(caveat):
    a = _ans("Go.", [caveat], route_id="rt-1", scenario_id="stage_p3m")
    assert validate_answer(a, _flooded("likely_flooded")) == []


def test_possibly_flooded_endpoint_accepts_the_weaker_words():
    a = _ans("Go.", [f"{PARK} mungkin dinaiki air."], route_id="rt-1", scenario_id="stage_p3m")
    assert validate_answer(a, _flooded("possible")) == []


# A2: demo values are never called verified, in any language.
@pytest.mark.parametrize(
    "text",
    [
        "Laluan ini telah disahkan oleh kakitangan.",
        "Cerun ini sudah disahkan.",
        "这条路线已由工作人员核实。",
        "坡度已核实。",
        "这段路经核实没有台阶。",
    ],
)
def test_demo_values_are_not_called_verified_in_bm_or_zh(text):
    assert any("Placeholder" in e for e in text_errors(text, _placeholder_rec()))


@pytest.mark.parametrize(
    "text",
    [
        "Status laluan: disahkan (pada nilai demo, belum ditinjau).",
        "Segmen ini belum disahkan.",
        "这段路未经核实。",
        "坡度尚未核实，演示数据，尚未实地调查。",
        "这段路没有核实过。",
    ],
)
def test_negated_or_demo_qualified_wording_is_allowed(text):
    assert not any("Placeholder" in e for e in text_errors(text, _placeholder_rec()))


# A3: guesses and reassurance, and the false positives the old patterns had.
@pytest.mark.parametrize(
    "text",
    [
        "Laluan ini mungkin boleh dilalui.",
        "Barangkali ada tanjakan.",
        "Laluan ini sepatutnya boleh dilalui.",
        "Tak perlu risau.",
        "这条路线可能可以通过。",
        "应该可以通行。",
        "The ramp might be fine.",
    ],
)
def test_guesses_are_rejected_in_every_language(text):
    assert any("reassure" in e for e in text_errors(text, _rec()))


@pytest.mark.parametrize(
    "text",
    [
        "Tiada masalah yang dilaporkan untuk laluan ini.",
        "这并不代表没问题。",
        f"{PARK} mungkin dinaiki air.",
        f"{PARK}可能被淹。",
        "该路段可能有台阶，尚未核实。",
    ],
)
def test_honest_uncertainty_is_not_reassurance(text):
    assert not any("reassure" in e for e in text_errors(text, _rec()))


# A4: the "entrance is not mapped" note must stay a warning.
NOTE = f"Route ends at the nearest mapped path to {PARK}; its entrance is not mapped."


@pytest.mark.parametrize(
    "caveat",
    [
        f"Use the {PARK} entrance by the lake, it has a ramp.",
        f"Pintu masuk {PARK} ada tanjakan.",
        f"{PARK}的入口在湖边。",
    ],
)
def test_entrance_note_cannot_become_a_positive_claim(caveat):
    a = _ans("Route found.", [caveat], answer_status="partial")
    assert any("plan_route warned" in e for e in validate_answer(a, _rec(inferred_notes=[NOTE])))


@pytest.mark.parametrize(
    "caveat",
    [
        NOTE,
        f"Laluan berakhir di laluan terdekat ke {PARK}; pintu masuknya belum dipetakan.",
        f"路线终点是离 {PARK} 最近的步行道；公园入口尚未在地图上标注。",
        f"The route stops near {PARK}: its entrance is not mapped yet.",
    ],
)
def test_entrance_note_in_each_language(caveat):
    a = _ans("Route found.", [caveat], answer_status="partial")
    assert not any(
        "plan_route warned" in e for e in validate_answer(a, _rec(inferred_notes=[NOTE]))
    )


# A5: the route status cannot be contradicted in BM or Chinese.
@pytest.mark.parametrize(
    "summary", ["Status laluan: disahkan. Pergi ikut jalan ini.", "路线状态：已确认。走这条路。"]
)
def test_status_contradiction_in_bm_and_zh(summary):
    r = _rec(routes={"rt-1": {}}, route_status={"rt-1": "partly_unverified"})
    a = _ans(summary, ["Segmen X belum disahkan."], route_id="rt-1")
    assert any("contradiction" in e for e in validate_answer(a, r))


@pytest.mark.parametrize("summary", ["Laluan disahkan. Ikut jalan ini.", "路线已确认。走这条路。"])
def test_demo_route_cannot_be_plainly_confirmed_in_bm_or_zh(summary):
    r = _placeholder_rec(
        routes={"rt-1": {"demo_evidence": True}}, route_status={"rt-1": "confirmed"}
    )
    a = _ans(summary, ["Nilai demo, belum ditinjau."], route_id="rt-1")
    assert any("placeholder (demo)" in e for e in validate_answer(a, r))


# A6: simulation numbers are checked whatever the language.
def _whatif_rec():
    return _rec(
        tool_calls=["simulate_what_if"],
        what_ifs=[
            {
                "summary": {
                    "total": 50,
                    "reach_before": 44,
                    "reach_after": 45,
                    "confirmed_before": 8,
                    "confirmed_after": 9,
                    "changed": 1,
                },
                "imagined": True,
            }
        ],
    )


@pytest.mark.parametrize(
    "summary",
    [
        "Dalam simulasi ini, 46 daripada 50 perjalanan akan sampai.",
        "在这个模拟中，50次行程中有46次可以到达。",
    ],
)
def test_whatif_numbers_are_checked_in_bm_and_zh(summary):
    errs = validate_answer(_ans(summary), _whatif_rec())
    assert any("do not appear" in e for e in errs), errs


@pytest.mark.parametrize(
    "summary",
    [
        "Dalam simulasi ini, 45 daripada 50 perjalanan akan sampai; 9 akan disahkan.",
        "在这个模拟中，50次行程中有45次可以到达（河水 +3 m 不在此模拟中）。",
    ],
)
def test_whatif_numbers_from_the_result_pass_in_bm_and_zh(summary):
    errs = validate_answer(_ans(summary), _whatif_rec())
    assert not any("do not appear" in e for e in errs), errs


# A7: water depths in BM and Chinese.
@pytest.mark.parametrize(
    "text", ["kedalaman 0.5 m", "air sedalam 30 cm", "水深30厘米", "深度约0.5米", "水齐膝深"]
)
def test_depths_are_rejected_in_bm_and_zh(text):
    assert any("depth" in e for e in text_errors(text, _rec()))


# B1: path segments are never counted as places.
def test_place_counts_come_from_the_place_count():
    r = _rec(
        tool_calls=["affected_places"],
        affected=[
            {
                "likely_place_count": 35,
                "likely_path_count": 2468,
                "possible_place_count": 20,
                "possible_path_count": 556,
            }
        ],
    )
    bad = _ans("At +5 m, 2,503 places are likely cut off.", scenario_id="stage_p5m")
    assert any("places" in e and "path segments" in e for e in validate_answer(bad, r))
    good = _ans(
        "At +5 m, 35 places and 2,468 path segments are likely flooded.", scenario_id="stage_p5m"
    )
    assert not any("path segments" in e for e in validate_answer(good, r))


# C2: leaked tool-call markup or internal ids never reach a resident.
@pytest.mark.parametrize(
    "text",
    [
        '</summary>\n<parameter name="claims">[{"evidence_ids": ["ev-scn-stage_p3m"]}]',
        "See ev-scn-stage_p3m for details.",
        "Your ticket vr-0012 was filed.",
        "Route rt-3f2a is the best.",
    ],
)
def test_leaked_markup_and_ids_are_rejected(text):
    assert any("Write for residents" in e for e in text_errors(text, _rec()))
