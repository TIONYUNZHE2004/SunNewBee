"""Fact binding (audit A2, T-001): every fact an answer states must match a tool field.

The validator used to accept any number a tool had shown, in any unit: "3 minutes" passed
because an incline of 3 % existed, "1 km" because a list had one item. Here each stated fact is
typed by what it measures, and it passes only against a tool value of the same kind:

- length: "440 m", "0.44 km", "440米" -> distance_m, walk_m, *_m (not width), "110 m" in text
- width: "1.5 m wide", "lebar 1.5 m", "宽1.5米" -> width_m evidence, *width* keys
- stage: "+3 m", "river rises 3 m" -> stage_m, "+3 m" in scenario labels
- time: "6 minutes", "1 hour", "6分钟" -> est_minutes, *minutes*, "6.3 min" in text
- slope: "3%", "3 percent" -> incline_pct evidence, *_pct
- steps: "99 steps", "99 anak tangga", "99级台阶" -> step_count evidence
- count: "27 toilets", "2 road crossings" -> list lengths, *_count / *_total, counts in text

Rounding policy: the exact value, or decimal rounding (440.6 -> 440.6 / 441 / 440), passes as
it is. A coarser round number (nearest 5, 10, 50 or 100, within 15 %) needs approximation wording
("about", "kira-kira", "约"), and "under" / "over" must point the right way. "exactly" allows no
rounding. Number words ("two minutes", "dua minit", "两分钟") are read like digits.

Subjects (T-001 follow-up): a fact is also bound to what it is about. A count of a noun ("two
toilets", "3 road crossings") must match a count of that same thing (a list of toilet results,
a route's crossings, "2 road crossings" in tool text); a list of anything else is not a count of
toilets. A length or time whose clause names places ("the toilet is 440.6 m from the mall")
must match a value tagged with every category named there: a route is tagged with its two
endpoints' types and names, an amenity result with its own type and its origin, a centre row as
a centre. Clauses that name no category keep the plain kind rule.

Features without a number ("a baby changing room", "a lift", "open 24 hours", "handrails") pass
only when evidence this turn records them positively, unless the feature's own clause is negated
or hedged ("No steps, so the toilet has a changing room" states a changing room).
"""

import math
import re
from dataclasses import dataclass

# ---------------------------------------------------------------------------- numbers
_EN_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90, "a hundred": 100, "hundred": 100,
    "a thousand": 1000, "half a": 0.5, "half an": 0.5,
}  # fmt: skip
_BM_WORDS = {
    "kosong": 0, "sifar": 0, "satu": 1, "dua": 2, "tiga": 3, "empat": 4, "lima": 5,
    "enam": 6, "tujuh": 7, "lapan": 8, "sembilan": 9, "sepuluh": 10, "sebelas": 11,
    "dua puluh": 20, "tiga puluh": 30, "empat puluh": 40, "lima puluh": 50, "seratus": 100,
    "setengah": 0.5,
}  # fmt: skip
_WORDS = {**_EN_WORDS, **_BM_WORDS}
_WORD_ALT = "|".join(sorted((re.escape(w) for w in _WORDS), key=len, reverse=True))
_ZH_DIGITS = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6,
              "七": 7, "八": 8, "九": 9}  # fmt: skip
_NUM = r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?"
_ZH_NUM = r"[零〇一二两三四五六七八九十百]+"


def _zh_value(s: str) -> float | None:
    """Simple Chinese numerals: 三, 十五, 二十, 二十五, 一百, 九十九."""
    if not s:
        return None
    total, cur = 0, 0
    for ch in s:
        if ch in _ZH_DIGITS:
            cur = _ZH_DIGITS[ch]
        elif ch == "十":
            total += (cur or 1) * 10
            cur = 0
        elif ch == "百":
            total += (cur or 1) * 100
            cur = 0
        else:
            return None
    return float(total + cur)


def _value(token: str) -> float | None:
    t = token.strip().lower()
    if re.fullmatch(_NUM, t):
        return float(t.replace(",", ""))
    if t in _WORDS:
        return float(_WORDS[t])
    return _zh_value(token.strip())


# ---------------------------------------------------------------------------- units and kinds
# unit text -> (base, factor to base): length base m, time base min, slope base %
_UNITS: dict[str, tuple[str, float]] = {}
for _u in ("km", "kilometre", "kilometres", "kilometer", "kilometers", "公里", "千米"):
    _UNITS[_u] = ("m", 1000.0)
for _u in ("m", "metre", "metres", "meter", "meters", "米", "公尺"):
    _UNITS[_u] = ("m", 1.0)
for _u in ("cm", "centimetre", "centimetres", "centimeter", "centimeters", "厘米"):
    _UNITS[_u] = ("m", 0.01)
for _u in ("min", "mins", "minute", "minutes", "minit", "分钟", "分"):
    _UNITS[_u] = ("min", 1.0)
for _u in ("h", "hr", "hrs", "hour", "hours", "jam", "小时", "个小时"):
    _UNITS[_u] = ("min", 60.0)
for _u in ("s", "sec", "secs", "second", "seconds", "saat", "秒"):
    _UNITS[_u] = ("min", 1 / 60)
for _u in ("%", "percent", "per cent", "peratus"):
    _UNITS[_u] = ("pct", 1.0)
_UNIT_ALT = "|".join(sorted((re.escape(u) for u in _UNITS), key=len, reverse=True))

_MEASURE = re.compile(
    rf"(?<![A-Za-z0-9_.,/])(\+\s?)?({_NUM}|{_WORD_ALT}|{_ZH_NUM})(?:\s|-)?({_UNIT_ALT})"
    r"(?![A-Za-z])",
    re.IGNORECASE,
)
_ZH_PERCENT = re.compile(rf"百分之({_ZH_NUM}|{_NUM})")

_STEP_NOUN = r"steps?|stairs?|anak tangga|tangga|台阶|阶梯|楼梯|级台阶"
_COUNT_NOUN = (
    r"toilets?|restrooms?|washrooms?|bench(?:es)?|seats?|crossings?|ramps?|lifts?|elevators?"
    r"|entrances?|shelters?|kerbs?|curbs?|tandas|bangku|tempat duduk|lintasan|tanjakan|lif"
    r"|pintu masuk|厕所|洗手间|长椅|座位|过街|斑马线|坡道|电梯|入口"
)
_COUNTED = re.compile(
    rf"(?<![A-Za-z0-9_.,/])({_NUM}|{_WORD_ALT}|{_ZH_NUM})\s?(?:个|间|张|处|级|座|条|部)?"
    rf"(?:\s?[^\d\s.,;:!?。，；]{{1,14}}){{0,2}}?\s?({_STEP_NOUN}|{_COUNT_NOUN})(?![A-Za-z])",
    re.IGNORECASE,
)

_CLAUSE_END = re.compile(r"[.;:!?。；：！？\n]|,\s")
_CJK = re.compile(r"[\u3400-\u9fff]")
_ZH_CLASSIFIERS = set("个间张处级座条部")  # the measure words a counted noun may take

# What a fact can be about. Canonical words (the first of each) re-match their own pattern, so a
# place name can be replaced by its categories before checking (validate._names_to_categories).
CATEGORIES: tuple[tuple[str, str, re.Pattern[str]], ...] = tuple(
    (cat, word, re.compile(rf"(?<![A-Za-z])(?:{pat})(?![A-Za-z])", re.IGNORECASE))
    for cat, word, pat in (
        ("toilet", "toilet", r"toilets?|restrooms?|washrooms?|tandas|厕所|洗手间|卫生间"),
        ("bench", "bench", r"bench(?:es)?|seats?|bangku|tempat duduk|长椅|座椅|座位"),
        ("crossing", "crossing", r"crossings?|lintasan|过街|斑马线|人行横道"),
        ("ramp", "ramp", r"ramps?|tanjakan|坡道"),
        ("lift", "lift", r"lifts?|elevators?|lif|电梯"),
        ("entrance", "entrance", r"entrances?|pintu masuk|入口"),
        ("shelter", "shelter", r"shelters?|teduhan|避雨处"),
        ("playground", "playground", r"playgrounds?|taman permainan|游乐场|儿童乐园"),
        ("parking", "parking", r"car ?parks?|parking|tempat letak kereta|停车场"),
        ("mall", "mall", r"malls?|pusat beli-belah|商场"),
        ("kiosk", "kiosk", r"kiosks?|小卖部|报亭"),
        ("clinic", "clinic", r"clinics?|klinik|诊所"),
        (
            "worship",
            "surau",
            r"surau|mosques?|masjid|churche?s?|temples?|place of worship|清真寺|祈祷室|教堂|寺庙",
        ),
        ("school", "school", r"schools?|sekolah|学校"),
        (
            "centre",
            "evacuation centre",
            r"evacuation cent(?:re|er)s?|relief cent(?:re|er)s?|pps|pusat pemindahan"
            r"|疏散中心|避难所|安置中心|疏散点",
        ),
    )
)


def categories(text: str) -> set[str]:
    """The place categories a text names ("the toilet near Car Park B" -> toilet, parking)."""
    text = (text or "").replace("_", " ")
    return {cat for cat, _, pat in CATEGORIES if pat.search(text)}


def category_words(text: str) -> str:
    """A name replaced by the canonical words of its categories ("Urban Park toilet" ->
    "toilet"), so stripping a name keeps what it is."""
    words = [w for cat, w, pat in CATEGORIES if pat.search((text or "").replace("_", " "))]
    return " " + " ".join(words) + " "


def _clause(text: str, start: int, end: int) -> str:
    before = _CLAUSE_END.split(text[:start])[-1]
    after = _CLAUSE_END.split(text[end:], maxsplit=1)[0]
    return before + text[start:end] + after


_WIDTH_CTX = re.compile(r"\bwide\b|\bwidth\b|\blebar\b|宽", re.IGNORECASE)
_STAGE_CTX = re.compile(
    r"\briver\b|\bstage\b|\brises?\b|\brising\b|\bsungai\b|\bnaik\b|\bparas\b|河|水位|上涨|上升",
    re.IGNORECASE,
)
_APPROX = re.compile(
    r"(?:\babout|\baround|\broughly|\bapproximately|\bapprox\.?|\bnearly|\balmost|\bsome"
    r"|\bunder|\bless than|\bbelow|\bover|\bmore than|\babove|\bup to|\bjust over|\bjust under"
    r"|~|\bkira-kira|\blebih kurang|\bsekitar|\bhampir|\bkurang (?:daripada|dari)"
    r"|\blebih (?:daripada|dari)|约|大约|大概|将近|差不多|不到|超过|接近)\W{0,3}$",
    re.IGNORECASE,
)
_APPROX_AFTER = re.compile(r"^\s?(?:左右|多|or so|ish)", re.IGNORECASE)
_DOWN = re.compile(
    r"(?:under|less than|below|up to|just under|kurang|不到|接近)\W{0,3}$", re.IGNORECASE
)
_UP = re.compile(r"(?:over|more than|above|just over|lebih|超过)\W{0,3}$", re.IGNORECASE)
_EXACT = re.compile(
    r"(?:\bexactly|\bprecisely|\bjust|\btepat|\btepat sekali|正好|整整|恰好|刚好)\W{0,3}$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Fact:
    kind: str  # length | width | stage | time | slope | steps | count
    value: float  # in the base unit (m, min, %) or a count
    shown: float  # the number as written
    factor: float  # shown * factor == value
    raw: str
    approx: bool = False
    exact: bool = False
    direction: str = ""  # "down" (under), "up" (over) or ""
    noun: str = ""  # counts: the category counted ("toilet"), "" for an uncategorised noun
    subjects: frozenset[str] = frozenset()  # lengths/times: categories named in the clause


def _context(text: str, start: int, end: int) -> tuple[bool, bool, str]:
    before = text[max(0, start - 30) : start]
    approx = bool(_APPROX.search(before) or _APPROX_AFTER.match(text[end : end + 8]))
    exact = bool(_EXACT.search(before))
    direction = "down" if _DOWN.search(before) else "up" if _UP.search(before) else ""
    return approx, exact, direction


def extract_facts(text: str) -> list[Fact]:
    """The measured and counted facts a text states (see the module list)."""
    facts: list[Fact] = []
    taken: list[tuple[int, int]] = []
    for m in _MEASURE.finditer(text):
        n = _value(m.group(2))
        unit = _UNITS.get(m.group(3).lower()) or _UNITS.get(m.group(3))
        if n is None or unit is None:
            continue
        base, factor = unit
        if base == "m":
            # Context words count only inside the same clause ("... 440 m. Width ..." is not a
            # width).
            after = _CLAUSE_END.split(text[m.end() : m.end() + 14], maxsplit=1)[0]
            before = _CLAUSE_END.split(text[max(0, m.start() - 30) : m.start()])[-1]
            if m.group(1) or _STAGE_CTX.search(before):
                kind = "stage"
            elif _WIDTH_CTX.search(after) or _WIDTH_CTX.search(before[-12:]):
                kind = "width"
            else:
                kind = "length"
        else:
            kind = {"min": "time", "pct": "slope"}[base]
        approx, exact, direction = _context(text, m.start(), m.end())
        subjects = (
            frozenset(categories(_clause(text, m.start(), m.end())))
            if kind in ("length", "time")
            else frozenset()
        )
        facts.append(
            Fact(
                kind,
                n * factor,
                n,
                factor,
                m.group(0).strip(),
                approx,
                exact,
                direction,
                subjects=subjects,
            )
        )
        taken.append(m.span())
    for m in _ZH_PERCENT.finditer(text):
        n = _value(m.group(1))
        if n is not None:
            approx, exact, direction = _context(text, m.start(), m.end())
            facts.append(Fact("slope", n, n, 1.0, m.group(0), approx, exact, direction))
            taken.append(m.span())
    for m in _COUNTED.finditer(text):
        if any(a <= m.start(1) < b for a, b in taken):
            continue  # "6 minutes" is a time, not a count
        nxt = text[m.end(1) : m.end(1) + 1]
        if (
            _CJK.match(nxt)
            and nxt not in _ZH_CLASSIFIERS
            and not m.group(0)[len(m.group(1)) :].lstrip().startswith(m.group(2))
        ):
            continue  # "两段…的台阶": the number counts segments (段), not steps
        n = _value(m.group(1))
        if n is None or n != int(n):
            continue
        kind = "steps" if re.fullmatch(_STEP_NOUN, m.group(2), re.IGNORECASE) else "count"
        approx, exact, direction = _context(text, m.start(), m.end())
        noun = next(iter(sorted(categories(m.group(2)))), "") if kind == "count" else ""
        facts.append(Fact(kind, n, n, 1.0, m.group(0).strip(), approx, exact, direction, noun=noun))
    return facts


# ---------------------------------------------------------------------------- tool values
_SKIP_KEYS = {"coordinates", "geometry", "bbox", "coord", "lat", "lon", "lng", "diff_geojson"}
_ID_VALUE = re.compile(r"^[a-z_]+[-:][\w.:-]+$|^[0-9a-f]{8,}$", re.IGNORECASE)


def kind_of_key(key: str) -> str | None:
    """What a numeric tool field measures, from its key (or an evidence attribute name)."""
    k = key.lower()
    if "width" in k:
        return "width"
    if k.endswith("_pct") or "incline" in k or "slope" in k or "percent" in k:
        return "slope"
    if k in ("step_count", "steps", "step_total"):
        return "steps"
    if "minute" in k or k.endswith("_min"):
        return "time"
    if "stage" in k:
        return "stage"
    if k.endswith(("_m", "_metres", "_meters")) or k in ("distance", "length", "walk_m"):
        return "length"
    if k.endswith(("count", "_total", "total")) or k in ("n", "count"):
        return "count"
    return None


_LABEL_KEYS = ("type", "kind", "amenity", "category", "name", "label", "element_label")


def tool_values(payload, resolve=None, subject: set[str] | None = None) -> dict[str, set[float]]:
    """Typed values a tool result shows: numeric fields by key, evidence values by attribute,
    list lengths as counts, and the facts written inside readable strings ("about 110 m",
    "River +3 m", "uses 2 road crossings"). Ids, keys and geometry are never read.

    Subject-tagged values ("length:toilet", "count:toilet") record what a value is about: the
    categories of the dict it sits in (its type/name fields; a route's endpoints through
    `resolve(place_id) -> categories`), with `subject` added for the rows of a top-level "data"
    list (the amenity asked for and its origin)."""
    out: dict[str, set[float]] = {}

    def add(kind: str | None, v: float) -> None:
        if kind:
            out.setdefault(kind, set()).add(float(v))

    def cats_of(x: dict) -> set[str]:
        cats: set[str] = set()
        for k in _LABEL_KEYS:
            v = x.get(k)
            if isinstance(v, str) and not _ID_VALUE.match(v):
                cats |= categories(v)
        if isinstance(x.get("centre"), dict) or str(x.get("id", "")).startswith("evc-"):
            cats.add("centre")
        if resolve is not None:
            for k in ("from_place", "to_place"):
                if isinstance(x.get(k), str):
                    cats |= resolve(x[k])
        return cats

    def walk(x, key: str = "", extra: frozenset[str] = frozenset()) -> None:
        if key in _SKIP_KEYS or key in ("id", "ids") or key.endswith(("_id", "_ids")):
            return
        if isinstance(x, bool):
            return
        if isinstance(x, int | float):
            add(kind_of_key(key), x)
        elif isinstance(x, str):
            if not _ID_VALUE.match(x):
                named = categories(x)
                for f in extract_facts(x):
                    add(f.kind, f.value)
                    if f.kind == "count" and f.noun:
                        add(f"count:{f.noun}", f.value)
                    if f.kind in ("length", "time"):
                        for c in named:
                            add(f"{f.kind}:{c}", f.value)
        elif isinstance(x, dict):
            attr, val = x.get("attribute"), x.get("value")
            if isinstance(attr, str) and isinstance(val, int | float) and not isinstance(val, bool):
                add(kind_of_key(attr), val)
            cats = cats_of(x) | extra
            for k, v in x.items():
                if k != "value" or not isinstance(attr, str):
                    walk(v, str(k))
                kind = kind_of_key(str(k))
                if kind in ("length", "time") and isinstance(v, int | float | bool):
                    for c in cats if not isinstance(v, bool) else ():
                        add(f"{kind}:{c}", v)
        elif isinstance(x, list):
            add("count", len(x))
            for c in categories(key):  # "crossings": [...] counts crossings
                add(f"count:{c}", len(x))
            # Distinct things per category: a route's unknowns list one row per attribute, so
            # three unchecked facts on one ramp are still "one ramp".
            things: dict[str, set] = {}
            for i, v in enumerate(x):
                if isinstance(v, dict):
                    ident = v.get("element_id") or v.get("id") or i
                    for c in cats_of(v) | extra:
                        things.setdefault(c, set()).add(str(ident))
            for c, ids in things.items():
                add(f"count:{c}", len(ids))
            for v in x:
                walk(v, key, extra)

    if subject and isinstance(payload, dict):
        walk({k: v for k, v in payload.items() if k != "data"})
        walk(payload.get("data"), "data", frozenset(subject))
    else:
        walk(payload)
    return out


def merge(*parts: dict[str, set[float]]) -> dict[str, set[float]]:
    out: dict[str, set[float]] = {}
    for p in parts:
        for k, v in p.items():
            out.setdefault(k, set()).update(v)
    return out


# ---------------------------------------------------------------------------- matching
def _matches(f: Fact, v: float) -> bool:
    """f states v under the rounding policy (module docstring), compared in the unit written."""
    shown_v = v / f.factor  # the tool value in the unit the answer used
    x = f.shown
    if abs(x - shown_v) < 1e-9 or any(abs(x - round(shown_v, d)) < 1e-9 for d in (1, 2)):
        return True
    if f.exact:
        return False
    near = abs(x - shown_v) <= 0.15 * abs(shown_v)
    whole = abs(x - round(shown_v)) < 1e-9 or x in (math.floor(shown_v), math.ceil(shown_v))
    if whole and near:
        return f.kind not in ("steps", "count")  # counts are whole: 3 is never 2.6
    if f.direction == "down" and x < shown_v or f.direction == "up" and x > shown_v:
        return False
    # "about 2 minutes" for 1.7 min: the nearest whole number, with "about" (live check T-001)
    nearest = x == math.floor(shown_v + 0.5) and shown_v >= 1
    if f.approx and nearest and f.kind not in ("steps", "count"):
        return True
    if not f.approx or not near:
        return False
    return any(abs(x / s - round(x / s)) < 1e-9 for s in (5, 10, 50, 100) if s < abs(shown_v))


def _candidates(f: Fact, values: dict[str, set[float]]) -> set[float]:
    """The tool values a fact may match: counts of the same noun; lengths and times tagged with
    every category its clause names; otherwise every value of its kind."""
    if f.kind == "count" and f.noun:
        return values.get(f"count:{f.noun}", set())
    if f.kind in ("length", "time") and f.subjects:
        tagged = [values.get(f"{f.kind}:{c}", set()) for c in sorted(f.subjects)]
        return set.intersection(*tagged)
    return values.get(f.kind, set())


def unsupported(
    text: str, values: dict[str, set[float]], skip: set[str] | frozenset[str] = frozenset()
) -> list[str]:
    """Raw phrases of facts in the text that no tool value of the same kind (and subject)
    supports (kinds in `skip` are checked elsewhere)."""
    return [
        f.raw
        for f in extract_facts(text)
        if f.kind not in skip and not any(_matches(f, v) for v in _candidates(f, values))
    ]


# ---------------------------------------------------------------------------- features
_SENTENCE = re.compile(r"(?<=[.!?;。！？；])\s*|\n")
_HEDGE = re.compile(
    r"\b(?:no|not|none|never|without|isn't|aren't|wasn't|doesn't|don't|cannot|can't|unknown"
    r"|unverified|unchecked|unclear|may|might|ask|check|whether)\b|\bnot (?:yet )?(?:checked|"
    r"recorded|mapped|surveyed)|\bno record|\btiada\b|\btidak\b|\btak\b|\bbelum\b|\bbukan\b"
    r"|\bmungkin\b|\bsila (?:tanya|semak)\b|没有|无|未|不|尚未|不确定|可能|请询问",
    re.IGNORECASE,
)
_POSITIVE = {True, "yes", "limited", "both", "one_side", "covered", "partial"}
# (label, phrases that state the feature, evidence attributes that can support it, value test)
FEATURES: tuple[tuple[str, re.Pattern[str], frozenset[str], object], ...] = (
    (
        "baby changing room",
        re.compile(
            r"baby[- ]chang|changing (?:room|table|station)|nursing room|bilik (?:menukar "
            r"lampin|penyusuan)|母婴室|育婴室|换尿布",
            re.IGNORECASE,
        ),
        frozenset({"baby_changing"}),
        None,
    ),
    (
        "lift",
        re.compile(r"\blifts?\b|\belevators?\b|\blif\b|电梯", re.IGNORECASE),
        frozenset({"lift", "elevator"}),
        None,
    ),
    (
        "24-hour opening",
        re.compile(
            r"\bopen 24|\b24/7\b|\b24 hours\b|round[- ]the[- ]clock|\b24 jam\b|24小时|全天开放",
            re.IGNORECASE,
        ),
        frozenset({"opening_hours"}),
        lambda v: isinstance(v, str) and "24" in v,
    ),
    (
        "handrail",
        re.compile(r"\bhandrails?\b|pemegang tangan|扶手", re.IGNORECASE),
        frozenset({"handrail"}),
        None,
    ),
    (
        "tactile paving",
        re.compile(r"\btactile\b|laluan taktil|盲道", re.IGNORECASE),
        frozenset({"tactile_paving"}),
        None,
    ),
    (
        "accessible toilet",
        re.compile(
            r"\b(?:accessible|wheelchair|oku|disabled)[- ](?:toilet|restroom|washroom)s?\b"
            r"|tandas (?:oku|orang kurang upaya)|无障碍厕所|残疾人厕所",
            re.IGNORECASE,
        ),
        frozenset({"wheelchair"}),
        None,
    ),
)


# Clause breaks for feature hedges: commas and joining words ("No steps, so ...", "没有台阶，所以").
_FEATURE_CLAUSE = re.compile(
    r"[,，、]|\b(?:so|and|but|therefore|thus|hence|because|then|jadi|maka|dan|tetapi|tapi"
    r"|kerana|sebab)\b|所以|因此|但是|而且|并且|因为|于是",
    re.IGNORECASE,
)


def _hedged(sentence: str, start: int) -> bool:
    """A hedge governs a feature when it stands in the feature's own clause, before it, or
    anywhere after it in the sentence ("There is a lift, but it is not checked yet")."""
    own = _FEATURE_CLAUSE.split(sentence[:start])[-1]
    return bool(_HEDGE.search(own) or _HEDGE.search(sentence[start:]))


def unsupported_features(text: str, evidence: list[tuple[str, object]]) -> list[str]:
    """Features a sentence states positively that no evidence this turn records positively.
    `evidence` holds (attribute, value) pairs. Hedged mentions ("no lift recorded", "ask staff
    whether there is a changing room") state nothing and pass; a negation in another clause
    ("No steps, so the toilet has a baby changing room") does not hedge the feature."""
    bad = []
    for sentence in _SENTENCE.split(text):
        if not sentence:
            continue
        for label, pattern, attrs, test in FEATURES:
            mentions = [m for m in pattern.finditer(sentence) if not _hedged(sentence, m.start())]
            if not mentions:
                continue
            ok = any(
                a in attrs and (test(v) if test else isinstance(v, str | bool) and v in _POSITIVE)
                for a, v in evidence
            )
            if not ok and label not in bad:
                bad.append(label)
    return bad
