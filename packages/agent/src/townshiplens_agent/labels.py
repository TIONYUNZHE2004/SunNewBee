"""Resident-readable wording for answers and uncertainty notes.

Pure functions: no raw element ids, attribute keys or status codes ever reach answer text.
The structured values (route_status, element_id, attribute) stay unchanged in events.
"""

import re
from collections.abc import Iterable
from datetime import datetime

from townshiplens_spatial.attributes import ATTRIBUTE_LABELS
from townshiplens_spatial.routing import rest_gap_text

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


# A confirmed route whose facts include placeholder evidence is named with this qualifier.
DEMO_CONFIRMED = "confirmed (on demo values, not yet surveyed)"


def route_status_text(status: str, route: dict | None) -> str:
    """Status words for a route; a demo_evidence route is "confirmed (on demo values, ...)"."""
    if status == "confirmed" and route and route.get("demo_evidence"):
        return DEMO_CONFIRMED
    return status_label(status)


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


def classify_why(u: dict) -> str:
    """Which evaluate.py reason this unknown carries; "fallback" means the wording is not
    understood (a drift test over real evaluate output keeps this from happening silently)."""
    why = u.get("why") or ""
    if _NEEDS.match(why):
        return "limit"
    if _SIDEWALK_REPORTED.search(why):
        return "sidewalk_reported"
    if "no sidewalk mapped" in why:
        return "sidewalk_none"
    if "sidewalk not verified" in why:
        return "sidewalk_unchecked"
    if u.get("attribute") == "flood" and "flooded" in why:
        return "flood"
    return "fallback"


def _fmt(x: str) -> str:
    return f"{float(x):g}"


def unknown_core(u: dict) -> str:
    """What is unknown, without saying where: "Stroller: incline not checked yet (limit 8.3%)"."""
    attr = u.get("attribute") or ""
    why = u.get("why") or ""
    stale = u.get("reason") == "stale"
    state = "last check is out of date" if stale else "not checked yet"
    kind = classify_why(u)
    if kind == "limit":
        profile, key, op, limit = _NEEDS.match(why).groups()
        if key == "step_count" and float(limit) == 0:
            rule = "no steps allowed"
        else:
            word = "limit" if op == "≤" else "minimum"
            rule = f"{word} {_fmt(limit)}{_UNITS.get(key, '')}"
        return f"{profile_label(profile)}: {_short(key)} {state} ({rule})"
    if kind == "sidewalk_reported":
        value = _SIDEWALK_REPORTED.search(why).group(1).replace("_", " ")
        return f"Sidewalk: reported as {value}, {state}"
    if kind == "sidewalk_none":
        return "Sidewalk: none mapped, so walking means the carriageway or verge"
    if kind == "sidewalk_unchecked":
        return f"Sidewalk: {state}"
    if kind == "flood":
        return "Possibly flooded in this indicative scenario"
    return f"{attribute_label(attr)}: {state}"


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
    """Caveat lines: up to `max_named` items (identical lines collapse to "(x3)"), then exact
    "and N more" counts (same unit as the request sentence: unchecked items, flood separately),
    then exactly how many checks were requested this turn (nothing when none were)."""
    seen: dict[tuple, dict] = {}
    for u in unknowns:
        seen.setdefault((u.get("element_id"), u.get("attribute")), u)
    items = list(seen.values())
    lines: dict[str, int] = {}
    for u in items[:max_named]:
        line = unknown_line(u)
        lines[line] = lines.get(line, 0) + 1
    out = [f"{line} (x{n})" if n > 1 else line for line, n in lines.items()]
    rest = items[max_named:]
    more = sum(u.get("attribute") != "flood" for u in rest)
    more_flood = len(rest) - more
    if more:
        out.append(f"and {more} more unchecked {'item' if more == 1 else 'items'}")
    if more_flood:
        out.append(
            f"and {more_flood} more possibly flooded {'path' if more_flood == 1 else 'paths'}"
        )
    if sentence := request_sentence(items, vrs or []):
        out.append(sentence)
    return out


CROSSING_WORDS = "road crossing"  # every crossing note contains this (validator)
_CROSSING_TYPE = {
    "traffic_signals": "with traffic lights",
    "marked": "marked, no traffic lights",
    "unmarked": "unmarked",
    "no": "where crossing is not allowed",
}


def crossing_note(route: dict) -> str | None:
    """One readable line for the crossings a route uses, or None when it uses none:
    "This route uses 2 road crossings: 1 with traffic lights (map data, not checked), 1 with no
    recorded crossing type." Only verified claims drop the "(map data, not checked)" note."""
    rows = route.get("crossings") or []
    if not rows:
        return None
    groups: dict[tuple[str | None, bool], int] = {}
    for r in rows:
        kind = r.get("crossing") if r.get("crossing") in _CROSSING_TYPE else None
        checked = kind is not None and r.get("status") == "verified"
        groups[(kind, checked)] = groups.get((kind, checked), 0) + 1
    order = [*_CROSSING_TYPE, None]
    parts = []
    for (kind, checked), n in sorted(groups.items(), key=lambda g: (order.index(g[0][0]), g[0][1])):
        if kind is None:
            parts.append(f"{n} with no recorded crossing type")
        else:
            parts.append(
                f"{n} {_CROSSING_TYPE[kind]}" + ("" if checked else " (map data, not checked)")
            )
    n = len(rows)
    return f"This route uses {n} {CROSSING_WORDS}{'s' if n != 1 else ''}: {', '.join(parts)}."


REST_GAP_WORDS = "without a rest point"  # every rest-gap caveat contains this (validator)


def rest_caveats(route: dict) -> list[str]:
    """Rest-limit lines for a route of a profile with a rest limit (older_adult_rest), else [].

    Over the limit: "Longest stretch without a rest point is about 110 m (limit 100 m)."
    Within it only thanks to unverified rest points: name them.
    """
    limit = route.get("rest_limit_m")
    if limit is None:
        return []
    if route.get("rest_limit_met") is False:
        return [_cap(rest_gap_text(route.get("max_gap_between_rest_m") or 0.0, limit)) + "."]
    needed = set(route.get("rest_points_unverified") or [])
    names = [
        p.get("name") or "an unnamed rest point"
        for p in route.get("rest_points") or []
        if p.get("place_id") in needed
    ]
    if not names:
        return []
    one = len(names) == 1
    return [
        f"Rest {'point' if one else 'points'} not checked yet: {', '.join(names)}; this route "
        f"needs {'it' if one else 'them'} to keep every stretch within {limit:g} m."
    ]


CLOSURE_WORDS = "Closed (staff report)"  # every closure line starts with this (validator, UI text)
_CLOSURE_REASONS = {
    "works": "works",
    "event": "event",
    "flooding": "flooding",
    "other": "other reason",
}


def closure_name(row: dict) -> str:
    """The closed element's name as the answer writes it ("an unnamed footway" when it has none)."""
    name = (row.get("element_name") or "").strip()
    if not name:
        return "an unnamed element"
    if name.startswith("Unnamed "):
        return "an unnamed " + name.removeprefix("Unnamed ")
    return name


def closure_until(row: dict) -> str:
    """ "until 20 Oct 2026" / "until further notice" for a closure row (site-local date)."""
    ends = row.get("ends_at")
    if not ends:
        return "until further notice"
    d = datetime.fromisoformat(ends)
    return f"until {d.day} {d.strftime('%b %Y')}"


def closure_line(row: dict) -> str:
    """ "Closed (staff report): Jalan Hopea until 20 Oct 2026 - works". `row` is a closure_row
    (spatial tools); its `ends_at` is already in the site's time zone, so the date is read as is."""
    reason = _CLOSURE_REASONS.get(row.get("reason") or "", "reason not stated")
    return f"{CLOSURE_WORDS}: {closure_name(row)} {closure_until(row)} \u2014 {reason}"


def closure_caveats(rows: list[dict]) -> list[str]:
    """One caveat per closure, first-seen order, no repeats."""
    return list(dict.fromkeys(closure_line(r) for r in rows))


def closure_summary_tail(rows: list[dict], status: str, route: dict | None = None) -> str:
    """Extra words for a route summary: a blocked route says what blocked it, and a route to or
    from a closed place does not read as plain "confirmed"."""
    if status == "blocked" and any(r.get("impact") == "blocked" for r in rows):
        return "blocked by a reported closure"
    if status in ("confirmed", "partly_unverified") and any(
        r.get("impact") == "endpoint" for r in rows
    ):
        return f"{route_status_text(status, route)}, but a place at one end is reported closed"
    return ""


def inferred_caveats(notes: list[str]) -> list[str]:
    """Entrance-not-mapped lines (plan_route warnings), no repeats."""
    return list(dict.fromkeys(notes))


# ---- answer language (Cycle 6): the frame around the model's text follows the question -------
_CJK = re.compile(r"[\u4e00-\u9fff]")
# Bahasa Melayu function words. Place-like nouns ("pusat", "sungai", "laluan", "tangga") are left
# out on purpose: they appear in Elmina's place names inside English text.
_BM = re.compile(
    r"\b(?:boleh|saya|dari|tanpa|jika|kalau|bagaimana|berapa|adakah|apakah|di mana|ke mana|"
    r"untuk|dengan|ke|nak|tak|ini|itu|ada|akan|dalam|daripada|yang|tidak|belum|macam mana|"
    r"kerusi roda|kereta sorong|atau|juga|sahaja|tiada|sudah|telah|mahu|hendak)\b",
    re.IGNORECASE,
)
FRAME = {
    "en": {"status": "Route status", "worth": "Worth knowing:"},
    "ms": {"status": "Status laluan", "worth": "Perlu diketahui:"},
    "zh": {"status": "路线状态", "worth": "注意事项："},
}
STATUS_WORDS = {
    "ms": {
        "confirmed": "disahkan",
        "partly_unverified": "sebahagian belum disahkan",
        "blocked": "tersekat",
        "no_data": "tiada sambungan dipetakan (jurang data)",
        "demo": "disahkan (pada nilai demo, belum ditinjau)",
    },
    "zh": {
        "confirmed": "已确认",
        "partly_unverified": "部分未核实",
        "blocked": "受阻",
        "no_data": "无已绘制的连接（数据缺口）",
        "demo": "已确认（基于演示数据，尚未实地调查）",
    },
}


def detect_language(text: str, names: Iterable[str] = ()) -> str:
    """'zh' for Chinese characters, 'ms' for Bahasa Melayu (two or more common words), else 'en'.
    Place names are removed first, so "Pusat Pemindahan …" or "Sungai Buloh" in an English
    question does not make it Malay."""
    text = text or ""
    for n in sorted((n for n in names if n), key=len, reverse=True):
        text = re.sub(re.escape(n), " ", text, flags=re.IGNORECASE)
    if _CJK.search(text):
        return "zh"
    return "ms" if len(_BM.findall(text)) >= 2 else "en"


def route_status_line(status: str, route: dict | None, lang: str = "en") -> str:
    words = STATUS_WORDS.get(lang)
    if not words:
        return f"{FRAME['en']['status']}: {route_status_text(status, route)}"
    demo = status == "confirmed" and route and route.get("demo_evidence")
    return f"{FRAME[lang]['status']}: {words['demo'] if demo else words.get(status, status)}"
