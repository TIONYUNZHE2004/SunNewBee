"""The assistant on an Elmina Day rehearsal (Cycle 14): tool, validator, mock and template."""

import asyncio
import re
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
                AgentSettings(_env_file=None, llm_provider="mock", assistant_scope="all"),
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
        # review C16: no blanket sums, no "over N" escape, no percent or number words
        ("In this rehearsal of synthetic residents 150 residents could not go" + GAP, "appear"),
        ("In this rehearsal of synthetic residents 27 trips were late" + GAP, "appear"),
        (
            "In this rehearsal of synthetic residents over 3000 residents could not go" + GAP,
            "appear",
        ),
        ("In this rehearsal of synthetic residents 3000+ trips were lost" + GAP, "appear"),
        ("In this rehearsal of synthetic residents about 25 percent were late" + GAP, "digits"),
        ("In this rehearsal of synthetic residents twenty trips were late" + GAP, "digits"),
        ("In this rehearsal of synthetic residents a third of residents were late" + GAP, "digits"),
        ("In this rehearsal of synthetic residents 464 - 400 = 70 were late" + GAP, "appear"),
        (
            "In this rehearsal of synthetic residents, residents may be stranded tomorrow" + GAP,
            "does not predict",
        ),
        (
            "In this rehearsal of synthetic residents, pupils won't get to school" + GAP,
            "does not predict",
        ),
        (
            "In this rehearsal of synthetic residents 14 trips were late; there is no data gap.",
            "data gap",
        ),
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
        s = AgentSettings(_env_file=None, llm_provider="mock", assistant_scope="all")
        return [e async for e in run_turn(ctx, ChatRequest(message=q), s, record=rec)]

    evs = asyncio.run(go())
    assert evs[-1].model == "mock-scripted" and rec.validator_errors == []
    assert rec.day_stages == {"stage_p3m"}
    # day.show carries the stage; no separate flood.set_level (review C16: restore on close)
    assert not any(e.type == "scene.intent" and e.intent.kind == "flood.set_level" for e in evs)
    shows = [e.intent for e in evs if e.type == "scene.intent" and e.intent.kind == "day.show"]
    assert [(i.day, i.t_min, i.scenario_id) for i in shows] == [("storm", 7 * 60 + 25, "stage_p3m")]
    text = "".join(e.delta for e in evs if e.type == "text.delta")
    assert "data gap" in text and "not a forecast" in text
    assert re.search(r"\d,\d{3} trips", text) and "river rising to +3 m" in text
    steps = [ln for ln in text.splitlines() if ln[:2] in ("1.", "2.")]
    assert steps[0].startswith("1. School:") and steps[1].startswith("2. Teenagers:"), steps
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


def test_the_template_skips_empty_or_unlabelled_groups():
    d = {
        **DAY,
        "groups": [*DAY["groups"], {"label": "Empty", "residents": 0, "late": 2}, {"late": 1}],
    }
    a = FinalAnswer(**day_answer(d, ["ev-day-weekday"]))
    assert not any("Empty" in x or "of 0" in x for x in a.steps), a.steps


# Cycle 17: the assistant tests an imagined change on a rehearsal (day_test_change).
CHANGE = {
    "scenario": {"id": "storm", "label": "Storm at the school run"},
    "option": 1,
    "change": "Imagine the flooded stretch on Jalan Sungai Buloh (about 931 m) raised so it "
    "never floods in any scenario (best case)",
    "why": "on the usual route of 1129 residents whose trips the water cut",
    "options": [
        {"option": 1, "change": "Imagine A raised", "why": "x", "residents_relying": 1129},
        {"option": 2, "change": "Imagine B raised", "why": "y", "residents_relying": 247},
    ],
    "residents_better": 823,
    "residents_worse": 0,
    "trips_better": 1645,
    "trips_worse": 0,
    "groups": [
        {"label": "Households without a car", "residents": 442, "better_off": 80, "worse_off": 0}
    ],
    "river_stages": ["stage_p1m", "stage_p3m"],
}


def _crec():
    r = TurnRecord(tool_calls=["day_test_change"], day_changes=[CHANGE])
    r.place_names |= {"Households without a car", CHANGE["change"], CHANGE["why"]}
    r.evidence["ev-daychange-storm-1"] = Evidence(
        id="ev-daychange-storm-1", element_id="day", attribute="storm change 1", status="indicative"
    )
    return r


def _cans(
    summary, caveats=("Imagined change on a rehearsal of synthetic residents, not a forecast.",)
):
    return FinalAnswer(
        answer_status="answered",
        summary=summary,
        caveats=list(caveats),
        claims=[Claim(text="change", status="indicative", evidence_ids=["ev-daychange-storm-1"])],
    )


def test_the_change_template_passes_the_validator():
    from townshiplens_agent.template import day_change_answer

    a = FinalAnswer(**day_change_answer(CHANGE, ["ev-daychange-storm-1"]))
    assert validate_answer(a, _crec()) == []
    assert "823 residents would be better off and 0 worse off" in a.summary
    assert any("(option 2)" in s for s in a.steps)


@pytest.mark.parametrize(
    "summary,why",
    [
        (
            "Raising it would help 823 residents and 0 would be worse off. Not a forecast.",
            "imagined",
        ),
        ("Raising it will be built next year: 823 residents better off.", "not a plan"),
        ("In this imagined change, 900 residents would be better off.", "appear"),
        ("In this imagined change, most of the residents would be better off.", "digits"),
        # live smoke test C17: only option 1 was tested, so it is not "the best"
        ("The change that would help most: 823 residents would be better off.", "top suggestion"),
        ("This is the best change: 823 residents would be better off.", "top suggestion"),
    ],
)
def test_dishonest_change_answers_are_rejected(summary, why):
    errs = validate_answer(
        _cans(summary, [] if why == "imagined" else _cans.__defaults__[0]), _crec()
    )
    assert any(why in e for e in errs), errs


def test_the_assistant_tests_a_change_end_to_end_on_the_seed():
    seed = Path(__file__).resolve().parents[3] / "data" / "seed" / "elmina"
    ctx = tools.Ctx(world=load_world(seed), vrs=VerificationStore(":memory:"))
    rec = TurnRecord()

    async def go():
        q = "Which change would help most residents in the storm rehearsal?"
        s = AgentSettings(_env_file=None, llm_provider="mock", assistant_scope="all")
        return [e async for e in run_turn(ctx, ChatRequest(message=q), s, record=rec)]

    evs = asyncio.run(go())
    assert evs[-1].model == "mock-scripted" and rec.validator_errors == []
    kinds = [e.intent.kind for e in evs if e.type == "scene.intent"]
    assert kinds == ["day.show", "whatif.diff"], kinds  # day.show first, or it clears the diff
    diff = next(
        e.intent.geojson for e in evs if e.type == "scene.intent" and e.intent.kind == "whatif.diff"
    )
    assert diff and diff["features"]
    assert any(e.type == "disclaimer" and e.lens == "whatif" for e in evs)
    text = "".join(e.delta for e in evs if e.type == "text.delta")
    assert "residents would be better off" in text and "not a forecast" in text
    # the map geometry never reaches the model
    from townshiplens_agent.agent import _for_model

    out = _for_model("day_test_change", {"data": dict(rec.day_changes[0])})
    assert "changed_geojson" not in out["data"]


def test_day_test_change_rejects_an_unknown_option():
    ctx = tools.Ctx(world=load_world(TINY), vrs=VerificationStore(":memory:"))
    r = tools.TOOLS["day_test_change"](ctx, day="weekday", option=99)
    assert not r.ok and "option must be 1 to" in r.warnings[0]


def test_suggested_changes_never_read_the_same_twice():
    ctx = tools.Ctx(world=load_world(TINY), vrs=VerificationStore(":memory:"))
    c = tools.day_changes(ctx, "weekday").data["candidates"]
    pairs = [(x["label"], x["why"]) for x in c]
    assert len(pairs) == len(set(pairs)), pairs


def test_the_mock_keeps_fixit_questions_apart_from_day_changes():
    import re

    from townshiplens_agent.mock import _DAY_CHANGE

    assert not re.search(
        _DAY_CHANGE, "which 2 changes would help wheelchair users most on everyday trips?"
    )
    assert re.search(_DAY_CHANGE, "what if we raise the flooded road in the storm rehearsal?")


def test_day_show_goes_before_a_model_written_diff():
    """Live smoke test C17: the model wrote whatif.diff itself; day.show must still come first."""
    from townshiplens_agent.events import SceneIntent
    from townshiplens_agent.run import _answer_events

    rec = _crec()
    rec.day_changes[0] = {
        **CHANGE,
        "show_at": "07:25",
        "changed_geojson": {"type": "FeatureCollection", "features": [{}]},
    }
    a = FinalAnswer(
        **{
            **__import__("townshiplens_agent.template", fromlist=["x"]).day_change_answer(
                CHANGE, ["ev-daychange-storm-1"]
            ),
            "scene_intents": [SceneIntent(kind="whatif.diff")],
        }
    )
    ctx = tools.Ctx(world=load_world(TINY), vrs=VerificationStore(":memory:"))
    kinds = [e.intent.kind for e in _answer_events(a, rec, ctx) if e.type == "scene.intent"]
    assert kinds == ["day.show", "whatif.diff"], kinds


@pytest.mark.parametrize(
    "summary",
    [
        # the live model's honest wording (Cycle 17), rejected before negation was read
        "In the storm rehearsal, the top suggestion is an imagined change. This is a top "
        "suggestion, not a proven best option. 823 residents would be better off and 0 worse off.",
        "I tested only this 1 of 2 suggested changes, so it is the top suggestion, not the best "
        "option. 823 residents would be better off.",
    ],
)
def test_a_negated_best_claim_is_honest(summary):
    errs = validate_answer(_cans(summary), _crec())
    assert not any("top suggestion" in e for e in errs), errs


# Cycle 17 review: ranking words, negation, per-day testing, numbers, future tense, mixed turns.
@pytest.mark.parametrize(
    "summary,why",
    [
        (
            "In this imagined change, the number one fix: 823 residents would be better off.",
            "top suggestion",
        ),
        (
            "In this imagined change, the ideal change: 823 residents would be better off.",
            "top suggestion",
        ),
        (
            "Imagined: isn't it the best change? 823 residents would be better off.",
            "top suggestion",
        ),
        (
            "Imagined. It is not clear, but this is the best change for 823 residents.",
            "top suggestion",
        ),
        (
            "Imagined: it is not only the best change, 823 residents would be better off.",
            "top suggestion",
        ),
        ("Imagined: you should build it, 823 residents would be better off.", "not a plan"),
        ("Imagined: the council should raise it; 823 residents would be better off.", "not a plan"),
        ("Imagined: 823 residents will be better off.", "not a plan"),
        ("Imagined: this will help 823 residents.", "not a plan"),
        ("Imagined: 247 residents would be better off.", "appear"),
        ("Imagined: 1 residents would be better off, 2 worse off.", "appear"),
    ],
)
def test_review_c17_dishonest_change_answers_are_rejected(summary, why):
    errs = validate_answer(_cans(summary), _crec())
    assert any(why in e for e in errs), errs


@pytest.mark.parametrize(
    "summary",
    [
        "Imagined (best case): 823 residents would be better off, on the usual route of 1,129 "
        "residents whose trips the water cut. It is not the best option, only the top suggestion.",
        "Imagined: I tested option 1, 1 of 2 suggested changes. 823 residents would be better off.",
    ],
)
def test_review_c17_honest_change_answers_pass(summary):
    assert validate_answer(_cans(summary), _crec()) == []


def test_best_needs_every_option_of_that_day_tested():
    rec = _crec()
    rec.day_changes.append({**CHANGE, "scenario": {"id": "weekday", "label": "w"}, "option": 2})
    errs = validate_answer(
        _cans("Imagined: the best change, 823 residents would be better off."), rec
    )
    assert any("top suggestion" in e for e in errs), errs
    rec.day_changes.append({**CHANGE, "option": 2})  # now both storm options are tested too
    rec.day_changes.append({**CHANGE, "scenario": {"id": "weekday", "label": "w"}, "option": 1})
    errs = validate_answer(
        _cans("Imagined: the best change, 823 residents would be better off."), rec
    )
    assert not any("top suggestion" in e for e in errs), errs


def test_a_turn_with_rehearsal_and_change_gets_a_valid_template():
    from townshiplens_agent.template import template_answer

    rec = _crec()
    rec.days.append(DAY)
    rec.place_names |= {"Older residents (65+)"}
    rec.tool_calls = ["day_rehearsal", "day_test_change"]
    a = template_answer(rec, "q")
    assert validate_answer(a, rec) == [], validate_answer(a, rec)
    assert any("data gap" in x for x in a.steps)


def test_day_show_follows_the_last_call():
    from townshiplens_agent.run import _answer_events

    rec = _crec()
    rec.days.append({**DAY, "show_at": "13:15"})
    rec.tool_calls = ["day_test_change", "day_rehearsal"]  # the rehearsal came last
    a = FinalAnswer(**__import__("townshiplens_agent.template", fromlist=["x"]).day_answer(DAY, []))
    ctx = tools.Ctx(world=load_world(TINY), vrs=VerificationStore(":memory:"))
    show = [
        e.intent
        for e in _answer_events(a, rec, ctx)
        if e.type == "scene.intent" and e.intent.kind == "day.show"
    ]
    assert show[0].day == "weekday" and show[0].t_min == 13 * 60 + 15


def test_the_mock_routes_day_changes_by_the_named_day():
    import re

    from townshiplens_agent.mock import _DAY_CHANGE, _day_id

    q = "what if we raise the flooded road in the event rehearsal? option 3"
    assert re.search(_DAY_CHANGE, q) and _day_id(q) == "event"
    assert not re.search(_DAY_CHANGE, "how does the rehearsal change when the river rises?")
    assert _day_id("what happens to residents in the storm rehearsal?") == "storm"


def test_mcp_drops_the_map_only_geometry():
    from townshiplens_agent.mcp_server import MAP_ONLY

    assert MAP_ONLY["day_test_change"] == ("changed_geojson",)


@pytest.fixture(autouse=True)
def _legacy_scope(monkeypatch):
    monkeypatch.setenv("ASSISTANT_SCOPE", "all")
