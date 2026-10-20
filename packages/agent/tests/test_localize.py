"""T-019: fixed caveat and staff-check lines are written in the answer's language."""

import pytest
from townshiplens_agent.answer import FinalAnswer
from townshiplens_agent.labels import closure_line, crossing_note, request_sentence
from townshiplens_agent.localize import localize
from townshiplens_agent.run import answer_text

CASES = [
    (
        "Asked the township team to check 6 of the 6 unchecked items.",
        "Pasukan township diminta menyemak 6 daripada 6 item yang belum disemak.",
        "已请社区团队核查6项未核实项目中的6项。",
    ),
    (
        "Asked the township team to check all 7 unchecked items.",
        "Pasukan township diminta menyemak kesemua 7 item yang belum disemak.",
        "已请社区团队核查全部7项未核实的项目。",
    ),
    (
        "Asked the township team to check this item.",
        "Pasukan township diminta menyemak item ini.",
        "已请社区团队核查此项。",
    ),
    (
        "This route uses 2 road crossings: 1 with traffic lights (map data, not checked), "
        "1 with no recorded crossing type.",
        "Laluan ini menggunakan 2 lintasan jalan: 1 dengan lampu isyarat (data peta, belum "
        "disemak), 1 tanpa jenis lintasan direkodkan.",
        "此路线经过2处过街：1处有红绿灯（地图数据，未核实），1处未记录过街类型。",
    ),
    (
        "Route ends at the nearest mapped path to Surau At Taqwa; its entrance is not mapped.",
        "Laluan berakhir di laluan dipetakan terdekat dengan Surau At Taqwa; pintu masuknya "
        "belum dipetakan.",
        "路线终点是离Surau At Taqwa最近的已绘制路径；其入口尚未绘制。",
    ),
    (
        "Not checked yet: Steps, Incline (%) and Width (m) on an unnamed footway (x2)",
        "Belum disemak: Anak tangga, Kecerunan (%) dan Lebar (m) pada laluan pejalan kaki "
        "tanpa nama (x2)",
        "尚未核实：无名人行小路的台阶、坡度（%）、宽度（米） (x2)",
    ),
    ("and 3 more unchecked items", "dan 3 item lagi belum disemak", "另有3项未核实"),
    (
        "Longest stretch without a rest point is about 110 m (limit 100 m).",
        "Regangan terpanjang tanpa tempat rehat ialah kira-kira 110 m (had 100 m).",
        "最长无休息点路段约110米（上限100米）。",
    ),
    (
        "Rest point not checked yet: Urban Park bench 2",
        "Tempat rehat belum disemak: Urban Park bench 2",
        "休息点尚未核实：Urban Park bench 2",
    ),
    (
        "About 352 m follows road centre lines without a mapped sidewalk; sidewalk access is "
        "not verified",
        "Kira-kira 352 m mengikut garis tengah jalan tanpa laluan pejalan kaki dipetakan; akses "
        "laluan pejalan kaki belum disahkan",
        "约352米沿道路中线而行，没有已绘制的人行道；人行道通行情况未核实",
    ),
    (
        "Closed (staff report): Jalan Hopea until 20 Oct 2026 — works",
        "Ditutup (laporan kakitangan): Jalan Hopea hingga 20 Oct 2026 — kerja-kerja",
        "已关闭（工作人员报告）：Jalan Hopea，至20 Oct 2026 — 施工",
    ),
    (
        "Route: route confirmed (on demo values, not yet surveyed).",
        "Route: laluan disahkan (pada nilai demo, belum ditinjau).",
        "Route: 路线已确认（基于演示数据，尚未实地调查）。",
    ),
]


@pytest.mark.parametrize("en,ms,zh", CASES)
def test_fixed_lines_are_translated(en, ms, zh):
    assert localize(en, "ms") == ms
    assert localize(en, "zh") == zh
    assert localize(en, "en") == en


def test_helpers_produce_lines_the_translator_knows():
    """The patterns follow the helpers that write the English lines (labels.py)."""
    unknowns = [{"element_id": "e1", "attribute": "step_count"}]
    vrs = [{"element_id": "e1", "attribute": "step_count"}]
    rows = [{"crossing": "traffic_signals", "status": "reported"}, {"crossing": None}]
    closure = {"element_name": "Jalan Hopea", "ends_at": "2026-10-20T00:00:00", "reason": "works"}
    for line in (
        request_sentence(unknowns, vrs),
        crossing_note({"crossings": rows}),
        closure_line(closure),
    ):
        assert localize(line, "ms") != line and localize(line, "zh") != line


def test_unknown_text_and_names_pass_through():
    assert localize("Taman Selamat is 3 m away.", "ms") == "Taman Selamat is 3 m away."
    assert localize("", "zh") == ""


def test_answer_frame_translates_fixed_caveats_only():
    ans = FinalAnswer(
        answer_status="answered",
        summary="Laluan kira-kira 364 m.",
        caveats=[
            "Asked the township team to check 6 of the 6 unchecked items.",
            "Jalan ini sibuk.",
        ],
    )
    text = answer_text(ans, None, None, "ms")
    assert "Pasukan township diminta menyemak 6 daripada 6" in text
    assert "Asked the township" not in text and "Jalan ini sibuk." in text
    english = answer_text(ans, None, None, "en")
    assert "Asked the township team to check 6 of the 6 unchecked items." in english


# T-019: road_note and crossing_note are required, but a translated note is not a missing one.
ROAD = (
    "About 352 m follows road centre lines without a mapped sidewalk; sidewalk access is not "
    "verified"
)
CROSS = (
    "This route uses 8 road crossings: 5 unmarked (map data, not checked), 3 with no recorded "
    "crossing type."
)


def _road_rec():
    from townshiplens_agent.record import TurnRecord
    from townshiplens_spatial.models import Evidence

    rec = TurnRecord(tool_calls=["plan_route"])
    rec.evidence["ev-1"] = Evidence(
        id="ev-1", element_id="seg-a", attribute="access_point", value="n", status="reported"
    )
    rec.routes["rt-1"] = {
        "id": "rt-1",
        "status": "confirmed",
        "distance_m": 363.8,
        "road_without_mapped_sidewalk_m": 352.0,
        "road_note": ROAD,
        "crossing_note": CROSS,
        "crossings": [{}] * 8,
    }
    rec.route_status["rt-1"] = "confirmed"
    return rec


def _route_answer(*caveats):
    from townshiplens_agent.answer import Claim

    return FinalAnswer(
        answer_status="answered",
        summary="Route status: confirmed. About 364 m.",
        route_id="rt-1",
        caveats=list(caveats),
        claims=[Claim(text="Route", status="unverified", evidence_ids=["ev-1"])],
    )


@pytest.mark.parametrize(
    "caveats, missing",
    [
        ((CROSS,), "road centre lines"),  # road note left out (live T-019 r10)
        ((ROAD,), "road crossing"),
        ((ROAD, CROSS), None),
        ((localize(ROAD, "ms"), localize(CROSS, "zh")), None),  # the app's own lines
        (
            (
                "Sekitar 352 m laluan mengikut tengah jalan raya tanpa kaki lima yang dipetakan.",
                "此路线经过8处过街：5处为无标线过街，3处没有记录过街类型。",
            ),
            None,  # the model's own translations, same numbers (live r02, r10)
        ),
        (("Sekitar 300 m mengikut jalan raya.", CROSS), "road centre lines"),  # wrong number
    ],
)
def test_road_and_crossing_notes(caveats, missing):
    from townshiplens_agent.validate import validate_answer

    errs = [e for e in validate_answer(_route_answer(*caveats), _road_rec()) if "plan_route" in e]
    if missing is None:
        assert errs == []
    else:
        assert errs and missing in " ".join(errs)


def test_crossing_sub_counts_are_crossing_counts():
    from townshiplens_agent.facts import tool_values, unsupported

    v = tool_values({"routes": [{"crossing_note": CROSS, "crossings": [{}] * 8}]})
    assert unsupported("此路线经过8处过街：5处为无标线过街，3处没有记录过街类型。", v) == []
    assert unsupported("There are 4 unmarked crossings.", v) == ["4 unmarked crossings"]


@pytest.mark.parametrize(
    "en,ms,zh",
    [
        (  # the model's own ending (live T-019 r03)
            "About 152 m follows road centre lines without a mapped sidewalk; sidewalk access "
            "is not checked yet.",
            "Kira-kira 152 m mengikut garis tengah jalan tanpa laluan pejalan kaki dipetakan; "
            "akses laluan pejalan kaki belum disahkan.",
            "约152米沿道路中线而行，没有已绘制的人行道；人行道通行情况未核实。",
        ),
        (
            "demo values, not yet surveyed.",
            "Nilai demo, belum ditinjau.",
            "演示数据，尚未实地调查。",
        ),
        (  # joined lines (live T-019 r02)
            "Asked the township team to check 10 of the 27 unchecked items; and 17 more "
            "unchecked items.",
            "Pasukan township diminta menyemak 10 daripada 27 item yang belum disemak; dan 17 "
            "item lagi belum disemak.",
            "已请社区团队核查27项未核实项目中的10项；另有17项未核实。",
        ),
    ],
)
def test_live_variants(en, ms, zh):
    assert localize(en, "ms") == ms and localize(en, "zh") == zh


def test_profile_limits_in_tool_text_are_values():
    from townshiplens_agent.facts import tool_values, unsupported

    v = tool_values({"unknowns": [{"why": "wheelchair needs width_m ≥ 0.9; not verified"}]})
    assert unsupported("宽度至少0.9米。", v) == []  # live T-019 r10
    assert unsupported("The path is 0.7 m wide.", v) == ["0.7 m"]
