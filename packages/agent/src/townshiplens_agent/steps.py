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
ARRIVE = {"en": "Arrive at your destination.", "ms": "Tiba di destinasi.", "zh": "到达目的地。"}


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
        "en": f"… {hidden} more steps are shown on the map.",
        "ms": f"… {hidden} langkah lagi ditunjukkan pada peta.",
        "zh": f"……另有{hidden}个步骤显示在地图上。",
    }[lang if lang in _I else "en"]
    return [*lines[:keep], more, lines[-1]]


# --------------------------------------------------------------------------- answer checks
STREET = re.compile(
    r"\b(?:Jalan|Persiaran|Lebuh(?:raya)?|Lorong|Bulatan|Lingkaran|Lengkok|Laman)"
    r"(?:\s+[A-Z0-9][\w/-]*)+"
)
_TURN_WORDS = (
    (re.compile(r"\bturn(?:s|ing)?\s+left\b|\bbelok\s+kiri\b|左转|向左转", re.I), "left"),
    (re.compile(r"\bturn(?:s|ing)?\s+right\b|\bbelok\s+kanan\b|右转|向右转", re.I), "right"),
)


def _norm(s: str) -> str:
    return " ".join(s.casefold().split())


def maneuver_errors(text: str, route: dict) -> list[str]:
    """Model text about a route with maneuvers: every street name it gives is a maneuver's
    street_name, and a stated turn side exists among the maneuvers."""
    ms = route.get("maneuvers") or []
    if not ms:
        return []
    errs = []
    streets = {_norm(m["street_name"]) for m in ms if m.get("street_name")}
    streets |= {_norm(r.get("name") or "") for r in route.get("road_sections") or []}
    named = {m.group(0).strip() for m in STREET.finditer(text)}
    unknown = sorted(
        n
        for n in named
        if not any(s.startswith(_norm(n)) or _norm(n).startswith(s) for s in streets if s)
    )
    if unknown:
        errs.append(
            f"Street names {unknown} are not on this route's maneuvers: name only the streets the "
            "route uses, as plan_route gives them (an unnamed stretch is 'the footway')."
        )
    sides = {
        side for m in ms for side in ("left", "right") if (m.get("action") or "").endswith(side)
    }
    for pattern, side in _TURN_WORDS:
        if pattern.search(text) and side not in sides:
            errs.append(
                f"No maneuver on this route turns {side}: give turns only as the route's "
                "maneuvers list them (the app writes the steps)."
            )
    return errs
