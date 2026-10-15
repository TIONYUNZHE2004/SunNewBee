from datetime import date, datetime

from . import models as _m
from .models import Claim, Edge, EvalResult, FloodClass, Profile, active_closures

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


def _needs_verification(c: Claim | None, attr: str, today: date) -> bool:
    """True when `c` cannot support a PASS: missing, valueless, not verified (reported, unknown,
    stale, contested) or past its TTL. `evaluate_edge` and the gap map both use this."""
    return c is None or c.status != "verified" or c.value is None or _is_stale(c, attr, today)


# Edge types people can only walk along on a sidewalk or verge (Task 31).
SIDEWALK_TYPES = {"major_road"}
# `separate` = the sidewalk is mapped as its own footway; the brief accepts the road edge too
# (review M-5: a stricter "prefer the parallel footway" rule is a possible follow-up).
SIDEWALK_PRESENT = {"both", "one_side", "separate"}


def _sidewalk_check(edge: Edge, profile: Profile, today: date) -> tuple[EvalResult, dict] | None:
    """Walking profiles on a major road: None when the sidewalk claim supports it, else
    FAIL/UNKNOWN with the reason. Vehicle profiles (allowed_types set) are not affected.

    Same status semantics as the hard limits (world-model-schema 3): for a profile that treats
    a missing sidewalk as a barrier (`no_sidewalk_is: FAIL`), "sidewalk present" counts only
    when verified and fresh; a reported `none` is enough to FAIL. The default profile has no
    hard constraints, so a fresh reported or verified sidewalk is enough there.
    """
    if edge.type not in SIDEWALK_TYPES or profile.allowed_types is not None:
        return None
    strict = profile.no_sidewalk_is == "FAIL"
    c = edge.claims.get("sidewalk")
    stale = c is not None and c.value is not None and _is_stale(c, "sidewalk", today)
    trusted = c is not None and c.status in ("verified", "reported") and not stale
    if trusted and c.value in SIDEWALK_PRESENT:
        if c.status == "verified" or not strict:
            return None
        return "UNKNOWN", {
            "element_id": edge.id,
            "attribute": "sidewalk",
            "reason": "unknown",
            "why": f"major road; sidewalk only reported ({c.value}), not verified",
        }
    if trusted and c.value == "none":
        if strict:
            return "FAIL", {
                "element_id": edge.id,
                "attribute": "sidewalk",
                "why": f"major road with no sidewalk mapped; not usable for {profile.id}",
            }
        return "UNKNOWN", {
            "element_id": edge.id,
            "attribute": "sidewalk",
            "reason": "unknown",
            "why": "major road with no sidewalk mapped; walking means the carriageway or verge",
        }
    return "UNKNOWN", {
        "element_id": edge.id,
        "attribute": "sidewalk",
        "reason": "stale" if stale or (c is not None and c.status == "stale") else "unknown",
        "why": "major road; sidewalk not verified",
    }


def evaluate_edge(
    edge: Edge,
    profile: Profile,
    flood_class: FloodClass | None = None,
    today: date | None = None,
    now: datetime | None = None,
) -> tuple[EvalResult, list[dict]]:
    today = today or date.today()
    why: list[dict] = []
    if edge.closures:
        # Staff-reported closure (Task 46): FAIL for every profile, never an upgrade. Outside
        # its [starts_at, ends_at) window it has no effect.
        live = active_closures(edge.closures, now or _m.utcnow())
        if live:
            return "FAIL", [
                {
                    "element_id": edge.id,
                    "attribute": "closure",
                    "reason": "unknown",
                    "why": c.label(),
                }
                for c in live
            ]
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
    side = _sidewalk_check(edge, profile, today)
    if side is not None:
        if side[0] == "FAIL":
            return "FAIL", [side[1]]
        result = "UNKNOWN"
        why.append(side[1])
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
        if _needs_verification(c, attr, today):
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


def relevant_attributes(edge: Edge, profile: Profile) -> list[str]:
    """Attributes `evaluate_edge` consults for this edge and profile (pure; the gap map reuses
    it so the two never drift). Vehicle profiles check only edge type, so nothing is relevant."""
    if profile.allowed_types is not None:
        return []
    attrs = [_CHECKS[key][0] for key in profile.hard]
    if edge.type in SIDEWALK_TYPES:
        attrs.append("sidewalk")
    return attrs


def claim_gap(claim: Claim | None, attr: str, today: date | None = None) -> tuple[bool, bool, bool]:
    """(unknown, stale, reported) for one claim, by the same rule `evaluate_edge` uses: unknown
    means the claim cannot support a PASS (missing, valueless, reported, unknown, stale,
    contested or past its TTL). stale is the stale/expired subset; reported marks a claim that is
    only reported, not verified."""
    today = today or date.today()
    unknown = _needs_verification(claim, attr, today)
    if claim is None:
        return unknown, False, False
    stale = claim.status == "stale" or _is_stale(claim, attr, today)
    return unknown, stale, unknown and claim.status == "reported"


def edge_gaps(edge: Edge, profile: Profile, today: date | None = None) -> list[dict]:
    """Facts that would make `evaluate_edge` answer UNKNOWN for this edge and profile (flood
    aside): [{attribute, stale, reported}]. A reported or verified claim that breaks a hard limit
    is a known barrier (FAIL), not a gap. Same predicates as `evaluate_edge`, so the two agree."""
    today = today or date.today()
    out: list[dict] = []
    if profile.allowed_types is not None:
        return out
    for key, limit in profile.hard.items():
        attr, violates = _CHECKS[key]
        c = edge.claims.get(attr)
        if (
            attr == "step_count"
            and edge.type == "steps"
            and (c is None or c.value is None or c.status not in ("verified", "reported"))
        ):  # the implied claim evaluate_edge substitutes (a reported step)
            c = Claim(value=max(c.value or 0, 1) if c else 1, status="reported")
        if c is not None and c.status in ("verified", "reported") and violates(c.value, limit):
            continue  # known barrier: FAIL
        unknown, stale, reported = claim_gap(c, attr, today)
        if unknown:
            out.append({"attribute": attr, "stale": stale, "reported": reported})
    side = _sidewalk_check(edge, profile, today)
    if side is not None and side[0] == "UNKNOWN":
        c = edge.claims.get("sidewalk")
        out.append(
            {
                "attribute": "sidewalk",
                "stale": side[1].get("reason") == "stale",
                "reported": c is not None and c.status == "reported",
            }
        )
    return out
