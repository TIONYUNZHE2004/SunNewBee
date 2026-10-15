from .answer import Claim, FinalAnswer
from .events import SceneIntent
from .labels import (
    attribute_label,
    closure_caveats,
    closure_summary_tail,
    inferred_caveats,
    rest_caveats,
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
    if tail := closure_summary_tail(rec.route_closures, status):
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
