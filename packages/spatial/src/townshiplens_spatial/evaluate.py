from datetime import date

from .models import Claim, Edge, EvalResult, FloodClass, Profile

DEFAULT_TTL = {"step_count": 365, "incline_pct": 365, "width_m": 365, "surface": 365}
_CHECKS = {  # hard key -> (attribute, violates(value, limit))
    "max_step_count": ("step_count", lambda v, lim: v is not None and v > lim),
    "max_incline_pct": ("incline_pct", lambda v, lim: v is not None and abs(v) > lim),
    "min_width_m": ("width_m", lambda v, lim: v is not None and v < lim),
}


def _is_stale(c: Claim, attr: str, today: date) -> bool:
    if c.status != "verified" or not c.verified_at:
        return False
    ttl = c.ttl_days if c.ttl_days is not None else DEFAULT_TTL.get(attr, 365)
    return (today - date.fromisoformat(c.verified_at[:10])).days > ttl


def evaluate_edge(
    edge: Edge, profile: Profile, flood_class: FloodClass | None = None, today: date | None = None
) -> tuple[EvalResult, list[dict]]:
    today = today or date.today()
    why: list[dict] = []
    if profile.allowed_types is not None and edge.type not in profile.allowed_types:
        return "FAIL", [
            {
                "element_id": edge.id,
                "attribute": "type",
                "reason": "unknown",
                "why": f"{edge.type} edges are not usable for {profile.id}",
            }
        ]
    if flood_class == "likely_flooded":
        return "FAIL", [
            {
                "element_id": edge.id,
                "attribute": "flood",
                "reason": "unknown",
                "why": "likely flooded in this scenario",
            }
        ]
    if flood_class == "possible" and profile.flood.get("possible_is") == "FAIL":
        return "FAIL", [
            {
                "element_id": edge.id,
                "attribute": "flood",
                "reason": "unknown",
                "why": f"possibly flooded; not passable for {profile.id}",
            }
        ]
    # TODO(deferred): enforce profile.max_rest_free_run_m; not used in the walking skeleton.
    result: EvalResult = "PASS"
    for key, limit in profile.hard.items():
        attr, violates = _CHECKS[key]
        c = edge.claims.get(attr)
        # A steps edge is a barrier unless a verified/reported claim says otherwise.
        implied = attr == "step_count" and edge.type == "steps"
        if implied and (c is None or c.value is None or c.status not in ("verified", "reported")):
            c = Claim(
                value=max(c.value or 0, 1) if c else 1,
                status="reported",
                evidence_type="edge_type",
            )
        if c is not None and c.status in ("verified", "reported") and violates(c.value, limit):
            return "FAIL", [
                {
                    "element_id": edge.id,
                    "attribute": attr,
                    "why": f"{attr}={c.value} breaks {profile.id} limit {limit}",
                }
            ]
        if c is None or c.status != "verified" or c.value is None or _is_stale(c, attr, today):
            result = "UNKNOWN"
            stale = c is not None and c.value is not None and c.status in ("verified", "stale")
            op = "≤" if key.startswith("max") else "≥"
            why.append(
                {
                    "element_id": edge.id,
                    "attribute": attr,
                    "reason": "stale" if stale else "unknown",
                    "why": f"{profile.id} needs {attr} {op} {limit}; not verified",
                }
            )
    if flood_class == "possible":
        result = "UNKNOWN"
        why.append(
            {
                "element_id": edge.id,
                "attribute": "flood",
                "why": "possibly flooded in this scenario",
            }
        )
    return result, why
