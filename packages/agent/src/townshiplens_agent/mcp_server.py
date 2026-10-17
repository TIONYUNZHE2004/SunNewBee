"""The township world model over the Model Context Protocol (Cycle 4).

Any MCP client (Claude Desktop, an IDE agent, another team's tool) can query City of Elmina
through the same deterministic engine the assistant uses. It serves the lookups, what-ifs,
survey plans, rising-river rollouts and tipping points from `townshiplens_spatial.tools.TOOLS`.
Results are the same `ToolResult` JSON as the assistant gets: evidence ids plus warnings that
carry the disclaimers.

uv run python -m townshiplens_agent.mcp_server            # stdio (Claude Desktop and others)

Honesty and PDPA:
- MCP clients never write to the staff queue. Verification requests (including the ones
  `plan_route` files for unknown segments) go to an in-memory store unless `MCP_ALLOW_VR=true`,
  and `create_verification_request` is not exposed at all unless that flag is set.
- No user text is stored, and staff free-text closure notes are stripped from every result
  (the same `_without_closure_notes` rule the assistant applies before a model sees a result).
- Every simulation carries its "indicative / what-if / not a forecast" disclaimer in `warnings`.
"""

from __future__ import annotations

import inspect
import os
import typing
from functools import cache
from pathlib import Path

from fastmcp import FastMCP
from townshiplens_spatial import tools as sp
from townshiplens_spatial.closure_store import ClosureStore
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

from .agent import _without_closure_notes, route_summary, safe_vr_args
from .scope import ACCESS_FLOOD_TOOLS
from .settings import ROOT, AgentSettings

INSTRUCTIONS = (
    "TownshipLens: a world model of City of Elmina (Sime Darby Property). Facts come only from "
    "these tools. Routes are confirmed / partly unverified / blocked / no mapped connection "
    "(a data gap). Flood stages are indicative scenarios, not forecasts and not water depths; "
    "never call a place safe. What-ifs and rollouts are simulations: imagined changes are not "
    "real. Demo values (team_survey_placeholder) are not surveyed. Staff closures and ticket "
    "outcomes are as of the server's start."
)
EXCLUDED = {"create_verification_request"}
# Parameters an MCP client may not set: the server fills them (PDPA: no client free text is
# stored in the staff queue).
HIDDEN = {"plan_route": {"question_summary"}}


def allow_vr() -> bool:
    return os.environ.get("MCP_ALLOW_VR", "").lower() in ("1", "true", "yes")


def vr_db(site_id: str) -> str:
    """Where verification requests from MCP clients go: memory only, unless MCP_ALLOW_VR."""
    return str(ROOT / ".data" / f"{site_id}.db") if allow_vr() else ":memory:"


@cache
def _ctx() -> sp.Ctx:
    data = Path(os.environ.get("TL_DATA_DIR") or ROOT / "data/seed/elmina")
    if not (data / "site.json").exists():
        data = ROOT / "packages/spatial/tests/fixtures/tiny"
    world = load_world(data)
    # Staff-reported closures as of server start (read-only), so routes match the app's.
    db = ROOT / ".data" / f"{world.site.id}.db"
    if db.exists():
        world.set_closures(ClosureStore(str(db)).current())
    return sp.Ctx(world=world, vrs=VerificationStore(vr_db(world.site.id)))


MAP_ONLY = {"day_test_change": ("changed_geojson",)}


def _expose(mcp: FastMCP, name: str, fn) -> None:
    hints = typing.get_type_hints(fn)
    sig = inspect.signature(fn)
    hidden = HIDDEN.get(name, set())
    params = [
        p.replace(annotation=hints.get(p.name, p.annotation))
        for p in sig.parameters.values()
        if p.name != "ctx" and p.name not in hidden
    ]

    def tool(**kwargs):
        ctx = _ctx()
        if name == "create_verification_request":  # only exposed with MCP_ALLOW_VR
            kwargs = safe_vr_args(ctx.world, kwargs, source="mcp")
        if name == "plan_route":  # the stored summary names places, never client text
            kwargs["question_summary"] = route_summary(
                ctx.world, kwargs.get("profile"), kwargs.get("from_id"), kwargs.get("to_id")
            )
        # Same PDPA rule as the assistant: staff free text on closures never leaves the server.
        out = _without_closure_notes(fn(ctx, **kwargs).model_dump(mode="json"))
        if isinstance(out.get("data"), dict):
            for k in MAP_ONLY.get(name, ()):  # drawn by the app's map, no use to a client
                out["data"].pop(k, None)
        return out

    tool.__name__ = name
    tool.__doc__ = inspect.getdoc(fn) or name
    tool.__signature__ = sig.replace(parameters=params, return_annotation=dict)
    tool.__annotations__ = {p.name: p.annotation for p in params} | {"return": dict}
    mcp.tool(tool)


def build_server() -> FastMCP:
    scope = AgentSettings().assistant_scope
    instructions = (
        INSTRUCTIONS
        if scope == "all"
        else (
            "Scope: access and indicative flood evacuation around Elmina Urban Park and "
            "Elmina Lakeside Mall frontage only. Other features are outside what this server "
            "can check. Routes and place existence can rest on demo values; preserve "
            "team_survey_placeholder / Demo value · not surveyed. Flood stages are indicative, "
            "not forecasts or path depths. Never promise or call a place safe. Staff closures "
            "and ticket outcomes are as of server start."
        )
    )
    mcp = FastMCP("TownshipLens", instructions=instructions)
    for name, fn in sp.TOOLS.items():
        if scope == "access_flood" and name not in ACCESS_FLOOD_TOOLS:
            continue
        if name in EXCLUDED and not allow_vr():
            continue
        _expose(mcp, name, fn)

    @mcp.resource("townshiplens://honesty")
    def honesty() -> str:
        """The rules every answer built on these tools must keep."""
        return instructions

    return mcp


mcp = build_server()

if __name__ == "__main__":
    mcp.run(show_banner=False)  # stdout is the protocol channel; keep it clean
