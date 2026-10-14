from .answer import Claim, FinalAnswer
from .events import SceneIntent
from .record import TurnRecord


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
            summary="I couldn't find verified information to answer that yet. "
            "I've noted the gap for the township team.",
            scenario_id=scenario_id,
            caveats=["Answer generated from data without AI wording."],
        )
    rid, route = next(iter(rec.routes.items()))
    status = rec.route_status.get(rid, "no_data")
    # Claim text omits raw values: they may contain wording forbidden in flood answers.
    claims = [
        Claim(
            text=f"{e.attribute} on {e.element_id}: {e.status}",
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
        caveats.append(f"Route status: {status}; not all segments are verified.")
    dist = route.get("distance_m")
    summary = f"Route status: {status}" + (f", {dist} m." if dist is not None else ".")
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
