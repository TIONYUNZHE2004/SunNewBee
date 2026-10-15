"""Deterministic scripted model for CI and keyless development. Mirrors the 3 hero flows."""

import json
import re

from pydantic_ai import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.messages import ModelRequest, ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from .labels import attribute_label, status_label, unchecked_caveats


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


def _vrs(ret: dict) -> list[dict]:
    """Verification requests the plan_route call filed (or upvoted) this turn."""
    data = _data(ret)
    return (data or {}).get("verification_requests") or [] if isinstance(data, dict) else []


def _cannot(
    msg: str = "I couldn't get verified information for that yet.", **extra
) -> ModelResponse:
    return _final(answer_status="cannot_answer", summary=msg, **extra)


def _unknown_caveats(routes: list, vrs: list[dict] | None = None) -> list[str]:
    return unchecked_caveats([u for r in routes for u in r.get("unknowns") or []], vrs)


def _status_caveat(status: str, a: str, b: str) -> str:
    if status == "no_data":
        return f"No mapped connection between {a} and {b} (data gap)."
    return f"Route status: {status_label(status)}; some segments are still unverified."


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
DESTINATIONS = [
    "lakeside mall",
    "mall",
    "playground",
    "kiosk",
    "toilet",
]  # access hero; default "playground"
ORIGINS = ["lakeside mall", "playground", "car park b", "kiosk"]  # flood resident; default mall
# Access routing places, matched by position. Longest phrases first so "lakeside mall" beats "mall".
PLACE_WORDS = ["lakeside mall", "urban park", "car park b", "playground", "kiosk", "toilet", "mall"]
DEMO_ORIGIN = ("lakeside-mall", "Elmina Lakeside Mall")  # same start point the web uses
_WHERE_NEXT = r"where (?:can|should|do) (?:i|we) go|where (?:to|should i) (?:go|evacuate)"
_ACCESS_Q = (
    r"stroller|pram|stairs|tangga|wheelchair|kerusi roda|step|older adult|elderly|\brest\b"
    r"|\beasy\b|\bwalk\b|get to|from .+ to "
)
_PROFILE_WORDS = [
    ("wheelchair", r"wheelchair|kerusi roda"),
    ("stroller", r"stroller|pram|kereta sorong"),
    ("older_adult_rest", r"older adult|elderly|needs? to rest|warga emas"),
]
_FLOOD_NOTE = "This is not a forecast; follow official MBSA / JPS / NADMA guidance."


def _first(q: str, words: list[str], default: str) -> str:
    hits = [(q.find(w), w) for w in words if w in q]
    return min(hits)[1] if hits else default


def _place(text: str, default: str | None) -> str | None:
    """The first known place named in `text` (by position), else `default`."""
    hits = [(m.start(), w) for w in PLACE_WORDS if (m := re.search(re.escape(w), text))]
    return min(hits, key=lambda h: (h[0], -len(h[1])))[1] if hits else default


def _route_ends(q: str) -> tuple[str, str]:
    """Origin and destination words: "from X to Y", else "get to Y" with Car Park B as origin."""
    m = re.search(r"from (.+?) to (.+)", q)
    if m:
        return _place(m.group(1), "car park b"), _place(m.group(2), "playground")
    origin = _place(q.split("from ", 1)[1], "car park b") if "from " in q else "car park b"
    return origin, _place(q.replace(origin, " ", 1), "playground")


def _ui(info: AgentInfo, key: str) -> str | None:
    m = re.search(rf"{key}=(\w+)", info.instructions or "")
    return m.group(1) if m else None


def _profile(q: str, info: AgentInfo, fallback: str) -> str:
    """Profile named in the prompt, else the UI profile from the dynamic instructions."""
    for prof, pat in _PROFILE_WORDS:
        if re.search(pat, q):
            return prof
    m = re.search(r"profile=(\w+)", info.instructions or "")
    return m.group(1) if m and m.group(1) != "default" else fallback


_PLACE_Q = re.compile(
    r"^\s*(?:please\s+)?"
    r"(?:tell me (?:more )?about|what(?:'s| is) (?:at|in)|info(?:rmation)? (?:on|about))"
    r"\s+(.+?)\s*[?.!]*\s*$"
)


def _place_question(q: str) -> str | None:
    """The place named in "Tell me about <place>" / "What is at <place>", else None."""
    m = _PLACE_Q.match(q)
    return m.group(1) if m else None


def _claim_value(v) -> str:
    if isinstance(v, bool):
        return "yes" if v else "no"
    return str(v).replace("_", " ")


def _claim_status(ev: dict) -> tuple[str, str]:
    """(resident wording, FinalAnswer claim status) for one piece of evidence."""
    if ev.get("source_type") == "team_survey_placeholder":
        return "demo value, not surveyed", "unverified"
    status = ev.get("status")
    if status == "verified":
        return f"staff verified on {ev.get('verified_at') or 'an unrecorded date'}", "verified"
    if status == "stale":
        return "last check is out of date", "stale"
    if status == "reported":
        return "reported, not checked yet", "unverified"
    return "not checked yet", "unknown"


def _place_answer(details: dict, evidence: list[dict]) -> ModelResponse:
    """Summarise get_place_details: each recorded fact with its status. Files nothing."""
    pid = details["id"]
    kind = str(details.get("type") or "place").replace("_", " ")
    claims = [
        {
            "text": f"Place name and type: {details['name']} ({kind})",
            "status": "unverified",
            "evidence_ids": [f"ev-place-{pid}"],
        }
    ]
    statuses, placeholder = [], False
    for ev in evidence:
        if ev.get("attribute") in ("name", None) or ev["id"] == f"ev-place-{pid}":
            continue
        wording, status = _claim_status(ev)
        statuses.append(status)
        placeholder |= ev.get("source_type") == "team_survey_placeholder"
        raw = (details.get("claims") or {}).get(ev["attribute"], {}).get("value", ev.get("value"))
        claims.append(
            {
                "text": f"{attribute_label(ev['attribute'])}: {_claim_value(raw)} ({wording})",
                "status": status,
                "evidence_ids": [ev["id"]],
            }
        )
    caveats = []
    if not statuses:
        caveats.append("No other facts about this place are recorded yet.")
    if placeholder:
        caveats.append("Some facts are demo values, not yet surveyed.")
    if any(st != "verified" for st in statuses):
        caveats.append("Not every fact here has been checked by township staff yet.")
    answered = bool(statuses) and all(st == "verified" for st in statuses)
    return _final(
        answer_status="answered" if answered else "partial",
        summary=f"{details['name']} ({kind}): here is what the township model records.",
        claims=claims,
        caveats=caveats,
        scene_intents=[{"kind": "place.focus", "place_id": pid}],
    )


def _script(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    q = _prompt(messages).lower()
    rets = _returns(messages)
    n = len(rets)
    is_flood = bool(re.search(r"flood|river|banjir|sungai|rises|naik|水", q))
    ui_sid = _ui(info, "active_scenario")
    ui_sid = None if ui_sid == "none" else ui_sid
    where_next = bool(re.search(_WHERE_NEXT, q))
    if where_next and not ui_sid:  # no scenario to plan against: point at the river-level control
        return _cannot(
            "Pick a river level on the scenario bar, or ask about a specific route, "
            "and I can show where to go."
        )
    sid = ui_sid or "stage_p3m"
    if m := re.search(r"(\d+(?:\.\d+)?)\s*m\b", q) if is_flood else None:
        metres = float(m.group(1))
        if metres != int(metres) or not 1 <= metres <= 5:
            return _cannot("Scenarios exist for river levels +1 m to +5 m only.")
        sid = f"stage_p{int(metres)}m"
    level = f"River +{sid.removeprefix('stage_p').removesuffix('m')} m"
    scn = {"scenario_id": sid}
    if is_flood and re.search(
        r"cut off|affected|briefing|terjejas|island|isolated", q
    ):  # management
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
    if is_flood or where_next:  # resident: where can I go
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
                scenario_id=sid,
                profile=profile,
                near_place=origin,
            )
        centres = [c for c in (_data(rets[1][1]) or []) if c.get("reachable")]
        if n == 2:
            if not centres:
                return _cannot(none_reachable, **scn)
            # Centres are routable as transient "__centre__<id>" targets (their place_id may be
            # unmapped); the list only carries route ids for the nearest few, so always re-plan.
            return _call(
                "plan_route",
                from_id=origin,
                to_id=f"__centre__{centres[0]['centre']['id']}",
                profile=profile,
                scenario_id=sid,
            )
        if not centres:
            return _cannot(none_reachable, **scn)
        c0 = centres[0]["centre"]
        routes = (_data(rets[-1][1]) or {}).get("routes") or []
        route = routes[0] if routes else None
        flood_cav, flood_ev, likely = _endpoint_flood(_data(rets[-1][1]))
        caveats = _unknown_caveats(routes[:1], _vrs(rets[-1][1]))
        if route and route.get("status") != "confirmed" and not caveats:
            caveats = [_status_caveat(route.get("status"), found[0]["name"], c0["name"])]
        caveats = _placeholder_caveat(rets, flood_cav + caveats)
        confirmed = route and route.get("status") == "confirmed" and not likely
        start = (
            f" from {DEMO_ORIGIN[1]} (demo start point)"
            if where_next and origin == DEMO_ORIGIN[0]
            else ""
        )
        return _final(
            answer_status="answered" if confirmed else "partial",
            summary=(
                f"In the {level} indicative scenario, the nearest reachable centre{start} is "
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
            scenario_id=sid,
            caveats=caveats,
            scene_intents=[{"kind": "flood.set_level", "scenario_id": sid}]
            + ([{"kind": "route.highlight", "route_id": route["id"]}] if route else []),
        )
    if re.search(r"recycl|e-?waste|waste|rubbish|sampah|batter|\bbins?\b", q):  # waste points
        wtype = (
            "e_waste_drop_off"
            if re.search(r"e-?waste|batter|phone", q)
            else "recycling_drop_off"
            if re.search(r"recycl", q)
            else None
        )
        label = {"e_waste_drop_off": "e-waste drop-off", "recycling_drop_off": "recycling drop-off"}
        if n == 0:
            return _call("find_waste_points", type=wtype, near_place="lakeside-mall")
        pts = _data(rets[-1][1])
        if not pts and wtype and n == 1:  # nothing of that kind mapped: list what is nearest
            return _call("find_waste_points", near_place="lakeside-mall")
        if not pts:
            return _cannot("I don't have any waste points in the township model yet.")
        seen = set(_ev_ids(rets))
        pts = [p for p in pts if f"ev-{p['id']}.status" in seen][:3]
        if not pts:
            return _cannot()
        gap = bool(wtype) and n > 1  # the typed search was empty; these are other kinds
        names = list(dict.fromkeys(p["name"] for p in pts))
        unconfirmed = list(dict.fromkeys(p["name"] for p in pts if p.get("status") != "verified"))
        caveats = (
            [f"Not confirmed yet: {', '.join(unconfirmed)}; check before you go."]
            if unconfirmed
            else []
        )
        if gap:
            summary = (
                f"No {label[wtype]} is mapped yet. Nearest waste points, all unconfirmed: "
                f"{', '.join(names)}."
            )
            caveats.append(
                "Check with MBSA (Majlis Bandaraya Subang Jaya) for official "
                f"{label[wtype]} locations."
            )
        else:
            summary = f"Waste points found: {', '.join(names)}."
        return _final(
            answer_status="partial" if unconfirmed or gap else "answered",
            summary=summary,
            claims=[
                {
                    "text": f"{p['name']} ({p['type'].replace('_', ' ')}) status: {p['status']}",
                    "status": "verified" if p["status"] == "verified" else "unknown",
                    "evidence_ids": [f"ev-{p['id']}.status"],
                }
                for p in pts
            ],
            caveats=caveats,
        )
    if re.search(_ACCESS_Q, q):  # access hero
        origin_w, dest_w = _route_ends(q)
        if n == 0:
            return _call("find_place", query=origin_w)
        if n == 1:
            return _call("find_place", query=dest_w)
        plan_profile = _profile(q, info, _ui(info, "profile") or "stroller")
        if n == 2:
            a, b = _data(rets[0][1]), _data(rets[1][1])
            if not a or not b:
                return _cannot("I couldn't find one of those places yet.")
            return _call("plan_route", from_id=a[0]["id"], to_id=b[0]["id"], profile=plan_profile)
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
        caveats = _unknown_caveats(routes, _vrs(rets[-1][1]))
        if status != "confirmed" and not caveats:
            caveats = [_status_caveat(status, a.get("name", a["id"]), b.get("name", b["id"]))]
        caveats = _placeholder_caveat(rets, flood_cav + caveats)
        gap = r0.get("max_gap_between_rest_m") if r0 else None
        if gap is not None and plan_profile == "older_adult_rest":
            caveats.append(
                f"Rest stops mapped on this route: {len(r0.get('rest_points') or [])}; "
                f"the longest stretch without one is about {round(gap)} m."
            )
        dist = r0.get("distance_m") if r0 else None
        flagged = rr.get("endpoint_flood") or []
        return _final(
            answer_status="answered" if status == "confirmed" and not likely else "partial",
            scenario_id=flagged[0]["scenario_id"] if flagged else ui_sid,
            summary=(
                f"No mapped connection between {a.get('name', a['id'])} and "
                f"{b.get('name', b['id'])} (data gap)."
                if status == "no_data"
                else f"{a.get('name', a['id'])} to {b.get('name', b['id'])}: "
                f"route {status_label(status)}" + (f", {dist} m." if dist is not None else ".")
            ),
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
    place_q = _place_question(q)
    if n == 0:
        return _call("find_place", query=place_q or q[:80])
    found = _data(rets[0][1])
    if n == 1 and not found:
        # PDPA: never store the user's words on a staff-visible VR.
        return _call(
            "create_verification_request",
            target_id="unknown_place",
            attribute="existence",
            reason="missing_place",
            question_summary="place asked about in chat was not found in the township model",
        )
    if found and place_q:  # "Tell me about <place>": summarise what the model has, with statuses
        if n == 1:
            return _call("get_place_details", place_id=found[0]["id"])
        details = _data(rets[-1][1])
        if isinstance(details, dict):
            return _place_answer(details, rets[-1][1].get("evidence") or [])
        return _cannot("I couldn't get the details for that place yet.")
    if found:  # the place exists but this question is not one the mock can answer; no VR was filed
        return _cannot("I can't answer that from the township model yet.")
    return _final(
        answer_status="cannot_answer",
        summary="I don't have that place in the township model yet. I've asked the team to check.",
    )


def mock_model() -> FunctionModel:
    return FunctionModel(_script, model_name="mock-scripted")
