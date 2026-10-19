# ruff: noqa: E501
"""T-021: answer steps come from plan_route maneuvers (contract v1) only."""

import pytest
from tests_support import TINY
from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import _answer_events
from townshiplens_agent.steps import MAX_STEPS, maneuver_errors, maneuver_steps, step_text
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial import tools
from townshiplens_spatial.models import Evidence
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world


def m(index, action, dist, street=None, kind="footway", level="likely_ok", bearing=0.0):
    return {
        "index": index,
        "action": action,
        "distance_m": dist,
        "bearing_deg": bearing,
        "street_name": street,
        "edge_type": kind,
        "access_level": level,
        "rule_id": "paved_path_v1",
        "segment_ids": [] if action == "arrive" else [f"seg-{index}"],
        "point": [101.5, 3.18],
    }


ROUTE = {
    "id": "rt-1",
    "status": "likely_ok",
    "distance_m": 172.2,
    "maneuvers": [
        m(1, "depart", 40.0),
        m(2, "turn_left", 120.4, street="Persiaran Elmina", kind="street", level="unknown"),
        m(3, "cross", 11.8, kind="crossing", level="unknown"),
        m(4, "arrive", 0.0, kind="crossing", level="unknown"),
    ],
}


@pytest.mark.parametrize(
    "lang, first, second",
    [
        (
            "en",
            "Start heading north along the footway for about 40 m (likely OK, estimated from map data).",
            "Turn left onto Persiaran Elmina. Continue about 120 m (not checked yet).",
        ),
        (
            "ms",
            "Mula ke arah utara menyusuri laluan pejalan kaki sejauh kira-kira 40 m (kemungkinan "
            "OK, anggaran daripada data peta).",
            "Belok kiri ke Persiaran Elmina. Teruskan kira-kira 120 m (belum disemak).",
        ),
        (
            "zh",
            "出发，向北，沿人行小路走约40米（可能可行，根据地图数据估计）。",
            "左转进入Persiaran Elmina，走约120米（尚未核实）。",
        ),
    ],
)
def test_steps_follow_the_maneuvers_in_three_languages(lang, first, second):
    steps = maneuver_steps(ROUTE, lang)
    assert steps[0] == first and steps[1] == second
    assert len(steps) == 4


def test_unnamed_stretch_is_named_by_type_and_no_side_or_control_is_invented():
    cross = step_text(m(3, "cross", 11.8, kind="crossing", level="verified"))
    assert cross == "Cross at the crossing, about 12 m."  # no traffic lights, no label if verified
    assert "on your" not in maneuver_steps(ROUTE)[-1]  # no destination side
    assert maneuver_steps({"maneuvers": []}) == [] and maneuver_steps({}) == []


def test_long_routes_keep_eight_lines_and_say_how_many_are_not_listed():
    many = {"maneuvers": [m(i, "continue", 10.0 + i) for i in range(1, 15)] + [m(15, "arrive", 0)]}
    steps = maneuver_steps(many)
    assert len(steps) == MAX_STEPS
    assert steps[-2] == "… 8 more steps are not listed here (shortened directions)."
    assert steps[-1] == "Reach the end of the mapped route."  # never a claimed arrival


# T-021 review: the model never writes a turn or heading (the app renders the steps), so no
# turn can be bound to the wrong street, stretch or occurrence.
@pytest.mark.parametrize(
    "text, problem",
    [
        ("Turn right onto Persiaran Elmina.", "Do not write turns"),
        ("Turn left onto Persiaran Elmina.", "Do not write turns"),  # true, but the app's job
        ("Turn right onto persiaran elmina.", "Do not write turns"),
        ("Turn right onto the footway.", "Do not write turns"),
        ("Bear right onto Persiaran Elmina.", "Do not write turns"),
        ("Belok kanan ke Persiaran Elmina.", "Do not write turns"),
        ("在Persiaran Elmina右转。", "Do not write turns"),
        ("Head north along the footway.", "Do not write turns"),
        ("Walk along Jalan Hopea.", "Jalan Hopea"),
        ("Follow persiaran elmina for 11.8 m.", "11.8 m"),
    ],
)
def test_model_written_directions_are_rejected(text, problem):
    assert problem in " ".join(maneuver_errors(text, ROUTE))


@pytest.mark.parametrize(
    "text",
    [
        "Follow the footway, then Persiaran Elmina.",
        "It runs along Persiaran Elmina for about 120 m.",
        "The route is about 172 m.",
    ],
)
def test_descriptions_from_the_maneuvers_pass(text):
    assert maneuver_errors(text, ROUTE) == []


def _rec():
    rec = TurnRecord(tool_calls=["plan_route"])
    rec.evidence["ev-1"] = Evidence(
        id="ev-1", element_id="seg-1", attribute="access_point", value="n", status="reported"
    )
    rec.routes["rt-1"] = dict(ROUTE)
    rec.route_status["rt-1"] = "likely_ok"
    return rec


def _ans(summary, **kw):
    return FinalAnswer(
        answer_status="partial",
        summary=summary,
        route_id="rt-1",
        caveats=["Likely OK sections are estimated from map data, not checked on site."],
        claims=[Claim(text="Route", status="unverified", evidence_ids=["ev-1"])],
        **kw,
    )


@pytest.mark.parametrize(
    "summary",
    [
        "The route is about 172 m. Turn left onto Persiaran Elmina.",
        "The route is about 172 m and step-free along Persiaran Elmina.",
        "The route is about 172 m along Jalan Hopea.",
    ],
)
def test_validator_rejects_invented_or_overclaimed_steps(summary):
    assert validate_answer(_ans(summary), _rec())


def test_rendered_answer_uses_maneuver_steps_not_model_steps():
    ctx = tools.Ctx(world=load_world(TINY), vrs=VerificationStore(":memory:"))
    ans = _ans("The route is about 172 m (likely OK, estimated from map data).", steps=["Fly."])
    text = "".join(e.delta for e in _answer_events(ans, _rec(), ctx) if e.type == "text.delta")
    assert "Fly." not in text
    assert "1. Start heading north along the footway" in text
    assert "2. Turn left onto Persiaran Elmina" in text


# T-021 review (backend, data/audits/2026-10-20-t021/drive-arrival-chat.json): the real drive
# answer keeps the road-end gap and driving-limit warnings, and never claims a physical arrival.
from townshiplens_agent.events import ChatRequest  # noqa: E402
from townshiplens_agent.memory import SessionMemory  # noqa: E402
from townshiplens_agent.run import run_turn  # noqa: E402
from townshiplens_agent.settings import ROOT, AgentSettings  # noqa: E402

SEED = ROOT / "data/seed/elmina"


@pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
async def test_drive_answer_keeps_engine_warnings_and_mapped_end():
    ctx = tools.Ctx(world=load_world(SEED), vrs=VerificationStore(":memory:"))
    evs = [
        e
        async for e in run_turn(
            ctx,
            ChatRequest(message="Can I drive from Car Park B to the playground?", profile="drive"),
            AgentSettings(_env_file=None, llm_provider="mock"),
            memory=SessionMemory(),
        )
    ]
    text = "".join(e.delta for e in evs if e.type == "text.delta")
    assert "distance and time stop at the road" in text
    assert "legal turn restrictions and changing directions not modelled" in text
    assert "Arrive at your destination" not in text
    assert "Reach the end of the mapped route." in text
