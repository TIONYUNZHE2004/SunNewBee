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
