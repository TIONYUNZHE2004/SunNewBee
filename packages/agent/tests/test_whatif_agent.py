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
