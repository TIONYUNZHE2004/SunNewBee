"""The assistant on an Elmina Day rehearsal (Cycle 14): tool, validator, mock and template."""

import asyncio
from pathlib import Path

import pytest
from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import AgentSettings
from townshiplens_agent.template import day_answer
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial import tools
from townshiplens_spatial.models import Evidence
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

TINY = Path(__file__).resolve().parents[2] / "spatial" / "tests" / "fixtures" / "tiny"
DAY = {
    "scenario": {"id": "weekday", "label": "A normal weekday", "summary": "x"},
    "residents": 5000,
    "trips": 9380,
    "outcomes": {
        "on_time": 9203,
        "late": 14,
        "cancelled": 0,
        "turned_back": 0,
        "stranded": 0,
        "data_gap": 163,
    },
    "groups": [
        {
            "label": "Older residents (65+)",
            "residents": 464,
            "on_time": 400,
            "late": 13,
            "cancelled": 0,
            "turned_back": 0,
            "stranded": 0,
            "data_gap": 3,
            "stayed_home": 48,
            "could_not_make_a_trip": 0,
        }
    ],
    "school": {"pupils": 1373, "on_time": 1339, "late": 1, "cancelled": 0},
    "busiest_places": [],
    "river_stages": [],
}


def _rec():
    r = TurnRecord(tool_calls=["day_rehearsal"], days=[DAY])
    r.place_names |= {"Older residents (65+)"}
    r.evidence["ev-day-weekday"] = Evidence(
        id="ev-day-weekday", element_id="day", attribute="weekday", status="indicative"
    )
    return r


def _ans(summary, caveats=("Residents are synthetic: a rehearsal, not a forecast.",)):
    return FinalAnswer(
        answer_status="answered",
        summary=summary,
        caveats=list(caveats),
        claims=[Claim(text="rehearsal", status="indicative", evidence_ids=["ev-day-weekday"])],
    )


def test_the_template_answer_passes_the_validator():
    a = FinalAnswer(**day_answer(DAY, ["ev-day-weekday"]))
    assert validate_answer(a, _rec()) == []


@pytest.mark.parametrize(
    "summary,caveats,why",
    [
        ("In this rehearsal 14 trips were late.", ["Not a forecast."], "synthetic"),
        ("In this rehearsal of synthetic residents 14 trips were late.", [], "not a forecast"),
        ("In this rehearsal of synthetic residents 25 trips were late.", None, "do not appear"),
        (
            "In this rehearsal of synthetic residents, 14 older residents will be stranded.",
            None,
            "does not predict",
        ),
    ],
)
def test_a_rehearsal_answer_must_be_honest_about_what_it_is(summary, caveats, why):
    a = _ans(summary) if caveats is None else _ans(summary, caveats)
    assert any(why in e for e in validate_answer(a, _rec())), validate_answer(a, _rec())


def test_the_mock_answers_a_rehearsal_question_end_to_end():
    w = load_world(TINY)
    ctx = tools.Ctx(world=w, vrs=VerificationStore(":memory:"))
    rec = TurnRecord()

    async def go():
        return [
            e
            async for e in run_turn(
                ctx,
                ChatRequest(message="What happens on a normal weekday rehearsal?"),
                AgentSettings(_env_file=None, llm_provider="mock"),
                record=rec,
            )
        ]

    evs = asyncio.run(go())
    assert evs[-1].model == "mock-scripted" and rec.validator_errors == []
    text = "".join(e.delta for e in evs if e.type == "text.delta")
    assert "synthetic" in text and "not a forecast" in text
    assert any(e.type == "citation" and e.evidence_id == "ev-day-weekday" for e in evs)


GAP = "; 163 had no mapped connection (data gap)."


@pytest.mark.parametrize(
    "summary",
    [
        "In this rehearsal of synthetic residents 0 were stranded and 14 trips were late" + GAP,
        "In this rehearsal of synthetic residents no one was stranded" + GAP,
        "Between 7:25 and 8:00am in the rehearsal of synthetic residents, 14 trips were late" + GAP,
        "In this rehearsal of synthetic residents, residents aged 65 and over: 48 stayed home"
        + GAP,
        "In this rehearsal of synthetic residents 464 - 400 = 64 older residents were not on time"
        + GAP,
        "In this rehearsal of synthetic residents over 2 hours, 14 trips were late" + GAP,
    ],
)
def test_honest_rehearsal_wording_passes(summary):
    assert validate_answer(_ans(summary), _rec()) == []


@pytest.mark.parametrize(
    "summary,why",
    [
        ("In this rehearsal of synthetic residents 14 trips were late.", "data gap"),
        ("In this rehearsal of synthetic residents, three out of 464 were late" + GAP, "digits"),
        ("In this rehearsal of synthetic residents 14% of trips were late" + GAP, "digits"),
        ("In this rehearsal of synthetic residents 5.000 residents moved" + GAP, "digits"),
        (
            "In this rehearsal of synthetic residents, real people will be affected tomorrow" + GAP,
            "does not predict",
        ),
    ],
)
def test_dishonest_rehearsal_wording_is_rejected(summary, why):
    errs = validate_answer(_ans(summary), _rec())
    assert any(why in e for e in errs), errs


def test_a_storm_rehearsal_sets_the_map_stage_without_the_model_naming_it():
    """Live smoke test (Cycle 15): the model never sets scenario_id for a rehearsal, so the
    validator must not ask for it, and the map still shows the rehearsal's peak stage."""
    seed = Path(__file__).resolve().parents[3] / "data" / "seed" / "elmina"
    w = load_world(seed)
    ctx = tools.Ctx(world=w, vrs=VerificationStore(":memory:"))
    rec = TurnRecord()

    async def go():
        q = "What happens to residents in the storm rehearsal?"  # the management starter chip
        s = AgentSettings(_env_file=None, llm_provider="mock")
        return [e async for e in run_turn(ctx, ChatRequest(message=q), s, record=rec)]

    evs = asyncio.run(go())
    assert evs[-1].model == "mock-scripted" and rec.validator_errors == []
    assert rec.day_stages == {"stage_p3m"}
    assert any(
        e.type == "scene.intent"
        and e.intent.kind == "flood.set_level"
        and e.intent.scenario_id == "stage_p3m"
        for e in evs
    )
    text = "".join(e.delta for e in evs if e.type == "text.delta")
    assert "data gap" in text and "not a forecast" in text
    a = FinalAnswer(**{**day_answer(rec.days[0], ["ev-day-storm"]), "scenario_id": None})
    assert not any("scenario_id" in e for e in validate_answer(a, rec))


@pytest.mark.parametrize("day", ["Storm", " STORM "])
def test_the_day_argument_is_normalised(day):
    ctx = tools.Ctx(world=load_world(TINY), vrs=VerificationStore(":memory:"))
    a = tools.TOOLS["day_rehearsal"](ctx, day=day)
    b = tools.TOOLS["day_rehearsal"](ctx, day="storm")
    assert a.ok == b.ok and a.warnings == b.warnings


@pytest.mark.parametrize(
    "q",
    [
        "Stroller route from Car Park B to the playground on a normal weekday",
        "Which changes would help most on a normal weekday?",
    ],
)
def test_the_mock_does_not_treat_other_questions_as_a_rehearsal(q):
    import re

    from townshiplens_agent.mock import _DAY

    assert not re.search(_DAY, q.lower())
