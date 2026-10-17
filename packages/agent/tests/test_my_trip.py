"""Rehearse my trip (Cycle 19): the assistant on a resident's own rehearsed trip."""

import asyncio
from pathlib import Path

import pytest
from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import AgentSettings
from townshiplens_agent.template import my_trip_answer
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial import tools
from townshiplens_spatial.models import Evidence
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

ROOT = Path(__file__).resolve().parents[3]
TINY = ROOT / "packages/spatial/tests/fixtures/tiny"
SEED = ROOT / "data/seed/elmina"
MOCK = AgentSettings(_env_file=None, llm_provider="mock")

CUT = {
    "status": "rehearsed",
    "scenario": {"id": "storm", "label": "Storm at the school run"},
    "from": {"id": "park-b", "name": "Car Park B"},
    "to": {"id": "sk", "name": "SK Denai Alam"},
    "profile": "stroller",
    "leave": "07:00",
    "stage_at_leave": "stage_p2m",
    "river_changes": [["06:45", "stage_p1m"], ["07:05", "stage_p2m"], ["12:30", None]],
    "normal_minutes": 64,
    "asked": {
        "leave": "07:00",
        "outcome": "very_long",
        "arrive": "12:13",
        "minutes": 313,
        "waited_min": 0,
        "unchecked": 6,
    },
    "cut_by": ["the street on Persiaran Alstonia"],
    "last_ok_leave_before": "06:40",
    "next_clear_leave": "12:30",
    "sweep": [{"leave": "06:40", "outcome": "clear", "arrive": "07:44", "minutes": 64}],
}


def _rec(d=CUT):
    r = TurnRecord(tool_calls=["find_place", "find_place", "rehearse_my_trip"], my_trips=[d])
    r.place_names |= {"Car Park B", "SK Denai Alam", "the street on Persiaran Alstonia"}
    r.scenarios_used.add("stage_p2m")
    r.day_stages.add("stage_p2m")
    r.evidence["ev-mytrip-storm"] = Evidence(
        id="ev-mytrip-storm", element_id="my-trip", attribute="storm trip", status="indicative"
    )
    return r


def _ans(summary, steps=()):
    return FinalAnswer(
        answer_status="answered",
        summary=summary,
        steps=list(steps),
        scenario_id="stage_p2m",
        caveats=["A rehearsal, not a forecast. Follow official MBSA / JPS / NADMA guidance."],
        claims=[Claim(text="trip", status="indicative", evidence_ids=["ev-mytrip-storm"])],
    )


OK = (
    "In the storm rehearsal, a trip leaving at 07:00 found only a very long way round (313 min "
    "instead of 64): the river cut the street on Persiaran Alstonia. It crossed 6 unchecked "
    "stretches."
)


def test_the_template_passes_for_a_cut_trip_and_a_data_gap():
    a = FinalAnswer(**my_trip_answer(CUT, ["ev-mytrip-storm"]))
    assert validate_answer(a, _rec()) == [], validate_answer(a, _rec())
    assert "06:40 or earlier got there" in " ".join(a.steps)
    gap = {**CUT, "status": "no_data", "reason": "no mapped connection on a normal day"}
    a = FinalAnswer(**my_trip_answer(gap, ["ev-mytrip-storm"]))
    assert validate_answer(a, _rec(gap)) == [] and "data gap" in a.summary


def test_honest_wording_passes():
    assert validate_answer(_ans(OK), _rec()) == []


@pytest.mark.parametrize(
    "summary,why",
    [
        (OK + " You should leave by 06:40.", "advise"),
        (OK + " Leave before 06:40.", "advise"),
        (OK + " The best time is 06:40.", "advise"),
        (OK.replace("found only a very long way round", "will get there"), "advise"),
        (OK + " A trip leaving at 06:50 got there at 07:52.", "not in the rehearsal"),
        (OK.replace("313 min", "290 min"), "minutes do not appear"),
        (OK.replace(" It crossed 6 unchecked stretches.", ""), "unchecked"),
        (
            "In the storm rehearsal, a trip leaving at 07:00 got there. It crossed 6 unchecked "
            "stretches.",
            "Say what happened",
        ),
    ],
)
def test_dishonest_trip_answers_are_rejected(summary, why):
    errs = validate_answer(_ans(summary), _rec())
    assert any(why in e for e in errs), errs


def _turn(world, q):
    ctx = tools.Ctx(world=world, vrs=VerificationStore(":memory:"))
    rec = TurnRecord()

    async def go():
        return [e async for e in run_turn(ctx, ChatRequest(message=q), MOCK, record=rec)]

    return asyncio.run(go()), rec


def test_the_mock_rehearses_a_trip_on_the_tiny_world():
    evs, rec = _turn(
        load_world(TINY),
        "In the rehearsal of a normal weekday, what happens to my trip from Car Park B to the "
        "playground leaving at 7:30?",
    )
    assert evs[-1].model == "mock-scripted" and rec.validator_errors == []
    text = "".join(e.delta for e in evs if e.type == "text.delta")
    assert "leaving at 07:30 got there" in text and "not a forecast" in text
    trip = [e.intent for e in evs if e.type == "scene.intent" and e.intent.kind == "day.trip"]
    assert trip and trip[0].day == "weekday" and trip[0].t_min == 450
    kinds = {f["properties"]["kind"] for f in trip[0].geojson["features"]}
    assert {"normal", "trip"} <= kinds


@pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
def test_the_mock_names_the_street_that_cut_a_storm_trip():
    evs, rec = _turn(
        load_world(SEED),
        "In the storm rehearsal, what happens to my trip from Car Park B to SK Denai Alam by car "
        "leaving at 7:30?",
    )
    assert evs[-1].model == "mock-scripted" and rec.validator_errors == []
    text = "".join(e.delta for e in evs if e.type == "text.delta")
    assert "found no way through" in text and "Persiaran Alstonia" in text
    assert "12:30" in text and "06:40" in text
    trip = next(e.intent for e in evs if e.type == "scene.intent" and e.intent.kind == "day.trip")
    assert trip.scenario_id == "stage_p3m" and any(
        f["properties"]["kind"] == "cut" for f in trip.geojson["features"]
    )
    # the map geometry never reaches the model
    from townshiplens_agent.agent import _for_model

    out = _for_model("rehearse_my_trip", {"data": dict(rec.my_trips[0])})
    assert not {"track", "normal_route", "cut_lines"} & set(out["data"])
