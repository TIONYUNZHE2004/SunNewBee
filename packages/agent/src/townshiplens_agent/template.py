from .answer import Claim, FinalAnswer
from .events import SceneIntent
from .record import TurnRecord


def template_answer(rec: TurnRecord, question: str) -> FinalAnswer:
    if not rec.routes:
        return FinalAnswer(
            answer_status="cannot_answer",
            summary="I couldn't find verified information to answer that yet. "
            "I've noted the gap for the township team.",
            scenario_id=next(iter(rec.scenarios_used), None),
            caveats=["Answer generated from data without AI wording."],
        )
    rid, route = next(iter(rec.routes.items()))
    status = rec.route_status[rid]
    claims = [
        Claim(
            text=f"{e.attribute} on {e.element_id}: {e.value} ({e.status})",
            status={"verified": "verified", "stale": "stale", "indicative": "indicative"}.get(
                e.status, "unverified"
            ),
            evidence_ids=[eid],
        )
        for eid, e in list(rec.evidence.items())[:8]
    ]
    unknowns = [f"{u['attribute']} on {u['element_id']}" for u in route.get("unknowns", [])]
    return FinalAnswer(
        answer_status="partial" if unknowns else "answered",
        summary=f"Route status: {status}, {route['distance_m']} m.",
        claims=claims,
        route_id=rid,
        scenario_id=next(iter(rec.scenarios_used), None),
        caveats=([f"Not checked yet: {', '.join(unknowns)}."] if unknowns else []),
        scene_intents=[SceneIntent(kind="route.highlight", route_id=rid)],
    )
