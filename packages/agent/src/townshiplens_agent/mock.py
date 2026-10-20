"""Deterministic scripted model for CI and keyless development. Mirrors the 3 hero flows."""

import json
import re

from pydantic_ai import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.messages import ModelRequest, ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel

from .journeys import PLAYABLE, journey_steps, start_time_for
from .labels import (
    LIKELY_OK_CAVEAT,
    attribute_label,
    closure_caveats,
    closure_summary_tail,
    inferred_caveats,
    rest_caveats,
    route_status_text,
    status_label,
    unchecked_caveats,
)
from .scope import CANNOT_FROM_DATA
from .template import (
    day_answer,
    day_change_answer,
    fixit_answer,
    greeting_answer,
    my_trip_answer,
    plan_answer,
    rollout_answer,
    scope_answer,
    tipping_answer,
    whatif_answer,
)


def _current(messages: list[ModelMessage]) -> list[ModelMessage]:
    """This turn's messages: from the last user prompt on (earlier turns are only history)."""
    starts = [
        i
        for i, m in enumerate(messages)
        if isinstance(m, ModelRequest) and any(isinstance(p, UserPromptPart) for p in m.parts)
    ]
    return messages[starts[-1] :] if starts else messages


def _prompt(messages: list[ModelMessage]) -> str:
    for m in _current(messages):
        if isinstance(m, ModelRequest):
            for p in m.parts:
                if isinstance(p, UserPromptPart) and isinstance(p.content, str):
                    return p.content
    return ""


def _returns(messages: list[ModelMessage]) -> list[tuple[str, dict]]:
    out = []
    for m in _current(messages):
        if isinstance(m, ModelRequest):
            for p in m.parts:
                # The previous turn's final_answer return can share a request with the new
                # prompt (multi-turn history): it is not a tool result.
                if isinstance(p, ToolReturnPart) and p.tool_name != "final_answer":
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


def _crossing(route: dict | None) -> list[str]:
    """plan_route's crossing and road notes, word for word (validator: crossing_note,
    road_note)."""
    route = route or {}
    return [n for n in (route.get("crossing_note"), route.get("road_note")) if n]


def _inferred(ret: dict) -> list[str]:
    """plan_route warnings about an endpoint whose entrance is not mapped (Task 43)."""
    return inferred_caveats(
        [
            w
            for w in ret.get("warnings") or []
            if w.startswith("Route ") and "entrance is not mapped" in w
        ]
    )


def _blocked_by_closure(closed: list[dict]) -> bool:
    return any(c.get("impact") == "blocked" for c in closed)


def _status_caveat(status: str, a: str, b: str) -> str:
    if status == "no_data":
        return f"No mapped connection between {a} and {b} (data gap)."
    if status == "likely_ok":
        return f"{LIKELY_OK_CAVEAT}."
    return f"Route status: {status_label(status)}; some segments are still unverified."


def _placeholder_caveat(rets, caveats: list[str]) -> list[str]:
    """Append the placeholder caveat when any evidence seen is team_survey_placeholder."""
    if any(
        route.get("access_metres", {}).get("likely_ok", 0) or route.get("status") == "likely_ok"
        for _, result in rets
        if isinstance(result.get("data"), dict)
        for route in result["data"].get("routes", [])
    ) and not any("estimated from map data" in c.lower() for c in caveats):
        caveats = [*caveats, f"{LIKELY_OK_CAVEAT}."]
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
PLACE_WORDS = [
    "lakeside mall car park b",  # the journey demo's destination (spec 2026-10-19 §2)
    "lakeside mall",
    "urban park",
    "car park b",
    "playground",
    "kiosk",
    "toilet",
    "mall",
]
DEMO_ORIGIN = ("lakeside-mall", "Elmina Lakeside Mall")  # same start point the web uses
_WHERE_NEXT = r"where (?:can|should|do) (?:i|we) go|where (?:to|should i) (?:go|evacuate)"
_ACCESS_Q = (
    r"stroller|pram|stairs|tangga|wheelchair|kerusi roda|step|older adult|elderly|\brest\b"
    r"|\beasy\b|\bwalk\b|get to|from .+ to |从.+?(?:走|步行)?到"
)
_PROFILE_WORDS = [
    ("wheelchair", r"wheelchair|kerusi roda"),
    ("stroller", r"stroller|pram|kereta sorong"),
    ("older_adult_rest", r"older adult|elderly|needs? to rest|warga emas|\bwalker\b|walking frame"),
]
_FLOOD_NOTE = "This is not a forecast; follow official MBSA / JPS / NADMA guidance."


def _first(q: str, words: list[str], default: str) -> str:
    hits = [(q.find(w), w) for w in words if w in q]
    return min(hits)[1] if hits else default


def _place(text: str, default: str | None) -> str | None:
    """The first known place named in `text` (by position), else `default`."""
    hits = [(m.start(), w) for w in PLACE_WORDS if (m := re.search(re.escape(w), text))]
    return min(hits, key=lambda h: (h[0], -len(h[1])))[1] if hits else default


def _named(phrase: str) -> str | None:
    """A place phrase the pinned words don't know ("harmoni 1"): find_place resolves it by name
    from the world. None when nothing is left after articles and punctuation."""
    words = re.sub(r"[?.!,]+", " ", phrase).split()
    words = words[1:] if words[:1] in (["the"], ["a"], ["my"]) else words
    return " ".join(words[:6]) or None


def _route_ends(q: str) -> tuple[str | None, str | None]:
    """Both endpoints must be stated; no silent demo origin. A phrase with no pinned place word
    is searched by its own words (find_place by name)."""
    m = re.search(r"from (.+?) to (.+)", q) or re.search(
        r"从(.+?)(?:走|步行)?到(.+?)(?:怎么走|怎样走|可以吗|吗)?[？?。]*$", q
    )
    if m:
        a, b = m.group(1), m.group(2)
        return _place(a, None) or _named(a), _place(b, None) or _named(b)
    return None, None


def _route_places(rets, ends: list[tuple[str, str | None]]):
    """Walk the find_place results for each (query, default) route end, in call order.

    A searched-by-name phrase ("harmoni 1") that find_place matches only weakly (top score below
    PLACE_MIN_SCORE) or not at all is not taken as the place: the end falls back to its default,
    or to no place when the default is None (no silent demo endpoint). Pinned words are taken as
    found.
    Returns (query still to search or None, [hit or None per end], results used)."""
    hits: list[dict | None] = []
    i = 0
    for query, default in ends:
        if i >= len(rets):
            return query, [None, None], i
        found = _data(rets[i][1]) or []
        i += 1
        top = found[0].get("score", 1.0) if found else 0.0
        if query not in PLACE_WORDS and top < PLACE_MIN_SCORE:
            if i >= len(rets):
                return default, [None, None], i
            found = _data(rets[i][1]) or []
            i += 1
        hits.append(found[0] if found else None)
    return None, hits, i


def _ui(info: AgentInfo, key: str) -> str | None:
    m = re.search(rf"{key}=(\w+)", info.instructions or "")
    return m.group(1) if m else None


def _no_answer(info: AgentInfo) -> str:
    """No tool answers the question: the management panel's words (T-023), else the resident's."""
    if _ui(info, "panel") == "management":
        return CANNOT_FROM_DATA
    return "I can't answer that from the township model yet."


def _profile(q: str, info: AgentInfo, fallback: str) -> str:
    """Profile named in the prompt, else the UI profile from the dynamic instructions."""
    for prof, pat in _PROFILE_WORDS:
        if re.search(pat, q):
            return prof
    m = re.search(r"profile=(\w+)", info.instructions or "")
    return m.group(1) if m and m.group(1) != "default" else fallback


PLACE_MIN_SCORE = 0.85  # find_place score needed to treat a hit as "the" place asked about
PLACE_CLEAR_MARGIN = 0.05  # the top hit must lead the next place by at least this much
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
    caveats = closure_caveats(details.get("closures") or [])
    if not statuses:
        caveats.append("No other facts about this place are recorded yet.")
    if placeholder:
        caveats.append("Some facts are demo values, not yet surveyed.")
    if any(st != "verified" for st in statuses):
        caveats.append("Not every fact here has been checked by township staff yet.")
    answered = bool(statuses) and all(st == "verified" for st in statuses)
    return _final(
        answer_status="answered" if answered else "partial",
        summary=f"{details['name']} ({kind}): "
        + ("it has a staff-reported closure; " if details.get("closures") else "")
        + "here is what the township model records.",
        claims=claims,
        caveats=caveats,
        scene_intents=[{"kind": "place.focus", "place_id": pid}],
    )


_CLOSURE_Q = r"\b(?:closed|closures?|reopen\w*)\b"
_ROUTE_Q = r"stroller|pram|wheelchair|older adult|elderly|\bwalk\b|get to|from .+ to "
_CLOSURE_PLACE = re.compile(
    r"\b(?:is|are|was)\s+(?:the\s+)?(.+?)\s+closed\b|\bclosures?\s+(?:near|at|around)\s+(?:the\s+)?(.+?)\s*[?.!]*$"
)


def _closure_place(q: str) -> str | None:
    """The place a closure question names ("Is the toilet closed?"), else None (list them all)."""
    m = _CLOSURE_PLACE.search(q)
    return next((g for g in (m.groups() if m else ()) if g), None)


def _closure_answer(rets, place_q: str | None) -> ModelResponse:
    """Name every closure get_closures returned, or say none is reported (never "it is open")."""
    name, ret = rets[-1]
    rows = _data(ret)
    if name != "get_closures" or not isinstance(rows, list):
        return _cannot("I couldn't look up closures just now.")
    ev = [e["id"] for e in ret.get("evidence", [])]
    if not rows:
        where = f" near {place_q}" if place_q else ""
        return _final(
            answer_status="partial",
            summary=f"No staff-reported closure{where} is on record. That is not a guarantee.",
            caveats=["Closures are staff reports, not a full list."],
        )
    return _final(
        answer_status="partial",
        summary=f"{len(rows)} staff-reported {'closure' if len(rows) == 1 else 'closures'}.",
        claims=[
            {
                "text": closure_caveats([r])[0],
                "status": "unverified",
                "evidence_ids": [f"ev-closure-{r['id']}"],
            }
            for r in rows
            if f"ev-closure-{r['id']}" in ev
        ],
        caveats=[*closure_caveats(rows), "A closure is a staff report, not a guarantee."],
    )


_PLAN = (
    r"which (?:facts|checks|things)\b|verify (?:first|next)|survey plan"
    r"|what should (?:staff|we|the team) (?:check|verify)"
)


def _plan(q: str, rets, info: AgentInfo) -> ModelResponse:
    """Survey-plan flow: one plan_verifications call, then narrate its numbers only."""
    profile = _profile(q, info, "wheelchair")
    if not rets:
        scope = "evacuation" if re.search(r"centre|center|evacuat|pps|shelter", q) else "suite"
        return _call("plan_verifications", profile=profile, scope=scope, budget=15)
    d = _data(rets[-1][1])
    if not isinstance(d, dict):
        return _cannot("I couldn't build a survey plan from the township model.")
    ev = [i for i in _ev_ids(rets) if i.startswith("ev-plan-")]
    return _final(**plan_answer(d, ev))


# River-level questions only: a river/flood/water word must appear (review I6).
_TIPPING = (
    r"(?=.*\b(?:river|flood|water|banjir|sungai)\b)"
    r"(?:(?:which|what) (?:river |water )?level|tipping|route (?:to [^?]* )?break"
    r"|does my (?:route|trip) break)"
)
_ROLLOUT = r"rising[- ]river|as the river rises|stage by stage|river rollout"


def _tipping(q: str, rets, info: AgentInfo) -> ModelResponse:
    profile = _profile(q, info, "default")
    if not rets:
        return _call("find_place", query=_first(q, ORIGINS, "lakeside mall"))
    if len(rets) == 1:
        found = _data(rets[0][1]) or []
        if not found:
            return _cannot("I couldn't find where you start in the township model yet.")
        return _call("river_tipping_point", from_id=found[0]["id"], profile=profile)
    d = _data(rets[-1][1])
    if not isinstance(d, dict):
        return _cannot("I couldn't run the river levels for that trip.")
    ev = [i for i in _ev_ids(rets) if i.startswith("ev-tip-")]
    return _final(**tipping_answer(d, ev))


def _rollout(q: str, rets, info: AgentInfo) -> ModelResponse:
    if not rets:
        return _call("rising_river_rollout")
    d = _data(rets[-1][1])
    if not isinstance(d, dict):
        return _cannot("I couldn't run the rising-river simulation.")
    ev = [i for i in _ev_ids(rets) if i.startswith("ev-rollout-")]
    return _final(**rollout_answer(d, ev))


_FIXIT = (
    r"\bwhich (?:\d+ |two |three )?(?:changes|fixes) would\b|\bbest (?:fixes|changes)\b"
    r"|\bfix-it\b"
)


def _fixit(q: str, rets, info: AgentInfo) -> ModelResponse:
    profile = _profile(q, info, "wheelchair")
    if not rets:
        stage = None
        if (m := re.search(r"(\d+)\s*m\b", q)) and 1 <= int(m.group(1)) <= 5:
            stage = f"stage_p{m.group(1)}m"
        scope = "suite" if re.search(r"trip|journey|everyday", q) else "evacuation"
        words = {"two": 2, "three": 3, "one": 1}
        nb = re.search(r"which (\d+|one|two|three) (?:changes|fixes)", q)
        budget = (int(nb.group(1)) if nb.group(1).isdigit() else words[nb.group(1)]) if nb else 2
        return _call("find_fixes", profile=profile, scope=scope, scenario_id=stage, budget=budget)
    d = _data(rets[-1][1])
    if not isinstance(d, dict):
        return _cannot("I couldn't run the fix-it search on the township model.")
    ev = [i for i in _ev_ids(rets) if i.startswith("ev-fixit-")]
    return _final(**fixit_answer(d, ev))


_WHATIF = r"\bwhat[- ]if\b|\bimagine\b|\bif (?:we|you|staff) (?:build|add|close|verify)\b"


def _whatif(q: str, rets, info: AgentInfo) -> ModelResponse:
    """What-if hero flow: engine suggestions -> one simulation -> narrate its summary only."""
    profile = _profile(q, info, "wheelchair")
    if not rets:
        return _call("suggest_interventions", profile=profile)
    if len(rets) == 1:
        cands = (_data(rets[0][1]) or {}).get("candidates") or []
        want = (
            "build_ramp"
            if "ramp" in q
            else "close_path"
            if "close" in q
            else "verify_fact"
            if "verif" in q
            else None
        )
        pick = next((c for c in cands if c["action"]["kind"] == want), cands[0] if cands else None)
        actions = [pick["action"]] if pick else []
        if (m := re.search(r"(\d+)\s*m\b", q)) and 1 <= int(m.group(1)) <= 5:
            stage = {"kind": "set_river_stage", "scenario_id": f"stage_p{m.group(1)}m"}
            actions.insert(0, stage)
        if not actions:
            return _cannot("I couldn't find a change to imagine for that yet.")
        scope = "evacuation" if re.search(r"centre|center|evacuat|pps|shelter", q) else "suite"
        return _call("simulate_what_if", actions=actions, profile=profile, scope=scope)
    d = _data(rets[-1][1])
    if not isinstance(d, dict):
        return _cannot("I couldn't run that what-if on the township model.")
    wi = {**d, "labels": d.get("action_labels") or []}
    ev = [i for i in _ev_ids(rets) if i.startswith("ev-whatif-")]
    return _final(**whatif_answer(wi, ev))


_DAY = r"\brehears|\bsimulated day\b|\belmina day\b|\ba day in elmina\b|\blatihan\b"


def _day_id(q: str) -> str:
    # a day named in the question wins over flood words ("raise the flooded road in the event
    # rehearsal", review C17)
    return (
        "weekday"
        if re.search(r"weekday|hari biasa", q)
        else "friday"
        if re.search(r"friday|jumaat|jumat|prayer", q)
        else "event"
        if re.search(r"\bevent|night|community|acara|malam|taman", q)
        else "storm"
        if re.search(r"storm|flood|rain|river|banjir|ribut|水", q)
        else "event"
        if re.search(r"\bpark\b", q)
        else "weekday"
    )


def _day(q: str, rets, info: AgentInfo) -> ModelResponse:
    if not rets:
        return _call("day_rehearsal", day=_day_id(q))
    d = _data(rets[-1][1])
    if not isinstance(d, dict):
        return _cannot("I couldn't run the simulated day on the township model.")
    ev = [i for i in _ev_ids(rets) if i.startswith("ev-day-")]
    return _final(**day_answer(d, ev))


_MY_TRIP = (
    r"(?=.*(?:\brehears|\bstorm\b|\bribut\b|\blatihan\b|\bsimulated day\b))"
    r"(?=.*(?:\bmy trip\b|\bi leave\b|\bleav(?:e|ing) at\b|\bbertolak\b))"
)
_ENDS = re.compile(r"from (.+?) to (.+?)(?=\s+(?:at|by|with|in|on|leaving|if|during)\b|[?.,]|$)")


def _leave_at(q: str) -> str:
    m = re.search(r"\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b|\b(\d{1,2})[:.](\d{2})\b", q)
    if not m:
        return "07:30"
    if m.group(3):
        h, mm = int(m.group(1)), int(m.group(2) or 0)
        h = h % 12 + (12 if m.group(3) == "pm" else 0)
    else:
        h, mm = int(m.group(4)), int(m.group(5))
    return f"{h:02d}:{mm:02d}"


def _my_trip(q: str, rets, info: AgentInfo) -> ModelResponse:
    m = _ENDS.search(q)
    if not m:
        return _cannot("Tell me where your trip starts and ends, and when you leave.")
    n = len(rets)
    if n == 0:
        return _call("find_place", query=m.group(1).strip())
    if n == 1:
        return _call("find_place", query=m.group(2).strip())
    if n == 2:
        a, b = _data(rets[0][1]), _data(rets[1][1])
        if not a or not b:
            return _cannot("I couldn't find one of those places yet.")
        prof = "drive" if re.search(r"\bby car\b|\bdrive\b|\bkereta\b", q) else None
        return _call(
            "rehearse_my_trip",
            from_id=a[0]["id"],
            to_id=b[0]["id"],
            leave_at=_leave_at(q),
            day=_day_id(q),
            profile=prof or _profile(q, info, "default"),
        )
    d = _data(rets[-1][1])
    if not isinstance(d, dict):
        return _cannot("I couldn't rehearse that trip on the township model.")
    ev = [i for i in _ev_ids(rets) if i.startswith("ev-mytrip-")]
    return _final(**my_trip_answer(d, ev))


_DAY_CHANGE = (
    r"(?=.*(?:\brehears|\bstorm\b|\bribut\b|\blatihan\b|\bsimulated day\b))"
    r"(?=.*(?:\bwhich (?:one )?change\b|\btest (?:a |the |another |option)"
    r"|\bchange (?:to test|would help|that would)|\braise[ds]?\b|\braising\b|\boption \d\b"
    r"|\bperubahan\b|\btinggikan\b))"
)


def _day_change(q: str, rets, info: AgentInfo) -> ModelResponse:
    if not rets:
        m = re.search(r"\boption (\d)\b|\bpilihan (\d)\b", q)
        n = int(next(g for g in m.groups() if g)) if m else 1
        return _call("day_test_change", day=_day_id(q), option=n)
    d = _data(rets[-1][1])
    if not isinstance(d, dict):
        return _cannot("I couldn't test that change on the simulated day.")
    ev = [i for i in _ev_ids(rets) if i.startswith("ev-daychange-")]
    return _final(**day_change_answer(d, ev))


def _script(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    q = _prompt(messages).lower()
    from .scope import is_greeting, outside_scope
    from .settings import AgentSettings

    scope = _ui(info, "assistant_scope") or AgentSettings().assistant_scope
    if scope == "access_flood" and is_greeting(q):
        return _final(**greeting_answer(q).model_dump())
    if scope == "access_flood" and outside_scope(q):
        return _final(**scope_answer(q).model_dump())
    rets = _returns(messages)
    n = len(rets)
    if scope == "all" and re.search(_MY_TRIP, q):
        return _my_trip(q, rets, info)
    if scope == "all" and re.search(_DAY_CHANGE, q):
        return _day_change(q, rets, info)
    if scope == "all" and re.search(_DAY, q):
        return _day(q, rets, info)
    if scope == "all" and re.search(_FIXIT, q):
        return _fixit(q, rets, info)
    if scope == "all" and re.search(_ROLLOUT, q):
        return _rollout(q, rets, info)
    if scope == "all" and re.search(_TIPPING, q):
        return _tipping(q, rets, info)
    if scope == "all" and re.search(_PLAN, q):
        return _plan(q, rets, info)
    if scope == "all" and re.search(_WHATIF, q):
        return _whatif(q, rets, info)
    is_flood = bool(re.search(r"flood|river|banjir|sungai|rises|naik|水", q))
    ui_sid = _ui(info, "active_scenario")
    ui_sid = None if ui_sid == "none" else ui_sid
    where_next = bool(re.search(_WHERE_NEXT, q))
    names_level = is_flood and bool(re.search(r"\d+(?:\.\d+)?\s*m\b", q))
    if where_next and not ui_sid and not names_level:  # no scenario to plan against
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
            return _call(
                "affected_places", scenario_id=sid, kind="all", profile=_profile(q, info, "default")
            )
        a = _data(rets[-1][1])
        if not isinstance(a, dict):
            return _cannot()

        # Lists are capped by the tool: use the counts, places and path segments apart.
        def both(side: str) -> str:
            if f"{side}_place_count" not in a:
                return f"{a.get(f'{side}_total', len(a.get(side) or []))} places/paths"
            pl, pa = a[f"{side}_place_count"], a[f"{side}_path_count"]
            return (
                f"{pl} {'place' if pl == 1 else 'places'} and "
                f"{pa} path {'segment' if pa == 1 else 'segments'}"
            )

        likely, possible = both("likely"), both("possible")  # a malformed payload raises here
        ev = [i for i in _ev_ids(rets) if i == f"ev-scn-{sid}"]
        if not ev:
            return _cannot()
        return _final(
            answer_status="answered",
            summary=(
                f"In the {level} indicative scenario, {likely} are likely flooded, "
                f"and {possible} possibly. {_FLOOD_NOTE}"
            ),
            claims=[{"text": f"Scenario {level}", "status": "indicative", "evidence_ids": ev}],
            scenario_id=sid,
            scene_intents=[{"kind": "flood.set_level", "scenario_id": sid}],
        )
    if is_flood and re.search(r"is the playground|playground safe", q):
        if n == 0:
            return _call("affected_places", scenario_id=sid)
        data = _data(rets[-1][1])
        row = next((p for p in data.get("likely", []) if p.get("id") == "playground"), None)
        if not row:
            return _cannot("The scenario does not give a checked answer for that place.", **scn)
        return _final(
            answer_status="partial",
            summary=f"{row['name']} is likely flooded in this indicative scenario. {_FLOOD_NOTE}",
            claims=[{"text": row["name"], "status": "indicative", "evidence_ids": _ev_ids(rets)}],
            scenario_id=sid,
            scene_intents=[{"kind": "flood.set_level", "scenario_id": sid}],
        )
    if is_flood or where_next:  # resident: where can I go
        if n == 0:
            origin_word = _first(q, ORIGINS, None)
            if not origin_word:
                return _cannot(
                    "Please name your starting place before I select an evacuation route.", **scn
                )
            return _call("find_place", query=origin_word)
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
        rest = rest_caveats(route) if route else []
        closed = (_data(rets[-1][1]) or {}).get("closures") or []
        if (
            route
            and route.get("status") != "confirmed"
            and not caveats
            and not rest
            and not _blocked_by_closure(closed)
        ):
            caveats = [_status_caveat(route.get("status"), found[0]["name"], c0["name"])]
        caveats = _placeholder_caveat(
            rets,
            flood_cav
            + caveats
            + rest
            + _crossing(route)
            + closure_caveats(closed)
            + _inferred(rets[-1][1])
            + inferred_caveats([n for n in [centres[0].get("entrance_note")] if n]),
        )
        confirmed = route and route.get("status") == "confirmed" and not likely and not closed
        start = f" from {found[0]['name']}" if where_next and origin == DEMO_ORIGIN[0] else ""
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
    if re.search(
        r"recycl|e-?waste|waste|rubbish|sampah|batter(?:y|ies)|\bbins?\b", q
    ):  # waste points
        wtype = (
            "e_waste_drop_off"
            if re.search(r"e-?waste|batter(?:y|ies)|phone", q)
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
        asks_when = bool(re.search(r"\bwhen\b|schedule|which day|what day|jadual", q))
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
        if asks_when:  # the model holds locations only: say so instead of implying a timetable
            caveats.append(
                "No collection schedule is recorded for these points; ask MBSA for the "
                "collection day."
            )
        return _final(
            answer_status="partial" if unconfirmed or gap or asks_when else "answered",
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
    if re.search(_CLOSURE_Q, q) and not re.search(_ROUTE_Q, q):  # is X closed?
        place_q = _closure_place(q)
        if n == 0:
            return _call("find_place", query=place_q) if place_q else _call("get_closures")
        found = _data(rets[0][1]) if rets[0][0] == "find_place" else None
        if rets[0][0] == "find_place" and n == 1:
            top = found[0].get("score", 1.0) if found else 0.0
            if top < PLACE_MIN_SCORE:
                return _cannot("I couldn't find that place in the township model yet.")
            close = [p for p in found if top - p.get("score", 1.0) < PLACE_CLEAR_MARGIN]
            if len(close) > 1:
                names = list(dict.fromkeys(p["name"] for p in close))[:3]
                return _cannot(f"Which place do you mean? {', '.join(names)}?")
            return _call("get_closures", near_place=found[0]["id"])
        return _closure_answer(rets, place_q)
    if re.search(_ACCESS_Q, q):  # access hero
        origin_w, dest_w = _route_ends(q)
        if not origin_w or not dest_w:
            return _cannot("Please name the exact start and destination before I select a route.")
        need, (a, b), used = _route_places(rets, [(origin_w, None), (dest_w, None)])
        if need:
            return _call("find_place", query=need)
        plan_profile = _profile(q, info, _ui(info, "profile") or "stroller")
        if n == used:
            if not a or not b:
                return _cannot("I couldn't find one of those places yet.")
            return _call("plan_route", from_id=a["id"], to_id=b["id"], profile=plan_profile)
        rr = _data(rets[-1][1])
        if not isinstance(rr, dict):
            return _cannot()
        routes = rr.get("routes") or []
        r0 = routes[0] if routes else None
        status = rr.get("status") or "no_data"
        seen = set(_ev_ids(rets))
        # Cite the two chosen places (not every find_place candidate) and the route's segments.
        ev = [i for i in (f"ev-place-{a['id']}", f"ev-place-{b['id']}") if i in seen]
        ev += [e["id"] for e in rets[-1][1].get("evidence", [])]
        flood_cav, flood_ev, likely = _endpoint_flood(rr)
        ev += flood_ev
        caveats = _unknown_caveats(routes, _vrs(rets[-1][1]))
        # Rest-limit lines (older_adult_rest): the gap over the limit, or unverified rest points.
        rest = rest_caveats(r0) if r0 else []
        closed = rr.get("closures") or []
        if (
            status not in ("confirmed", "no_data")
            and not caveats
            and not rest
            and not _blocked_by_closure(closed)
        ):
            # no_data: the summary says it
            caveats = [_status_caveat(status, a.get("name", a["id"]), b.get("name", b["id"]))]
        caveats = _placeholder_caveat(
            rets,
            flood_cav
            + caveats
            + rest
            + _crossing(r0)
            + closure_caveats(closed)
            + _inferred(rets[-1][1]),
        )
        gap = r0.get("max_gap_between_rest_m") if r0 else None
        if gap is not None and plan_profile == "older_adult_rest" and not rest:
            caveats.append(
                f"Rest stops mapped on this route: {len(r0.get('rest_points') or [])}; "
                f"the longest stretch without one is about {round(gap)} m."
            )
        dist = r0.get("distance_m") if r0 else None
        flagged = rr.get("endpoint_flood") or []
        # The walk (spec 2026-10-19 §6.3): played after the highlight, and told in the answer
        # with the counts and names plan_route's journey facts give (never computed here).
        facts = (r0 or {}).get("journey")
        walk = bool(facts) and status in PLAYABLE and not closed
        intents = [{"kind": "route.highlight", "route_id": r0["id"]}] if r0 else []
        if walk:
            intents.append(
                {"kind": "journey.play", "route_id": r0["id"], "start_time": start_time_for(q)}
            )
        summary = (
            f"No mapped connection between {a.get('name', a['id'])} and "
            f"{b.get('name', b['id'])} (data gap)."
            if status == "no_data"
            else f"{a.get('name', a['id'])} to {b.get('name', b['id'])}: "
            f"route {closure_summary_tail(closed, status, r0) or route_status_text(status, r0)}"
            + (f", {dist} m." if dist is not None else ".")
        )
        if walk and dist is not None:
            est = r0["est_minutes"]
            mins = round(est) if est >= 10 else round(est, 1)  # "about 1 min" for 0.8 is not
            summary = (
                f"{a.get('name', a['id'])} to {b.get('name', b['id'])}: route "
                f"{route_status_text(status, r0)}. There is a mapped walking route of about "
                f"{round(dist)} m, about {mins:g} min at this pace plus rests."
            )
        return _final(
            answer_status="answered"
            if status == "confirmed" and not likely and not closed
            else "partial",
            scenario_id=flagged[0]["scenario_id"] if flagged else ui_sid,
            summary=summary,
            steps=journey_steps(facts) if walk else [],
            claims=[
                {
                    "text": "Places and segments on this route",
                    "status": "verified" if status == "confirmed" else "unverified",
                    "evidence_ids": list(dict.fromkeys(ev)),
                }
            ],
            route_id=r0["id"] if r0 else None,
            caveats=caveats,
            scene_intents=intents,
        )
    # unknown: try to resolve, else cannot answer + missing_place VR
    place_q = _place_question(q)
    if n == 0:
        return _call("find_place", query=place_q or q[:80])
    found = _data(rets[0][1]) or []
    top = found[0].get("score", 1.0) if found else 0.0
    if n == 1 and found and top < PLACE_MIN_SCORE and not place_q:
        # No place phrase was recognised, so the whole question was searched and only weakly
        # matched: a place may exist, so don't say it is missing or file a VR.
        return _cannot(_no_answer(info))
    if n == 1 and not found and not place_q and _ui(info, "panel") == "management":
        return _cannot(_no_answer(info))  # T-023: no place was named, so no place is missing
    if n == 1 and top < PLACE_MIN_SCORE:  # nothing found: the place is missing
        # PDPA: never store the user's words on a staff-visible VR.
        return _call(
            "create_verification_request",
            target_id="unknown_place",
            attribute="existence",
            reason="missing_place",
            question_summary="place asked about in chat was not found in the township model",
        )
    if top < PLACE_MIN_SCORE:
        # T-022: none found -> "I can't find that place. Did you mean X?" (a weak match only)
        guess = f" Did you mean {found[0]['name']}?" if found else ""
        return _final(
            answer_status="cannot_answer",
            summary=f"I can't find that place.{guess} I've asked the team to check.",
        )
    if place_q:  # "Tell me about <place>": summarise what the model has, with statuses
        close = [p for p in found if top - p.get("score", 1.0) < PLACE_CLEAR_MARGIN]
        if len(close) > 1:  # no clear top hit: ask, claim no follow-up
            names = list(dict.fromkeys(p["name"] for p in close))[:3]
            return _cannot(f"Which place do you mean? {', '.join(names)}?")
        if n == 1:
            return _call("get_place_details", place_id=found[0]["id"])
        details = _data(rets[-1][1])
        if isinstance(details, dict):
            return _place_answer(details, rets[-1][1].get("evidence") or [])
        return _cannot("I couldn't get the details for that place yet.")
    return _cannot(_no_answer(info))  # found; no VR was filed


STREAM_CHUNK = 24  # characters of tool-call JSON per streamed delta


async def _stream_script(messages: list[ModelMessage], info: AgentInfo):
    """The same scripted response, streamed in small JSON chunks like a real provider, so the
    draft stream (`answer.draft`) is exercised keylessly in tests and e2e."""
    resp = _script(messages, info)
    for i, part in enumerate(resp.parts):
        args = part.args if isinstance(part.args, str) else json.dumps(part.args)
        call_id = f"mock-{i}"
        yield {i: DeltaToolCall(name=part.tool_name, json_args="", tool_call_id=call_id)}
        for k in range(0, len(args), STREAM_CHUNK):
            yield {i: DeltaToolCall(json_args=args[k : k + STREAM_CHUNK], tool_call_id=call_id)}


def mock_model() -> FunctionModel:
    return FunctionModel(_script, stream_function=_stream_script, model_name="mock-scripted")
