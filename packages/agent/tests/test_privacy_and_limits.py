"""Audit F4 (personal data never leaves the server) and F5 (a cap on model requests per turn)."""

import pytest
from pydantic_ai import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from tests_support import TINY
from townshiplens_agent import agent as agent_mod
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.redact import has_personal_data, redact
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

MOCK = AgentSettings(_env_file=None, llm_provider="mock")
PII = "My IC is 900101-14-5678, call 012-345 6789 or mail aisyah.k@example.com about the ramp."


@pytest.fixture
def ctx(tmp_path):
    return tools.Ctx(world=load_world(TINY), vrs=VerificationStore(str(tmp_path / "vr.db")))


@pytest.mark.parametrize(
    ("text", "gone"),
    [
        ("IC 900101-14-5678", "900101-14-5678"),
        ("IC 900101145678", "900101145678"),
        ("call 012-345 6789", "345 6789"),
        ("call +60 12 345 6789", "345 6789"),
        ("call 0123456789", "0123456789"),
        ("office 03-1234 5678", "1234 5678"),
        ("mail aisyah.k@example.com", "@example.com"),
    ],
)
def test_personal_data_is_removed(text, gone):
    out = redact(text)
    assert gone not in out and "removed]" in out
    assert has_personal_data(text)


@pytest.mark.parametrize(
    "text",
    [
        "Can I push a stroller 440 m from Car Park B?",
        "If the river rises +3 m, where can I go at 07:25?",
        "The route is 1,175 m, about 17 minutes, in 2026.",
        "Coordinates 3.181345, 101.508790 near Jalan U15/32",
        "Route rt-8f2c, segment seg-1306543755-2",
    ],
)
def test_ordinary_questions_are_unchanged(text):
    assert redact(text) == text


async def test_pii_never_reaches_the_model_or_memory(ctx, monkeypatch):
    seen: list[str] = []

    def spy(messages, info):
        seen.append(repr(messages))
        return ModelResponse(
            parts=[
                ToolCallPart(
                    tool_name="final_answer",
                    args={"answer_status": "cannot_answer", "summary": "I can help with routes."},
                )
            ]
        )

    monkeypatch.setattr(agent_mod, "model_for", lambda s, escalate=False: FunctionModel(spy))
    memory = SessionMemory()
    req = ChatRequest(message=PII, session_id="session-12345")
    evs = [e async for e in run_turn(ctx, req, MOCK, memory=memory)]
    assert evs[-1].type == "done"
    sent = " ".join(seen)
    stored = repr(memory.history("session-12345"))
    for secret in ("900101-14-5678", "345 6789", "aisyah.k@example.com"):
        assert secret not in sent and secret not in stored
    assert "[IC number removed]" in sent


async def test_a_turn_past_the_request_cap_ends_with_the_template(ctx, monkeypatch):
    calls = []

    def looper(messages, info):
        calls.append(1)
        return ModelResponse(parts=[ToolCallPart(tool_name="find_place", args={"query": "park"})])

    monkeypatch.setattr(agent_mod, "model_for", lambda s, escalate=False: FunctionModel(looper))
    settings = AgentSettings(_env_file=None, llm_provider="mock", llm_request_limit=4)
    evs = [e async for e in run_turn(ctx, ChatRequest(message="loop"), settings)]
    assert len(calls) <= 4
    assert any(e.type == "error" and e.code == "agent_limit" for e in evs)
    assert evs[-1].type == "done" and evs[-1].model.endswith("+template")
