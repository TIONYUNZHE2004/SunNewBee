"""MCP server smoke test (Cycle 4): in-memory client, same engine tools, no staff-queue writes."""

import json

import pytest
from fastmcp import Client
from tests_support import TINY


@pytest.fixture
def server(monkeypatch):
    monkeypatch.setenv("ASSISTANT_SCOPE", "all")
    monkeypatch.setenv("TL_DATA_DIR", str(TINY))
    monkeypatch.delenv("MCP_ALLOW_VR", raising=False)
    from townshiplens_agent import mcp_server

    mcp_server._ctx.cache_clear()
    return mcp_server.build_server()


async def test_lists_world_model_tools_but_not_vr_creation(server):
    async with Client(server) as c:
        names = {t.name for t in await c.list_tools()}
    assert {"find_place", "plan_route", "simulate_what_if", "rising_river_rollout"} <= names
    assert "create_verification_request" not in names


async def test_calls_return_the_engine_result_with_disclaimers(server):
    async with Client(server) as c:
        r = await c.call_tool("find_place", {"query": "playground"})
        found = json.loads(r.content[0].text)
        assert found["ok"] and found["data"][0]["id"] == "playground"
        w = await c.call_tool(
            "simulate_what_if",
            {
                "actions": [{"kind": "build_ramp", "element_id": "seg-be"}],
                "profile": "wheelchair",
                "scope": "suite",
            },
        )
        d = json.loads(w.content[0].text)
        assert d["ok"] and "not a forecast" in d["warnings"][0]


async def test_route_planning_from_mcp_never_touches_the_staff_queue(server):
    from townshiplens_agent import mcp_server

    async with Client(server) as c:
        await c.call_tool(
            "plan_route", {"from_id": "park-b", "to_id": "kiosk", "profile": "stroller"}
        )
    assert mcp_server.vr_db("tiny") == ":memory:"
    assert mcp_server._ctx().vrs.list(status="all")  # filed, but only in memory


def test_vr_store_is_the_real_one_only_when_allowed(monkeypatch):
    from townshiplens_agent import mcp_server

    monkeypatch.setenv("MCP_ALLOW_VR", "true")
    assert mcp_server.vr_db("elmina").endswith(".data/elmina.db")


async def test_staff_closure_notes_never_reach_mcp_clients(server):
    from datetime import UTC, datetime, timedelta

    from townshiplens_agent import mcp_server
    from townshiplens_spatial.models import Closure

    w = mcp_server._ctx().world
    c = Closure(
        id="c-note",
        element_id="seg-ab",
        reason="works",
        starts_at=datetime.now(UTC) - timedelta(hours=1),
        note="call Ahmad 012-3456789",
    )
    w.set_closures([c])
    try:
        async with Client(server) as cl:
            r = await cl.call_tool("get_closures", {})
        assert "012-3456789" not in r.content[0].text and "Ahmad" not in r.content[0].text
    finally:
        w.set_closures([])


async def test_mcp_clients_cannot_store_free_text(server, monkeypatch):
    """Review I6: plan_route hides question_summary; VR creation is sanitised when allowed."""
    from townshiplens_agent import mcp_server

    async with Client(server) as c:
        tools = {t.name: t for t in await c.list_tools()}
        assert "question_summary" not in tools["plan_route"].input_schema["properties"]
        await c.call_tool(
            "plan_route", {"from_id": "park-b", "to_id": "kiosk", "profile": "stroller"}
        )
    summaries = [v.question_summary for v in mcp_server._ctx().vrs.list(status="all")]
    assert summaries and all("->" in s for s in summaries)  # built from place names

    monkeypatch.setenv("MCP_ALLOW_VR", "true")
    monkeypatch.setattr(mcp_server, "vr_db", lambda site: ":memory:")
    mcp_server._ctx.cache_clear()
    allowed = mcp_server.build_server()
    async with Client(allowed) as c:
        await c.call_tool(
            "create_verification_request",
            {
                "target_id": "seg-cf",
                "attribute": "incline_pct",
                "reason": "user_report",
                "question_summary": "Siti 900101-10-1234 says it is broken",
            },
        )
    rows = mcp_server._ctx().vrs.list(status="all")
    assert rows and not any("900101" in (r.question_summary or "") for r in rows)
    assert all(r.question_summary.startswith("mcp:") for r in rows)
    mcp_server._ctx.cache_clear()
