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
    """Evidence ids seen so far, first-seen order, without repeats."""
    return list(dict.fromkeys(e["id"] for _, r in rets for e in r.get("evidence", [])))


def _src(c: dict) -> str:
    return "official PPS" if c["source"] == "official_pps" else "candidate, not confirmed as a PPS"


def _call(name: str, **args) -> ModelResponse:
    return ModelResponse(parts=[ToolCallPart(tool_name=name, args=args)])


def _final(**ans) -> ModelResponse:
    return ModelResponse(parts=[ToolCallPart(tool_name="final_answer", args=ans)])


def _data(ret: dict):
    """Tool payload data, or None when the tool failed or returned nothing."""
    return ret.get("data") if ret.get("ok", True) else None


def _cannot(
    msg: str = "I couldn't get verified information for that yet.", **extra
) -> ModelResponse:
    return _final(answer_status="cannot_answer", summary=msg, **extra)


def _unknown_caveats(routes: list) -> list[str]:
    out = []
    for r in routes:
        for u in r.get("unknowns") or []:
            if u.get("attribute") == "flood":  # flood "unknowns" are possible-flood segments
                out.append(f"{u.get('element_id')}: {u.get('why') or 'possibly flooded'}")
            else:
                out.append(f"Not checked yet: {u.get('attribute')} on {u.get('element_id')}")
    return out


def _placeholder_caveat(rets, caveats: list[str]) -> list[str]:
    """Append the placeholder caveat when any evidence seen is team_survey_placeholder."""
    if any(
        e.get("source_type") == "team_survey_placeholder"
        for _, r in rets
        for e in r.get("evidence", [])
    ):
        return [*caveats, "Segment facts are demo values, not yet surveyed."]
    return caveats


def _endpoint_flood(route_data) -> tuple[list[str], list[str], bool]:
    """Caveats, evidence ids and "any likely flooded" for route endpoints in a flooded place."""
    flagged = (route_data or {}).get("endpoint_flood") or []
    caveats = [
        f"{f['name']} is {'likely' if f['flood_class'] == 'likely_flooded' else 'possibly'} "
        "flooded in this indicative scenario."
        for f in flagged
    ]
    ev = [f"ev-scn-{f['scenario_id']}.{f['place_id']}" for f in flagged]
    return caveats, ev, any(f["flood_class"] == "likely_flooded" for f in flagged)


# Pinned prompt words -> find_place queries. First match in the prompt wins.
DESTINATIONS = ["playground", "kiosk", "toilet"]  # access hero; default "playground"
ORIGINS = ["lakeside mall", "playground", "car park b", "kiosk"]  # flood resident; default mall
_PROFILE_WORDS = [
    ("wheelchair", r"wheelchair|kerusi roda"),
    ("stroller", r"stroller|pram|kereta sorong"),
]
_FLOOD_NOTE = "This is not a forecast; follow official MBSA / JPS / NADMA guidance."
_P3M = {"scenario_id": "stage_p3m"}


def _first(q: str, words: list[str], default: str) -> str:
    hits = [(q.find(w), w) for w in words if w in q]
    return min(hits)[1] if hits else default


def _profile(q: str, info: AgentInfo, fallback: str) -> str:
    """Profile named in the prompt, else the UI profile from the dynamic instructions."""
    for prof, pat in _PROFILE_WORDS:
        if re.search(pat, q):
            return prof
    m = re.search(r"profile=(\w+)", info.instructions or "")
    return m.group(1) if m and m.group(1) != "default" else fallback


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
        if not isinstance(a, dict):
            return _cannot()
        # Lists are capped by the tool: prefer the totals when present.
        likely = a["likely_total"] if "likely_total" in a else len(a.get("likely") or [])
        possible = a["possible_total"] if "possible_total" in a else len(a.get("possible") or [])
        ev = [i for i in _ev_ids(rets) if i == "ev-scn-stage_p3m"]
        if not ev:
            return _cannot()
        return _final(
            answer_status="answered",
            summary=(
                f"In the River +3 m indicative scenario, {likely} places/paths are likely "
                f"cut off and {possible} possibly. {_FLOOD_NOTE}"
            ),
            claims=[{"text": "Scenario River +3 m", "status": "indicative", "evidence_ids": ev}],
            scenario_id="stage_p3m",
            scene_intents=[{"kind": "flood.set_level", "scenario_id": "stage_p3m"}],
        )
    if is_flood:  # resident: where can I go
        if n == 0:
            return _call("find_place", query=_first(q, ORIGINS, "lakeside mall"))
        found = _data(rets[0][1]) or []
        origin = found[0]["id"] if found else None
        profile = _profile(q, info, "default")
        none_reachable = (
            f"No reachable centre found from there in this indicative scenario. {_FLOOD_NOTE}"
        )
        if n == 1:
            if not origin:
                return _cannot("I couldn't find where you are in the township model yet.")
            return _call(
                "list_evacuation_centres",
                scenario_id="stage_p3m",
                profile=profile,
                near_place=origin,
            )
        centres = [c for c in (_data(rets[1][1]) or []) if c.get("reachable")]
        if n == 2:
            if not centres:
                return _cannot(none_reachable, **_P3M)
            # Centres are routable as transient "__centre__<id>" targets (their place_id may be
            # unmapped); the list only carries route ids for the nearest few, so always re-plan.
            return _call(
                "plan_route",
                from_id=origin,
                to_id=f"__centre__{centres[0]['centre']['id']}",
                profile=profile,
                scenario_id="stage_p3m",
            )
        if not centres:
            return _cannot(none_reachable, **_P3M)
        c0 = centres[0]["centre"]
        routes = (_data(rets[-1][1]) or {}).get("routes") or []
        route = routes[0] if routes else None
        flood_cav, flood_ev, likely = _endpoint_flood(_data(rets[-1][1]))
        caveats = _unknown_caveats(routes[:1])
        if route and route.get("status") != "confirmed" and not caveats:
            caveats = [f"Route status: {route.get('status')}; some segments are still unverified."]
        caveats = _placeholder_caveat(rets, flood_cav + caveats)
        confirmed = route and route.get("status") == "confirmed" and not likely
        return _final(
            answer_status="answered" if confirmed else "partial",
            summary=(
                "In the River +3 m indicative scenario, the nearest reachable centre is "
                f"{c0['name']}; source: {_src(c0)}. {_FLOOD_NOTE}"
            ),
            claims=[
                {
                    "text": "Centre source and reachability",
                    "status": "indicative",
                    "evidence_ids": [
                        i for i in _ev_ids(rets) if i.startswith(("ev-centre-", "ev-scn-"))
                    ][:3],
                },
            ]
            + (
                [
                    {
                        "text": "Flood class of the route endpoint",
                        "status": "indicative",
                        "evidence_ids": flood_ev,
                    }
                ]
                if flood_ev
                else []
            ),
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
            return _call("find_place", query=_first(q, DESTINATIONS, "playground"))
        if n == 2:
            a, b = _data(rets[0][1]), _data(rets[1][1])
            if not a or not b:
                return _cannot("I couldn't find one of those places yet.")
            return _call(
                "plan_route",
                from_id=a[0]["id"],
                to_id=b[0]["id"],
                profile=_profile(q, info, "stroller"),
            )
        rr = _data(rets[-1][1])
        if not isinstance(rr, dict):
            return _cannot()
        routes = rr.get("routes") or []
        r0 = routes[0] if routes else None
        status = rr.get("status") or "no_data"
        a, b = _data(rets[0][1])[0], _data(rets[1][1])[0]
        seen = set(_ev_ids(rets))
        # Cite the two chosen places (not every find_place candidate) and the route's segments.
        ev = [i for i in (f"ev-place-{a['id']}", f"ev-place-{b['id']}") if i in seen]
        ev += [e["id"] for e in rets[-1][1].get("evidence", [])]
        flood_cav, flood_ev, likely = _endpoint_flood(rr)
        ev += flood_ev
        caveats = _unknown_caveats(routes)
        if status != "confirmed" and not caveats:
            caveats = [f"Route status: {status}; some segments are still unverified."]
        caveats = _placeholder_caveat(rets, flood_cav + caveats)
        dist = r0.get("distance_m") if r0 else None
        flagged = rr.get("endpoint_flood") or []
        m = re.search(r"active_scenario=(\w+)", info.instructions or "")
        ui_sid = m.group(1) if m and m.group(1) != "none" else None
        return _final(
            answer_status="answered" if status == "confirmed" and not likely else "partial",
            scenario_id=flagged[0]["scenario_id"] if flagged else ui_sid,
            summary=f"{a.get('name', a['id'])} to {b.get('name', b['id'])}: route {status}"
            + (f", {dist} m." if dist is not None else "."),
            claims=[
                {
                    "text": "Places and segments on this route",
                    "status": "verified" if status == "confirmed" else "unverified",
                    "evidence_ids": list(dict.fromkeys(ev)),
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
        # PDPA: never store the user's words on a staff-visible VR.
        return _call(
            "create_verification_request",
            target_id="unknown_place",
            attribute="existence",
            reason="missing_place",
            question_summary="place asked about in chat was not found in the township model",
        )
    return _final(
        answer_status="cannot_answer",
        summary="I don't have that place in the township model yet. I've asked the team to check.",
    )


def mock_model() -> FunctionModel:
    return FunctionModel(_script, model_name="mock-scripted")
