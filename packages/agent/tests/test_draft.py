"""Draft streaming (`answer.draft`) and validator verdicts (`answer.check`), Cycle 0."""

import json

import pytest
from pydantic_ai import ModelResponse, ToolCallPart
from pydantic_ai.models.function import DeltaToolCall, FunctionModel
from tests_support import TINY
from townshiplens_agent import agent as agent_mod
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

MOCK = AgentSettings(_env_file=None, llm_provider="mock", assistant_scope="all")
KIOSK_Q = "Can I push a stroller from Car Park B to the kiosk without stairs?"


@pytest.fixture
def ctx(tmp_path):
    return tools.Ctx(world=load_world(TINY), vrs=VerificationStore(str(tmp_path / "vr.db")))


async def collect(ctx, msg, profile="stroller"):
    req = ChatRequest(message=msg, profile=profile)
    return [e async for e in run_turn(ctx, req, MOCK)]


async def test_mock_streams_a_draft_before_the_checked_answer(ctx):
    evs = await collect(ctx, KIOSK_Q)
    types = [e.type for e in evs]
    drafts = [e for e in evs if e.type == "answer.draft"]
    assert len(drafts) > 1, "the summary is streamed in several word-sized deltas"
    first_draft, check, first_text = (
        types.index("answer.draft"),
        types.index("answer.check"),
        types.index("text.delta"),
    )
    assert first_draft < check < first_text  # draft, then verdict, then validated text
    text = "".join(e.delta for e in evs if e.type == "text.delta")
    draft = "".join(d.delta for d in drafts)
    assert draft and draft in text  # the accepted draft is exactly the summary shown
    verdict = next(e for e in evs if e.type == "answer.check")
    assert verdict.ok and verdict.attempt == 1 and verdict.issues == []


def _streaming(responses):
    """A FunctionModel that streams pre-built responses (a list of ModelResponse) in order."""
    calls = {"n": 0}

    async def stream(messages, info):
        resp = responses[min(calls["n"], len(responses) - 1)]
        calls["n"] += 1
        for i, part in enumerate(resp.parts):
            args = json.dumps(part.args)
            yield {i: DeltaToolCall(name=part.tool_name, json_args="", tool_call_id=f"c{i}")}
            for k in range(0, len(args), 7):
                yield {i: DeltaToolCall(json_args=args[k : k + 7], tool_call_id=f"c{i}")}

    def plain(messages, info):  # never used: run_turn streams when stream_function is set
        raise AssertionError

    return FunctionModel(plain, stream_function=stream)


def _final(summary, **kw):
    args = {"answer_status": "cannot_answer", "summary": summary, **kw}
    return ModelResponse(parts=[ToolCallPart(tool_name="final_answer", args=args)])


async def test_rejected_attempt_is_reported_and_rewritten(ctx, monkeypatch):
    bad = _final("Go there now, all is fine.", answer_status="answered")  # no tool was called
    good = _final("I can help with routes, places and flood scenarios in Elmina.")
    model = _streaming([bad, good])
    monkeypatch.setattr(agent_mod, "model_for", lambda s, escalate=False: model)
    evs = await collect(ctx, "hello")
    checks = [e for e in evs if e.type == "answer.check"]
    assert [c.ok for c in checks] == [False, True]
    assert checks[0].issues == ["answered without checking the township data"]
    attempts = {d.attempt for d in evs if d.type == "answer.draft"}
    assert attempts == {1, 2}  # the client starts a fresh draft for the rewrite
    text = "".join(e.delta for e in evs if e.type == "text.delta")
    assert text.startswith("I can help with routes")
    assert evs[-1].type == "done" and not evs[-1].model.endswith("+template")


@pytest.mark.parametrize(
    "summary",
    [
        "The playground is safe to visit right now.",
        "Expect 0.5 m of water on the path.",
        "Take seg-ab then turn left.",
    ],
)
async def test_draft_stops_before_forbidden_wording(ctx, monkeypatch, summary):
    model = _streaming([_final(summary), _final("I can't answer that from the township model.")])
    monkeypatch.setattr(agent_mod, "model_for", lambda s, escalate=False: model)
    evs = await collect(ctx, "hello")
    first = "".join(d.delta for d in evs if d.type == "answer.draft" and d.attempt == 1)
    for banned in ("safe", "0.5", "seg-ab"):
        assert banned not in first
    assert summary.startswith(first)


@pytest.mark.parametrize(
    "summary, banned",
    [
        ("It should be fine for a stroller, go ahead now.", "should be fine"),
        ("I have asked the staff team to check the ramp for you.", "asked the staff"),
        ("Expect 0.5 m dalam on the low path near the lake.", "0.5"),
    ],
)
async def test_draft_uses_every_validator_wording_rule(ctx, monkeypatch, summary, banned):
    model = _streaming([_final(summary), _final("I can't answer that from the township model.")])
    monkeypatch.setattr(agent_mod, "model_for", lambda s, escalate=False: model)
    evs = await collect(ctx, "hello")
    first = "".join(d.delta for d in evs if d.type == "answer.draft" and d.attempt == 1)
    assert banned not in first


async def test_schema_failure_is_reported_as_a_sent_back_attempt(ctx, monkeypatch):
    bad = _final("Half an answer.", answer_status="bogus")  # not a valid FinalAnswer
    good = _final("I can help with routes, places and flood scenarios in Elmina.")
    monkeypatch.setattr(agent_mod, "model_for", lambda s, escalate=False: _streaming([bad, good]))
    evs = await collect(ctx, "hello")
    checks = [(e.attempt, e.ok) for e in evs if e.type == "answer.check"]
    assert checks == [(1, False), (2, True)]
    assert {d.attempt for d in evs if d.type == "answer.draft"} == {1, 2}


async def test_only_the_first_final_answer_in_a_response_is_drafted(ctx, monkeypatch):
    two = ModelResponse(
        parts=[
            ToolCallPart(
                tool_name="final_answer",
                args={"answer_status": "cannot_answer", "summary": "First answer is this one."},
            ),
            ToolCallPart(
                tool_name="final_answer",
                args={"answer_status": "cannot_answer", "summary": "Second answer text appears."},
            ),
        ]
    )
    monkeypatch.setattr(agent_mod, "model_for", lambda s, escalate=False: _streaming([two]))
    evs = await collect(ctx, "hello")
    draft = "".join(d.delta for d in evs if d.type == "answer.draft")
    assert draft == "First answer is this one."


async def test_chinese_drafts_stream_before_the_end(ctx, monkeypatch):
    zh = _final("我可以帮你查询路线，地点，以及洪水情景。这是一个较长的句子，用来测试。")
    monkeypatch.setattr(agent_mod, "model_for", lambda s, escalate=False: _streaming([zh]))
    evs = await collect(ctx, "你好")
    assert len([d for d in evs if d.type == "answer.draft"]) > 1


@pytest.fixture(autouse=True)
def _legacy_scope(monkeypatch):
    # These existing engine/pipeline regressions explicitly retain all legacy features.
    monkeypatch.setenv("ASSISTANT_SCOPE", "all")
