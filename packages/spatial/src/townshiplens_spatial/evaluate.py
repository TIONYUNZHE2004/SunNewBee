from datetime import date, datetime

from . import models as _m
from .models import Claim, Edge, EvalResult, FloodClass, Place, Profile, active_closures

PLACEHOLDER_SOURCE = (
    "team_survey_placeholder"  # demo values, not surveyed (see Route.demo_evidence)
)
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
    return (
        c is None
        or c.status != "verified"
        or c.value is None
        or not c.verified_at
        or _is_stale(c, attr, today)
    )


# Edge types people can only walk along on a sidewalk or verge (Task 31).
SIDEWALK_TYPES = {"major_road"}
# `separate` = the sidewalk is mapped as its own footway; the brief accepts the road edge too
# (review M-5: a stricter "prefer the parallel footway" rule is a possible follow-up).
SIDEWALK_PRESENT = {"both", "one_side", "separate"}


def mode_access(edge: Edge, profile: Profile) -> tuple[str | None, str | None]:
    """Most specific OSM mode permission wins; foot=yes can override generic access=no."""
    keys = (
        ("motorcar", "motor_vehicle", "vehicle", "access")
        if profile.id == "drive"
        else ("foot", "access")
    )
    for key in keys:
        if key in edge.osm_tags:
            return key, edge.osm_tags[key]
    return None, None


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


def evaluate_flood(
    element_id: str,
    profile: Profile,
    flood_class: FloodClass | None,
    coverage: str | None = None,
) -> tuple[EvalResult, list[dict]]:
    """The same scenario rules for paths and endpoints. Coverage gaps never imply flooding."""
    if flood_class == "likely_flooded" or (
        flood_class == "possible" and profile.flood.get("possible_is") == "FAIL"
    ):
        return "FAIL", [
            {
                "element_id": element_id,
                "attribute": "flood",
                "reason": "unknown",
                "why": "likely flooded in this scenario"
                if flood_class == "likely_flooded"
                else f"possibly flooded; not passable for {profile.id}",
            }
        ]
    why = []
    if flood_class == "possible":
        why.append(
            {
                "element_id": element_id,
                "attribute": "flood",
                "why": "possibly flooded in this scenario",
            }
        )
    if coverage:
        why.append(
            {
                "element_id": element_id,
                "attribute": "flood_coverage",
                "reason": "unknown",
                "why": f"flood assessment has {coverage} raster coverage; unassessed data gap",
            }
        )
    return ("UNKNOWN" if why else "PASS"), why


def evaluate_edge(
    edge: Edge,
    profile: Profile,
    flood_class: FloodClass | None = None,
    today: date | None = None,
    now: datetime | None = None,
    flood_coverage: str | None = None,
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
    permission_key, permission = mode_access(edge, profile)
    wheelchair = edge.claims.get("wheelchair")
    wheelchair_denied = profile.id == "wheelchair" and (
        edge.osm_tags.get("wheelchair") == "no"
        or (
            wheelchair is not None
            and wheelchair.status in ("verified", "reported")
            and wheelchair.value == "no"
        )
    )
    if permission == "no" or wheelchair_denied:
        attr = "wheelchair" if wheelchair_denied else permission_key
        return "FAIL", [
            {
                "element_id": edge.id,
                "attribute": attr,
                "reason": "unknown",
                "why": f"{attr}=no; not usable for {profile.id}",
            }
        ]
    # OSM smoothness grades wheeled travel, not whether a pedestrian can walk here.
    # https://wiki.openstreetmap.org/wiki/Key:smoothness
    if edge.osm_tags.get("smoothness") == "impassable" and profile.id in {
        "wheelchair",
        "stroller",
        "drive",
    }:
        return "FAIL", [
            {
                "element_id": edge.id,
                "attribute": "smoothness",
                "reason": "unknown",
                "why": "OSM smoothness=impassable; no positive access estimate is permitted",
            }
        ]
    flood_result, flood_why = evaluate_flood(edge.id, profile, flood_class, flood_coverage)
    if flood_result == "FAIL":
        return flood_result, flood_why
    # profile.max_rest_free_run_m is a path property, enforced by routing._rest_search.
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
    if flood_result == "UNKNOWN":
        result = "UNKNOWN"
        why.extend(flood_why)
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


def is_demo(claim: Claim | None) -> bool:
    """True for a claim whose evidence is a team placeholder: a demo value, not yet surveyed."""
    return claim is not None and claim.evidence_type == PLACEHOLDER_SOURCE


def edge_demo_gaps(edge: Edge, profile: Profile, today: date | None = None) -> list[dict]:
    """Facts that let `evaluate_edge` PASS only on demo values (Task 55, R33): [{attribute,
    stale, reported, demo}]. They are gaps for the gap map ("not yet surveyed") although the
    evaluation stays PASS. A known barrier (FAIL) or a fact already unknown is not repeated."""
    today = today or date.today()
    already = {g["attribute"] for g in edge_gaps(edge, profile, today)}
    out: list[dict] = []
    for attr in relevant_attributes(edge, profile):
        c = edge.claims.get(attr)
        if attr in already or not is_demo(c) or c is None or c.value is None:
            continue
        if attr == "sidewalk":
            if c.value not in SIDEWALK_PRESENT:
                continue
        else:
            key = next((k for k, (a, _) in _CHECKS.items() if a == attr), None)
            if key is not None and _CHECKS[key][1](c.value, profile.hard[key]):
                continue  # a known barrier, not a gap
        out.append({"attribute": attr, "stale": False, "reported": False, "demo": True})
    return out


# Rest points for max_rest_free_run_m (Task 41). The place's own claims decide whether it is a
# rest point, mirroring evaluate_edge: verified present = PASS; verified or reported absent =
# FAIL (a reported "gone" is enough to stop counting it); anything else (no claim / OSM only,
# unknown, stale, contested, only reported present) = UNKNOWN.
REST_ATTRS = {"seating": ("seating",), "shelter": ("shelter", "seating")}
_YES = {True, "yes", "true"}
_NO = {False, "no", "false"}


def _rest_present(attr: str, value) -> bool | None:
    v = value.lower() if isinstance(value, str) else value
    if attr == "shelter":
        return True if v in ("covered", "partial") else False if v == "none" else None
    return True if v in _YES else False if v in _NO else None


def rest_point_state(place: Place, today: date | None = None) -> EvalResult | None:
    """PASS / FAIL / UNKNOWN for a seating or shelter place as a rest point; None otherwise."""
    attrs = REST_ATTRS.get(place.type)
    if attrs is None:
        return None
    today = today or date.today()
    claims = [(a, place.claims[a]) for a in attrs if a in place.claims]
    if any(
        c.status in ("verified", "reported") and _rest_present(a, c.value) is False
        for a, c in claims
    ):
        return "FAIL"
    if any(
        c.status == "verified" and _rest_present(a, c.value) and not _is_stale(c, a, today)
        for a, c in claims
    ):
        return "PASS"
    return "UNKNOWN"
