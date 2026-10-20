"""Check the actual agent and MCP transport boundaries using real engine calls."""

import json

from fastmcp import Client
from pydantic_ai import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from tests_support import TINY
from townshiplens_agent import agent as A
from townshiplens_agent import mcp_server
from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import AgentSettings
from townshiplens_agent.template import template_answer
from townshiplens_spatial import tools
from townshiplens_spatial.models import Claim as SpatialClaim
from townshiplens_spatial.models import Evidence
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world


async def test_mcp_keeps_demo_source_warning_and_unverified_amenity(monkeypatch):
    monkeypatch.setenv("TL_DATA_DIR", str(TINY))
    mcp_server._ctx.cache_clear()
    ctx = mcp_server._ctx()
    ctx.world.places["toilet-1"].claims["existence"] = SpatialClaim(
        value=True, status="unknown", evidence_type="team_survey_placeholder"
    )
    try:
        async with Client(mcp_server.build_server()) as client:
            result = await client.call_tool(
                "nearby_amenities", {"origin_id": "park-b", "amenity": "toilet", "max_walk_m": 300}
            )
        payload = json.loads(result.content[0].text)
        assert payload["data"][0]["via_unverified"] is True
        assert payload["evidence"][0]["source_type"] == "team_survey_placeholder"
        assert any("Demo value · not surveyed" in w for w in payload["warnings"])
    finally:
        mcp_server._ctx.cache_clear()


async def test_agent_citation_retains_demo_source_for_existing_ui_badge(monkeypatch):
    world = load_world(TINY)
    world.places["toilet-1"].claims["existence"] = SpatialClaim(
        value=True, status="unknown", evidence_type="team_survey_placeholder"
    )
    ctx = tools.Ctx(world=world, vrs=VerificationStore(":memory:"))
    turns = 0

    def model(messages, info):
        nonlocal turns
        turns += 1
        if turns == 1:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "nearby_amenities",
                        {"origin_id": "park-b", "amenity": "toilet", "max_walk_m": 300},
                    )
                ]
            )
        answer = FinalAnswer(
            answer_status="partial",
            summary="A demo toilet is listed.",
            caveats=["Place facts are demo values, not yet surveyed."],
            claims=[
                Claim(
                    text="Demo toilet existence",
                    status="unverified",
                    evidence_ids=["ev-place-toilet-1"],
                )
            ],
        )
        return ModelResponse(parts=[ToolCallPart("final_answer", answer.model_dump())])

    monkeypatch.setattr(A, "model_for", lambda *a, **k: FunctionModel(model))
    events = [
        e
        async for e in run_turn(
            ctx,
            ChatRequest(message="Is there a toilet near Car Park B?"),
            AgentSettings(_env_file=None, llm_provider="mock"),
            memory=SessionMemory(),
        )
    ]
    citation = next(e for e in events if e.type == "citation")
    assert citation.source_type == "team_survey_placeholder" and citation.status == "unknown"
    assert "demo values, not yet surveyed" in "".join(
        e.delta for e in events if e.type == "text.delta"
    )


def test_provider_failure_fallback_keeps_place_demo_warning():
    rec = TurnRecord()
    rec.evidence["ev-place-toilet-1"] = Evidence(
        id="ev-place-toilet-1",
        element_id="toilet-1",
        attribute="name",
        status="unknown",
        source_type="team_survey_placeholder",
    )
    answer = template_answer(rec, "Where is the toilet?")
    assert any("demo values, not yet surveyed" in c for c in answer.caveats)
