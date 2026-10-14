"""Deterministic scripted model for CI and keyless development. Mirrors the 3 hero flows."""

import json
import re

from pydantic_ai import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.messages import ModelRequest, ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import AgentInfo, FunctionModel


def _prompt(messages: list[ModelMessage]) -> str:
    for m in messages:
        if isinstance(m, ModelRequest):
            for p in m.parts:
                if isinstance(p, UserPromptPart) and isinstance(p.content, str):
                    return p.content
    return ""


def _returns(messages: list[ModelMessage]) -> list[tuple[str, dict]]:
    out = []
    for m in messages:
        if isinstance(m, ModelRequest):
            for p in m.parts:
                if isinstance(p, ToolReturnPart):
                    c = (
                        p.content
                        if isinstance(p.content, dict)
                        else json.loads(p.model_response_str())
                    )
                    out.append((p.tool_name, c))
    return out


def _ev_ids(rets) -> list[str]:
    return [e["id"] for _, r in rets for e in r.get("evidence", [])]


def _src(c: dict) -> str:
    return "official PPS" if c["source"] == "official_pps" else "candidate, not confirmed as a PPS"


def _call(name: str, **args) -> ModelResponse:
    return ModelResponse(parts=[ToolCallPart(tool_name=name, args=args)])


def _final(**ans) -> ModelResponse:
    return ModelResponse(parts=[ToolCallPart(tool_name="final_answer", args=ans)])


def _data(ret: dict):
    """Tool payload data, or None when the tool failed or returned nothing."""
    return ret.get("data") if ret.get("ok", True) else None


def _cannot(msg: str = "I couldn't get verified information for that yet.") -> ModelResponse:
    return _final(answer_status="cannot_answer", summary=msg)


def _unknown_caveats(routes: list) -> list[str]:
    return [
        f"Not checked yet: {u.get('attribute')} on {u.get('element_id')}"
        for r in routes
        for u in (r.get("unknowns") or [])
    ]


def _script(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    q = _prompt(messages).lower()
    rets = _returns(messages)
    n = len(rets)
    is_flood = bool(re.search(r"flood|river|banjir|sungai|rises|naik|水", q))
    if is_flood and re.search(r"cut off|affected|briefing|terjejas", q):  # management
        if n == 0:
            return _call("list_flood_scenarios")
        if n == 1:
            return _call("affected_places", scenario_id="stage_p3m", kind="all", profile="default")
        a = _data(rets[-1][1])
        ev = _ev_ids(rets)
        if not isinstance(a, dict) or not ev:
            return _cannot()
        return _final(
            answer_status="answered",
            summary=(
                f"In the River +3 m indicative scenario, {len(a.get('likely') or [])} "
                f"places/paths are likely cut off and {len(a.get('possible') or [])} possibly. "
                "This is not a forecast; follow official MBSA / JPS / NADMA guidance."
            ),
            claims=[
                {"text": "Scenario River +3 m", "status": "indicative", "evidence_ids": [ev[0]]}
            ],
            scenario_id="stage_p3m",
            scene_intents=[{"kind": "flood.set_level", "scenario_id": "stage_p3m"}],
        )
    if is_flood:  # resident: where can I go
        if n == 0:
            return _call("find_place", query="lakeside mall")
        found = _data(rets[0][1]) or []
        origin = found[0]["id"] if found else None
        if n == 1:
            if not origin:
                return _cannot("I couldn't find where you are in the township model yet.")
            return _call(
                "list_evacuation_centres",
                scenario_id="stage_p3m",
                profile="wheelchair",
                near_place=origin,
            )
        centres = [c for c in (_data(rets[1][1]) or []) if c.get("reachable")]
        if n == 2:
            if not centres:
                return _cannot("No reachable centre found in this indicative scenario.")
            ctr = centres[0]["centre"]
            return _call(
                "plan_route",
                from_id=origin,
                to_id=ctr.get("place_id") or f"__centre__{ctr['id']}",
                profile="wheelchair",
                scenario_id="stage_p3m",
            )
        if not centres:
            return _cannot("No reachable centre found in this indicative scenario.")
        c0 = centres[0]["centre"]
        routes = (_data(rets[-1][1]) or {}).get("routes") or []
        route = routes[0] if routes else None
        caveats = _unknown_caveats(routes[:1])
        if route and route.get("status") != "confirmed" and not caveats:
            caveats = [f"Route status: {route.get('status')}; not all segments are verified."]
        return _final(
            answer_status="answered" if route and route.get("status") == "confirmed" else "partial",
            summary=(
                "In the River +3 m indicative scenario, the nearest reachable centre is "
                f"{c0['name']} ({_src(c0)}). "
                "This is not a forecast; follow official MBSA / JPS / NADMA guidance."
            ),
            claims=[
                {
                    "text": "Centre source and reachability",
                    "status": "indicative",
                    "evidence_ids": [
                        i for i in _ev_ids(rets) if i.startswith(("ev-centre-", "ev-scn-"))
                    ][:3],
                }
            ],
            route_id=route["id"] if route else None,
            scenario_id="stage_p3m",
            caveats=caveats,
            scene_intents=[{"kind": "flood.set_level", "scenario_id": "stage_p3m"}]
            + ([{"kind": "route.highlight", "route_id": route["id"]}] if route else []),
        )
    if re.search(r"stroller|pram|stairs|tangga|wheelchair|kerusi roda|step", q):  # access hero
        if n == 0:
            return _call("find_place", query="car park b")
        if n == 1:
            return _call("find_place", query="playground")
        if n == 2:
            a, b = _data(rets[0][1]), _data(rets[1][1])
            if not a or not b:
                return _cannot("I couldn't find one of those places yet.")
            return _call("plan_route", from_id=a[0]["id"], to_id=b[0]["id"], profile="stroller")
        rr = _data(rets[-1][1])
        if not isinstance(rr, dict):
            return _cannot()
        routes = rr.get("routes") or []
        r0 = routes[0] if routes else None
        status = rr.get("status") or "no_data"
        ev = [i for i in _ev_ids(rets) if i.startswith("ev-")]
        caveats = _unknown_caveats(routes)
        if status != "confirmed" and not caveats:
            caveats = [f"Route status: {status}; not all segments are verified."]
        dist = r0.get("distance_m") if r0 else None
        return _final(
            answer_status="answered" if status == "confirmed" else "partial",
            summary=f"Route status: {status}" + (f", {dist} m." if dist is not None else "."),
            claims=[
                {
                    "text": "Segments on this route",
                    "status": "verified" if status == "confirmed" else "unverified",
                    "evidence_ids": ev[:4],
                }
            ],
            route_id=r0["id"] if r0 else None,
            caveats=caveats,
            scene_intents=[{"kind": "route.highlight", "route_id": r0["id"]}] if r0 else [],
        )
    # unknown: try to resolve, else cannot answer + missing_place VR
    if n == 0:
        return _call("find_place", query=q[:80])
    if n == 1 and not _data(rets[0][1]):
        return _call(
            "create_verification_request",
            target_id=q[:60] or "unknown",
            attribute="existence",
            reason="missing_place",
            question_summary="place not found",
        )
    return _final(
        answer_status="cannot_answer",
        summary="I don't have that place in the township model yet. I've asked the team to check.",
    )


def mock_model() -> FunctionModel:
    return FunctionModel(_script, model_name="mock-scripted")
