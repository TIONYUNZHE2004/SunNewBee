"""Turn-by-turn steps from plan_route `maneuvers` (T-021, contract v1). No model-written turns.

Each step is built from one maneuver only: action, distance_m, street_name (OSM, else the stretch
is named by its type), edge_type and access_level. A stretch that is estimated (likely_ok) or not
checked (unknown) carries its short label. Long routes keep at most `MAX_STEPS` lines: the first
steps, one line saying how many steps are on the map only, and the arrival.
"""

import re

MAX_STEPS = 8

COMPASS = {
    "en": [
        "north",
        "north-east",
        "east",
        "south-east",
        "south",
        "south-west",
        "west",
        "north-west",
    ],
    "ms": [
        "utara",
        "timur laut",
        "timur",
        "tenggara",
        "selatan",
        "barat daya",
        "barat",
        "barat laut",
    ],
    "zh": ["北", "东北", "东", "东南", "南", "西南", "西", "西北"],
}
KIND = {  # edge_type -> the stretch named by its type when it has no OSM name
    "footway": ("the footway", "laluan pejalan kaki", "人行小路"),
    "sidewalk": ("the sidewalk", "laluan tepi jalan", "人行道"),
    "pedestrian": ("the pedestrian path", "laluan pejalan kaki", "步行道"),
    "crossing": ("the crossing", "lintasan", "过街处"),
    "steps": ("the steps", "anak tangga", "台阶"),
    "ramp": ("the ramp", "tanjakan", "坡道"),
    "path": ("the path", "laluan", "小路"),
    "street": ("the street", "jalan", "街道"),
    "track": ("the track", "denai", "土路"),
    "major_road": ("the main road", "jalan utama", "主干道"),
}
LEVEL = {
    "likely_ok": (
        "likely OK, estimated from map data",
        "kemungkinan OK, anggaran daripada data peta",
        "可能可行，根据地图数据估计",
    ),
    "unknown": ("not checked yet", "belum disemak", "尚未核实"),
    "barrier": ("barrier recorded", "halangan direkodkan", "有记录的障碍"),
}
TURN = {
    "turn_left": ("Turn left", "Belok kiri", "左转"),
    "turn_right": ("Turn right", "Belok kanan", "右转"),
    "slight_left": ("Bear left", "Belok sedikit ke kiri", "稍向左"),
    "slight_right": ("Bear right", "Belok sedikit ke kanan", "稍向右"),
    "u_turn": ("Turn back", "Pusing balik", "掉头"),
}
_I = {"en": 0, "ms": 1, "zh": 2}
# The route ends on the mapped graph; the place's own entrance may be off it (T-021 review).
ARRIVE = {
    "en": "Reach the end of the mapped route.",
    "ms": "Sampai di hujung laluan yang dipetakan.",
    "zh": "到达已绘制路线的终点。",
}


def _where(m: dict, lang: str) -> str:
    if name := (m.get("street_name") or "").strip():
        return name
    row = KIND.get(m.get("edge_type") or "")
    if row:
        return row[_I[lang]]
    return ("the path", "laluan", "路")[_I[lang]]


def _metres(m: dict, lang: str) -> str:
    d = m.get("distance_m") or 0
    n = round(d) if d >= 1 else d
    return {"en": f"about {n} m", "ms": f"kira-kira {n} m", "zh": f"约{n}米"}[lang]


def _heading(m: dict, lang: str) -> str | None:
    b = m.get("bearing_deg")
    if b is None:
        return None
    return COMPASS[lang][int(((b % 360) + 22.5) // 45) % 8]


def _label(m: dict, lang: str) -> str:
    row = LEVEL.get(m.get("access_level") or "")
    if not row:
        return ""
    return f" ({row[_I[lang]]})" if lang != "zh" else f"（{row[2]}）"


def step_text(m: dict, lang: str = "en") -> str:
    """One readable step from one maneuver, in `lang` ("en", "ms" or "zh")."""
    lang = lang if lang in _I else "en"
    action, where, dist = m.get("action"), _where(m, lang), _metres(m, lang)
    if action == "arrive":
        return ARRIVE[lang]
    head = _heading(m, lang)
    if action == "depart":
        if lang == "en":
            text = f"Start {'heading ' + head + ' ' if head else ''}along {where} for {dist}."
        elif lang == "ms":
            text = f"Mula {'ke arah ' + head + ' ' if head else ''}menyusuri {where} sejauh {dist}."
        else:
            text = f"出发，{'向' + head + '，' if head else ''}沿{where}走{dist}。"
    elif action == "continue":
        text = {
            "en": f"Continue along {where} for {dist}.",
            "ms": f"Teruskan menyusuri {where} sejauh {dist}.",
            "zh": f"继续沿{where}走{dist}。",
        }[lang]
    elif action == "cross":
        text = {
            "en": f"Cross at {where}, {dist}.",
            "ms": f"Melintas di {where}, {dist}.",
            "zh": f"在{where}过街，{dist}。",
        }[lang]
    else:
        turn = TURN.get(action or "", TURN["turn_left"])[_I[lang]]
        text = {
            "en": f"{turn} onto {where}. Continue {dist}.",
            "ms": f"{turn} ke {where}. Teruskan {dist}.",
            "zh": f"{turn}进入{where}，走{dist}。",
        }[lang]
    label = _label(m, lang)
    if not label:
        return text
    return text[:-1] + label + text[-1]


def maneuver_steps(route: dict, lang: str = "en", max_steps: int = MAX_STEPS) -> list[str]:
    """Answer steps for a route with `maneuvers`, else []. At most `max_steps` lines."""
    ms = sorted(route.get("maneuvers") or [], key=lambda m: m.get("index", 0))
    if not ms:
        return []
    lines = [step_text(m, lang) for m in ms]
    if len(lines) <= max_steps:
        return lines
    keep = max_steps - 2  # first steps, one "more on the map" line, the arrival
    hidden = len(lines) - keep - 1
    more = {
        "en": f"… {hidden} more steps are not listed here (shortened directions).",
        "ms": f"… {hidden} langkah lagi tidak disenaraikan di sini (arah dipendekkan).",
        "zh": f"……另有{hidden}个步骤未在此列出（路线说明已缩短）。",
    }[lang if lang in _I else "en"]
    return [*lines[:keep], more, lines[-1]]


# --------------------------------------------------------------------------- answer checks
# Model text may repeat a direction only as one maneuver states it (T-021 review): the street
# name exactly, the turn on its side, the distance of that same stretch.
STREET = re.compile(
    r"\b(?:Jalan|Persiaran|Lebuh(?:raya)?|Lorong|Bulatan|Lingkaran|Lengkok|Laman)"
    r"(?:\s+[A-Z0-9][\w/-]*)+"
)
SIDES = (
    (
        "left",
        re.compile(
            r"\b(?:turn|bear|keep|veer|slight(?:ly)?)\s+(?:to\s+the\s+)?left\b"
            r"|\bbelok\s+(?:sedikit\s+)?(?:ke\s+)?kiri\b|左转|向左|稍向左|靠左",
            re.I,
        ),
    ),
    (
        "right",
        re.compile(
            r"\b(?:turn|bear|keep|veer|slight(?:ly)?)\s+(?:to\s+the\s+)?right\b"
            r"|\bbelok\s+(?:sedikit\s+)?(?:ke\s+)?kanan\b|右转|向右|稍向右|靠右",
            re.I,
        ),
    ),
    ("u", re.compile(r"\bu[- ]?turn\b|\bturn (?:back|around)\b|\bpusing balik\b|掉头", re.I)),
)
_SENTENCES = re.compile(r"(?<!\d)[.;!?。；！？\n]+|[.;](?!\d)")
_CONTINUE = re.compile(
    r"^\s*(?:then\s+|and\s+)?(?:continue|keep going|go on|walk|follow it|teruskan|terus|"
    r"继续|再走)",
    re.I,
)
_CLOSED = re.compile(r"\bclosed\b|\bditutup\b|\btutup\b|已关闭|关闭|封闭", re.I)


def _norm(s: str) -> str:
    return " ".join(s.casefold().split())


def _side(action: str | None) -> str | None:
    a = action or ""
    return (
        "left"
        if a.endswith("left")
        else "right"
        if a.endswith("right")
        else ("u" if a == "u_turn" else None)
    )


def maneuver_errors(text: str, route: dict, closed_names: set[str] | frozenset = frozenset()):
    """Model text about a route with maneuvers, sentence by sentence: a street name equals a
    maneuver's street_name (or a road section name); a turn or bear on a named street has that
    street's maneuver side (else some maneuver's side); a distance in that sentence, or in the
    next "continue …" sentence, is that street's stretch. A closure sentence may name the
    closed street (staff report), which the route avoids."""
    from .facts import _matches, extract_facts

    ms = route.get("maneuvers") or []
    if not ms:
        return []
    by_street: dict[str, list[dict]] = {}
    for m in ms:
        if m.get("street_name"):
            by_street.setdefault(_norm(m["street_name"]), []).append(m)
    sections: dict[str, list[float]] = {}
    for r in route.get("road_sections") or []:
        if r.get("name"):
            sections.setdefault(_norm(r["name"]), []).append(float(r.get("length_m") or 0))
    known = set(by_street) | set(sections)
    closed = {_norm(n) for n in closed_names}
    all_sides = {_side(m.get("action")) for m in ms} - {None}
    errs: list[str] = []
    context: str | None = None
    for sentence in _SENTENCES.split(text):
        if not sentence.strip():
            continue
        found = {_norm(m.group(0)): m.group(0).strip() for m in STREET.finditer(sentence)}
        if _CLOSED.search(sentence):
            found = {n: raw for n, raw in found.items() if n not in closed}
        names = list(found)
        bad = [found[n] for n in names if n not in known]
        if bad:
            errs.append(
                f"Street names {sorted(set(bad))} are not on this route's maneuvers: name a street "
                "exactly as plan_route gives it (an unnamed stretch is 'the footway')."
            )
        said = [side for side, pattern in SIDES if pattern.search(sentence)]
        street = next((n for n in names if n in by_street), None)
        for side in said:
            sides = (
                {_side(m.get("action")) for m in by_street.get(street, [])} if street else all_sides
            )
            if side not in sides:
                where = f"onto {found[street]}" if street else "on this route"
                errs.append(
                    f"No maneuver {where} turns {side}: give turns only as the route's "
                    "maneuvers list them (the app writes the steps)."
                )
        if street:
            context = street
        elif not _CONTINUE.search(sentence):
            context = None
        if context:
            allowed = [float(m.get("distance_m") or 0) for m in by_street.get(context, [])]
            allowed += sections.get(context, [])
            allowed += [sum(allowed[: len(by_street.get(context, []))])] if allowed else []
            allowed.append(sum(sections.get(context, [])))
            for f in extract_facts(sentence):
                if f.kind == "length" and not any(_matches(f, v) for v in allowed if v):
                    errs.append(
                        f"The distance {f.raw!r} is not the {context} stretch in this route's "
                        "maneuvers: give each stretch its own distance (the app writes the steps)."
                    )
    return list(dict.fromkeys(errs))
