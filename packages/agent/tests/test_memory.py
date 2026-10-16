"""Multi-turn session memory (Cycle 1)."""

import pydantic
import pytest
from pydantic_ai import ModelResponse, ToolCallPart
from pydantic_ai.messages import ModelRequest, UserPromptPart
from pydantic_ai.models.function import FunctionModel
from tests_support import TINY
from townshiplens_agent import agent as agent_mod
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

MOCK = AgentSettings(_env_file=None, llm_provider="mock")
SID = "tab-0123456789"


@pytest.fixture
def ctx(tmp_path):
    return tools.Ctx(world=load_world(TINY), vrs=VerificationStore(str(tmp_path / "vr.db")))


def _req(msg):
    return ModelRequest(parts=[UserPromptPart(content=msg)])


def test_memory_caps_turns_and_sessions_and_expires():
    m = SessionMemory(max_sessions=2, max_turns=2, max_idle_s=60)
    for i in range(3):
        m.add_turn("a", f"q{i}", f"answer {i}")
    hist = m.history("a")
    assert [p.parts[0].content for p in hist[::2]] == ["q1", "q2"]  # oldest turn dropped
    assert [p.parts[0].content for p in hist[1::2]] == ["answer 1", "answer 2"]
    m.add_turn("b", "b", "x")
    m.add_turn("c", "c", "x")
    assert len(m) == 2 and m.history("a") == []  # least recently used session dropped
    m.max_idle_s = -1
    assert m.history("c") == []  # idle sessions expire
    assert m.history(None) == [] and m.history("") == []


def test_memory_keeps_only_compact_text_under_a_size_cap():
    m = SessionMemory(max_chars=300)
    for i in range(5):
        m.add_turn("s", f"question {i}", "y" * 5000, simulated=(i == 0))
    hist = m.history("s")
    assert len(hist) == 2  # the newest turn alone exceeds the cap; older ones are dropped
    assert len(hist[1].parts[0].content) <= 1200
    assert not m.simulated("s")  # the simulated turn was dropped with it


def test_session_id_is_constrained():
    with pytest.raises(pydantic.ValidationError):
        ChatRequest(message="x", session_id="short")
    with pytest.raises(pydantic.ValidationError):
        ChatRequest(message="x", session_id="a b c d e f g h i")
    assert ChatRequest(message="x", session_id=SID).session_id == SID


async def test_follow_up_sees_the_earlier_turn_and_other_sessions_do_not(ctx, monkeypatch):
    seen: list[list[str]] = []

    def spy(messages, info):
        seen.append([p.content for m in messages for p in m.parts if isinstance(p, UserPromptPart)])
        return ModelResponse(
            parts=[
                ToolCallPart(
                    tool_name="final_answer",
                    args={"answer_status": "cannot_answer", "summary": "I can help in Elmina."},
                )
            ]
        )

    monkeypatch.setattr(agent_mod, "model_for", lambda s, escalate=False: FunctionModel(spy))
    mem = SessionMemory()

    async def ask(msg, sid):
        req = ChatRequest(message=msg, session_id=sid)
        return [e async for e in run_turn(ctx, req, MOCK, memory=mem)]

    await ask("What if the river rises 3 m?", SID)
    await ask("And if it rises another metre?", SID)
    await ask("Hello", "other-tab-0001")
    assert seen[0] == ["What if the river rises 3 m?"]
    assert seen[1] == ["What if the river rises 3 m?", "And if it rises another metre?"]
    assert seen[2] == ["Hello"]


async def test_mock_answers_only_the_current_question_with_history(ctx):
    mem = SessionMemory()
    q1 = ChatRequest(
        message="Can I push a stroller from Car Park B to the kiosk without stairs?",
        profile="stroller",
        session_id=SID,
    )
    first = [e async for e in run_turn(ctx, q1, MOCK, memory=mem)]
    q2 = ChatRequest(message="Where can I recycle paper and cans?", session_id=SID)
    second = [e async for e in run_turn(ctx, q2, MOCK, memory=mem)]
    assert [e.name for e in second if e.type == "tool.call"] == ["find_waste_points"]
    assert first[-1].model == second[-1].model == "mock-scripted"


async def test_follow_up_cannot_repeat_whatif_numbers_without_resimulating(ctx, monkeypatch):
    """Review I1: memory must not let a follow-up restate simulated numbers unchecked."""
    from pydantic_ai import ModelResponse, ToolCallPart

    mem = SessionMemory()
    first = ChatRequest(
        message="What if we build a ramp at the steps?", profile="wheelchair", session_id=SID
    )
    [e async for e in run_turn(ctx, first, MOCK, memory=mem)]
    assert mem.simulated(SID)

    def parrot(messages, info):
        rets = [p for m in messages for p in m.parts if p.part_kind == "tool-return"]
        if not rets:
            return ModelResponse(parts=[ToolCallPart(tool_name="find_place", args={"query": "x"})])
        return ModelResponse(
            parts=[
                ToolCallPart(
                    tool_name="final_answer",
                    args={
                        "answer_status": "partial",
                        "summary": "As before, 4 of 5 wheelchair journeys would reach it.",
                    },
                )
            ]
        )

    monkeypatch.setattr(agent_mod, "model_for", lambda s, escalate=False: FunctionModel(parrot))
    from townshiplens_agent.record import TurnRecord

    rec = TurnRecord()
    follow = ChatRequest(message="And for strollers?", session_id=SID)
    evs = [e async for e in run_turn(ctx, follow, MOCK, record=rec, memory=mem)]
    assert any("repeated from memory" in e for errs in rec.validator_errors for e in errs)
    assert evs[-1].model.endswith("+template")
