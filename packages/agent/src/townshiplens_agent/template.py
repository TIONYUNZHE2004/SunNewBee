from .answer import Claim, FinalAnswer
from .events import SceneIntent
from .record import TurnRecord
from .validate import DEPTH, FORBIDDEN, PLACEHOLDER_CAVEAT, PLACEHOLDER_SOURCE


def _cannot_summary(rec: TurnRecord, question: str) -> str:
    """Say what could not be resolved: a missing attribute if a tool surfaced one, else the query.

    The question is only echoed outside flood turns and when it passes the flood-wording and
    depth rules (it is the user's own text; never let it smuggle forbidden wording in).
    """
    tail = " I've noted the gap for the township team."
    for e in rec.evidence.values():
        if str(e.status) == "unknown":
            return f"I don't have a verified {e.attribute} for {e.element_id} yet.{tail}"
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
            text=f"{e.attribute} on {e.element_id}: "
            + ("demo value" if e.source_type == PLACEHOLDER_SOURCE else e.status),
            status={"verified": "verified", "stale": "stale", "indicative": "indicative"}.get(
                e.status, "unverified"
            ),
            evidence_ids=[eid],
        )
        for eid, e in list(rec.evidence.items())[:8]
    ]
    unknowns = [f"{u['attribute']} on {u['element_id']}" for u in route.get("unknowns", [])]
    caveats: list[str] = list(flood_caveats)
    if unknowns:
        caveats.append(f"Not checked yet: {', '.join(unknowns)}.")
    if status != "confirmed":
        caveats.append("Some segments are still unverified.")
    if any(
        getattr(rec.evidence.get(i), "source_type", None) == PLACEHOLDER_SOURCE
        for c in claims
        for i in c.evidence_ids
    ):
        caveats.append(f"Some segment facts are {PLACEHOLDER_CAVEAT}.")
    dist = route.get("distance_m")
    summary = f"Route of {dist} m." if dist is not None else "Route found."
    return FinalAnswer(
        answer_status="answered"
        if status == "confirmed" and not unknowns and not likely_flooded
        else "partial",
        summary=summary,
        claims=claims,
        route_id=rid,
        scenario_id=scenario_id,
        caveats=caveats,
        scene_intents=[SceneIntent(kind="route.highlight", route_id=rid)],
    )
