import re

from .answer import Claim, FinalAnswer
from .events import SceneIntent
from .labels import (
    attribute_label,
    closure_caveats,
    closure_summary_tail,
    inferred_caveats,
    profile_label,
    rest_caveats,
    route_status_text,
    unchecked_caveats,
)
from .record import TurnRecord
from .validate import DEPTH, FORBIDDEN, PLACEHOLDER_CAVEAT, PLACEHOLDER_SOURCE


def _cannot_summary(rec: TurnRecord, question: str) -> str:
    """Say what could not be resolved: a missing attribute if a tool surfaced one, else the query.

    The question is only echoed outside flood turns and when it passes the flood-wording and
    depth rules (it is the user's own text; never let it smuggle forbidden wording in).
    """
    tail = " I've noted the gap for the township team." if rec.vrs else ""
    # Name the gap only when the unknown facts this turn all belong to one element (otherwise
    # an unrelated unknown could be reported), in readable words (no ids or attribute keys).
    unknown = [e for e in rec.evidence.values() if str(e.status) == "unknown"]
    if unknown and len({e.element_id for e in unknown}) == 1:
        labels = list(dict.fromkeys(attribute_label(e.attribute).lower() for e in unknown))
        return f"I don't have a checked {', '.join(labels[:3])} for that place yet.{tail}"
    q = " ".join(question.split())[:80]
    if q and not rec.scenarios_used and not FORBIDDEN.search(q) and not DEPTH.search(q):
        return f'I couldn\'t find an answer for "{q}" in the township model yet.{tail}'
    return f"I couldn't find verified information to answer that yet.{tail}"


WHATIF_CAVEAT = "Imagined changes are not real; unverified facts stay unverified."
FLOOD_GUIDANCE = (
    "This is an indicative scenario, not a forecast. Follow official MBSA / JPS / NADMA guidance."
)


def _stage_words(sid: str | None) -> str | None:
    m = re.fullmatch(r"stage_p(\d)m", sid or "")
    return f"River +{m.group(1)} m" if m else None


def whatif_answer(wi: dict, evidence_ids: list[str]) -> dict:
    """FinalAnswer fields for one what-if result (shared by the mock and the template, so the
    validator, mock and template agree on what-if wording). Every number is from `summary`."""
    sm = wi.get("summary") or {}
    who = profile_label(wi.get("profile") or "default").lower()
    goal = (
        "reach an evacuation centre" if wi.get("scope") == "evacuation" else "have a mapped route"
    )
    labels = "; ".join(wi.get("labels") or []) or "no change"
    stage, base = wi.get("scenario_id"), wi.get("base_scenario_id")
    # "today" only when the before-state is the real river level, else name its stage
    before = f"before, at {_stage_words(base)}" if _stage_words(base) else "today"
    total = sm.get("total", 0)
    if "reach_stage_only" in sm:  # river rise + interventions: the flood alone, then both
        summary = (
            f"In this what-if simulation ({labels}): with the river rise alone, "
            f"{sm['reach_stage_only']} of {total} {who} journeys would {goal}; with the changes "
            f"too, {sm.get('reach_after', 0)} would ({before}: {sm.get('reach_before', 0)})."
        )
    else:
        summary = (
            f"In this what-if simulation ({labels}), {sm.get('reach_after', 0)} of {total} "
            f"{who} journeys would {goal} ({before}: {sm.get('reach_before', 0)}), and "
            f"{sm.get('confirmed_after', 0)} would be confirmed "
            f"({before}: {sm.get('confirmed_before', 0)})."
        )
    caveats = [WHATIF_CAVEAT]
    if sm.get("confirmed_on_demo_after"):
        caveats.append(f"Segment facts are {PLACEHOLDER_CAVEAT}.")
    intents: list[dict] = [{"kind": "whatif.diff"}]
    if stage or base:
        caveats.append(FLOOD_GUIDANCE)
    if stage:
        intents.append({"kind": "flood.set_level", "scenario_id": stage})
    return {
        "answer_status": "partial",
        "summary": summary,
        "claims": [
            {"text": "What-if simulation", "status": "indicative", "evidence_ids": evidence_ids}
        ],
        "scenario_id": stage or base,
        "caveats": caveats,
        "scene_intents": intents,
    }


PLAN_CAVEAT = (
    "A planning estimate from the township model: nothing is confirmed until staff check on site."
)


def plan_answer(plan: dict, evidence_ids: list[str]) -> dict:
    """FinalAnswer fields for a survey plan (shared by the mock and the template)."""
    sm = plan.get("summary") or {}
    facts = plan.get("facts") or []
    who = profile_label(plan.get("profile") or "default").lower()
    goal = " to an evacuation centre" if plan.get("scope") == "evacuation" else ""
    if not facts:
        summary = (
            "No set of checks within this budget would give a sample journey a confirmed route "
            "in the township model yet."
        )
        steps: list[str] = []
    else:
        n, places = len(facts), int(plan.get("places", 0))
        summary = (
            f"If {'this check' if n == 1 else f'these {n} checks'} at "
            f"{'1 place' if places == 1 else f'{places} places'} pass"
            f"{'es' if n == 1 else ''}, {sm.get('confirmed_after', 0)} of {sm.get('total', 0)} "
            f"sampled {who} journeys would have a confirmed route{goal} "
            f"(today: {sm.get('confirmed_before', 0)})."
        )
        by: dict[str, tuple[str, list[str]]] = {}  # one step per path (unnamed ones differ)
        for f in facts:
            where = f.get("path_label") or "a path"
            by.setdefault(f.get("element_id") or where, (where, []))[1].append(f.get("check") or "")
        steps = [f"{w[:1].upper()}{w[1:]}: check {', '.join(c)}" for w, c in by.values()]
    caveats = [PLAN_CAVEAT]
    if n := sum(1 for f in facts if f.get("ticket_id")):
        caveats.append(f"{n} of these checks already have an open ticket.")
    return {
        "answer_status": "partial",
        "summary": summary,
        "steps": steps[:8],
        "claims": [{"text": "Survey plan", "status": "indicative", "evidence_ids": evidence_ids}],
        "caveats": caveats,
    }


ROLLOUT_GUIDANCE = (
    "Indicative simulation with synthetic residents, not a forecast; follow official MBSA / JPS "
    "/ NADMA guidance."
)
_STATUS_WORDS = {
    "confirmed": "confirmed",
    "partly_unverified": "partly unverified",
    "blocked": "cut off",
    "no_data": "no mapped connection",
}


def tipping_answer(tp: dict, evidence_ids: list[str]) -> dict:
    """FinalAnswer fields for a tipping point (shared by the mock and the template)."""
    labels = tp.get("labels") or {}
    origin = tp.get("from_name") or "your start"
    to_centre = tp.get("to_id") == "__nearest_centre__"
    target = tp.get("target_name") or ("the nearest evacuation centre" if to_centre else "there")
    rows = tp.get("stages") or []
    br = tp.get("breaks_at")
    demo = any(r.get("demo_evidence") for r in rows)
    caveats = [ROLLOUT_GUIDANCE]

    def status_words(r: dict) -> str:
        w = _STATUS_WORDS.get(r["status"], r["status"])
        if r.get("demo_evidence"):
            w = "confirmed (on demo values, not yet surveyed)"
        if "likely_flooded" in (r.get("start_flood"), r.get("end_flood")):
            w += (
                "; the start is likely flooded"
                if r.get("start_flood") == "likely_flooded"
                else ("; the destination is likely flooded")
            )
        elif r.get("start_flood") or r.get("end_flood"):
            w += "; possibly flooded at the start or destination"
        if to_centre and r.get("target_name"):
            w += f" (nearest centre: {r['target_name']})"
        return w

    if not tp.get("reached_at_normal", True):
        base = rows[0]["status"] if rows else "no_data"
        why = (
            "there is no mapped connection (a data gap)"
            if base == "no_data"
            else "it is cut off even at normal river level"
        )
        summary = (
            f"In this simulation, the trip from {origin} has no working route at any modelled "
            f"river level: {why}. Indicative scenarios, not a forecast."
        )
    elif br:
        row = next((r for r in rows if r["stage"] == br), {})
        flood = "likely_flooded" in (row.get("start_flood"), row.get("end_flood"))
        why = (
            ", because the start or destination is likely flooded there"
            if flood and row.get("status") in ("confirmed", "partly_unverified")
            else ""
        )
        summary = (
            f"In this simulation, the trip from {origin} to {target} is cut off from "
            f"{labels.get(br, br)}{why} (indicative river scenarios, not a forecast)."
        )
    else:
        summary = (
            f"In this simulation, the trip from {origin} to {target} keeps a mapped route at every "
            "modelled river level; indicative scenarios, not a forecast."
        )
    if tp.get("centre_changes"):
        caveats.append("The nearest reachable centre changes as the river rises (see each level).")
    if demo:
        caveats.append(f"Segment facts are {PLACEHOLDER_CAVEAT}.")
    stage_ids = [r["stage"] for r in rows if r["stage"] != "baseline"]
    return {
        "answer_status": "partial",
        "summary": summary,
        "steps": [f"{labels.get(r['stage'], r['stage'])}: {status_words(r)}" for r in rows],
        "claims": [
            {"text": "River tipping point", "status": "indicative", "evidence_ids": evidence_ids}
        ],
        "scenario_id": stage_ids[-1] if stage_ids else None,
        "caveats": caveats,
    }


def rollout_answer(ro: dict, evidence_ids: list[str]) -> dict:
    """FinalAnswer fields for a rising-river rollout (shared by the mock and the template)."""
    stages = ro.get("stages") or []
    start, last = (stages[0], stages[-1]) if stages else ({}, {})
    parts = []
    for prof, per in (ro.get("counts") or {}).items():
        a, b = per.get(start.get("id"), {}), per.get(last.get("id"), {})
        parts.append(
            f"{b.get('reach', 0)} of {b.get('total', 0)} {profile_label(prof).lower()} residents"
            f" (at {start.get('label', 'normal level').lower()}: {a.get('reach', 0)})"
        )
    summary = (
        "In this rising-river simulation, synthetic residents heading for the nearest "
        f"evacuation centre: at {last.get('label', 'the highest stage')}, "
        + "; ".join(parts)
        + " would still reach one."
    )
    first: dict[tuple[str, str], list[str]] = {}  # (stage label, place) -> personas
    for c in ro.get("first_cut_off") or []:
        if c.get("stage_label"):
            key = (c["stage_label"], c.get("origin_name") or "an unnamed place")
            first.setdefault(key, []).append(profile_label(c["profile"]).lower())
    steps = [
        f"{stage}: sampled residents starting at {place} are cut off first ({', '.join(who)})"
        for (stage, place), who in list(first.items())[:3]
    ]
    top = last.get("id") if last.get("id") != "baseline" else None
    return {
        "answer_status": "partial",
        "summary": summary,
        "steps": steps,
        "claims": [
            {"text": "Rising-river rollout", "status": "indicative", "evidence_ids": evidence_ids}
        ],
        "scenario_id": top,
        "caveats": [
            ROLLOUT_GUIDANCE,
            "No departure times, warnings or crowding are modelled; "
            "animation speed is illustrative.",
        ],
        "scene_intents": [{"kind": "river.rollout"}],
    }


def fixit_answer(fx: dict, evidence_ids: list[str]) -> dict:
    """FinalAnswer fields for a fix-it search (shared by the mock and the template)."""
    best = fx.get("best") or {}
    sm = best.get("summary") or {}
    who = profile_label(fx.get("profile") or "default").lower()
    goal = (
        "reach an evacuation centre" if fx.get("scope") == "evacuation" else "have a mapped route"
    )
    stage = _stage_words(fx.get("stage"))
    at = f" at {stage}" if stage else ""
    n = len(fx.get("candidates") or [])
    if not best.get("actions") and not fx.get("conclusive", True):
        summary = (
            f"In this what-if search{at}, the township model ran out of time before trying every "
            f"set of the {n} candidate changes, and none it tried changed the sampled {who} "
            "journeys; the result is inconclusive."
        )
    elif not best.get("actions"):
        summary = (
            f"In this what-if search{at}, none of the {n} candidate changes the township model "
            f"tried changes the sampled {who} journeys: {sm.get('reach_before', 0)} of "
            f"{sm.get('total', 0)} would {goal} with or without them. The gaps here are "
            "unchecked facts; ask which facts staff should verify first."
        )
    else:
        summary = (
            f"In this what-if search{at}, the best set of changes the model found is: "
            f"{'; '.join(best.get('labels') or [])}. With it, {sm.get('reach_after', 0)} of "
            f"{sm.get('total', 0)} sampled {who} journeys would {goal} "
            f"(without it: {sm.get('reach_before', 0)}), and {sm.get('confirmed_after', 0)} "
            f"would be confirmed (without it: {sm.get('confirmed_before', 0)})."
        )
    caveats = [WHATIF_CAVEAT, "No costs or construction feasibility are modelled."]
    if sm.get("confirmed_on_demo_after"):
        caveats.append(f"Segment facts are {PLACEHOLDER_CAVEAT}.")
    if stage:
        caveats.append(FLOOD_GUIDANCE)
    if fx.get("stopped_early") and best.get("actions"):
        caveats.append("The search stopped at its time limit before trying every set.")
    return {
        "answer_status": "partial",
        "summary": summary,
        "claims": [{"text": "Fix-it search", "status": "indicative", "evidence_ids": evidence_ids}],
        "scenario_id": fx.get("stage"),
        "caveats": caveats,
    }


DAY_CAVEAT = (
    "Residents are synthetic: a rehearsal on the township model, not a forecast and not real "
    "people."
)


def day_answer(d: dict, evidence_ids: list[str]) -> dict:
    """FinalAnswer fields for an Elmina Day rehearsal (shared by the mock and the template).
    Every number is copied from the tool's summary: school first, then the groups hit hardest
    (by share of the group), and every data gap named as one."""
    o = d.get("outcomes") or {}
    sc = d.get("scenario") or {}
    top = _top_stage(d.get("river_stages") or [])
    river = f", with the river rising to {_stage_words(top)[6:]}" if _stage_words(top) else ""
    summary = (
        f"In this rehearsal of {d.get('residents', 0):,} synthetic residents "
        f"({sc.get('label', 'a simulated day')}{river}), {d.get('trips', 0):,} trips: "
        f"{o.get('on_time', 0):,} on time, {o.get('late', 0):,} late, "
        f"{o.get('cancelled', 0):,} couldn't go and {o.get('turned_back', 0):,} turned back"
        + (f"; {o['data_gap']:,} had no mapped connection (data gap)" if o.get("data_gap") else "")
        + ". It is a rehearsal, not a forecast."
    )
    steps = []
    sch = d.get("school") or {}
    if sch.get("pupils"):
        steps.append(
            f"School: {sch.get('on_time', 0):,} of {sch['pupils']:,} pupils on time, "
            f"{sch.get('cancelled', 0):,} couldn't get there, {sch.get('turned_back', 0):,} "
            "turned back"
            + (
                f", {sch['data_gap']:,} had no mapped connection (data gap)."
                if sch.get("data_gap")
                else "."
            )
        )
    hit = [
        g
        for g in d.get("groups") or []
        if g.get("residents")
        and g.get("label")
        and (g.get("could_not_make_a_trip", 0) or g.get("late", 0))
    ]
    hit.sort(key=lambda g: -g.get("could_not_make_a_trip", 0) / g["residents"])
    for g in hit:
        steps.append(
            f"{g['label']}: {g.get('could_not_make_a_trip', 0):,} of {g['residents']:,} had a "
            f"trip they couldn't make, {g.get('late', 0):,} late."
        )
    caveats = [DAY_CAVEAT]
    if d.get("river_stages"):
        caveats.append(FLOOD_GUIDANCE)
    return {
        "answer_status": "answered",
        "summary": summary,
        "steps": steps[:6],
        "claims": [
            {"text": "Elmina Day rehearsal", "status": "indicative", "evidence_ids": evidence_ids}
        ],
        "scenario_id": top,
        "caveats": caveats,
    }


DAY_CHANGE_CAVEAT = (
    "Imagined change on a rehearsal of synthetic residents: not a plan, not a promise and not a "
    "forecast. The real township is unchanged."
)


def day_change_answer(c: dict, evidence_ids: list[str]) -> dict:
    """FinalAnswer fields for an imagined change tested on an Elmina Day rehearsal (shared by
    the mock and the template). Every number is copied from the tool's result."""
    sc = c.get("scenario") or {}
    better, worse = c.get("residents_better", 0), c.get("residents_worse", 0)
    summary = (
        f"On the {sc.get('label', 'simulated day')} rehearsal of synthetic residents: "
        f"{c.get('change', 'an imagined change')}. In that imagined day, {better:,} residents "
        f"would be better off and {worse:,} worse off ({c.get('trips_better', 0):,} trips better, "
        f"{c.get('trips_worse', 0):,} worse). Not a plan and not a forecast."
    )
    steps = [
        f"{g['label']}: {g.get('better_off', 0):,} better off, {g.get('worse_off', 0):,} worse off."
        for g in c.get("groups") or []
        if g.get("label") and g.get("residents")
    ]
    if c.get("why"):
        top = "the day's top suggestion, " if c.get("option") == 1 else ""
        steps.insert(0, f"Why this change: {top}{c['why']}.")
    others = [o for o in c.get("options") or [] if o.get("option") != c.get("option")]
    if others:
        steps.append(
            f"Another change to test (option {others[0]['option']}): {others[0]['change']}."
        )
    caveats = [DAY_CHANGE_CAVEAT]
    if c.get("river_stages"):
        caveats.append(FLOOD_GUIDANCE)
    return {
        "answer_status": "answered",
        "summary": summary,
        "steps": steps[:6],
        "claims": [
            {
                "text": "Imagined change on a rehearsal",
                "status": "indicative",
                "evidence_ids": evidence_ids,
            }
        ],
        "scenario_id": _top_stage(c.get("river_stages") or []),
        "caveats": caveats,
    }


def _top_stage(stages: list[str]) -> str | None:
    import re

    best = None
    for s in stages:
        m = re.fullmatch(r"stage_p(\d+)m", s or "")
        if m and (best is None or int(m.group(1)) > int(best.removeprefix("stage_p")[:-1])):
            best = s
    return best


def template_answer(rec: TurnRecord, question: str) -> FinalAnswer:
    scenario_id = next(iter(sorted(rec.scenarios_used)), None)
    flood_caveats = [
        f"{i['name']} is {'likely' if i['flood_class'] == 'likely_flooded' else 'possibly'} "
        "flooded in this indicative scenario."
        for i in rec.flooded_endpoints.values()
    ]
    likely_flooded = any(
        i["flood_class"] == "likely_flooded" for i in rec.flooded_endpoints.values()
    )
    closed = [*rec.route_closures, *rec.asked_closures]
    last_fixit = bool(rec.what_ifs and rec.what_ifs[-1].get("fixit"))
    if rec.day_changes and rec.days and not rec.routes:
        # a turn that also ran the rehearsal names its data gap too (review C17)
        ev = [i for i in rec.evidence if i.startswith("ev-daychange-")][-1:]
        fields = day_change_answer(rec.day_changes[-1], ev)
        gap = (rec.days[-1].get("outcomes") or {}).get("data_gap")
        if gap:
            fields["steps"] = [
                *fields["steps"][:5],
                f"In the rehearsal itself, {gap:,} trips had no mapped connection (data gap).",
            ]
        fields["caveats"] = [*fields["caveats"], "Answer generated from data without AI wording."]
        return FinalAnswer(**fields)
    for items, fn, prefix in (
        (rec.day_changes, day_change_answer, "ev-daychange-"),
        (rec.days, day_answer, "ev-day-"),
        (rec.fixes if last_fixit else [], fixit_answer, "ev-fixit-"),
        (rec.tippings, tipping_answer, "ev-tip-"),
        (rec.rollouts, rollout_answer, "ev-rollout-"),
    ):
        if items and not rec.routes:
            ev = [i for i in rec.evidence if i.startswith(prefix)][-1:]
            fields = fn(items[-1], ev)
            fields["caveats"] = [
                *fields["caveats"],
                "Answer generated from data without AI wording.",
            ]
            return FinalAnswer(**fields)
    if rec.plans and not rec.routes:
        ev = [i for i in rec.evidence if i.startswith("ev-plan-")][-1:]
        fields = plan_answer(rec.plans[-1], ev)
        fields["caveats"] = [*fields["caveats"], "Answer generated from data without AI wording."]
        return FinalAnswer(**fields)
    if rec.what_ifs and not rec.routes:
        ev = [i for i in rec.evidence if i.startswith("ev-whatif-")][-1:]
        fields = whatif_answer(rec.what_ifs[-1], ev)
        fields["caveats"] = [*fields["caveats"], "Answer generated from data without AI wording."]
        return FinalAnswer(**fields)
    if not rec.routes and closed:  # closures left no route, or the question was about a closure
        blocked = any(c.get("impact") == "blocked" for c in rec.route_closures)
        return FinalAnswer(
            answer_status="cannot_answer",
            summary=(
                f"Route {closure_summary_tail(rec.route_closures, 'blocked')}."
                if blocked
                else "A staff-reported closure is on record; see below."
            ),
            scenario_id=scenario_id,
            caveats=[
                *closure_caveats(closed),
                *inferred_caveats(rec.inferred_notes),
                "Answer generated from data without AI wording.",
            ],
        )
    if not rec.routes:
        return FinalAnswer(
            answer_status="cannot_answer",
            summary=_cannot_summary(rec, question),
            scenario_id=scenario_id,
            caveats=["Answer generated from data without AI wording."],
        )
    rid, route = next(iter(rec.routes.items()))
    status = rec.route_status.get(rid, "no_data")
    # Claim text omits raw values: they may contain wording forbidden in flood answers.
    claims = [
        Claim(
            text=f"{attribute_label(e.attribute)}: "
            + ("demo value" if e.source_type == PLACEHOLDER_SOURCE else e.status),
            status={"verified": "verified", "stale": "stale", "indicative": "indicative"}.get(
                e.status, "unverified"
            ),
            evidence_ids=[eid],
        )
        for eid, e in list(rec.evidence.items())[:8]
    ]
    route_unknowns = route.get("unknowns", [])
    unknowns = unchecked_caveats(route_unknowns, rec.vrs)
    rest = rest_caveats(route)
    caveats: list[str] = list(flood_caveats)
    caveats += unknowns
    if status == "no_data":
        caveats.append("No mapped connection between these places (data gap).")
    elif (
        status != "confirmed"
        and (route_unknowns or not rest)
        and (route_unknowns or not any(c.get("impact") == "blocked" for c in rec.route_closures))
    ):
        caveats.append("Some segments are still unverified.")
    caveats += rest
    if note := route.get("crossing_note"):
        caveats.append(note)
    caveats += closure_caveats(closed)
    caveats += inferred_caveats(rec.inferred_notes)
    if any(getattr(e, "source_type", None) == PLACEHOLDER_SOURCE for e in rec.evidence.values()):
        caveats.append(f"Some segment facts are {PLACEHOLDER_CAVEAT}.")
    dist = route.get("distance_m")
    summary = f"Route of {dist} m." if dist is not None else "Route found."
    if status == "confirmed" and route.get("demo_evidence"):
        summary = f"Route {route_status_text(status, route)}" + (
            f", {dist} m." if dist is not None else "."
        )
    if tail := closure_summary_tail(rec.route_closures, status, route):
        summary = f"Route {tail}."
    if status == "no_data":
        summary = "No route can be shown between these places."  # the data-gap caveat says why
    return FinalAnswer(
        answer_status="answered"
        if status == "confirmed"
        and not route_unknowns
        and not likely_flooded
        and not rec.route_closures
        else "partial",
        summary=summary,
        claims=claims,
        route_id=rid,
        scenario_id=scenario_id,
        caveats=caveats,
        scene_intents=[SceneIntent(kind="route.highlight", route_id=rid)],
    )
