"""Resident-readable wording for answers and uncertainty notes.

Pure functions: no raw element ids, attribute keys or status codes ever reach answer text.
The structured values (route_status, element_id, attribute) stay unchanged in events.
"""

import re

from townshiplens_spatial.attributes import ATTRIBUTE_LABELS

STATUS_LABELS = {
    "confirmed": "confirmed",
    "partly_unverified": "partly unverified",
    "blocked": "blocked",
    "no_data": "no mapped connection (data gap)",
}
PROFILE_LABELS = {
    "default": "Walking",
    "stroller": "Stroller",
    "wheelchair": "Wheelchair",
    "older_adult_rest": "Older adult",
    "drive": "Driving",
}
_EXTRA_ATTRIBUTES = {"flood": "Flood", "existence": "Existence", "type": "Path type"}
_EDGE_TYPES = {
    "footway": "footway",
    "sidewalk": "sidewalk",
    "pedestrian": "pedestrian path",
    "crossing": "crossing",
    "steps": "set of steps",
    "ramp": "ramp",
    "path": "path",
    "street": "street",
    "track": "track",
    "major_road": "major road",
}
_UNITS = {"incline_pct": "%", "width_m": " m", "step_count": " steps", "step_height_cm": " cm"}
_NEEDS = re.compile(r"^(\w+) needs (\w+) (≤|≥) ([\d.]+); not verified$")
_SIDEWALK_REPORTED = re.compile(r"sidewalk only reported \((\w+)\)")


def status_label(status: str) -> str:
    return STATUS_LABELS.get(status, status.replace("_", " "))


def attribute_label(key: str) -> str:
    label = ATTRIBUTE_LABELS.get(key) or _EXTRA_ATTRIBUTES.get(key)
    return label or key.replace("_", " ").capitalize()


def profile_label(profile_id: str) -> str:
    return PROFILE_LABELS.get(profile_id, profile_id.replace("_", " ").capitalize())


def element_label(name: str | None, edge_type: str | None) -> str:
    """The element's name, else "an unnamed footway / street / major road"."""
    if name and name.strip():
        return name.strip()
    kind = _EDGE_TYPES.get(edge_type or "", (edge_type or "").replace("_", " ") or "path")
    return f"unnamed {kind}" if kind.startswith("set of") else f"an unnamed {kind}"


def _short(attribute: str) -> str:
    """ "Incline (%)" -> "incline"."""
    return re.sub(r"\s*\(.*?\)", "", attribute_label(attribute)).lower()


def _cap(text: str) -> str:
    return text[:1].upper() + text[1:]


def unknown_core(u: dict) -> str:
    """What is unknown, without saying where: "Stroller: incline not checked yet (limit 8.3%)"."""
    attr = u.get("attribute") or ""
    why = u.get("why") or ""
    if m := _NEEDS.match(why):
        profile, key, op, limit = m.groups()
        unit = _UNITS.get(key, "")
        word = "limit" if op == "≤" else "minimum"
        state = "check is out of date" if u.get("reason") == "stale" else "not checked yet"
        return f"{profile_label(profile)}: {_short(key)} {state} ({word} {limit}{unit})"
    if m := _SIDEWALK_REPORTED.search(why):
        return f"Sidewalk: reported as {m.group(1).replace('_', ' ')}, not checked yet"
    if "no sidewalk mapped" in why:
        return "Sidewalk: none mapped, so walking means the carriageway or verge"
    if attr == "flood":
        return "Possibly flooded in this indicative scenario"
    return f"{attribute_label(attr)}: not checked yet"


def unknown_note(u: dict, element: str | None = None) -> str:
    """The uncertainty note: core text plus where ("... on Jalan Hopea U15/17D")."""
    core = unknown_core(u)
    el = element or u.get("element_label")
    return f"{core} on {el}" if el else core


def unknown_line(u: dict) -> str:
    """One item for the answer's caveat line."""
    el = u.get("element_label") or "an unnamed element"
    if u.get("attribute") == "flood":
        return f"{_cap(el)}: possibly flooded in this indicative scenario"
    return f"Not checked yet: {attribute_label(u.get('attribute') or '')} on {el}"


def enrich_unknowns(world, route: dict) -> None:
    """Add readable `element_label` and `note` to each unknown of a plan_route route, in place.
    The live model sees them in the tool result and the mock/template reuse them."""
    for u in route.get("unknowns") or []:
        edge = world.edges.get(u.get("element_id", ""))
        u["element_label"] = element_label(edge.name if edge else None, edge.type if edge else None)
        u["note"] = unknown_note(u)


def unchecked_items(unknowns: list[dict]) -> set[tuple[str, str]]:
    """Distinct (element, attribute) items staff could check. Flood unknowns are not checkable."""
    return {
        (u.get("element_id", ""), u.get("attribute", ""))
        for u in unknowns
        if u.get("attribute") != "flood"
    }


def request_sentence(unknowns: list[dict], vrs: list[dict]) -> str | None:
    """Exactly what was asked of staff this turn, or None when nothing was."""
    items = unchecked_items(unknowns)
    filed = {(v.get("element_id"), v.get("attribute")) for v in vrs}
    k = len(items & filed)
    if not items or not k:
        return None
    if len(items) == 1:
        return "Asked the township team to check this item."
    if k == len(items):
        return f"Asked the township team to check all {k} unchecked items."
    return f"Asked the township team to check {k} of the {len(items)} unchecked items."


MAX_NAMED = 5  # unchecked items named in answer text; the uncertainty event lists them all


def unchecked_caveats(
    unknowns: list[dict], vrs: list[dict] | None = None, max_named: int = MAX_NAMED
) -> list[str]:
    """Caveat lines: up to `max_named` items, an exact "and N more" (items, not segments), then
    exactly how many checks were requested this turn (nothing when none were)."""
    seen: dict[tuple, dict] = {}
    for u in unknowns:
        seen.setdefault((u.get("element_id"), u.get("attribute")), u)
    items = list(seen.values())
    out = [unknown_line(u) for u in items[:max_named]]
    more = len(items) - max_named
    if more > 0:
        out.append(f"and {more} more unchecked {'item' if more == 1 else 'items'}")
    if sentence := request_sentence(items, vrs or []):
        out.append(sentence)
    return out
