"""Scope-B policy is tested independently of the legacy all-features tests."""

import pytest
from fastmcp import Client
from pydantic_ai import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from tests_support import TINY
from townshiplens_agent import agent as A
from townshiplens_agent import mcp_server
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.scope import ACCESS_FLOOD_TOOLS, outside_scope
from townshiplens_agent.settings import AgentSettings
from townshiplens_agent.template import scope_answer
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

REMOVED_QUESTIONS = [
    ("Where can I recycle batteries near the mall?", "outside what I can check"),
    ("Boleh kitar semula bateri di mall?", "di luar"),
    ("商场哪里可以回收电池？", "超出"),
    ("What if we build a ramp at the steps?", "outside what I can check"),
    ("Bagaimana jika kita bina tanjakan?", "di luar"),
    ("如果建造坡道，会有多少路线改善？", "超出"),
    ("Which facts should staff verify first?", "outside what I can check"),
    ("Fakta mana perlu disahkan dahulu?", "di luar"),
    ("工作人员应该先核实哪些信息？", "超出"),
    ("At which river level does the route break?", "outside what I can check"),
    ("Pada paras sungai berapakah laluan terputus?", "di luar"),
    ("哪个水位让路线中断？", "超出"),
    ("What happens to residents as the river rises?", "outside what I can check"),
    ("Apa yang berlaku kepada penduduk pada setiap paras sungai?", "di luar"),
    ("随着河水上涨，居民会怎样？", "超出"),
    ("Which changes would help wheelchair users most?", "outside what I can check"),
    ("Perubahan terbaik untuk membantu kerusi roda?", "di luar"),
    ("哪些改造帮助最多居民？", "超出"),
    ("Show the Elmina Day rehearsal.", "outside what I can check"),
    ("Simulasi hari biasa penduduk.", "di luar"),
    ("模拟居民的一天。", "超出"),
    ("Give me a nasi lemak recipe.", "outside what I can check"),
]


@pytest.fixture
def ctx():
    return tools.Ctx(world=load_world(TINY), vrs=VerificationStore(":memory:"))


@pytest.mark.parametrize("question,phrase", REMOVED_QUESTIONS)
async def test_removed_features_refuse_before_model_cache_and_tools(
    ctx, monkeypatch, question, phrase
):
    def forbidden(*args, **kwargs):
        raise AssertionError("scope refusal must not call model or demo cache")

    monkeypatch.setattr(A, "model_for", forbidden)
    monkeypatch.setattr("townshiplens_agent.run.demo.load", forbidden)
    rec = TurnRecord()
    evs = [
        e
        async for e in run_turn(
            ctx,
            ChatRequest(message=question),
            AgentSettings(llm_provider="mock", assistant_scope="access_flood", demo_mode=True),
            record=rec,
            memory=SessionMemory(),
        )
    ]
    assert [e.type for e in evs] == ["text.delta", "done"]
    assert phrase in evs[0].delta
    assert evs[-1].answer_status == "cannot_answer"
    assert rec.tool_calls == [] and ctx.vrs.list(status="all") == []
    assert validate_answer(scope_answer(question), TurnRecord()) == []


@pytest.mark.parametrize(
    "question",
    [
        "Can I push a stroller from Car Park B to the playground?",
        "Which places are affected if the river rises 3 m?",
        "What if the river rises 3 m: where can I evacuate?",
        "Adakah laluan ke tandas ditutup?",
        "我推婴儿车去公园，有什么未核实的入口信息？",
        "Di mana pusat pemindahan terdekat?",
        "B停车场的通道有扶手吗？",
    ],
)
def test_access_and_fixed_stage_questions_remain_in_scope(question):
    assert not outside_scope(question)


@pytest.mark.parametrize("scope", ["access_flood", "all"])
async def test_model_registration_uses_scope_allowlist(ctx, scope):
    seen = []

    def model(messages, info):
        seen.extend(t.name for t in info.function_tools)
        return ModelResponse(
            parts=[ToolCallPart("final_answer", scope_answer("hello").model_dump())]
        )

    await A.build_agent(FunctionModel(model), assistant_scope=scope).run(
        "hello", deps=A.Deps(ctx, TurnRecord(), ChatRequest(message="hello"))
    )
    assert set(seen) == (ACCESS_FLOOD_TOOLS if scope == "access_flood" else set(tools.TOOLS))


async def test_mcp_uses_the_same_scope_with_existing_write_opt_in(monkeypatch):
    monkeypatch.setenv("ASSISTANT_SCOPE", "access_flood")
    monkeypatch.delenv("MCP_ALLOW_VR", raising=False)
    async with Client(mcp_server.build_server()) as client:
        assert {t.name for t in await client.list_tools()} == ACCESS_FLOOD_TOOLS - {
            "create_verification_request"
        }
    monkeypatch.setenv("MCP_ALLOW_VR", "true")
    async with Client(mcp_server.build_server()) as client:
        assert {t.name for t in await client.list_tools()} == ACCESS_FLOOD_TOOLS


def test_scope_defaults_and_invalid_values(monkeypatch):
    monkeypatch.delenv("ASSISTANT_SCOPE", raising=False)
    assert AgentSettings(_env_file=None).assistant_scope == "access_flood"
    monkeypatch.setenv("ASSISTANT_SCOPE", "all")
    assert AgentSettings(_env_file=None).assistant_scope == "all"
    with pytest.raises(ValueError):
        AgentSettings(_env_file=None, assistant_scope="arbitrary")


async def test_in_scope_mock_still_executes_real_tools(ctx):
    evs = [
        e
        async for e in run_turn(
            ctx,
            ChatRequest(
                message="Can I push a stroller from Car Park B to the playground?",
                profile="stroller",
            ),
            AgentSettings(llm_provider="mock", assistant_scope="access_flood"),
        )
    ]
    assert any(e.type == "tool.call" and e.name == "plan_route" for e in evs)
    assert evs[-1].model == "mock-scripted"
