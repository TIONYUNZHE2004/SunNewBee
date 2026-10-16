"""What-if turns through the agent (Cycle 1): mock hero flow, scene diff, template fallback."""

import pytest
from pydantic_ai.exceptions import UnexpectedModelBehavior
from tests_support import TINY
from townshiplens_agent import agent as agent_mod
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import AgentSettings
from townshiplens_agent.template import template_answer
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

MOCK = AgentSettings(_env_file=None, llm_provider="mock")
RAMP_Q = "What if we build a ramp at the steps? How many wheelchair journeys would work?"
FLOOD_Q = "What if the river rises 3 m and we build a ramp: can wheelchair users reach a centre?"


@pytest.fixture
def ctx(tmp_path):
    return tools.Ctx(world=load_world(TINY), vrs=VerificationStore(str(tmp_path / "vr.db")))


async def turn(ctx, q, record=None, profile="wheelchair"):
    req = ChatRequest(message=q, profile=profile)
    return [e async for e in run_turn(ctx, req, MOCK, record=record)]


def text(evs):
    return "".join(e.delta for e in evs if e.type == "text.delta")


async def test_whatif_hero_runs_the_engine_and_passes_the_validator(ctx):
    rec = TurnRecord()
    evs = await turn(ctx, RAMP_Q, rec)
    calls = [e.name for e in evs if e.type == "tool.call"]
    assert calls == ["suggest_interventions", "simulate_what_if"]
    assert evs[-1].model == "mock-scripted" and rec.validator_errors == []
    t = text(evs)
    assert t.startswith("In this what-if simulation (Build a step-free ramp")
    assert "3 of 5 wheelchair journeys would have a mapped route" in t
    assert "Imagined changes are not real" in t
    diff = next(
        e.intent for e in evs if e.type == "scene.intent" and e.intent.kind == "whatif.diff"
    )
    assert diff.geojson and all(f["properties"]["whatif"] for f in diff.geojson["features"])
    assert any(e.type == "disclaimer" and e.lens == "whatif" for e in evs)
    unc = next(e for e in evs if e.type == "uncertainty")
    assert any(i["element_id"] == "whatif" for i in unc.items)
    assert ctx.world.edges["seg-be"].type == "steps"  # the real township is unchanged


async def test_whatif_with_river_rise_tells_the_flood_and_the_ramp_apart(ctx):
    evs = await turn(ctx, FLOOD_Q)
    t = text(evs)
    assert "with the river rise alone" in t and "evacuation centre" in t
    assert "not a forecast" in t
    kinds = [e.intent.kind for e in evs if e.type == "scene.intent"]
    assert {"whatif.diff", "flood.set_level"} <= set(kinds)
    # the flood disclaimer comes last, so official guidance stays the last word
    disc = [e for e in evs if e.type == "disclaimer"]
    assert disc[-1].lens == "flood"


async def test_whatif_template_fallback_says_the_same_numbers(ctx, monkeypatch):
    rec = TurnRecord()
    await turn(ctx, RAMP_Q, rec)
    ans = template_answer(rec, RAMP_Q)
    assert validate_answer(ans, rec) == []
    assert "3 of 5 wheelchair journeys" in ans.summary


async def test_model_that_lies_about_whatif_numbers_falls_back_to_template(ctx, monkeypatch):
    from pydantic_ai import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    def liar(messages, info):
        rets = [
            p for m in messages for p in getattr(m, "parts", []) if p.part_kind == "tool-return"
        ]
        if not rets:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        tool_name="simulate_what_if",
                        args={
                            "actions": [{"kind": "build_ramp", "element_id": "seg-be"}],
                            "profile": "wheelchair",
                            "scope": "suite",
                        },
                    )
                ]
            )
        ev = [e["id"] for p in rets for e in (p.content.get("evidence") or [])]
        return ModelResponse(
            parts=[
                ToolCallPart(
                    tool_name="final_answer",
                    args={
                        "answer_status": "partial",
                        "summary": "In this what-if, 6 wheelchair journeys are now confirmed.",
                        "claims": [{"text": "x", "status": "indicative", "evidence_ids": ev}],
                    },
                )
            ]
        )

    monkeypatch.setattr(agent_mod, "model_for", lambda s, escalate=False: FunctionModel(liar))
    rec = TurnRecord()
    evs = await turn(ctx, "what if?", rec)
    assert evs[-1].model.endswith("+template")
    joined = " ".join(" ".join(e) for e in rec.validator_errors)
    assert "do not appear in the what-if result" in joined and "conditional" in joined
    assert "3 of 5 wheelchair journeys" in text(evs)
    assert UnexpectedModelBehavior  # imported for clarity: retries exhausted -> template


# ---- survey plans (Cycle 2) ------------------------------------------------------------------
PLAN_Q = "Which facts should staff verify first so wheelchair users can reach an evacuation centre?"


async def test_plan_hero_is_conditional_and_engine_numbered(ctx):
    rec = TurnRecord()
    evs = await turn(ctx, PLAN_Q, rec)
    assert [e.name for e in evs if e.type == "tool.call"] == ["plan_verifications"]
    assert rec.validator_errors == [] and evs[-1].model == "mock-scripted"
    t = text(evs)
    assert t.startswith("If this check at 1 place passes, 4 of 5 sampled wheelchair journeys")
    assert "An unnamed ramp: check incline" in t and "nothing is confirmed" in t


def test_plan_validator_rejects_certainty_and_invented_numbers():
    from townshiplens_agent.answer import Claim, FinalAnswer
    from townshiplens_agent.validate import validate_answer
    from townshiplens_spatial.models import Evidence

    rec = TurnRecord(tool_calls=["plan_verifications"])
    rec.evidence["ev-plan-x"] = Evidence(
        id="ev-plan-x", element_id="plan", attribute="verify_next", status="indicative"
    )
    rec.plans.append(
        {
            "summary": {"total": 50, "confirmed_before": 0, "confirmed_after": 4, "changed": 4},
            "facts": [{"journeys_relying": 1}] * 15,
            "places": 5,
            "budget": 15,
        }
    )

    def ans(summary):
        return FinalAnswer(
            answer_status="partial",
            summary=summary,
            claims=[Claim(text="plan", status="indicative", evidence_ids=["ev-plan-x"])],
        )

    ok = "If these 15 checks at 5 places pass, 4 of 50 sampled journeys would be confirmed."
    assert validate_answer(ans(ok), rec) == []
    errs = " ".join(validate_answer(ans("These 15 checks will confirm 4 of 50 journeys."), rec))
    assert "conditional" in errs and "will be confirmed" in errs
    bad = " ".join(
        validate_answer(ans("If these 12 checks pass, 9 journeys would be confirmed."), rec)
    )
    assert "12" in bad and "9" in bad


# ---- rising river (Cycle 3) ------------------------------------------------------------------
TIP_Q = "At which river level does my route from the playground to the evacuation centre break?"
ROLL_Q = "What happens to residents as the river rises?"


async def test_tipping_point_hero(ctx):
    rec = TurnRecord()
    evs = await turn(ctx, TIP_Q, rec, profile="default")
    assert [e.name for e in evs if e.type == "tool.call"] == ["find_place", "river_tipping_point"]
    assert rec.validator_errors == [] and evs[-1].model == "mock-scripted"
    t = text(evs)
    assert "is cut off from River +3 m, because the start or destination is likely flooded" in t
    assert "not a forecast" in t and any(e.type == "disclaimer" for e in evs)


async def test_rollout_hero_plays_on_the_map(ctx):
    rec = TurnRecord()
    evs = await turn(ctx, ROLL_Q, rec)
    assert rec.validator_errors == [] and evs[-1].model == "mock-scripted"
    assert any(e.type == "scene.intent" and e.intent.kind == "river.rollout" for e in evs)
    assert "rollout" not in str(rec.rollouts[0].get("routes", "absent"))  # geometry not kept


def test_rollout_validator_rules():
    from townshiplens_agent.answer import Claim, FinalAnswer
    from townshiplens_agent.validate import validate_answer
    from townshiplens_spatial.models import Evidence

    rec = TurnRecord(tool_calls=["rising_river_rollout"], scenarios_used={"stage_p5m"})
    rec.evidence["ev-rollout-x"] = Evidence(
        id="ev-rollout-x", element_id="rollout", attribute="river_rollout", status="indicative"
    )
    c = {
        "total": 30,
        "reach": 27,
        "confirmed": 0,
        "confirmed_on_demo": 0,
        "cut_off": 0,
        "no_data": 3,
    }
    rec.rollouts.append(
        {
            "stages": [{"id": "baseline"}, {"id": "stage_p3m"}, {"id": "stage_p5m"}],
            "counts": {
                "wheelchair": {"baseline": {**c, "reach": 29, "no_data": 1}, "stage_p5m": c}
            },
        }
    )

    def ans(summary):
        return FinalAnswer(
            answer_status="partial",
            summary=summary,
            scenario_id="stage_p5m",
            claims=[Claim(text="r", status="indicative", evidence_ids=["ev-rollout-x"])],
        )

    ok = "In this simulation (not a forecast), at River +5 m 27 of 30 wheelchair residents reach."
    assert validate_answer(ans(ok), rec) == []
    errs = " ".join(validate_answer(ans("At River +2.5 m, 25 of 30 residents reach."), rec))
    assert "not a forecast" in errs and "+2.5 m" in errs and "25" in errs


# ---- Cycle 3 review fixes ------------------------------------------------------------------
async def test_tipping_answer_for_a_trip_that_never_works(ctx):
    """C1: no route at normal level is said plainly, never 'keeps a mapped route'."""
    from townshiplens_agent.template import tipping_answer
    from townshiplens_spatial import tools as sp

    d = sp.river_tipping_point(ctx, from_id="moon-base", profile="wheelchair").data
    a = tipping_answer(d, ["ev-tip-x"])
    assert "no working route at any modelled river level" in a["summary"]
    assert "keeps a mapped route" not in a["summary"]


async def test_tipping_hero_labels_demo_values(ctx):
    """C2: demo-value 'confirmed' steps are labelled."""
    evs = await turn(ctx, TIP_Q, profile="default")
    t = text(evs)
    assert "confirmed (on demo values, not yet surveyed)" in t
    assert "demo values, not yet surveyed" in t


def _rollout_rec():
    from townshiplens_spatial.models import Evidence

    rec = TurnRecord(tool_calls=["rising_river_rollout"], scenarios_used={"stage_p5m"})
    rec.evidence["ev-rollout-x"] = Evidence(
        id="ev-rollout-x", element_id="rollout", attribute="river_rollout", status="indicative"
    )
    base = {
        "total": 5,
        "reach": 4,
        "confirmed": 3,
        "confirmed_on_demo": 0,
        "cut_off": 0,
        "no_data": 1,
    }
    top = {
        "total": 5,
        "reach": 2,
        "confirmed": 0,
        "confirmed_on_demo": 0,
        "cut_off": 2,
        "no_data": 1,
    }
    rec.rollouts.append(
        {
            "stages": [
                {"id": "baseline", "label": "Normal level"},
                {"id": "stage_p3m", "label": "River +3 m"},
                {"id": "stage_p5m", "label": "River +5 m"},
            ],
            "counts": {"wheelchair": {"baseline": base, "stage_p3m": base, "stage_p5m": top}},
        }
    )
    return rec


@pytest.mark.parametrize(
    "summary",
    [
        "In this simulation (not a forecast), at River +5 m 3 of 5 wheelchair residents still "
        "have a confirmed route.",
        "In this simulation (not a forecast), at River +5 m 4 wheelchair residents are cut off.",
        "In this simulation (not a forecast), at River +3 m 1 of 5 residents is cut off.",
        "In this simulation (not a forecast), 60% of residents are cut off at River +5 m.",
        "In this simulation (not a forecast), three of five residents reach a centre.",
        "In this simulation (not a forecast), if the river rises 2 metres most still reach one.",
        "In this simulation (not a forecast), residents will be stranded at River +5 m.",
    ],
)
def test_rollout_lies_are_rejected(summary):
    from townshiplens_agent.answer import Claim, FinalAnswer
    from townshiplens_agent.validate import validate_answer

    a = FinalAnswer(
        answer_status="partial",
        summary=summary,
        scenario_id="stage_p5m",
        claims=[Claim(text="r", status="indicative", evidence_ids=["ev-rollout-x"])],
    )
    assert validate_answer(a, _rollout_rec()), summary


def test_rollout_truth_passes():
    from townshiplens_agent.answer import Claim, FinalAnswer
    from townshiplens_agent.validate import validate_answer

    a = FinalAnswer(
        answer_status="partial",
        summary="In this simulation (not a forecast), at River +5 m 2 of 5 wheelchair residents "
        "still reach a centre and 2 are cut off.",
        scenario_id="stage_p5m",
        claims=[Claim(text="r", status="indicative", evidence_ids=["ev-rollout-x"])],
    )
    assert validate_answer(a, _rollout_rec()) == []


async def test_tipping_wrong_break_stage_is_rejected(ctx, monkeypatch):
    from townshiplens_agent.answer import Claim, FinalAnswer
    from townshiplens_agent.validate import validate_answer

    rec = TurnRecord()
    await turn(ctx, TIP_Q, rec, profile="default")
    ev = [i for i in rec.evidence if i.startswith("ev-tip-")]
    a = FinalAnswer(
        answer_status="partial",
        summary="In this simulation (not a forecast), the trip already breaks at River +1 m and "
        "is cut off from River +3 m. Demo values, not yet surveyed.",
        scenario_id="stage_p5m",
        claims=[Claim(text="t", status="indicative", evidence_ids=ev)],
    )
    assert any("breaks at River +3 m, not" in e for e in validate_answer(a, rec))


def test_mock_tipping_trigger_needs_a_river_word():
    import re

    from townshiplens_agent.mock import _TIPPING

    assert not re.search(_TIPPING, "which level is the ramp at?")
    assert not re.search(_TIPPING, "does my route break if it rains?")
    assert re.search(_TIPPING, "at which river level does my route break?")


# ---- fix-it (Cycle 4) ------------------------------------------------------------------------
FIX_Q = "Which 2 changes would help wheelchair users most on everyday trips?"


async def test_fixit_hero_reports_the_engine_best_set(ctx):
    rec = TurnRecord()
    evs = await turn(ctx, FIX_Q, rec)
    assert [e.name for e in evs if e.type == "tool.call"] == ["find_fixes"]
    assert rec.validator_errors == [] and evs[-1].model == "mock-scripted"
    t = text(evs)
    assert "the best set of changes the model found is" in t and "would be confirmed" in t
    assert "No costs or construction feasibility" in t


def test_fixit_with_no_helpful_change_cannot_claim_one():
    from townshiplens_agent.answer import Claim, FinalAnswer
    from townshiplens_agent.validate import validate_answer
    from townshiplens_spatial.models import Evidence

    rec = TurnRecord(tool_calls=["find_fixes"])
    rec.evidence["ev-fixit-x"] = Evidence(
        id="ev-fixit-x", element_id="fixit", attribute="find_fixes", status="indicative"
    )
    s = {
        "total": 20,
        "reach_before": 18,
        "reach_after": 18,
        "confirmed_before": 0,
        "confirmed_after": 0,
        "changed": 0,
        "confirmed_on_demo_after": 0,
    }
    rec.what_ifs.append({"summary": s, "imagined": False, "fixit": {"empty": True}})
    a = FinalAnswer(
        answer_status="partial",
        summary="In this what-if search, building a ramp would help: 18 of 20 would reach.",
        claims=[Claim(text="f", status="indicative", evidence_ids=["ev-fixit-x"])],
    )
    assert any("no candidate change" in e for e in validate_answer(a, rec))


def _fix_rec(empty=True, stopped=False):
    from townshiplens_spatial.models import Evidence

    rec = TurnRecord(tool_calls=["find_fixes"])
    rec.evidence["ev-fixit-x"] = Evidence(
        id="ev-fixit-x", element_id="fixit", attribute="find_fixes", status="indicative"
    )
    s = {
        "total": 20,
        "reach_before": 8,
        "reach_after": 8 if empty else 10,
        "confirmed_before": 0,
        "confirmed_after": 0,
        "changed": 0 if empty else 2,
        "confirmed_on_demo_after": 0,
    }
    rec.what_ifs.append(
        {"summary": s, "imagined": not empty, "fixit": {"empty": empty, "stopped": stopped}}
    )
    return rec


def _fix_ans(summary):
    from townshiplens_agent.answer import Claim, FinalAnswer

    return FinalAnswer(
        answer_status="partial",
        summary=summary,
        claims=[Claim(text="f", status="indicative", evidence_ids=["ev-fixit-x"])],
    )


@pytest.mark.parametrize(
    "summary",
    [
        "In this what-if search, a ramp could help wheelchair users.",
        "In this what-if search, building a ramp would let 12 more journeys have a mapped route.",
        "In this what-if search, verifying the footway would make the biggest difference.",
        "In this what-if search, the top change is verifying the footway.",
    ],
)
def test_fixit_empty_result_cannot_be_spun(summary):
    from townshiplens_agent.validate import validate_answer

    assert validate_answer(_fix_ans(summary), _fix_rec()), summary


@pytest.mark.parametrize(
    "summary",
    [
        "In this what-if search, a cheap ramp costing about RM 5,000 would let 10 of 20 reach.",
        "In this what-if search, the easiest and most feasible fix: 10 of 20 would reach.",
    ],
)
def test_fixit_never_invents_costs_or_feasibility(summary):
    from townshiplens_agent.validate import validate_answer

    errs = " ".join(validate_answer(_fix_ans(summary), _fix_rec(empty=False)))
    assert "costs or feasibility" in errs


def test_fixit_stopped_early_must_say_inconclusive():
    from townshiplens_agent.template import fixit_answer
    from townshiplens_agent.validate import validate_answer

    rec = _fix_rec(stopped=True)
    bad = _fix_ans("In this what-if search, none of the changes helps: 8 of 20 would reach.")
    assert any("inconclusive" in e for e in validate_answer(bad, rec))
    fields = fixit_answer(
        {
            "best": {"actions": [], "summary": rec.what_ifs[0]["summary"]},
            "conclusive": False,
            "candidates": [1, 2],
            "profile": "wheelchair",
            "scope": "evacuation",
        },
        ["ev-fixit-x"],
    )
    assert "inconclusive" in fields["summary"]
