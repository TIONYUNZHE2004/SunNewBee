"""Deterministic route intent and exact-entity guards; no model-written facts.

A generic destination is resolved only when one matching place is local to the named
other endpoint. Otherwise the assistant must ask which place, rather than choose a path.
"""

import re
import unicodedata

from townshiplens_spatial.geo import haversine_m

from .facts import _matches, extract_facts

MODE_WORDS = {
    "wheelchair": r"wheelchair|kerusi\s+roda|轮椅",
    "stroller": r"stroller|pram|kereta\s+sorong|婴儿车|嬰兒車",
    "older_adult_rest": r"older adult|elderly|rest points?|warga emas|长者|老人",
    "drive": r"\bdriv(?:e|ing)\b|\bby car\b|\bmemandu\b|\bpandu\b"
    r"|\b(?:naik|dengan) kereta(?!\s+sorong)\b|\bberkereta\b|驾车|开车|乘车|坐车",
    "default": r"\bwalk(?:ing)?\b|\bon foot\b|\b(?:ber)?jalan kaki\b|步行|走路",
}
GENERIC = {
    "playground": ("playground", "taman permainan", "游乐场", "遊樂場"),
    "toilet": ("toilet", "restroom", "tandas", "厕所", "洗手间"),
    "seating": ("bench", "seating", "bangku", "长椅"),
    "shelter": ("shelter", "teduhan", "避雨处"),
    "clinic": ("clinic", "klinik", "诊所"),
    "mall": ("mall", "pusat beli belah", "商场"),
    "park": ("park", "公园"),
    "kiosk": ("kiosk", "小卖部"),
}
GENERIC_NAMES = {w for words in GENERIC.values() for w in words}
ROLE_PAIR = re.compile(
    r"\bfrom\s+(.+?)\s+to\s+(.+)|\bdari\s+(.+?)\s+ke\s+(.+)"
    r"|从(.+?)(?:到|去)(.+)|從(.+?)(?:到|去)(.+)",
    re.I,
)


class RouteSelectionError(ValueError):
    pass


def normalise(text):
    return " ".join(re.sub(r"[^\w\s]", " ", unicodedata.normalize("NFKC", text).casefold()).split())


def canonical_id(world, pid):
    if pid.startswith("__centre__"):
        centre = world.centres.get(pid.removeprefix("__centre__"))
        if centre and centre.place_id in world.places:
            return centre.place_id
    return pid


def entities(world):
    registry = {
        pid: {"name": p.name, "aliases": list(p.aliases), "type": p.type}
        for pid, p in world.places.items()
    }
    if "park-b" in registry:
        registry["park-b"]["aliases"].extend(["B停车场", "停车场B", "Tempat letak kereta B"])
    if "playground" in registry:
        registry["playground"]["aliases"].extend(
            [
                "Elmina Urban Park游乐场",
                "taman permainan Elmina Urban Park",
            ]
        )
    for p in registry.values():
        if p["name"].startswith("Elmina ") and len(p["name"].split()) >= 3:
            p["aliases"].append(p["name"].removeprefix("Elmina "))
        shortened = re.sub(r"^(?:Surau|Masjid|Sekolah|SK|SRA)\s+", "", p["name"], flags=re.I)
        if shortened != p["name"] and len(shortened.split()) >= 2:
            p["aliases"].append(shortened)
        # "Harmoni 1 @ City of Elmina Show Units" is asked for as "Harmoni 1".
        head = p["name"].split(" @ ", 1)[0].strip()
        if head != p["name"] and len(head.split()) >= 2:
            p["aliases"].append(head)
    for cid, c in world.centres.items():
        pid = canonical_id(world, "__centre__" + cid)
        if pid in registry:
            registry[pid]["aliases"].append(c.name)
        else:
            registry[pid] = {"name": c.name, "aliases": []}
    return registry


def mentions(text, places):
    """Longest, specific aliases win; generic words never prove an exact place identity."""
    plain = normalise(text)
    hits = []
    for pid, p in places.items():
        for name in [p["name"], *p.get("aliases", [])]:
            alias = normalise(name)
            if len(alias) < 3 or alias in GENERIC_NAMES:
                continue
            # Word boundaries for Latin names; Chinese place words may be adjacent to 从/到.
            pattern = re.escape(alias)
            if not re.search(r"[\u3400-\u9fff]", alias):
                pattern = r"(?<![a-z0-9_])" + pattern + r"(?![a-z0-9_])"
            for m in re.finditer(pattern, plain):
                hits.append((m.start(), m.end(), pid))
    return {
        pid
        for a, b, pid in hits
        if not any(c <= a and d >= b and d - c > b - a for c, d, _ in hits)
    }


# A negation governs a mode word up to three words later, inside its clause ("not in a
# wheelchair", "tidak guna kerusi roda", "不坐轮椅").
_MODE_NEGATION = re.compile(
    r"(?:\b(?:not|never|no|without|instead of|bukan|tidak|tak|tanpa)\b(?:\s+[^\s,.;!?]+){0,3}\s+"
    r"|(?:不是|不用|不坐|没有|不)[^，。,.;；！？!?]{0,4})$",
    re.I,
)


def _negated_mode(question, start):
    clause = re.split(r"[,.;!?，。；！？]", question[:start])[-1]
    return bool(_MODE_NEGATION.search(clause))


def effective_profile(question, ui_profile, supplied=None):
    every = {p: list(re.finditer(pattern, question, re.I)) for p, pattern in MODE_WORDS.items()}
    found = {
        p: [m for m in ms if not _negated_mode(question, m.start())] for p, ms in every.items()
    }
    explicit = {p for p, ms in found.items() if ms}
    negated = {p for p, ms in every.items() if ms and not found[p]}
    # A wheelchair/stroller question can also contain the ordinary word "walking".
    if explicit & {"wheelchair", "stroller", "older_adult_rest"}:
        explicit.discard("default")
    # "...in a wheelchair, and are there rest points?" asks about rest points on that route; it
    # does not name a second travel mode.
    if explicit & {"wheelchair", "stroller"} and all(
        re.fullmatch(r"rest points?", m.group(0), re.I) for m in found["older_adult_rest"]
    ):
        explicit.discard("older_adult_rest")
    if (
        explicit == {"default"}
        and ui_profile in {"wheelchair", "stroller", "older_adult_rest"}
        and not re.search(
            r"\b(?:I am|I'm) walking\b|\bon foot\b|\b(?:ber)?jalan kaki\b|我(?:是)?步行",
            question,
            re.I,
        )
    ):
        explicit.clear()  # "can he walk?" does not remove a selected mobility constraint
    if len(explicit) > 1 and not re.search(
        r"\bcompare\b|\bversus\b|\bvs\b|\bor\b|\batau\b|比较|还是", question, re.I
    ):
        raise RouteSelectionError(
            "More than one travel mode is named. Ask which mode this route should use."
        )
    # "I don't use a wheelchair" overrides the wheelchair selected in the app: walking.
    allowed = explicit or ({"default"} if ui_profile in negated else {ui_profile})
    chosen = supplied or (next(iter(allowed)) if len(allowed) == 1 else ui_profile)
    if chosen not in allowed:
        raise RouteSelectionError(
            f"This question is for {', '.join(sorted(allowed))}. Re-run the tool with that "
            "profile; do not substitute a walking route."
        )
    return chosen


def effective_scenario(question, world, ui_scenario, supplied=None):
    asked = {f.value for f in extract_facts(question) if f.kind == "stage"}
    allowed = {s.id for s in world.flood.scenarios if s.stage_m in asked}
    if asked and len({s.stage_m for s in world.flood.scenarios if s.id in allowed}) < len(asked):
        raise RouteSelectionError(
            "No scenario exists for the requested river level. Ask for a modelled level."
        )
    if re.search(
        r"\bbaseline\b|\bwithout flooding\b|\btanpa banjir\b|无洪水|没有洪水", question, re.I
    ):
        allowed.add("baseline")
    if not allowed:
        allowed = {ui_scenario or "baseline"}
    chosen = supplied or (next(iter(allowed)) if len(allowed) == 1 else None)
    if chosen not in allowed:
        raise RouteSelectionError(
            "Use the requested river scenario, or the active scenario on screen; "
            "do not substitute baseline conditions."
        )
    return None if chosen == "baseline" and not supplied and not ui_scenario else chosen


def role_phrases(question):
    match = ROLE_PAIR.search(question)
    if not match:
        reverse = re.search(
            r"\bto\s+(.+?),?\s+(?:from|starting (?:at|from))\s+(.+)"
            r"|\bke\s+(.+?),?\s+(?:dari|bermula (?:di|dari))\s+(.+)",
            question,
            re.I,
        )
        if reverse:
            parts = [v for v in reverse.groups() if v is not None]
            return parts[1], parts[0]
        arrow = re.search(r"(.+?)\s*(?:→|->)\s*(.+)", question)
        if arrow:
            return arrow.groups()
        target = re.search(r"\bto\s+(.+)|\bke\s+(.+)|到(.+)", question, re.I)
        if target:
            return question[: target.start()], next(v for v in target.groups() if v is not None)
        return None
    values = [v.strip() for v in match.groups() if v is not None]
    return values[0], values[1]


def generic_kind(phrase):
    plain = normalise(phrase)
    plain = re.sub(r"^(?:(?:the|a|an|nearest|closest|nearby|local|this|that)\s+)+", "", plain)
    for kind, words in GENERIC.items():
        for word in words:
            if plain.startswith(word):
                tail = plain[len(word) :].strip()
                if not tail or re.match(
                    r"^(?:without|with|for|using|if|when|under|and|please|how|can|is|are|does|"
                    r"have|has|now|tanpa|untuk|boleh|berapa)\b|^(?:有|怎么|如何|那里|那裡)",
                    tail,
                ):
                    return kind
    return None


def guard_origin(world, question, origin_id, *, context=None, strict=False):
    pair = role_phrases(question)
    named = mentions(pair[0] if pair else question, entities(world))
    if named:
        if named != {canonical_id(world, origin_id)}:
            raise RouteSelectionError(
                "Resolve the exact named starting place; do not search from another origin."
            )
    elif context:
        if origin_id != context.get("from_place"):
            raise RouteSelectionError(
                "This follow-up must use the previous route's starting place."
            )
    elif strict:
        raise RouteSelectionError(
            "Ask for the starting place before searching for nearby destinations."
        )


def guard_endpoints(world, question, args, *, context=None, strict=False, centre_options=()):
    pair = role_phrases(question)
    registry = entities(world)
    # A requested evacuation destination is chosen by the deterministic centre search,
    # using the same origin, mode and scenario. It is never a model-invented endpoint.
    if re.search(
        r"evacuation|centre|center|pusat pemindahan|疏散|避难|where.+(?:she|he|I|we) go",
        question,
        re.I,
    ):
        options = [
            option
            for option in centre_options
            if all(option.get(k) == args.get(k) for k in ("from_id", "profile", "scenario_id"))
        ]
        if re.search(r"nearest|closest|terdekat|最近", question, re.I):
            options = options[:1]
        origin = canonical_id(world, args.get("from_id", ""))
        named = mentions(question, registry)
        if (
            any(o["to_id"] == args.get("to_id") for o in options)
            and origin in named
            and not (named - {origin, canonical_id(world, args.get("to_id", ""))})
        ):
            return
    if not pair:
        named = mentions(question, registry)
        chosen = {canonical_id(world, args.get(k, "")) for k in ("from_id", "to_id")}
        if named and not named <= chosen:
            raise RouteSelectionError(
                "The chosen route does not include the exact places named in the question."
            )
        if context and not named:
            expected = tuple(context[k] for k in ("from_place", "to_place"))
            if tuple(args.get(k) for k in ("from_id", "to_id")) != expected:
                raise RouteSelectionError(
                    "This follow-up refers to the previous route. Re-run its exact endpoints "
                    "instead of choosing another journey."
                )
        elif strict and named != chosen:  # both ends named exactly ("I'm at X. Is Y reachable?")
            raise RouteSelectionError(
                "Please name the exact start and destination before selecting a route."
            )
        return
    for phrase, key, otherkey in zip(pair, ("from_id", "to_id"), ("to_id", "from_id"), strict=True):
        selected = canonical_id(world, args.get(key, ""))
        named = mentions(phrase, registry)
        if named:
            if len(named) > 1 or selected not in named:
                names = ", ".join(sorted(registry[p]["name"] for p in named))
                raise RouteSelectionError(
                    f"The requested endpoint names {names}. Resolve that exact place with "
                    "find_place; ask which one if more than one matches. "
                    "Do not substitute another place."
                )
            continue
        kind = generic_kind(phrase)
        if not kind:
            raise RouteSelectionError(
                "The endpoint name could not be resolved exactly. Ask for its exact name; "
                "do not replace it with a familiar demo destination."
            )
        other = world.places.get(args.get(otherkey, ""))
        if other is None:
            raise RouteSelectionError(
                "Ask for a named start and destination before selecting a route."
            )
        nearby = [
            p
            for p in world.places.values()
            if (p.type == kind or (kind == "kiosk" and re.search(r"\bkiosk\b", p.name, re.I)))
            and haversine_m(other.coord, p.coord) <= 1000
        ]
        if len(nearby) != 1:
            names = ", ".join(sorted(p.name for p in nearby)[:4])
            raise RouteSelectionError(
                f"Which {kind} do you mean near {other.name}? "
                + (f"Candidates: {names}. " if names else "")
                + "Ask for the exact place; do not guess an endpoint."
            )
        if selected != nearby[0].id:
            raise RouteSelectionError(
                f"The local {kind} near {other.name} is {nearby[0].name} "
                f"({nearby[0].id}). Resolve it before routing; do not choose a distant name match."
            )


def bound_measurement_errors(answer, record):
    """A place name cannot borrow distance/time from another entity of the same category."""
    if not record.place_entities or not record.measurement_subjects:
        return []
    errors = []
    for text in [answer.summary, *answer.steps, *answer.caveats, *(c.text for c in answer.claims)]:
        # Keep decimal numbers intact when splitting sentences.
        for clause in re.split(r"(?<!\d)[.;。；!?！？\n]|[.;](?!\d)", text):
            ids = mentions(clause, record.place_entities)
            measured = [f for f in extract_facts(clause) if f.kind in {"length", "time"}]
            if ids and measured:
                sources = [s for s in record.measurement_subjects if ids <= set(s["place_ids"])]
                values = {}
                for source in sources:
                    for key, numbers in source["values"].items():
                        values.setdefault(key, set()).update(numbers)
                # The ordinary typed gate handles widths/slopes/counts. Here only a named
                # distance/time must come from that exact entity's returned measurements.
                if not sources or any(
                    not any(_matches(f, v) for v in values.get(f.kind, ())) for f in measured
                ):
                    errors.append(
                        "Route endpoint mismatch: this measurement was not returned for the "
                        "exact named "
                        "places. Re-run the correct route or remove the measurement."
                    )
    return errors


def requested_radius(question):
    limits = []
    for fact in extract_facts(question):
        if fact.kind != "length":
            continue
        offset = question.casefold().find(fact.raw.casefold())
        if offset < 0:
            continue
        before, after = question[:offset], question[offset + len(fact.raw) :]
        if re.search(
            r"(?:within|up to|under|at most|no more than|dalam jarak|kurang daripada)\s*$",
            before,
            re.I,
        ) or re.match(r"\s*(?:以内|内)", after):
            limits.append(fact.value)  # the common fact parser already converts units to metres
    return min(limits) if limits else None


def amenity_selection_errors(answer, record):
    return amenity_text_errors(" ".join([answer.summary, *answer.steps, *answer.caveats]), record)


def amenity_text_errors(text, record):
    if not record.amenity_searches:
        return []
    allowed = {pid for s in record.amenity_searches for pid in [s["origin_id"], *s["ids"]]}
    named = mentions(text, record.place_entities)
    kinds = {s.get("amenity") for s in record.amenity_searches}
    if any(pid not in allowed and record.place_entities[pid].get("type") in kinds for pid in named):
        return [
            "Only name amenity destinations returned by the matching amenity search. "
            "Do not recommend other find_place candidates when the search found no matching route."
        ]
    return []


# Positive assertions an estimate cannot support. Existing promise/depth checks still apply.
_ESTIMATE_FACT = re.compile(
    r"\b(?:confirmed|verified|checked|surveyed|step[- ]free|barrier[- ]free|accessible)\b"
    r"|\bwheelchair[- ]friendly\b|\bno (?:steps|steep sections)\b"
    r"|\b(?:disahkan|ditinjau|diperiksa|mesra kerusi roda|bebas halangan)\b"
    r"|已(?:核实|检查|调查|确认)|无障碍|轮椅友好|没有台阶|没有陡坡",
    re.I,
)
_ESTIMATE_NEGATIVE = re.compile(
    r"(?:\b(?:not|never|cannot|unverified|belum|tidak|bukan)(?:\s+yet)?(?:\s+been)?\s*"
    r"|未|没有|尚未|并非|不是)$",
    re.I,
)


def has_estimates(record):
    return any(
        r.get("status") == "likely_ok" or r.get("access_metres", {}).get("likely_ok", 0) > 0
        for r in record.routes.values()
    )


def estimate_text_errors(text, record):
    if not has_estimates(record):
        return []
    for clause in re.split(r"[.;。；!?！？\n]|\bbut\b|\btetapi\b|但是", text):
        for match in _ESTIMATE_FACT.finditer(clause):
            physical = re.search(
                r"step[- ]free|barrier[- ]free|accessible|friendly|no (?:steps|steep sections)"
                r"|mesra|bebas|无障碍|友好|没有台阶|没有陡坡",
                match.group(),
                re.I,
            )
            if physical and re.search(
                r"\blikely\b|\bestimat|\brecorded\b|\bmapped\b|\btagged\b"
                r"|\banggar|\bmungkin\b|\bkemungkinan\b|可能|估计|估算|记录|direkodkan",
                clause,
                re.I,
            ):
                continue  # explicitly estimated access, never a checked physical fact
            if not _ESTIMATE_NEGATIVE.search(clause[: match.start()]):
                return [
                    "Map estimates are not checked facts: remove positive survey, confirmation "
                    "or accessibility claims."
                ]
    return []


def has_estimate_qualifier(text):
    low = text.casefold()
    return bool(
        re.search(
            r"estimat\w*[^.;。]{0,80}(?:map|osm|openstreetmap)|(?:map|osm|openstreetmap)[^.;。]{0,80}estimat",
            low,
        )
        or re.search(r"anggaran[^.;。]{0,80}(?:peta|osm)|(?:peta|osm)[^.;。]{0,80}anggaran", low)
        or re.search(
            r"(?:地图|osm)[^。；]{0,30}(?:估计|估算)|(?:估计|估算)[^。；]{0,30}(?:地图|osm)", low
        )
    )
