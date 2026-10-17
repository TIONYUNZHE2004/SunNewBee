"""Backup model on provider errors, and escalation to a stronger model after a rejection."""

import pytest
from pydantic_ai import ModelResponse, ToolCallPart
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelRequest, RetryPromptPart, UserPromptPart
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.function import FunctionModel
from tests_support import TINY
from townshiplens_agent import agent as agent_mod
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

LIE = {
    "answer_status": "answered",
    "summary": "It is safe",
    "claims": [{"text": "x", "status": "verified", "evidence_ids": ["ev-fake"]}],
}
HONEST = {
    "answer_status": "cannot_answer",
    "summary": "I can help with routes, places, flood scenarios and recycling in Elmina.",
}


@pytest.fixture
def ctx(tmp_path):
    return tools.Ctx(world=load_world(TINY), vrs=VerificationStore(str(tmp_path / "vr.db")))


def final(args):
    return ModelResponse(parts=[ToolCallPart(tool_name="final_answer", args=args)])


async def collect(ctx, settings, message="hello"):
    return [e async for e in run_turn(ctx, ChatRequest(message=message), settings)]


def live_settings(**kw):
    return AgentSettings(_env_file=None, llm_provider="openrouter", openrouter_api_key="k", **kw)


def test_no_fallback_by_default_and_a_fallback_when_configured():
    assert not isinstance(agent_mod.model_for(live_settings()), FallbackModel)
    m = agent_mod.model_for(live_settings(llm_model_fallback="openai/gpt-6-luna"))
    assert isinstance(m, FallbackModel)
    assert [x.model_name for x in m.models] == ["anthropic/claude-haiku-5.5", "openai/gpt-6-luna"]


def test_a_fallback_equal_to_the_default_is_ignored():
    m = agent_mod.model_for(live_settings(llm_model_fallback="anthropic/claude-haiku-5.5"))
    assert not isinstance(m, FallbackModel)


def test_escalate_builds_the_escalation_model():
    m = agent_mod.model_for(live_settings(), escalate=True)
    assert m.model_name == "anthropic/claude-sonnet-5.5"


def test_answer_rejected_reads_only_a_final_answer_retry():
    retry = ModelRequest(parts=[RetryPromptPart(content="bad", tool_name="final_answer")])
    other = ModelRequest(parts=[RetryPromptPart(content="bad args", tool_name="plan_route")])
    user = ModelRequest(parts=[UserPromptPart(content="hi")])
    assert agent_mod.answer_rejected([user, retry])
    assert not agent_mod.answer_rejected([user, other])
    assert not agent_mod.answer_rejected([user])
    assert not agent_mod.answer_rejected([])


async def test_provider_error_fails_over_to_the_backup(ctx, monkeypatch):
    def down(messages, info):
        raise ModelHTTPError(503, "primary", "unavailable")

    backup = FunctionModel(lambda m, i: final(HONEST), model_name="backup")
    model = FallbackModel(FunctionModel(down, model_name="primary"), backup)
    monkeypatch.setattr(agent_mod, "model_for", lambda s, escalate=False: model)
    evs = await collect(ctx, AgentSettings(_env_file=None, llm_provider="mock"))
    assert not any(e.type == "error" for e in evs)
    assert evs[-1].type == "done" and evs[-1].model == "backup"


async def test_a_rejected_answer_is_rewritten_by_the_escalation_model(ctx, monkeypatch):
    calls = {"primary": 0, "strong": 0}

    def primary(messages, info):
        calls["primary"] += 1
        return final(LIE)

    def strong(messages, info):
        calls["strong"] += 1
        return final(HONEST)

    models = {
        False: FunctionModel(primary, model_name="primary"),
        True: FunctionModel(strong, model_name="strong"),
    }
    monkeypatch.setattr(agent_mod, "model_for", lambda s, escalate=False: models[escalate])
    settings = AgentSettings(_env_file=None, llm_provider="mock", llm_escalate_on_rewrite=True)
    evs = await collect(ctx, settings)
    assert calls == {"primary": 1, "strong": 1}
    assert evs[-1].model == "strong" and not evs[-1].model.endswith("+template")
    assert "safe" not in "".join(e.delta for e in evs if e.type == "text.delta").lower()


async def test_without_escalation_the_rewrite_stays_on_the_default_model(ctx, monkeypatch):
    calls = []

    def primary(messages, info):
        calls.append(1)
        return final(LIE if len(calls) == 1 else HONEST)

    monkeypatch.setattr(
        agent_mod, "model_for", lambda s, escalate=False: FunctionModel(primary, model_name="p")
    )
    evs = await collect(ctx, AgentSettings(_env_file=None, llm_provider="mock"))
    assert len(calls) == 2 and evs[-1].model == "p"


async def test_an_escalated_turn_that_still_fails_names_the_escalation_model(ctx, monkeypatch):
    models = {
        False: FunctionModel(lambda m, i: final(LIE), model_name="primary"),
        True: FunctionModel(lambda m, i: final(LIE), model_name="strong"),
    }
    monkeypatch.setattr(agent_mod, "model_for", lambda s, escalate=False: models[escalate])
    settings = AgentSettings(_env_file=None, llm_provider="mock", llm_escalate_on_rewrite=True)
    evs = await collect(ctx, settings)
    assert evs[-1].model == "strong+template"
