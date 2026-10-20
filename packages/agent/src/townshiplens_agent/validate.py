import re

from townshiplens_spatial.attributes import ATTRIBUTE_TYPES

from .answer import FinalAnswer
from .facts import _matches as _fact_matches
from .facts import (
    category_words,
    extract_facts,
    merge,
    tool_values,
    unsupported,
    unsupported_features,
)
from .journeys import PLAYABLE
from .labels import (
    CLOSURE_WORDS,
    DEMO_CONFIRMED,
    REST_GAP_WORDS,
    ROAD_WORDS,
    closure_name,
    closure_until,
    detect_language,
)
from .localize import localize
from .record import TurnRecord
from .route_binding import (
    amenity_selection_errors,
    amenity_text_errors,
    bound_measurement_errors,
    estimate_text_errors,
    has_estimate_qualifier,
    has_estimates,
)
from .steps import maneuver_errors

FORBIDDEN = re.compile(r"(?<![\w-])safe(?:ly)?(?![\w-])|\bselamat\b|安全", re.IGNORECASE)
DEPTH = re.compile(
    r"\d+(?:\.\d+)?\s?(?:cm|m|厘米|米)\s*(?:deep|of water|dalam|深)"
    r"|depth\s+of\s+\d|\d+(?:\.\d+)?\s?(?:cm|m)\s+depth|(?:knee|waist|ankle)-deep"
    # Bahasa Melayu and Chinese (Cycles 5-6 review A7)
    r"|\bkedalaman\b[^.;]{0,20}\d|\bsedalam\s+\d|\bparas (?:lutut|pinggang|buku lali)\b"
    r"|水深|深度[^。；]{0,8}\d|[齐没](?:膝|腰|踝)",
    re.IGNORECASE,
)
# Guesses and reassurance: the engine computes no likelihood for a route, so the answer must not
# imply one ("likely flooded" is a flood class and stays allowed).
REASSURE = re.compile(
    r"\bprobably\b|\bshould be (?:fine|ok(?:ay)?|alright|accessible|passable)\b"
    r"|\b(?:may|might|could) (?:well )?be (?:fine|ok(?:ay)?|alright)\b"
    r"|\byou(?:'ll| will) be (?:fine|ok(?:ay)?)\b|\bno problem\b|\bnothing to worry\b"
    # Bahasa Melayu and Chinese. "mungkin" / "可能" alone stay allowed (they translate "possibly
    # flooded" and honest "may have steps"); a guess that something works does not.
    r"|\bjangan risau\b|\b(?:tak|tidak) perlu (?:risau|bimbang)\b|\btak apa-apa\b"
    r"|\b(?:tiada|tak ada|tidak ada)\s+(?:sebarang\s+)?masalah\b"
    r"(?!\s+(?:yang\s+)?(?:dilaporkan|direkodkan|diketahui))|\bpasti boleh\b"
    r"|\bbarangkali\b|\bsepatutnya\s+(?:boleh|ok(?:ey)?|tiada masalah|baik)\b"
    r"|\bmungkin\s+(?:boleh|dapat|ok(?:ey)?|sesuai|tiada masalah)\b"
    r"|应该(?:可以|能|没问题|没事|行)|可能(?:可以|能够?(?:通过|通行|走)|没问题|没事)"
    r"|大概(?:可以|能|没问题)|估计(?:可以|没问题)|不用担心|别担心|(?<!不)放心|肯定可以"
    r"|(?<!代表)(?<!意味着)(?<!不是)(?:没|没有|不会有|无)问题(?!吗|被?(?:报告|记录|上报))",
    re.IGNORECASE,
)
# Required phrases, accepted in English, Bahasa Melayu and Chinese (Cycle 6), so a resident who
# asks in BM or 中文 gets the whole answer in their language.
DEMO_PHRASES = (
    "demo values, not yet surveyed",
    "nilai demo, belum ditinjau",
    "演示数据，尚未实地调查",
    "演示数据,尚未实地调查",
)
NOT_FORECAST = ("not a forecast", "bukan ramalan", "不是预报", "并非预报", "不是预测")
# A likely-flooded place keeps its strength in a caveat (Cycles 5-6 review A1): "mungkin" /
# "可能" alone mean "possibly".
LIKELY_WORDS = (
    "likely flooded",
    "likely to flood",
    "likely to be flooded",
    "besar kemungkinan",
    "很可能",
)
# The "entrance is not mapped" note, translated: the place, its entrance and a negation (review A4).
ENTRANCE_UNMAPPED = re.compile(
    r"\bentrance (?:is |isn't |is not |has not been |hasn't been )?(?:not |un)?mapped"
    r"|\bpintu masuk\w*[^.;]{0,30}\b(?:belum|tidak|tiada)\s+(?:di)?(?:petakan|peta|tanda|tandakan)"
    r"|\b(?:belum|tidak)\s+dipetakan\b[^.;]{0,30}\bpintu masuk"
    r"|入口[^。；]{0,15}(?:未|没有|尚未)(?:在地图上)?(?:标注|标出|绘制|标明|测绘|显示)"
    r"|(?:未|没有|尚未)(?:在地图上)?(?:标注|标出|绘制|标明)[^。；]{0,10}入口|地图上(?:没有|未)[^。；]{0,10}入口",
    re.IGNORECASE,
)


def has_demo_phrase(text: str) -> bool:
    low = text.lower()
    return any(p in low for p in DEMO_PHRASES)


def has_not_forecast(text: str) -> bool:
    low = text.lower()
    return any(p in low for p in NOT_FORECAST)


# What-if answers (Cycle 1, twm.py). The label is accepted in English, Bahasa Melayu and Chinese.
WHATIF_LABEL = re.compile(r"\bwhat[- ]if\b|\bsimulasi\b|\bandaian\b|假设|模拟", re.IGNORECASE)
# A number that is not a measurement ("400 m", "3 min", "1.2 km", "40%").
_COUNT = r"(\d+)(?![.,]\d)(?!\s*(?:m|km|cm|min|mins|minutes?|h|hours?|%)(?![a-z]))"
# A count of journeys/people/routes: "45 of 50 wheelchair journeys", "3 journeys", "12 people".
COUNTED = re.compile(
    rf"\b{_COUNT}\s+(?:out\s+)?(?:of\s+(?:the\s+)?(\d+)\s+)?(?:[a-z-]+\s+){{0,3}}?"
    r"(?:journeys?|trips?|routes?|people|residents|origins|places|users)\b",
    re.IGNORECASE,
)
# A count bound to the status it is about: "45 of 50 ... would reach", "3 would be confirmed".
STATUS_NUM = re.compile(
    rf"\b{_COUNT}(?:\s+(?:out\s+)?of\s+(?:the\s+)?\d+)?([^.;:()\d]{{0,60}}?)"
    r"\b(confirmed|reach(?:ed|es)?|(?:have|get) a mapped route)",
    re.IGNORECASE,
)
PERCENT = re.compile(r"\b\d+(?:[.,]\d+)?\s*%")
# An imagined outcome stated as fact ("is confirmed", "are now reachable", "can now reach").
WHATIF_AS_FACT = re.compile(
    r"\b(?:is|are|now)\s+(?:now\s+)?(?:confirmed|reachable|step-free)\b"
    r"|\bcan now (?:reach|get to|use)\b",
    re.IGNORECASE,
)
_REAL_NOW = re.compile(r"\b(?:today|currently|at present|at the moment|right now)\b", re.I)
# Fix-it answers (Cycle 4)
FIX_HELPS = re.compile(
    r"\b(?:would|could|might|may|will) (?:help|improve|unlock|add|let|make (?:a|the) "
    r"(?:biggest |real )?difference)\b|\bbiggest difference\b|\b(?:best|top) "
    r"(?:fix|change|option|candidate)\b",
    re.IGNORECASE,
)
STOPPED_WORDS = re.compile(r"inconclusive|time limit|ran out of time|not every", re.IGNORECASE)
COST_WORDS = re.compile(
    r"\bRM\s?\d|\$\s?\d|\bcheap(?:er|est)?\b|\beasiest\b|\b(?:most |very )?feasible\b"
    r"|\bcosting\b|\bcosts? (?:about|around|roughly|only|RM)",
    re.IGNORECASE,
)
# A what-if described as a real plan ("will be built", "the council plans to build").
WHATIF_AS_PLAN = re.compile(
    r"\b(?:will be|is being|is planned to be|are planned to be)\s+"
    r"(?:built|installed|added|fixed|repaired|upgraded)\b"
    r"|\bwe (?:will|are going to) build\b|\bplans? to (?:build|install|add|upgrade)\b"
    r"|\bwill get an? (?:ramp|lift|new path)\b",
    re.IGNORECASE,
)
# Survey plans (Cycle 2, planner.py): conditional on the checks passing, numbers from the plan.
PLAN_CONDITION = re.compile(
    r"\bif\b[^.;]{0,60}\bpass|\bjika\b[^.;]{0,60}\blulus|如果[^。；]{0,40}通过", re.IGNORECASE
)
PLAN_COUNTED = re.compile(
    r"\b(\d+)\s+(?:[a-z-]+\s+){0,2}?(?:checks?|facts?|places?|sites?|locations?)\b", re.I
)
PLAN_AS_FACT = re.compile(
    r"\bwill\s+(?:be\s+)?(?:confirm(?:ed)?|have a confirmed|get a confirmed|become confirmed)\b",
    re.IGNORECASE,
)
PLACEHOLDER_SOURCE = "team_survey_placeholder"
PLACEHOLDER_CAVEAT = "demo values, not yet surveyed"
BANNED_PLACEHOLDER = re.compile(r"\bsurveyed on\b|staff (?:have |has )?checked", re.IGNORECASE)
VERIFIED_WORD = re.compile(r"\bverified\b", re.IGNORECASE)  # not "unverified"/"partly_unverified"
# Honest negations before "verified" (fix round 1 of D-T3): "not (yet) (been)", "n't been",
# "never", and a "none / nothing / no <noun>" subject in the same clause ("None of it has been
# verified", "Nothing here is verified by staff yet", "No bench is verified"). The subject must
# reach the verb without a comma or a joining word, so "Nothing to worry, the ramp was verified"
# and "no step and the path is verified" stay affirmative.
_NO_JOIN = r"(?:(?!\b(?:and|but|so|while|though|although)\b)[^.;:!?,\n])"
NEGATED_VERIFIED = re.compile(
    r"(?:\bnot|\bnever|n['’]t)\s+(?:(?:yet|been|be|ever|all|fully)\s+)*$"
    rf"|\b(?:none|nothing)\b{_NO_JOIN}{{0,40}}?\b(?:is|are|was|were|has|have)\s+"
    r"(?:(?:yet|been|ever)\s+)*$"
    r"|\bno\s+\w+(?:\s+\w+)?\s+(?:is|are|was|were|has|have)\s+(?:(?:yet|been|ever)\s+)*$",
    re.IGNORECASE,
)
# "Verified" in Bahasa Melayu and Chinese (review A2). The app's own demo status line
# "disahkan (pada nilai demo, belum ditinjau)" stays allowed.
VERIFIED_ML = re.compile(
    r"\b(?:telah|sudah)\s+disahkan\b(?!\s*\(pada nilai demo)|\bdisahkan oleh\b"
    r"|\bdisemak oleh (?:kakitangan|pegawai|staf)\b"
    r"|\b(?:telah|sudah)\s+ditinjau\b|\bditinjau pada\b"
    r"|已(?:经)?(?:核实|验证|实地调查)|经(?:过)?(?:核实|验证)|核实过|验证过"
    r"|\bsebahagian\s+(?:telah\s+)?disahkan\b"
    # perfective only: "已由工作人员核实", "工作人员已检查", "工作人员检查过"
    # (never "请工作人员核实" / "需要工作人员确认")
    r"|已(?:经)?由工作人员|工作人员已(?:经)?[^。；]{0,4}(?:检查|核实|确认)"
    r"|工作人员[^。；]{0,4}(?:检查|核实|确认)过|实地调查于",
    re.IGNORECASE,
)
NEGATED_ML = re.compile(
    r"(?:\b(?:belum|tidak|bukan|perlu)\s+|未|没有|尚未|并未|未曾|并非|不是|需要|请)$", re.IGNORECASE
)


_ST = r"(confirmed|partly_unverified|blocked|no_data)"
STATUS_LABEL = re.compile(rf"\broute status\s*[:=]?\s*{_ST}\b")
STATUS_IS = re.compile(
    rf"\broute (?:is|was) {_ST}\b(?!\s+(?:by|at|near|because|due|on|from|where)\b)"
)
# BM / 中文 sentence form after `_to_en`: "laluan ini tersekat" -> "route ini blocked",
# "路线受阻" -> " route blocked".
STATUS_IS_ML = re.compile(rf"\broute (?:ini |itu |adalah |ini adalah )?{_ST}\b(?!\s*\()")
# "route confirmed" / "Route status: confirmed" / "the route is confirmed" NOT followed by the demo
# qualifier (a confirmed route over placeholder evidence must carry it).
BARE_CONFIRMED = re.compile(
    r"\broute\s+(?:status\s*[:=]?\s*|(?:is|was)\s+)?confirmed\b"
    r"(?!\s*\(on demo values, not yet surveyed\))",
    re.IGNORECASE,
)
RAW_ID = re.compile(
    r"\bseg-[\w-]+|(?<![\w-])ev-[\w-]*(?:\d|\.)[\w.-]*|(?<![\w-])rt-[0-9a-f]*\d[0-9a-f]*\b"
    r"|(?<![\w-])vr-\d+\b|\bevidence_ids\b"
    r"|</?(?:parameter|summary|claims|invoke|function_calls|antml:\w+)\b[^>]*>"
    r"|\b(?:" + "|".join(sorted(k for k in ATTRIBUTE_TYPES if "_" in k)) + r")\b"
)
ASKED = re.compile(
    r"\b(?:asked|requested|filed|notified)\b[^.;]{0,40}\b(?:team|staff)\b"
    r"|\bstaff (?:have|has) been (?:asked|notified)\b|\bnoted the gap\b",
    re.IGNORECASE,
)
OTHER_ROUTE = {"alternative", "alternate", "other", "another", "second", "different"}


OPEN_CLAIM = re.compile(
    r"(?:\bis|\bare|'s|\bremains?|\bstill|\bnow|\bcurrently)\s+open\b", re.IGNORECASE
)


TRAFFIC_LIGHTS = re.compile(
    r"traffic[- ]?(?:lights?|signals?)|signali[sz]ed|lampu isyarat|红绿灯|交通灯|信号灯",
    re.IGNORECASE,
)
_NEGATED_LIGHTS = re.compile(
    r"(?:\bno|\bnot|\bwithout|\bnever|\btiada|\btanpa|\btidak ada|没有|无)\W+(?:\w+\W+){0,3}$",
    re.IGNORECASE,
)


def claims_traffic_lights(text: str) -> bool:
    """True when the text says there are traffic lights ("no traffic lights" does not count)."""
    return any(
        not _NEGATED_LIGHTS.search(text[max(0, m.start() - 40) : m.start()])
        for m in TRAFFIC_LIGHTS.finditer(text)
    )


def _norm_note(text: str) -> str:
    return " ".join(text.lower().rstrip(". ").split())


def _names_closure(segments: list[str], row: dict) -> bool:
    """One summary, step or caveat holds the closure's marker words, its display name and its
    "until <date>" text together (a short or shared name alone is not enough)."""
    name, until = closure_name(row).lower(), closure_until(row).lower()
    return any(
        CLOSURE_WORDS.lower() in low and name in low and until in low
        for low in (seg.lower() for seg in segments)
    )


CROSSING_ANY = re.compile(r"crossings?|lintasan|过街|人行横道|斑马线", re.IGNORECASE)


def _note_given(note: str, caveat: str, words: re.Pattern[str]) -> bool:
    """A fixed plan_route note is in a caveat: word for word, as the app's own BM / 中文 line
    (localize), or translated by the model with the same subject words and every number of the
    note (T-019: a translated crossing or road note is not a missing one)."""
    if any(_norm_note(localize(note, lang)) in _norm_note(caveat) for lang in ("en", "ms", "zh")):
        return True
    nums = re.findall(r"\d+", note)
    return bool(words.search(caveat)) and all(re.search(rf"(?<!\d){n}(?!\d)", caveat) for n in nums)


def _inferred_ok(note: str, caveat: str) -> bool:
    """The plan_route note "... nearest mapped path to <place>; its entrance is not mapped" is
    given word for word, or (in any language) as a caveat naming the place and saying its
    entrance is not mapped (a positive "use the entrance by the lake" never counts)."""
    if _norm_note(note) in _norm_note(caveat):
        return True
    m = re.search(r"nearest mapped path to (.+?); its entrance", note)
    low = caveat.lower()
    return bool(m and m.group(1).lower() in low and ENTRANCE_UNMAPPED.search(caveat))


# Bahasa Melayu and Chinese status words mapped to the English ones before the status checks
# (review A5); the longer forms first.
_ML_STATUS = (
    ("disahkan (pada nilai demo, belum ditinjau)", "confirmed (on demo values, not yet surveyed)"),
    ("已确认（基于演示数据，尚未实地调查）", "confirmed (on demo values, not yet surveyed)"),
    ("已确认(基于演示数据,尚未实地调查)", "confirmed (on demo values, not yet surveyed)"),
    ("sebahagian belum disahkan", "partly_unverified"),
    ("部分未核实", "partly_unverified"),
    ("tiada sambungan dipetakan", "no_data"),
    ("无已绘制的连接", "no_data"),
    ("status laluan", "route status"),
    ("路线状态", "route status"),
    ("：", ": "),
    ("tersekat", "blocked"),
    ("受阻", "blocked"),
    ("已确认", " confirmed"),
    ("disahkan", "confirmed"),
    ("laluan", "route"),
    ("路线", " route "),
)


def _to_en(text: str) -> str:
    low = text.lower()
    for a, b in _ML_STATUS:
        low = low.replace(a, b)
    return low


def _norm_status_text(text: str) -> str:
    text = _to_en(text).replace("partly unverified", "partly_unverified")
    text = text.replace("no mapped connection", "no_data")
    return text.replace("no data", "no_data")


def _named_statuses(summary: str, steps: list[str]) -> set[str]:
    """Statuses the answer names for *the* route: "Route status: X" anywhere in the summary or
    steps, and "the route is X" in the summary's first sentence. Segment/element-level mentions,
    ids and other routes are ignored."""
    text = _norm_status_text(" ".join([summary, *steps]))
    out = {m.group(1) for m in STATUS_LABEL.finditer(text)}
    first = re.split(r"(?<=[.!?])\s|(?<=[。！？])|\n", _norm_status_text(summary), maxsplit=1)[0]
    ml = list(STATUS_IS_ML.finditer(first)) if detect_language(summary) != "en" else []
    for m in [*STATUS_IS.finditer(first), *ml]:
        prev = first[: m.start()].split()[-1:] or [""]
        if prev[0] not in OTHER_ROUTE:
            out.add(m.group(1))
    return out


def _claims_verified(text: str) -> bool:
    """True when the text uses "verified" affirmatively, in English, Bahasa Melayu or Chinese
    ("not (yet) verified", "belum disahkan", "未经核实" are allowed)."""
    if any(not NEGATED_VERIFIED.search(text[: m.start()]) for m in VERIFIED_WORD.finditer(text)):
        return True
    return any(not NEGATED_ML.search(text[: m.start()]) for m in VERIFIED_ML.finditer(text))


def _strip_names(text: str, names: set[str]) -> str:
    """Remove place names returned by tools ("Taman Selamat", "Safe Haven Hall")."""
    for n in sorted((n for n in names if n), key=len, reverse=True):
        text = re.sub(re.escape(n), " ", text, flags=re.IGNORECASE)
    return text


def _names_to_categories(text: str, names: set[str]) -> str:
    """Replace each tool-returned place name by its category words (facts.category_words)."""
    for n in sorted((n for n in names if n), key=len, reverse=True):
        text = re.sub(re.escape(n), category_words(n), text, flags=re.IGNORECASE)
    return text


def payload_numbers(payload) -> set[float]:
    """Every number a tool result shows, whatever it measures (facts.tool_values)."""
    return set().union(*tool_values(payload).values())


_STAGE_ID = re.compile(r"^stage_p(\d+(?:\.\d+)?)m$")


def _recorded_values(rec: TurnRecord) -> dict[str, set[float]]:
    """Typed values the model was shown this turn (call_tool), plus the routes, evidence and
    results recorded from the same tool calls (so hand-built records in tests count too), the
    river stages of the scenarios used, and the stages the resident asked about."""
    stages = {
        float(m.group(1))
        for sid in [*rec.scenarios_used, *rec.day_stages]
        if isinstance(sid, str) and (m := _STAGE_ID.match(sid))
    }
    return merge(
        {"stage": stages | rec.asked_stages},
        rec.tool_measures,
        tool_values(
            {
                "routes": list(rec.routes.values()),
                "evidence": [e.model_dump(mode="json") for e in rec.evidence.values()],
                "what_ifs": rec.what_ifs,
                "plans": rec.plans,
                "closures": list(rec.closures.values()),
                "my_trips": rec.my_trips,
            }
        ),
    )


def measurement_errors(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    """Audit A2 / F2 (T-001): every fact the answer states must match a tool field of the same
    kind (facts.py): a distance a distance, a width a width, a step count a step count. This
    applies to refusals too: cannot_answer licenses no assertion. A claim's steps, width or slope
    must match the evidence it cites, and a feature ("a baby changing room", "a lift") needs
    evidence that records it."""
    parts = [ans.summary, *(_STEP_NUMBER.sub("", s) for s in ans.steps), *ans.caveats]
    parts += [c.text for c in ans.claims]
    # Names go (they may hold numbers), but what they are stays: "Urban Park toilet is 440.6 m
    # from Elmina Lakeside Mall" is checked as "toilet is 440.6 m from mall".
    text = _names_to_categories(" ".join(parts), rec.place_names)
    errs: list[str] = bound_measurement_errors(ans, rec)
    # Rehearsal clock durations ("over 2 hours", "313 min") are checked by day_errors and
    # my_trip_errors, not here.
    skip = {"time"} if rec.days or rec.day_changes or rec.my_trips else set()
    if bad := unsupported(text, _recorded_values(rec), skip=skip):
        errs.append(
            f"Facts {sorted(set(bad))} do not match this turn's tool results: state distances, "
            "times, widths, slopes, step counts and other counts only as a tool returned them "
            "(round only with 'about'; never 'exactly' a rounded number)."
        )
    for c in ans.claims:
        cited = [
            rec.evidence[i].model_dump(mode="json") for i in c.evidence_ids if i in rec.evidence
        ]
        own = tool_values({"evidence": cited})
        wrong = [
            f.raw
            for f in extract_facts(_strip_names(c.text, rec.place_names))
            if f.kind in ("steps", "width", "slope")
            and not f.limit  # "(limit 8.3%)" is the profile's limit, not a recorded value
            and not any(_fact_matches(f, x) for x in own.get(f.kind, ()))
        ]
        if wrong:
            errs.append(
                f"Claim {c.text!r} states {sorted(set(wrong))}, which its cited evidence does not "
                "record: cite the evidence of that attribute, or remove the number."
            )
    pairs = [(e.attribute, e.value) for e in rec.evidence.values()]
    if feats := unsupported_features(text, pairs):
        errs.append(
            f"The answer states {feats}, which no tool recorded this turn: describe only "
            "recorded facts, or say the feature is not recorded."
        )
    return errs


# Audit F3/A4: promises the data cannot back ("I guarantee", "no risk", "zero risk", "totally
# accessible"), in English, Bahasa Melayu and Chinese. A promise is honest only when a negation
# in the same clause governs it directly ("not a guarantee", "无法保证"); "No steps, so I
# guarantee" is still a promise, because the clause ends before it.
OVERCLAIM = re.compile(
    r"\bguarantee[ds]?\b|\b(?:no|zero|nil|0)\s+(?:risks?|danger)\b|\brisk[- ]free\b"
    r"|\b(?:without|free of) (?:any )?(?:risks?|danger)\b|\brisks? (?:is|are) (?:zero|nil|none)\b"
    r"|\bnothing to worry about\b|\bno need to worry\b|\bperfectly fine\b"
    r"|\b(?:totally|fully|completely|perfectly|absolutely|entirely|100 ?%) (?:fine|ok(?:ay)?"
    r"|accessible|wheelchair[- ]accessible|step[- ]free|barrier[- ]free|passable)\b"
    r"|\b(?:dijamin|menjamin|jaminan|jamin)\b|\b(?:tiada|tanpa|tidak ada|tak ada|sifar)\s+"
    r"(?:sebarang\s+|langsung\s+)?(?:risiko|bahaya)\b|\brisiko\s+sifar\b|\btidak berisiko\b"
    r"|\b(?:sepenuhnya|100 ?%)\s+(?:mesra oku|boleh diakses)\b"
    r"|保证|担保|没有(?:任何)?(?:危险|风险)|无(?:危险|风险)|毫无风险|零(?:危险|风险)"
    r"|不会有(?:任何)?(?:危险|风险)|完全(?:无障碍|没问题|可以通行)|绝对(?:可以|没问题)",
    re.IGNORECASE,
)
# A clause ends at punctuation or a joining word; a negation before that point negates
# something else ("No steps, so ...", "没有台阶，所以 ...").
_CLAUSE_BREAK = re.compile(
    r"[.;:!?,。；：！？，、\n—–]|\b(?:so|and|but|therefore|thus|because|which|then|jadi|maka|dan"
    r"|tetapi|tapi|kerana|sebab)\b|所以|因此|但是|但|而且|并且|因为|于是",
    re.IGNORECASE,
)
# The negation must govern the promise: only filler words may stand between them.
_GOVERNS = re.compile(
    r"(?:\b(?:not|cannot|can not|never|no|tidak|tak|bukan|belum)\b|\b\w+n[’']t\b)"
    r"(?:\s+(?:a|an|any|the|be|been|is|are|was|can|could|do|does|did|to|really|fully|always"
    r"|truly|yet|able|offer|give|make|provide|real|absolute|100 ?%|dapat|boleh|akan|mampu"
    r"|untuk|ada|sebarang|satu|suatu|lagi|pernah|memberi|sebuah))*\s*$"
    r"|(?:无法|不能|不会|并非|不是|没法|不)(?:能|可以|敢|一定|作|做|出|提供|给|任何|向你|对此)*\s*$",
    re.IGNORECASE,
)


def _negated(before: str) -> bool:
    clause = _CLAUSE_BREAK.split(before)[-1]
    return bool(_GOVERNS.search(clause))


def overclaim_errors(text: str, rec: TurnRecord) -> list[str]:
    plain = _strip_names(text, rec.place_names)
    for m in OVERCLAIM.finditer(plain):
        if not _negated(plain[: m.start()]):
            return [
                f"Never guarantee or rule out risk ({m.group(0)!r}): the township data can only "
                "say what is recorded and what is not checked yet."
            ]
    return []


def _status_of(ans: FinalAnswer, rec: TurnRecord) -> str | None:
    status = rec.route_status.get(ans.route_id) if ans.route_id else None
    if status is None and len(rec.route_status) == 1:
        status = next(iter(rec.route_status.values()))  # unambiguous even without route_id
    return status


# T-020: a likely_ok route rests on map-data estimates. Access claims about it must be hedged in
# their own clause; the answer must say it is estimated.
ACCESS_CLAIM = re.compile(
    r"\b(?:step[- ]free|(?:wheelchair|stroller|pram)[- ](?:friendly|accessible)|accessible"
    r"|barrier[- ]free|no (?:steps|stairs))\b"
    r"|bebas (?:tangga|halangan)|tanpa anak tangga|mesra (?:oku|kerusi roda)|boleh diakses"
    r"|无障碍|无台阶|没有台阶|适合轮椅|方便轮椅|轮椅可以通行",
    re.IGNORECASE,
)
ESTIMATE_HEDGE = re.compile(
    r"\b(?:likely|estimat\w*|may|might|not (?:yet )?(?:checked|verified|confirmed)|unverified"
    r"|unchecked|recorded|on the map|map data|tagged)\b"
    r"|\b(?:mungkin|kemungkinan|anggaran|dianggarkan|belum|direkodkan|data peta)\b"
    r"|可能|估计|估算|未核实|尚未|记录|地图数据"
    # the demo qualifier hedges a demo-value fact ("step-free path (demo values, not yet
    # surveyed)", journey steps), as the existing demo rules already require
    r"|demo values|not yet surveyed|nilai demo|belum ditinjau|演示数据|尚未实地调查",
    re.IGNORECASE,
)
DEMO_HEDGE = re.compile(
    r"demo values|not yet surveyed|nilai demo|belum ditinjau|演示数据|尚未实地调查", re.I
)
ESTIMATE_WORDS = re.compile(r"\bestimat|\banggar|估计|估算|推估", re.IGNORECASE)
_CLAUSE = re.compile(r"[.;:!?。；：！？\n,，]")


def _selected_route(ans: FinalAnswer, rec: TurnRecord) -> dict:
    return rec.routes.get(ans.route_id or "") or (
        next(iter(rec.routes.values())) if len(rec.routes) == 1 else {}
    )


def estimate_claim_errors(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    """For a likely_ok route, or a route whose maneuvers include estimated or unchecked
    stretches (T-021): no unhedged access claim ("step-free", "无障碍") in any clause."""
    levels = {m.get("access_level") for m in _selected_route(ans, rec).get("maneuvers") or []}
    if _status_of(ans, rec) != "likely_ok" and not levels & {"likely_ok", "unknown"}:
        return []
    text = _strip_names(" ".join([ans.summary, *ans.steps, *ans.caveats]), rec.place_names)
    # a comma inside brackets does not end the clause ("(demo values, not yet surveyed)")
    text = re.sub(
        r"[(（][^)）]*[)）]", lambda m: m.group(0).replace(",", " ").replace("，", " "), text
    )
    bad = [
        m.group(0)
        for sentence in re.split(r"[.;!?。；！？\n]+", text)
        if not DEMO_HEDGE.search(sentence)  # the demo qualifier covers its whole sentence
        for clause in _CLAUSE.split(sentence)
        for m in ACCESS_CLAIM.finditer(clause)
        if not ESTIMATE_HEDGE.search(clause)
    ]
    if not bad:
        return []
    return [
        f"The route is only likely OK (estimated from map data, not checked): {sorted(set(bad))} "
        "stated as fact. Say 'likely step-free (estimated from map data, not checked)' instead."
    ]


def estimate_wording_errors(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    """A final answer about a likely_ok route says that it is an estimate."""
    if ans.answer_status == "cannot_answer" or _status_of(ans, rec) != "likely_ok":
        return []
    if ESTIMATE_WORDS.search(" ".join([ans.summary, *ans.steps, *ans.caveats])):
        return []
    return [
        "The route is likely OK only by estimate: say it is 'estimated from map data, not "
        "checked' ('anggaran daripada data peta' / '根据地图数据估计')."
    ]


def status_wording_errors(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    """How the text names route status and crossings. Shared with `draft_errors`."""
    errs: list[str] = estimate_claim_errors(ans, rec)
    errs += maneuver_errors(  # model-written text only: the app renders the steps (run.py)
        _strip_names(
            " ".join([ans.summary, *ans.caveats, *(c.text for c in ans.claims)]), rec.place_names
        ),
        _selected_route(ans, rec),
        {
            str(c.get("element_name") or "")
            for c in [*rec.route_closures, *rec.closures.values()]
            if c.get("element_name")
        },
    )
    status = _status_of(ans, rec)
    if status:
        named = _named_statuses(ans.summary, ans.steps) - {status}
        if named:
            errs.append(
                f"Route status contradiction: the route is {status} but the summary/steps name "
                f"{sorted(named)}. Use the status the tool returned."
            )
    segments = [ans.summary, *ans.steps, *ans.caveats]
    if claims_traffic_lights(_strip_names(" ".join(segments), rec.place_names)) and not any(
        c.get("crossing") == "traffic_signals"
        for r in rec.routes.values()
        for c in r.get("crossings") or []
    ):
        errs.append(
            "No crossing with traffic lights is recorded on a route this turn: do not mention "
            "traffic lights. Use the plan_route crossing_note if there is one."
        )
    rid = ans.route_id or (next(iter(rec.routes)) if len(rec.routes) == 1 else None)
    route = rec.routes.get(rid or "") or {}
    if (
        ans.answer_status != "cannot_answer"
        and status == "confirmed"
        and route.get("demo_evidence")
        and BARE_CONFIRMED.search(_to_en(" ".join(segments)))
    ):
        errs.append(
            "The route is confirmed only on placeholder (demo) values: say "
            f"'Route status: {DEMO_CONFIRMED}' in the summary instead of a bare 'confirmed'."
        )
    return errs


def draft_errors(text: str, rec: TurnRecord) -> list[str]:
    """The final answer's content checks, applied to draft text (`draft.DraftStreamer`), so a
    draft never shows what the final check would reject (audit A3). Checks that need the whole
    answer (citations, a required caveat or route_id) are left to `validate_answer`; a check
    that wants text the draft does not have yet only holds the draft back, which is safe."""
    ans = FinalAnswer(answer_status="partial", summary=text)
    return [
        *text_errors(text, rec),
        *overclaim_errors(text, rec),
        *status_wording_errors(ans, rec),
        *measurement_errors(ans, rec),
        *foreign_number_errors(ans, rec),
        *whatif_errors(ans, rec),
        *plan_errors(ans, rec),
        *rollout_errors(ans, rec),
        *day_errors(ans, rec),
        *day_change_errors(ans, rec),
        *affected_errors(ans, rec),
        *flood_impact_errors(ans, rec),
        *event_errors(ans, rec),
        *journey_errors(ans, rec),
    ]


# A topic refusal ("out of scope", "outside what I can check"): never on the management panel.
TOPIC_REFUSAL = re.compile(
    r"out(?:side)? of (?:my |the )?scope|outside (?:what I can|my|the) (?:check|scope|remit)"
    r"|di luar (?:skop|perkara yang boleh)|超出.{0,8}范围",
    re.IGNORECASE,
)


def validate_answer(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    errs: list[str] = amenity_selection_errors(ans, rec)
    if rec.panel == "management" and TOPIC_REFUSAL.search(" ".join([ans.summary, *ans.caveats])):
        errs.append(
            "The management panel refuses no topic: answer with the tools, or say "
            '"I can\'t answer that from our data."'
        )
    if rec.selection_error and ans.answer_status != "cannot_answer":
        errs.append(
            "Route selection is unresolved: ask which exact places or travel mode "
            "before showing a route."
        )
    if len(rec.routes) > 1 and not ans.route_id and ans.answer_status != "cannot_answer":
        errs.append("Select the exact route_id being answered before showing a route.")
    selected = ans.route_id or (next(iter(rec.routes)) if len(rec.routes) == 1 else None)
    selected_route = rec.routes.get(selected, {})
    if "scenario_id" in selected_route and (
        (selected_route["scenario_id"] or "baseline") != (ans.scenario_id or "baseline")
    ):
        errs.append("The answer scenario must match the selected route's river scenario.")
    allowed_scenarios = rec.scenarios_used | {
        e.element_id for e in rec.evidence.values() if e.attribute == "scenario"
    }
    if ans.scenario_id and rec.scenarios_used and ans.scenario_id not in allowed_scenarios:
        errs.append("The answer scenario was not checked by tools in this turn.")
    for intent in ans.scene_intents:
        if intent.kind == "flood.set_level" and (
            intent.scenario_id != ans.scenario_id or intent.scenario_id not in allowed_scenarios
        ):
            errs.append("The map flood scenario must match the answer and checked tool scenario.")
    if (
        has_estimates(rec)
        and ans.answer_status != "cannot_answer"
        and not has_estimate_qualifier(" ".join([ans.summary, *ans.steps, *ans.caveats]))
    ):
        errs.append(
            "State that Likely OK sections are estimated from map data, not checked on site."
        )
    if any(i.kind == "route.highlight" and i.route_id != selected for i in ans.scene_intents):
        errs.append("The map route must match the selected answer route_id.")
    for c in ans.claims:
        if ans.answer_status != "cannot_answer" and not c.evidence_ids:
            errs.append(
                f"Claim {c.text!r} cites no evidence: every claim needs at least one "
                "evidence id returned by tools in this turn. Put gaps in caveats, not claims, "
                "or answer cannot_answer."
            )
        bad = [i for i in c.evidence_ids if i not in rec.evidence]
        if bad:
            errs.append(
                f"Unknown evidence ids {bad}. Cite only ids returned by tools in this turn."
            )
    if ans.answer_status != "cannot_answer" and not rec.tool_calls:
        errs.append(
            "No tool was called this turn: answer only from tool results, or answer cannot_answer."
        )
    if ans.route_id and ans.route_id not in rec.routes:
        errs.append(f"route_id {ans.route_id} was not returned by plan_route in this turn.")
    status = rec.route_status.get(ans.route_id) if ans.route_id else None
    if status in ("blocked", "no_data") and ans.answer_status == "answered":
        errs.append(
            f"The route is {status}: answer_status cannot be 'answered'; "
            "use 'partial' or 'cannot_answer'."
        )
    if status is None and len(rec.route_status) == 1:
        status = next(iter(rec.route_status.values()))  # unambiguous even without route_id
    errs += status_wording_errors(ans, rec)
    errs += estimate_wording_errors(ans, rec)
    partly = status == "partly_unverified" or (
        ans.answer_status == "answered" and "partly_unverified" in rec.route_status.values()
    )
    if partly and not ans.caveats:
        errs.append(
            "The route is partly_unverified: add a caveat naming the unverified segment(s) first."
        )
    rid = ans.route_id or (next(iter(rec.routes)) if len(rec.routes) == 1 else None)
    route = rec.routes.get(rid or "") or {}
    if (
        ans.answer_status != "cannot_answer"
        and route.get("rest_limit_met") is False
        and not any(REST_GAP_WORDS in c.lower() for c in ans.caveats)
    ):
        errs.append(
            "The route runs further than the rest limit between rest points: add the plan_route "
            "warning as a caveat, e.g. 'Longest stretch without a rest point is about N m "
            "(limit 100 m).'"
        )
    segments = [ans.summary, *ans.steps, *ans.caveats]
    named_rows = [*rec.route_closures, *rec.asked_closures]
    missing = [closure_name(c) for c in named_rows if not _names_closure(segments, c)]
    if missing:
        errs.append(
            "A staff-reported closure must be named in one caveat line, in the form "
            "'Closed (staff report): <name> until <date> \u2014 <reason>' "
            f"(missing: {sorted(set(missing))}). If it blocks the route, say so."
        )
    cnote = route.get("crossing_note")
    if (
        ans.answer_status != "cannot_answer"
        and cnote
        and not any(_note_given(cnote, c, CROSSING_ANY) for c in ans.caveats)
    ):
        errs.append(f"plan_route says: {cnote!r} Add that as a caveat (word for word).")
    rnote = route.get("road_note")
    if (
        ans.answer_status != "cannot_answer"
        and rnote
        and not any(_note_given(rnote, c, ROAD_WORDS) for c in ans.caveats)
    ):
        errs.append(
            f"plan_route warned: {rnote!r} Add that as a caveat (word for word); never call "
            "that stretch a footpath or sidewalk."
        )
    if ans.answer_status != "cannot_answer":
        for note in rec.inferred_notes:
            if not any(_inferred_ok(note, c) for c in ans.caveats):
                errs.append(f"plan_route warned: {note!r} Add that as a caveat (word for word).")
    if ans.answer_status != "cannot_answer":
        for pid, info in rec.flooded_endpoints.items():
            names = {pid.lower(), str(info.get("name", pid)).lower()}
            likely = info.get("flood_class") == "likely_flooded"
            naming = [c.lower() for c in ans.caveats if any(n in c.lower() for n in names)]
            if likely and naming and not any(w in c for c in naming for w in LIKELY_WORDS):
                errs.append(
                    f"{info.get('name', pid)} ({pid}) is likely flooded in this indicative "
                    "scenario: keep the strength of the flood class ('likely flooded' / "
                    "'besar kemungkinan dinaiki air' / '很可能被淹'), never 'possibly'."
                )
            elif not naming:
                phrase = "likely flooded" if likely else "possibly flooded"
                errs.append(
                    f"{info.get('name', pid)} ({pid}) is {phrase} in this indicative "
                    "scenario: add a caveat naming it."
                )
    cited = {i for c in ans.claims for i in c.evidence_ids}
    all_text = " ".join([ans.summary, *ans.steps, *ans.caveats, *(c.text for c in ans.claims)])
    placeholder_ids = {
        i for i, e in rec.evidence.items() if getattr(e, "source_type", None) == PLACEHOLDER_SOURCE
    }
    if placeholder_ids:
        # Any placeholder evidence returned this turn (cited or not) forbids "verified" wording.
        # (the wording rule itself is in text_errors, shared with the draft guard)
        # The caveat is required when the answer's route/attribute claims rest on it: a route
        # was planned this turn, or a placeholder id is cited.
        rests_on = (ans.answer_status != "cannot_answer" and bool(rec.routes)) or bool(
            cited & placeholder_ids
        )
        if rests_on and not has_demo_phrase(all_text):
            errs.append(
                "Some evidence returned this turn is placeholder data (source_type "
                f"team_survey_placeholder): add a caveat containing the exact phrase "
                f"'{PLACEHOLDER_CAVEAT}'."
            )
    # a rehearsal's river stage comes from the tool (run.py fills it in), not from the model
    if rec.scenarios_used - rec.day_stages and not ans.scenario_id:
        errs.append("A flood scenario tool was used: set scenario_id.")
    errs += whatif_errors(ans, rec)
    errs += plan_errors(ans, rec)
    errs += rollout_errors(ans, rec)
    errs += foreign_number_errors(ans, rec)
    errs += day_errors(ans, rec)
    errs += day_change_errors(ans, rec)
    errs += my_trip_errors(ans, rec)
    errs += affected_errors(ans, rec)
    errs += flood_impact_errors(ans, rec)
    errs += event_errors(ans, rec)
    errs += measurement_errors(ans, rec)
    errs += journey_errors(ans, rec)
    # Honesty rules apply to every answer, whether or not a tool ran.
    errs += text_errors(all_text, rec)
    errs += overclaim_errors(all_text, rec)
    return errs


def _has_placeholder(rec: TurnRecord) -> bool:
    return any(getattr(e, "source_type", None) == PLACEHOLDER_SOURCE for e in rec.evidence.values())


def text_errors(text: str, rec: TurnRecord) -> list[str]:
    """Wording rules that depend only on the text and this turn's record. Shared by
    `validate_answer` and the draft guard (`draft.DraftStreamer`), so a draft is never allowed
    to show what the final check would reject."""
    errs: list[str] = [*estimate_text_errors(text, rec), *amenity_text_errors(text, rec)]
    if _has_placeholder(rec) and (BANNED_PLACEHOLDER.search(text) or _claims_verified(text)):
        # Any placeholder evidence returned this turn (cited or not) forbids "verified" wording.
        errs.append(
            "Placeholder evidence is not verified: remove the word 'verified' "
            "(only 'unverified' or 'not yet verified' are allowed) and 'surveyed on' / "
            f"'staff checked'; say the values are '{PLACEHOLDER_CAVEAT}'."
        )
    if rec.asked_closures and OPEN_CLAIM.search(text):
        errs.append(
            "A staff-reported closure is on record for this place: never say it is open. "
            "Name the closure instead."
        )
    if not rec.vrs and ASKED.search(text):
        errs.append(
            "No verification request was filed this turn: do not say staff or the team were "
            "asked (or that the gap was noted). Say nothing about a request."
        )
    if RAW_ID.search(text):
        errs.append(
            "Write for residents: use the readable names from the tool result "
            "(element_label, e.g. 'Incline (%)'), never segment, evidence, route or ticket ids, "
            "snake_case attribute keys or tool-call markup."
        )
    plain = _strip_names(text, rec.place_names)
    if FORBIDDEN.search(plain):
        errs.append("Never describe a place or route as safe/selamat/安全.")
    if DEPTH.search(text):
        errs.append("Do not state water depths on paths; scenarios are indicative.")
    if REASSURE.search(plain):
        errs.append(
            "Do not guess or reassure ('probably', 'should be fine'): the tools give no "
            "likelihood. State the route status and what is not checked yet."
        )
    return errs


def _whatif_numbers(rec: TurnRecord) -> set[int]:
    """Every number a what-if answer may say: the summary and per-profile counts, the change
    of each measure, and how many journeys fall short of the total."""
    out: set[int] = set()
    for w in rec.what_ifs:
        sm = {k: int(v) for k, v in (w.get("summary") or {}).items()}
        out |= set(sm.values())
        for side in ("counts_before", "counts_after"):
            for per in (w.get(side) or {}).values():
                out |= {int(v) for v in per.values()}
        if (w.get("fixit") or {}).get("empty"):
            continue  # nothing changed: only the plain counts may be said
        total = sm.get("total", 0)
        for m in ("reach", "confirmed"):
            vals = [sm[k] for k in (f"{m}_before", f"{m}_after", f"{m}_stage_only") if k in sm]
            out |= {abs(a - b) for a in vals for b in vals} | {total - v for v in vals}
    return out


def _metric_numbers(rec: TurnRecord, metric: str) -> set[int]:
    """Numbers allowed next to one status word: that measure before / after / stage-only, its
    changes, and how many journeys fall short of the total."""
    out: set[int] = set()
    for w in rec.what_ifs:
        sm = {k: int(v) for k, v in (w.get("summary") or {}).items()}
        vals = [v for k, v in sm.items() if k.startswith(f"{metric}_")]
        if (w.get("fixit") or {}).get("empty"):
            out |= set(vals) | {sm.get("total", 0)}
            continue
        total = sm.get("total", 0)
        out |= set(vals) | {abs(a - b) for a in vals for b in vals} | {total - v for v in vals}
    return out


def _as_fact(text: str) -> bool:
    for m in WHATIF_AS_FACT.finditer(text):
        sentence = re.split(r"[.!?;]\s", text[: m.start()])[-1]
        if not _REAL_NOW.search(sentence):  # "Today the route is confirmed" is a real fact
            return True
    return False


def whatif_errors(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    if ans.answer_status == "cannot_answer":
        return []
    text = " ".join([ans.summary, *ans.steps, *ans.caveats, *(c.text for c in ans.claims)])
    errs: list[str] = []
    simulated = bool(rec.what_ifs or rec.plans)
    if (simulated or rec.history_simulated) and WHATIF_AS_PLAN.search(text):
        errs.append(
            "A what-if is not a real plan or a real change: never say something will be built, "
            "installed or added, or that anyone plans to."
        )
    if not rec.what_ifs:
        if (
            rec.history_simulated
            and not simulated
            and (STATUS_NUM.search(text) and (WHATIF_LABEL.search(text) or "would" in text.lower()))
        ):
            errs.append(
                "Earlier what-if numbers cannot be repeated from memory: call simulate_what_if "
                "again this turn, or answer without them."
            )
        return errs
    if not WHATIF_LABEL.search(ans.summary):
        errs.append(
            "A what-if simulation was run: say plainly in the summary that it is a what-if "
            "(imagined, not real), e.g. 'In this what-if simulation, ...'."
        )
    allowed = _whatif_numbers(rec)
    bad = sorted({int(n) for m in COUNTED.finditer(text) for n in m.groups() if n} - allowed)
    for m in STATUS_NUM.finditer(text):
        metric = "confirmed" if m.group(3).lower() == "confirmed" else "reach"
        if int(m.group(1)) not in _metric_numbers(rec, metric):
            bad.append(int(m.group(1)))
    if bad:
        errs.append(
            f"Numbers {sorted(set(bad))} do not appear in the what-if result for what they "
            "describe: 'reach' numbers come from reach_*, 'confirmed' numbers from confirmed_* "
            "(or their changes)."
        )
    if PERCENT.search(text):
        errs.append("Give what-if results as counts from the simulation, not percentages.")
    if any(w.get("imagined") for w in rec.what_ifs) and _as_fact(text):
        errs.append(
            "Imagined outcomes are conditional: say 'would be confirmed' / 'would reach', "
            "never 'is confirmed' or 'can now reach'."
        )
    fixes = [w["fixit"] for w in rec.what_ifs if w.get("fixit")]
    only_fixit = all(w.get("fixit") for w in rec.what_ifs)
    if any(f.get("empty") for f in fixes) and only_fixit and FIX_HELPS.search(text):
        errs.append(
            "The fix-it search found no candidate change that helps: say so plainly, never "
            "that a change would or could help."
        )
    if any(f.get("stopped") for f in fixes) and not STOPPED_WORDS.search(text):
        errs.append(
            "The fix-it search stopped at its time limit: say the result is inconclusive "
            "(not every set was tried)."
        )
    if fixes and COST_WORDS.search(text):
        errs.append(
            "No costs or feasibility are modelled: never give a price or call a change cheap, "
            "easy or feasible."
        )
    staged = any(w.get("scenario_id") or w.get("base_scenario_id") for w in rec.what_ifs)
    if staged and not has_not_forecast(text):
        errs.append(
            "A what-if with a river stage must say it is an indicative scenario, not a forecast "
            "(include the words 'not a forecast')."
        )
    demo = any((w.get("summary") or {}).get("confirmed_on_demo_after") for w in rec.what_ifs)
    if demo and not has_demo_phrase(text):
        errs.append(
            "Imagined confirmed routes rest on demo values: add a caveat containing the exact "
            f"phrase '{PLACEHOLDER_CAVEAT}'."
        )
    return errs


# A count in a Bahasa Melayu or Chinese answer: next to a count noun ("45 daripada 50
# perjalanan", "3 tempat") or a Chinese measure word ("46次", "4条", "15项"). Dates, street
# numbers ("Jalan 2/3", "Seksyen U16"), steps, distances and times are not counts.
_N = r"(?<![\d.,/A-Za-z_])(\d{1,3}(?:,\d{3})+|\d+)(?![.,/]?\d)"  # CJK may touch the digits
FOREIGN_COUNT = re.compile(
    rf"{_N}\s+daripada\s+{_N}"
    rf"|{_N}\s+(?:[a-z-]+\s+){{0,2}}?(?:perjalanan|laluan|orang|penduduk|pengguna|tempat|lokasi"
    r"|pemeriksaan|semakan|fakta|tapak|pusat|perubahan)\b"
    rf"|{_N}\s*(?:次|条|个|位|名|项|处|人)",
    re.IGNORECASE,
)
_STEP_NUMBER = re.compile(r"^\s*\d+[.)]\s")
# Any count in a rehearsal answer ("2,503" is one number); measurements and stages are not.
_DAY_COUNT = re.compile(
    r"(?<![\d.,/A-Za-z_+])(\d{1,3}(?:,\d{3})+|\d+)(?![.,/]?\d)"
    r"(?!\s*(?:m|km|cm|min|minit|mins|minutes?|h|jam|%|metres?|meters?|米|公里|分钟)(?![a-z]))",
    re.IGNORECASE,
)


def _ints(x) -> set[int]:
    """Every integer leaf in a tool payload (counts, totals)."""
    if isinstance(x, bool):
        return set()
    if isinstance(x, int):
        return {x}
    if isinstance(x, dict):
        return set().union(*(_ints(v) for v in x.values())) if x else set()
    if isinstance(x, list):
        return set().union(*(_ints(v) for v in x)) if x else set()
    return set()


def foreign_number_errors(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    """Simulation answers in Bahasa Melayu or Chinese (review A6): the English count patterns do
    not read them, so every count in the answer must be a number the simulation produced."""
    if ans.answer_status == "cannot_answer" or not (
        rec.what_ifs or rec.plans or rec.rollouts or rec.tippings
    ):
        return []
    parts = [ans.summary, *(_STEP_NUMBER.sub("", s) for s in ans.steps), *ans.caveats]
    text = _strip_names(" ".join(parts), rec.place_names)
    if detect_language(text) == "en" and ans.language in ("", "en"):
        return []
    allowed = _whatif_numbers(rec) | _plan_numbers(rec)
    for r in rec.rollouts:
        allowed |= _ints(r.get("counts"))
    for t in rec.tippings:
        allowed |= _ints(t.get("stages"))
    spoken = {
        int(n.replace(",", "")) for m in FOREIGN_COUNT.finditer(text) for n in m.groups() if n
    }
    if bad := sorted(spoken - allowed):
        return [
            f"Numbers {bad} do not appear in the simulation result: in every language, quote "
            "only the counts the tool returned."
        ]
    return []


# Elmina Day rehearsals (Cycle 14): synthetic residents' simulated day.
DAY_WORD = re.compile(r"\brehears|\bsimulat|\bsimulasi\b|\blatihan\b|模拟|演练", re.IGNORECASE)
SYNTHETIC = re.compile(r"\bsynthetic\b|\bsintetik\b|虚拟|合成", re.IGNORECASE)
_HHMM = re.compile(r"\b\d{1,2}:\d{2}\b")
# Not counts: clock times (12- and 24-hour), ages ("under 13", "65+" with no count noun after
# them, two digits at most), durations in hours and dates. Review C16: "over 3000 residents" and
# "25 percent" are still read as numbers.
_COUNT_NOUN = (
    r"(?!\s*(?:residents?|trips?|people|persons?|pupils?|children|households?"
    r"|orang|penduduk|perjalanan|murid))"
)
_DAY_NOT_COUNT = re.compile(
    r"\b\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)(?![a-z])"
    rf"|\b(?:under|over|aged|above|below|bawah|atas|berumur)\s+\d{{1,2}}\b{_COUNT_NOUN}"
    rf"|\b\d{{1,2}}\s?\+{_COUNT_NOUN}|\b\d{{1,2}}\s?岁"
    r"|\b\d+(?:\.\d+)?\s?(?:hours?|hrs?)\b"
    r"|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b",
    re.IGNORECASE,
)
# A rehearsal says what happened in it; "0 stranded" is one of its outcomes, not a prediction.
DAY_FORECAST = re.compile(
    r"\b(?:will|may|might|could|would|won't|will not|would not)\s+(?:not\s+)?(?:be\s+|get\s+)?"
    r"(?:stranded|trapped|cut off|flooded|lose|stuck|affected|miss|struggle|unable)\b"
    r"|\b(?:won't|will not)\s+(?:be able to|get to|reach|make it)\b"
    # review C17: "823 residents will be better off", "this will help 823 residents"
    r"|\bwill\s+(?:be\s+(?:better|worse)|help|benefit|reach|arrive|get to|make it|save)\b"
    r"|\breal (?:people|residents)\b[^.]*\b(?:will|tomorrow|may|might)\b"
    # review C19: the river or the roads "will" do something
    r"|\bwill (?:be )?(?:cut|rise|risen|close|closed|open|reopen|passable|clear|blocked)\b",
    re.IGNORECASE,
)
# The data gap is named with its count nearby ("163 had no mapped connection (data gap)").
_GAP_WORDS = (
    r"(?:data gap|no mapped (?:connection|way)|jurang data|tiada data|tiada sambungan"
    r"|数据缺口|数据空白)"
)
DAY_GAP = re.compile(
    rf"\d[\d,]*[^\d.;]{{0,15}}{_GAP_WORDS}|{_GAP_WORDS}[\s:(—-]{{0,4}}\d", re.IGNORECASE
)
DAY_PERCENT = re.compile(r"\d\s*(?:%|percent|per cent|peratus)|百分之", re.IGNORECASE)
# Spelled-out counts and fractions ("twenty trips", "a third of residents", "half of them").
DAY_WORD_COUNT = re.compile(
    r"\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen"
    r"|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety"
    r"|hundreds?|thousands?|dozens?)\b|\b(?:a|one|two)\s+(?:third|quarter)s?\s+of\b|\bhalf\s+of\b"
    r"|\bmajority\b|\bmost of the (?:residents|trips|pupils|children)\b",
    re.IGNORECASE,
)
_ARITH = re.compile(
    r"(\d{1,3}(?:,\d{3})+|\d+)\s*([+\-−])\s*(\d{1,3}(?:,\d{3})+|\d+)"
    r"(?:\s*=\s*(\d{1,3}(?:,\d{3})+|\d+))?"
)


def _stated_sums(text: str, allowed: set[int]) -> set[int]:
    """A sum or difference is allowed only where the answer shows it ("464 - 400 = 64"), from
    two of the rehearsal's own counts (review C16: a blanket allowance let invented counts by)."""
    out = set()
    for m in _ARITH.finditer(text):
        a, op, b, c = (int(x.replace(",", "")) if x and x[0].isdigit() else x for x in m.groups())
        if a in allowed and b in allowed and c is not None and c == (a + b if op == "+" else a - b):
            out.add(c)
    return out


def day_errors(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    """A rehearsal answer says it is a rehearsal of synthetic residents, not a forecast, and
    every count in it is one the rehearsal produced."""
    if not rec.days or ans.answer_status == "cannot_answer":
        return []
    text = " ".join([ans.summary, *ans.steps, *ans.caveats])
    errs = []
    if not DAY_WORD.search(text) or not SYNTHETIC.search(text):
        errs.append(
            "A simulated day must be called a rehearsal (or simulation) of synthetic residents."
        )
    if not has_not_forecast(text):
        errs.append("A rehearsal must say it is not a forecast (include 'not a forecast').")
    if DAY_FORECAST.search(text):
        errs.append(
            "A rehearsal does not predict what will happen to real residents: say what happened "
            "in the rehearsal (for example 'could not make the trip in the rehearsal')."
        )
    gaps = sum((d.get("outcomes") or {}).get("data_gap", 0) for d in rec.days)
    if gaps and not DAY_GAP.search(text):
        errs.append(
            f"{gaps} trips had no mapped connection: say so as a data gap with its count "
            "(for example 'N had no mapped connection (data gap)')."
        )
    errs += _day_number_errors(text, rec, "trips by outcome, residents by group, school")
    return errs


def _day_number_errors(text: str, rec: TurnRecord, what: str) -> list[str]:
    """Every count is a digit the rehearsal (or the change tested on it) produced."""
    errs = []
    named = _strip_names(text, rec.place_names)
    if (
        DAY_PERCENT.search(named)
        or NUMBER_WORDS.search(named)
        or DAY_WORD_COUNT.search(named)
        or re.search(r"\b\d+\.\d{3}\b", named)
    ):
        errs.append("Give counts as digits copied from the rehearsal, not percentages or words.")
    # a tested change licenses its headline and group counts only (review C17: every integer in
    # its payload, option numbers and other options' counts included, let invented ones by)
    allowed = set().union(
        set(),
        *(_ints(d) for d in [*rec.days, *rec.my_trips]),
        *map(_change_counts, rec.day_changes),
    )
    plain = _strip_change_context(_DAY_NOT_COUNT.sub(" ", _HHMM.sub(" ", named)), rec)
    spoken = {int(m.group(1).replace(",", "")) for m in _DAY_COUNT.finditer(plain)}
    if (bad := spoken - allowed) and (bad := sorted(bad - _stated_sums(plain, allowed))):
        errs.append(
            f"Numbers {bad} do not appear in the rehearsal: quote only its counts ({what})."
        )
    return errs


def _change_counts(c: dict) -> set[int]:
    out = {c.get(k) for k in ("residents_better", "residents_worse", "trips_better", "trips_worse")}
    for g in c.get("groups") or []:
        out |= {g.get(k) for k in ("residents", "better_off", "worse_off")}
    return {x for x in out if isinstance(x, int) and not isinstance(x, bool)}


def _strip_change_context(text: str, rec: TurnRecord) -> str:
    """Numbers that are not outcome counts, only where their words say what they are: "option 2",
    "1 of 8 suggested changes", "1,129 residents whose trips the water cut", "318 trips walked"."""
    if not rec.day_changes:
        return text
    offered = max(len(c.get("options") or []) for c in rec.day_changes)
    reasons = {
        n
        for c in rec.day_changes
        for o in c.get("options") or []
        for n in (o.get("residents_relying"), o.get("trips_walked"))
        if isinstance(n, int)
    }

    def num(x: str) -> int:
        return int(x.replace(",", ""))

    text = re.sub(
        r"\b(?:option|pilihan)\s+(\d+)\b",
        lambda m: " " if num(m.group(1)) <= offered else m.group(0),
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\b(\d+)\s+of\s+(\d+)\s+(?:suggested\s+)?(?:changes|options|suggestions)\b",
        lambda m: " " if num(m.group(2)) == offered and num(m.group(1)) <= offered else m.group(0),
        text,
        flags=re.IGNORECASE,
    )
    return re.sub(
        r"(\d{1,3}(?:,\d{3})+|\d+)(\s+(?:[a-z]+\s+){0,3}?(?:whose trips|trips walked|walked|"
        r"relied|rely|relying))"
        r"|((?:relied on by|used by|usual route of|on the route of)\s+)(\d{1,3}(?:,\d{3})+|\d+)",
        lambda m: (
            (" " + (m.group(2) or "")) if num(m.group(1) or m.group(4)) in reasons else m.group(0)
        ),
        text,
        flags=re.IGNORECASE,
    )


# Rehearse my trip (Cycle 19): facts from the rehearsal, never advice.
MY_TRIP_ADVICE = re.compile(
    r"\b(?:should|must|need to|have to|better|ought to)\s+(?:leave|go|set off|depart|travel)\b"
    r"|\bleave (?:by|before|no later than|early)\b|\bbest time\b|\bsafest\b|\bmake sure\b"
    r"|\bi (?:recommend|suggest|advise)\b|\bsebaiknya\b|\bperlu bertolak\b|建议|最好"
    r"|\b(?:will|won't|would)\s+(?:not\s+)?(?:get|arrive|reach|make|be able)\b"
    r"|\bakan (?:sampai|tiba)\b"
    # review C19: recommendations and imperatives about when to go, in EN / BM / ZH
    r"|\b(?:it'?s |it is )?(?:better|best|wiser|safer) to\b"
    r"|\b(?:aim|plan|try|consider) (?:to |for )"
    r"|\b(?:set off|go|leave|depart) (?:early|earlier|before|instead|sooner)\b|\bleaving early\b"
    r"|\bwait until\b[^.]*\bto (?:go|leave)\b|\byou could (?:leave|go|set off)\b"
    r"|(?:^|[.!?]\s+)(?:leave|go|set off|depart|try)\b"
    r"|\b(?:leave|go|set off)\b[^.]{0,24}\binstead\b"
    r"|\bbertolak (?:sebelum|awal|lebih awal)\b|\belakkan\b|早点|提前|之前出发|不要出发"
    # reassurance a rehearsal cannot give
    r"|\bno risk\b|\b(?:fine|ok|okay) to (?:go|travel|leave)\b|\bnothing to worry\b"
    r"|\btiada risiko\b|没问题|没有风险",
    re.IGNORECASE,
)
MY_TRIP_OUTCOME = {
    "clear": r"got there|arrived|reached|sampai|tiba|到达|抵达",
    "longer": r"longer way|longer route|lebih (?:jauh|panjang)|绕",
    # live smoke test C21: "laluan yang sangat panjang", "very long" are the honest BM wording
    "very_long": r"very long|long way round|sangat (?:jauh|panjang)|jauh lebih panjang|很远|很长",
    "rerouted": r"re-?plan|re-?route|changed (?:its|the) route|tukar laluan|改道|重新规划",
    "turned_back": r"turned back|berpatah balik|折返|返回",
    "stranded": r"\bstuck\b|terkandas|被困",
    "no_way": r"no way|no route|no mapped way|tiada laluan|没有路",
}
UNCHECKED_WORDS = re.compile(r"unchecked|not (?:yet )?checked|belum disemak|未核实|未检查", re.I)
MY_TRIP_GAP = re.compile(
    r"data gap|no mapped connection|jurang data|tiada sambungan|数据缺口", re.IGNORECASE
)
_CLOCK = re.compile(r"\b(\d{1,2})[:.](\d{2})\s*(am|pm|a\.m\.|p\.m\.)?(?!\d)", re.IGNORECASE)


def _clock_minutes(text: str) -> set[int]:
    out = set()
    for h, m, ap in _CLOCK.findall(text):
        h, m = int(h), int(m)
        if ap and ap.lower().startswith("p") and h < 12:
            h += 12
        if ap and ap.lower().startswith("a") and h == 12:
            h = 0
        if h < 24 and m < 60:
            out.add(h * 60 + m)
    return out


def _payload_times(x) -> set[int]:
    if isinstance(x, str):
        return _clock_minutes(x) if re.fullmatch(r"\d{2}:\d{2}", x) else set()
    if isinstance(x, dict):
        return set().union(set(), *(_payload_times(v) for v in x.values()))
    if isinstance(x, list):
        return set().union(set(), *(_payload_times(v) for v in x))
    return set()


def my_trip_errors(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    """A resident's own rehearsed trip: says what happened in the rehearsal (the asked time's
    outcome, in words), never advice; every clock time and count comes from the rehearsal."""
    if not rec.my_trips or ans.answer_status == "cannot_answer":
        return []
    text = " ".join([ans.summary, *ans.steps, *ans.caveats])
    d = rec.my_trips[-1]
    errs = []
    if not DAY_WORD.search(text):
        errs.append("Say this is a rehearsal (a simulated day), not what will happen.")
    if not has_not_forecast(text):
        errs.append("A rehearsed trip must say it is not a forecast (include 'not a forecast').")
    if MY_TRIP_ADVICE.search(text) or DAY_FORECAST.search(text):
        errs.append(
            "Do not advise when to leave or predict the trip: say what happened in the "
            "rehearsal (for example 'in the rehearsal, a trip leaving at 06:40 got there')."
        )
    if d.get("status") != "rehearsed":
        if not MY_TRIP_GAP.search(text):
            errs.append("There is no mapped connection for this trip: call it a data gap.")
        return errs
    out = (d.get("asked") or {}).get("outcome")
    # the sentence about the asked time names what happened to it, and never contradicts it
    leave = _clock_minutes(d.get("leave") or "")
    said = [x for x in _SENTENCE.split(text) if leave & _clock_minutes(x)]
    if out in MY_TRIP_OUTCOME and not any(
        re.search(MY_TRIP_OUTCOME[out], x, re.IGNORECASE) for x in said
    ):
        errs.append(
            f"Say what happened to the trip at {d.get('leave')} in the rehearsal (it "
            f"{_OUTCOME_SAID.get(out, out)}), in the sentence about that time."
        )
    # a very long way round does arrive (late); the others never got there
    if out in ("no_way", "turned_back", "stranded") and any(_ARRIVED.search(x) for x in said):
        errs.append(
            f"The trip at {d.get('leave')} did not get there in the rehearsal: do not say it "
            "arrived."
        )
    if (d.get("asked") or {}).get("unchecked") and not UNCHECKED_WORDS.search(text):
        errs.append(
            "The rehearsal let this trip use unchecked paths: say how many unchecked stretches "
            "it crossed."
        )
    known = set().union(*(_payload_times(t) for t in rec.my_trips))
    for dd in rec.days:
        known |= _clock_minutes((dd.get("scenario") or {}).get("summary") or "")
    if bad := sorted(_clock_minutes(_strip_names(text, rec.place_names)) - known):
        errs.append(
            f"Times {[f'{m // 60:02d}:{m % 60:02d}' for m in bad]} are not in the rehearsal: "
            "quote only its times (leaving, arriving, when the way came back)."
        )
    errs += _day_number_errors(text, rec, "minutes, waiting and unchecked stretches")
    # minutes are not "measurements" here: every trip time must be one the rehearsal produced
    named = _strip_names(text, rec.place_names)
    mins = {int(x) for x in _TRIP_MIN.findall(named)}
    payload = set().union(*(_ints(t) for t in rec.my_trips))
    if bad := sorted(mins - payload):
        errs.append(
            f"Trip times {bad} minutes do not appear in the rehearsal: quote only its minutes."
        )
    # hours are fine only as a rounding of the rehearsal's own minutes (review C19)
    for h in _TRIP_HOURS.findall(named):
        if not any(abs(float(h) * 60 - m) <= 30 for m in payload if m >= 30):
            errs.append(
                f"'{h} hours' does not match the rehearsal's minutes: quote its minutes instead."
            )
            break
    return errs


_OUTCOME_SAID = {
    "clear": "got there",
    "longer": "got there by a longer way round",
    "very_long": "found only a very long way round",
    "rerouted": "had to re-plan on the way",
    "turned_back": "turned back",
    "stranded": "was stuck on the way",
    "no_way": "found no way through",
}
_SENTENCE = re.compile(r"(?<=[.!?;])\s+|\n")
_ARRIVED = re.compile(
    r"(?<!not )(?<!n't )(?<!never )\b(?:got there|arrived|reached|sampai|tiba)\b", re.IGNORECASE
)
_TRIP_HOURS = re.compile(r"(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h\b|jam)", re.IGNORECASE)
_TRIP_MIN = re.compile(r"(?<![\d.:])(\d+)\s*(?:min\b|mins\b|minutes?\b|minit\b|分钟)", re.I)


IMAGINED = re.compile(r"\bimagin|\bwhat-if\b|\bbayangkan|\bandaian\b|假设|设想", re.IGNORECASE)


def day_change_errors(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    """An imagined change tested on a rehearsal (Cycle 17): called imagined, on synthetic
    residents, not a plan and not a forecast, never "will be built", and only its counts."""
    if not rec.day_changes or ans.answer_status == "cannot_answer":
        return []
    text = " ".join([ans.summary, *ans.steps, *ans.caveats])
    errs = []
    if not IMAGINED.search(text) or not SYNTHETIC.search(text):
        errs.append(
            "A tested change must be called imagined, on a rehearsal of synthetic residents."
        )
    if not has_not_forecast(text):
        errs.append("A tested change must say it is not a forecast (include 'not a forecast').")
    if WHATIF_AS_PLAN.search(text) or DAY_FORECAST.search(text) or SHOULD_BUILD.search(text):
        errs.append(
            "An imagined change is not a plan: never say it will be built or should be, and say "
            "what would change in the rehearsal, not what will happen to real residents."
        )
    # a ranking needs every option of that day tested (review C17: per day, not across days)
    tested: dict[str, set] = {}
    offered: dict[str, int] = {}
    for c in rec.day_changes:
        day = (c.get("scenario") or {}).get("id") or ""
        tested.setdefault(day, set()).add(c.get("option"))
        offered[day] = len(c.get("options") or [])
    short = {d: (len(tested[d]), offered[d]) for d in tested if len(tested[d]) < offered[d]}
    if _claims_best(_strip_names(text, rec.place_names)) and short:
        n, m = next(iter(short.values()))
        errs.append(
            f"Only {n} of {m} suggested changes were tested: call it the top suggestion, not "
            "the best or the one that helps most."
        )
    errs += _day_number_errors(
        text, rec, "residents and trips better or worse off, by group, and the change's own"
    )
    return errs


def _claims_best(text: str) -> bool:
    """A ranking claim that is not negated ("not the best option", "not a proven best" are the
    honest wording, seen in the live smoke test of Cycle 17)."""
    for m in BEST_CHANGE.finditer(text):
        # the negation must govern the phrase itself ("is not the best", "not a proven best"),
        # review C17: "isn't it the best change?" and "not clear, but this is the best" are claims
        before = text[max(0, m.start() - 30) : m.start()].lower()
        if not _NEGATES.search(before):
            return True
    return False


_NEGATES = re.compile(
    r"(?:\bnot|\bbukan|n't)\s+(?:necessarily\s+)?(?:(?:a|the)\s+)?(?:proven\s+|single\s+)?$"
    r"|(?:不是|未必)$"
)


# "the best change", "would help most", "number one", "ideal", "recommended": a ranking needs every
# option tested; "best case" is the change's own wording (it never floods in any scenario)
SHOULD_BUILD = re.compile(
    r"\b(?:should|must|need to|ought to|harus|perlu)\s+(?:be\s+)?(?:build|built|raise|raised|"
    r"fix|fixed|do|done|go ahead|prioriti[sz]e|bina|dibina|tinggikan)\b",
    re.IGNORECASE,
)
BEST_CHANGE = re.compile(
    r"\bbest\b(?!\s*-?\s*case)|\bhelps? (?:the )?most\b|\bwould help most\b"
    r"|\bnumber one\b|\bno\. ?1\b"
    r"|\bideal\b|\boptimal\b|\bbiggest (?:impact|benefit|difference|gain)\b"
    r"|\bgreatest (?:impact|benefit)\b|\bmost (?:effective|helpful|useful|beneficial|impactful)\b"
    r"|\brecommend"
    r"|\bterbaik\b|\bpaling (?:berkesan|membantu)\b|最好|最有效",
    re.IGNORECASE,
)


# "35 places", "35 tempat", "35个地点": a count of places (review B1: path segments are not places).
PLACE_COUNT = re.compile(
    r"(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)\s+(?:[a-z-]+\s+){0,2}?(?:places?|tempat|lokasi)\b"
    r"|(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)\s*(?:个|处)(?:地点|地方)",
    re.IGNORECASE,
)


def affected_errors(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    """affected_places totals add places and path segments: a combined total is never said as a
    number of places (other place counts, sums or list lengths are the model's to phrase)."""
    if not rec.affected or rec.plans or ans.answer_status == "cannot_answer":
        return []
    combined: set[int] = set()  # totals that add path segments: never a number of places
    places: set[int] = set()
    for a in rec.affected:
        lp, pp = int(a.get("likely_place_count", 0)), int(a.get("possible_place_count", 0))
        lt = lp + int(a.get("likely_path_count", 0))
        pt = pp + int(a.get("possible_path_count", 0))
        places |= {lp, pp, lp + pp}
        combined |= {lt, pt, lt + pt}
    text = " ".join([ans.summary, *ans.steps, *ans.caveats])
    spoken = {int((m.group(1) or m.group(2)).replace(",", "")) for m in PLACE_COUNT.finditer(text)}
    if bad := sorted((spoken & combined) - places):
        return [
            f"Place counts {bad} are not place counts from affected_places: likely_total adds "
            "places and path segments. Say 'N places and M path segments' with "
            "likely_place_count / likely_path_count."
        ]
    return []


_CUT_OFF_WORDS = re.compile(
    r"cut off|no mapped way (?:in|out)|terputus|被切断|切断|无法进出", re.IGNORECASE
)
_FLOODED_WORDS = re.compile(r"flooded|dinaiki air|banjir|被淹|淹没", re.IGNORECASE)
_NOT_CLAIMED = re.compile(r"\bnot\b|n't\b|\btidak\b|\bbukan\b|未被|没有被|不会", re.IGNORECASE)


def flood_impact_errors(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    """T-024: a place called flooded or cut off must be one affected_places returned as such
    (flooded_places, the possible list, cut_off_places) or a flooded route endpoint."""
    if not rec.affected or ans.answer_status == "cannot_answer":
        return []
    flooded = {
        n for a in rec.affected for k in ("flooded", "possible") for n in a.get(k, {}).values()
    }
    flooded |= {e.get("name") or "" for e in rec.flooded_endpoints.values()}
    cut_off = {n for a in rec.affected for n in a.get("cut_off", {}).values()}
    names = sorted(
        {n for p in rec.place_entities.values() for n in [p["name"], *p["aliases"]] if len(n) >= 4},
        key=len,
        reverse=True,
    )
    low_allowed = {"flooded": {n.lower() for n in flooded}, "cut": {n.lower() for n in cut_off}}
    bad: list[str] = []
    for sent in _sentences(" ".join([ans.summary, *ans.caveats])):
        cut, flood = bool(_CUT_OFF_WORDS.search(sent)), bool(_FLOODED_WORDS.search(sent))
        if not (cut or flood) or _NOT_CLAIMED.search(sent):
            continue
        rest, said = sent.lower(), []
        for n in names:
            if n.lower() in rest:
                said.append(n)
                rest = rest.replace(n.lower(), " ")
        allowed = (low_allowed["cut"] if cut else set()) | (
            low_allowed["flooded"] if flood else set()
        )
        bad += [n for n in said if n.lower() not in allowed]
    if bad:
        return [
            f"{', '.join(dict.fromkeys(bad))}: affected_places did not return these as flooded or "
            "cut off in this scenario. Name only places from flooded_places / cut_off_places."
        ]
    return []


_EVENT_TRIPS = re.compile(
    r"(?<![\d.,])(\d+)\s+(?:of\s+(?:the\s+)?(\d+)\s+)?(?:[a-z-]+\s+){0,3}?"
    r"(?:trips?|journeys?|perjalanan)\b|(\d+)\s*(?:趟|次|个)(?:出行|行程)",
    re.IGNORECASE,
)
_JAM = re.compile(
    r"traffic jam|\bjams?\b|congest|gridlock|\bqueues?\b|\bcrowd"
    r"|kesesakan|\bsesak\b|拥堵|堵车|人群",
    re.IGNORECASE,
)
_BEFORE_WORDS = re.compile(
    r"before|already|data gap|sebelum|sudah|之前|原本|数据缺口", re.IGNORECASE
)


def _ints(x) -> set[int]:
    if isinstance(x, bool):
        return set()
    if isinstance(x, int | float):
        return {int(x)} if float(x).is_integer() else set()
    if isinstance(x, dict):
        # the per-trip rows hold metres, not counts; detour rows' "trips" are counts
        return {
            n for k, v in x.items() if not (k == "trips" and isinstance(v, list)) for n in _ints(v)
        }
    if isinstance(x, list):
        return {n for v in x for n in _ints(v)} | {len(x)}
    return set()


def event_errors(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    """T-025 event simulations: trip counts come from the tool; trips that had no route before
    the event are not blamed on it; no jam, queue or crowd prediction (no traffic data)."""
    if not rec.events or ans.answer_status == "cannot_answer":
        return []
    text = _strip_names(" ".join([ans.summary, *ans.steps, *ans.caveats]), rec.place_names)
    allowed = {n for e in rec.events for n in _ints(e)}
    errs: list[str] = []
    for sent in _sentences(text):
        for m in _EVENT_TRIPS.finditer(sent):
            nums = {int(g) for g in m.groups() if g}
            if bad := sorted(nums - allowed):
                errs.append(f"Trip counts {bad} are not in the event simulation: quote its counts.")
            for e in rec.events:
                every, newly = e.get("trips_no_route"), e.get("trips_newly_no_route")
                if (
                    every != newly
                    and every in nums
                    and re.search(r"no (?:mapped )?route|tiada laluan|没有.{0,4}路线", sent, re.I)
                    and not _BEFORE_WORDS.search(sent)
                ):
                    errs.append(
                        f"{every} trips include {e.get('trips_no_route_before')} that had no "
                        f"mapped route before the event: say trips_newly_no_route ({newly}) for "
                        "the event, and the rest as data gaps."
                    )
        if (
            _JAM.search(sent)
            and not _NOT_CLAIMED.search(sent)
            and not re.search(r"\bno\b|without|not modelled", sent, re.I)
        ):
            errs.append("There is no traffic or crowd data: never predict jams, queues or crowds.")
    return list(dict.fromkeys(errs))


def _plan_numbers(rec: TurnRecord) -> set[int]:
    out: set[int] = set()
    for p in rec.plans:
        sm = {k: int(v) for k, v in (p.get("summary") or {}).items()}
        out |= set(sm.values())
        out |= {abs(sm.get("confirmed_after", 0) - sm.get("confirmed_before", 0))}
        out |= {sm.get("total", 0) - sm.get("confirmed_after", 0)}
        facts = p.get("facts") or []
        out |= {len(facts), int(p.get("places") or 0), int(p.get("budget") or 0)}
        out |= {int(f.get("journeys_relying") or 0) for f in facts}
        out |= {sum(1 for f in facts if f.get("ticket_id"))}
    return out


def plan_errors(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    if not rec.plans or ans.answer_status == "cannot_answer":
        return []
    errs: list[str] = []
    text = " ".join([ans.summary, *ans.steps, *ans.caveats])
    if not PLAN_CONDITION.search(text):
        errs.append(
            "A survey plan is conditional: say the journeys would be confirmed only if the "
            "checks pass, e.g. 'If these 15 checks pass, ...'."
        )
    allowed = _plan_numbers(rec) | _whatif_numbers(rec)
    spoken = {int(n) for m in COUNTED.finditer(text) for n in m.groups() if n}
    spoken |= {int(m.group(1)) for m in PLAN_COUNTED.finditer(text)}
    if bad := sorted(spoken - allowed):
        errs.append(
            f"Numbers {bad} do not appear in the survey plan: use only its summary, the number "
            "of facts and places, and journeys_relying."
        )
    if PLAN_AS_FACT.search(text):
        errs.append(
            "Planned checks have not happened: say journeys 'would' be confirmed if they pass, "
            "never 'will be confirmed'."
        )
    return errs


# A river level, written any way: "+3 m", "rises 2 metres", "a 4 m rise", "rise of 3 m".
STAGE_MENTION = re.compile(
    r"(?:\+\s?|\brises?\s+(?:by\s+)?(?:another\s+)?|\brise of\s+)(\d+(?:\.\d+)?)\s?"
    r"(?:m|metres?|meters?)\b|\b(\d+(?:\.\d+)?)\s?(?:m|metres?|meters?)\s+rise\b",
    re.IGNORECASE,
)
FORECAST_WORDS = re.compile(
    r"\bstranded\b|\btrapped\b|\bwill (?:be |get )?(?:cut off|flooded|lose|stuck)\b",
    re.IGNORECASE,
)
NUMBER_WORDS = re.compile(
    r"\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:out\s+)?of\b",
    re.IGNORECASE,
)
BREAK_WORDS = re.compile(r"\bcut off\b|\bbreaks?\b|\bno longer\b|\bloses?\b", re.IGNORECASE)
_LABEL = re.compile(r"\bnormal (?:river )?level\b|\briver \+\d+(?:\.\d+)? m\b", re.IGNORECASE)
# rollout metric words -> count key
_METRIC = (
    (re.compile(r"cut off", re.I), "cut_off"),
    (re.compile(r"confirmed", re.I), "confirmed"),
    (re.compile(r"no mapped connection", re.I), "no_data"),
    (re.compile(r"reach", re.I), "reach"),
)
_COUNTED_METRIC = re.compile(
    rf"\b{_COUNT}(?:\s+(?:out\s+)?of\s+(?:the\s+)?(\d+))?([^.;:()\d]{{0,70}}?)"
    r"\b(cut off|confirmed|no mapped connection|reach(?:ed|es)?)",
    re.IGNORECASE,
)


def _stage_values(stage_ids) -> set[float]:
    out = set()
    for sid in stage_ids:
        if m := re.fullmatch(r"stage_p(\d+)m", sid or ""):
            out.add(float(m.group(1)))
    return out


def _sentences(text: str) -> list[str]:
    return [x for x in re.split(r"(?<=[.!?;])\s+|\n", text) if x.strip()]


def _label_to_stage(rec: TurnRecord) -> dict[str, str]:
    out: dict[str, str] = {}
    for r in rec.rollouts:
        for st in r.get("stages", []):
            if st.get("label"):
                out[st["label"].lower()] = st["id"]
    for t in rec.tippings:
        for sid, lab in (t.get("labels") or {}).items():
            out[lab.lower()] = sid
    out.setdefault("normal level", "baseline")
    out["normal river level"] = "baseline"
    return out


def rollout_errors(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    """Rising-river rollouts and tipping points (Cycle 3): stage-bound numbers, modelled stages
    only, the right break stage, conditional wording, demo values labelled."""
    if not (rec.rollouts or rec.tippings) or ans.answer_status == "cannot_answer":
        return []
    text = " ".join([ans.summary, *ans.steps, *ans.caveats, *(c.text for c in ans.claims)])
    low = text.lower()
    errs: list[str] = []
    if not has_not_forecast(text):
        errs.append(
            "River-stage simulations must say they are indicative scenarios, not a forecast "
            "(include the words 'not a forecast')."
        )
    if FORECAST_WORDS.search(text):
        errs.append(
            "A simulation does not predict who will be stranded or cut off: say who 'is cut off "
            "in this scenario' instead of 'will be'."
        )
    stage_ids = {s["id"] for r in rec.rollouts for s in r.get("stages", [])}
    stage_ids |= {row["stage"] for t in rec.tippings for row in t.get("stages", [])}
    known = _stage_values(stage_ids)
    spoken = {float(a or b) for a, b in STAGE_MENTION.findall(text)}
    if bad := sorted(spoken - known):
        errs.append(
            f"River stages {[f'+{b:g} m' for b in bad]} were not simulated: name only the "
            "modelled stages."
        )
    if PERCENT.search(text) or NUMBER_WORDS.search(text):
        errs.append("Give counts as digits from the simulation, not percentages or words.")
    labels = _label_to_stage(rec)
    # Counts must match the stage named in the same sentence (any persona), for that metric.
    for sent in _sentences(_strip_names(text, rec.place_names)):
        named = {
            labels[m.group(0).lower()]
            for m in _LABEL.finditer(sent)
            if m.group(0).lower() in labels
        }
        for m in _COUNTED_METRIC.finditer(sent):
            n = int(m.group(1))
            metric = next(k for rx, k in _METRIC if rx.search(m.group(4)))
            ok = set()
            for r in rec.rollouts:
                for per in (r.get("counts") or {}).values():
                    for sid, c in per.items():
                        if not named or sid in named:
                            ok |= {int(c.get(metric, -1)), int(c.get("total", -1))}
            if rec.rollouts and n not in ok:
                where = f" at {sorted(named)}" if named else ""
                errs.append(
                    f"Number {n} does not match the rollout's '{metric}' count{where}: quote the "
                    "counts of the stage you name."
                )
    for t in rec.tippings:
        labs = t.get("labels") or {}
        br, dg = t.get("breaks_at"), t.get("degrades_at")
        if not t.get("reached_at_normal", True) and re.search(r"keeps? a (?:mapped )?route", low):
            errs.append(
                "This trip has no working route even at normal level: say so (a data gap or "
                "cut off already), never that it keeps a route."
            )
        for sent in _sentences(text):
            if not BREAK_WORDS.search(sent):
                continue
            stages_here = {labels.get(m.group(0).lower()) for m in _LABEL.finditer(sent)}
            stages_here.discard(None)
            allowed_stages = {x for x in (br, dg) if x}
            if stages_here - allowed_stages - {"baseline"}:
                want = labs.get(br or "", "no stage")
                errs.append(f"The trip breaks at {want}, not at the stage named in: {sent[:80]!r}.")
        if br and (lab := labs.get(br)) and lab.lower() not in low:
            errs.append(f"Say the stage where the trip breaks, as '{lab}'.")
    demo = any(row.get("demo_evidence") for t in rec.tippings for row in t.get("stages", []))
    demo |= any(
        c.get("confirmed_on_demo")
        for r in rec.rollouts
        for per in (r.get("counts") or {}).values()
        for c in per.values()
    )
    if demo and "confirmed" in low and not has_demo_phrase(text):
        errs.append(
            "Confirmed routes in this simulation rest on demo values: add the exact phrase "
            f"'{PLACEHOLDER_CAVEAT}'."
        )
    return errs


# Journey answers (spec 2026-10-19 §6.3, AC-D5). The plan is TurnRecord.journeys (built in
# call_tool from the world and the route plan_route returned), never the model's text. Counts are
# read per sentence of the summary, steps (list numbers dropped), caveats and claim texts, with
# place names and event titles removed first ("Urban Park bench 3" is a name, not a count):
# - rest count: a number (digits or one..twelve) before "rest stop(s) / rest point(s) / bench(es)
#   / places to rest" (BM "tempat rehat", "bangku"; zh "长椅", "休息点"), or after "rest stops
#   ...:" ("Rest stops: 3"). Allowed: the plan's rest events only. A number that picks some out
#   ("the first 2 benches", "of these 2") is skipped. Checked only when the answer plays this
#   route's walk and the route has a rest rule (rest_limit_m): other plans have no rest events.
# - the route's own rest_points count is accepted only in the caveat form "Rest stops mapped on
#   this route: N" (the plan leaves out a rest point at the start and thins rests past 12 events,
#   so the two counts can differ); N must equal len(route.rest_points).
# - unchecked-place count: per clause (split at commas and semicolons) that says "not checked" /
#   "unchecked" (BM, zh too): a number before "place(s) / spot(s) / location(s)" ("tempat",
#   "lokasi"; zh "个地方", "处"), or "N are not checked yet" ("Of the 10 places on the way, 3 are
#   not checked yet" counts 3). Allowed: the plan's unknown events. "Items" (verification items)
#   are a different unit.
_NUM_WORDS = {
    w: i
    for i, w in enumerate(
        "zero one two three four five six seven eight nine ten eleven twelve".split()  # noqa: SIM905
    )
}
_JCNT = r"(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)"
REST_COUNT = re.compile(
    rf"(?<![\w.,]){_JCNT}\s+(?:(?:more|mapped|verified|demo|other)\s+)*"
    r"(?:rest[- ](?:stops?|points?|places?)|benche?s?|places? to rest|tempat rehat|bangku)\b"
    rf"|\brest[- ](?:stops?|points?)\b[^.;:\n]{{0,30}}:\s*{_JCNT}\b"
    r"|(\d+)\s*(?:张|个)?(?:长椅|休息点)",
    re.IGNORECASE,
)
# The route's own count, in the existing older-adult caveat form only (mock / template).
REST_MAPPED = re.compile(
    rf"\brest[- ](?:stops?|points?) mapped on this route\s*:\s*{_JCNT}\b", re.IGNORECASE
)
# A number that picks some of them out ("the first 2 benches") is not how many there are.
_NOT_A_TOTAL = re.compile(r"\b(?:first|last|next|those|these|of|other)\s+$", re.IGNORECASE)
UNCHECKED_PLACES = re.compile(
    rf"(?<![\w.,]){_JCNT}\s+(?:(?:more|unchecked|other)\s+)*"
    r"(?:places?|spots?|locations?|tempat|lokasi)\b|(\d+)\s*(?:个地方|个地点|处)"
    # "Of the 10 places on the way, 3 are not checked yet": the number the check is about
    rf"|(?<![\w.,]){_JCNT}\s+(?:of (?:them|these)\s+)?(?:are|is)\s+(?:still\s+)?"
    r"(?:not (?:yet )?checked|unchecked)\b",
    re.IGNORECASE,
)
_JSENT = re.compile(r"(?<=[.!?;。！？；])\s*|\n")
_JCLAUSE = re.compile(r"[,;，；]")


def _count(groups) -> int:
    g = next(x for x in groups if x)
    return int(g) if g.isdigit() else _NUM_WORDS[g.lower()]


def _answer_plan(ans: FinalAnswer, rec: TurnRecord):
    """The plan the answer is about: its route_id, else the only route, else the route of its
    first journey.play. None when no plan was built for it."""
    rid = ans.route_id or (next(iter(rec.routes)) if len(rec.routes) == 1 else None)
    if rid is None:
        rid = next((i.route_id for i in ans.scene_intents if i.kind == "journey.play"), None)
    return rid, rec.journeys.get(rid or "")


def journey_errors(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    errs: list[str] = []
    plays = [i for i in ans.scene_intents if i.kind == "journey.play"]
    for it in plays:
        if not it.route_id or it.route_id not in rec.routes:
            errs.append(
                f"journey.play names route {it.route_id!r}, which plan_route did not return "
                "this turn: use the route_id of a route from this turn."
            )
        elif it.route_id not in rec.journeys:
            errs.append(f"No journey can be built for route {it.route_id}: leave journey.play out.")
        elif (status := rec.route_status.get(it.route_id)) not in PLAYABLE:
            errs.append(
                f"journey.play cannot walk route {it.route_id}: its status is {status!r}, and "
                "only confirmed or partly_unverified routes are played. Leave journey.play out."
            )
        # The same holds as in the mock and template: no walk past a staff-reported closure,
        # and none on an evacuation turn (the walk is an everyday-trip view, not an escape plan).
        if rec.route_closures:
            errs.append(
                "journey.play on a route with a staff-reported closure: leave journey.play out "
                "and name the closure."
            )
        if "list_evacuation_centres" in rec.tool_calls:
            errs.append("journey.play is not used on an evacuation route: leave journey.play out.")
        if not it.start_time:
            errs.append('journey.play needs start_time ("HH:MM", e.g. "09:00").')
    rid, plan = _answer_plan(ans, rec)
    if plan is None:
        return errs
    names = rec.place_names | {e.title for e in plan.events}
    parts = [ans.summary, *(_STEP_NUMBER.sub("", s) for s in ans.steps), *ans.caveats]
    parts += [c.text for c in ans.claims]
    text = _strip_names("\n".join(parts), names)
    rests = sum(e.kind == "rest" for e in plan.events)
    # The walk's rest count is checked only for the walk the answer plays, on a profile with a
    # rest rule (older_adult_rest): other plans have no rest events at all (ruling D-T1), so
    # "2 benches near the playground" on a stroller route is not a count about the walk.
    played = any(i.route_id == rid for i in plays)
    check_rests = played and rec.routes.get(rid or "", {}).get("rest_limit_m") is not None
    mapped = len(rec.routes.get(rid or "", {}).get("rest_points") or [])
    unknown = sum(e.kind == "unknown" for e in plan.events)
    said_rests, said_mapped, said_unknown = set(), set(), set()
    for sent in _JSENT.split(text):
        said_mapped |= {_count(m.groups()) for m in REST_MAPPED.finditer(sent)}
        sent = REST_MAPPED.sub(" ", sent)
        if check_rests:
            said_rests |= {
                _count(m.groups())
                for m in REST_COUNT.finditer(sent)
                if not _NOT_A_TOTAL.search(sent[: m.start()])
            }
        for clause in _JCLAUSE.split(sent):
            if UNCHECKED_WORDS.search(clause):
                said_unknown |= {
                    _count(m.groups())
                    for m in UNCHECKED_PLACES.finditer(clause)
                    if not _NOT_A_TOTAL.search(clause[: m.start()])
                }
    if bad := sorted(said_rests - {rests}):
        errs.append(
            f"The answer says {bad} rest stops, but the walk for this route has {rests}: "
            "use the route's journey.rest_stops."
        )
    if bad := sorted(said_mapped - {mapped}):
        errs.append(
            f"The answer says {bad} rest stops are mapped on this route, but the route has "
            f"{mapped}: use the count of its rest_points."
        )
    if bad := sorted(said_unknown - {unknown}):
        errs.append(
            f"The answer says {bad} unchecked places, but the walk for this route shows "
            f"{unknown}: use the route's journey.unchecked_places."
        )
    if played:
        all_text = " ".join(parts)
        if any(e.demo for e in plan.events) and not has_demo_phrase(all_text):
            errs.append(
                "The journey shows demo facts (team_survey_placeholder): add a caveat with the "
                f"exact phrase '{PLACEHOLDER_CAVEAT}'."
            )
        checked = any(e.status == "verified" and not e.demo for e in plan.events)
        if not checked and _claims_verified(_strip_names(all_text, names)):
            errs.append(
                "Nothing on this journey is verified by staff: never say 'verified' (say 'No "
                "known barrier' or 'not checked yet')."
            )
    return errs


def repair_answer(ans: FinalAnswer, rec: TurnRecord) -> tuple[FinalAnswer, list[str]]:
    """Fact-free fixes applied before `validate_answer`, so a live model is not sent back for them.

    - A route id or verification-request id cited as evidence is dropped. It was returned by a
      tool this turn, but it is not evidence (models confuse `rt-…` / `vr-…` with `ev-…`).
    - A claim left without evidence is dropped, but only while another claim still cites
      evidence. Claims are never rendered as text (they become citations), so this hides nothing
      a resident reads. An answer whose claims would all be uncited is left as it is, so the
      validator still sends it back: an answer is never shipped without evidence.

    Invented ids are never removed: they still fail validation. Returns (answer, repair notes).
    """
    if ans.answer_status == "cannot_answer":
        return ans, []
    notes: list[str] = []
    if (rec.rollouts or rec.tippings) and not ans.scenario_id and rec.scenarios_used:
        # Every stage was simulated: name the top one so the right disclaimer is shown.
        top = max(rec.scenarios_used, key=lambda x: float(re.sub(r"\D", "", x) or 0))
        ans = ans.model_copy(update={"scenario_id": top})
        notes.append("set scenario_id for a river-stage simulation")
    not_evidence = set(rec.routes) | {str(v.get("id")) for v in rec.vrs}
    stripped = [
        c.model_copy(update={"evidence_ids": [i for i in c.evidence_ids if i not in not_evidence]})
        for c in ans.claims
    ]
    notes += [
        f"dropped non-evidence ids from claim {c.text[:40]!r}"
        for c, s in zip(ans.claims, stripped, strict=True)
        if len(s.evidence_ids) != len(c.evidence_ids)
    ]
    cited = [c for c in stripped if c.evidence_ids]
    if cited and len(cited) != len(stripped):
        notes += [f"dropped uncited claim {c.text[:40]!r}" for c in stripped if not c.evidence_ids]
        stripped = cited
    if not notes:
        return ans, []
    return ans.model_copy(update={"claims": stripped}), notes


# Readable reasons for an answer.check event (shown under "How the AI checked this").
_ISSUES = (
    # journey answers first: their messages also mention "route_id" and "caveat"
    ("journey.play names route", "played a walk for a route that was not checked"),
    ("No journey can be built", "played a walk the township data cannot show"),
    ("journey.play cannot walk route", "played a walk on a route that cannot be walked"),
    ("journey.play on a route with a staff-reported closure", "played a walk past a closure"),
    ("journey.play is not used on an evacuation", "played a walk on an evacuation route"),
    ("journey.play needs start_time", "played a walk without a start time"),
    ("rest stops, but the walk", "gave a rest-stop count the walk does not show"),
    ("rest stops are mapped on this route", "gave a rest-stop count the route does not have"),
    ("unchecked places, but the walk", "gave an unchecked-place count the walk does not show"),
    ("The journey shows demo facts", "left out that values are demo values, not yet surveyed"),
    ("Nothing on this journey is verified", "called unchecked facts verified"),
    (
        "Never describe a place or route as safe",
        "used a reassurance word that flood answers never use",
    ),
    ("water depths", "mentioned a water depth"),
    ("Do not guess or reassure", "guessed or reassured instead of stating what was checked"),
    ("Placeholder evidence is not verified", "called demo values verified"),
    ("placeholder data", "left out that values are demo values, not yet surveyed"),
    ("confirmed only on placeholder", "called a demo-value route plainly confirmed"),
    ("Route status contradiction", "named a different route status than the route check found"),
    ("only likely OK", "called an estimated route step-free or accessible"),
    ("not on this route's maneuvers", "named a street the route does not use"),
    ("No maneuver on this route turns", "gave a turn the route does not make"),
    ("likely OK only by estimate", "did not say the route is an estimate"),
    ("staff-reported closure", "did not name a staff-reported closure"),
    ("Write for residents", "used internal ids instead of readable names"),
    ("No tool was called", "answered without checking the township data"),
    ("No verification request was filed", "said staff were asked when no request was filed"),
    ("Unknown evidence ids", "cited evidence that no check returned"),
    ("cites no evidence", "made a claim without evidence"),
    ("route_id", "referred to a route that was not checked"),
    ("answer_status cannot be", "called a blocked or unmapped route answered"),
    ("rest limit", "left out the longest stretch without a rest point"),
    ("say plainly it is a what-if", "did not say the answer is a what-if simulation"),
    ("do not appear in the what-if result", "used numbers the simulation did not produce"),
    ("do not appear in the simulation result", "used numbers the simulation did not produce"),
    ("are not place counts", "counted path segments as places"),
    ("did not return these as flooded or cut off", "called a place flooded or cut off wrongly"),
    ("are not in the event simulation", "used trip counts the event simulation did not give"),
    ("before the event: say trips_newly_no_route", "blamed old data gaps on the event"),
    ("never predict jams, queues or crowds", "predicted traffic jams or crowds"),
    ("must be called a rehearsal", "did not say it is a rehearsal of synthetic residents"),
    ("A rehearsal must say it is not a forecast", "did not say the rehearsal is not a forecast"),
    ("do not appear in the rehearsal", "used numbers the rehearsal did not produce"),
    ("A rehearsal does not predict", "described a rehearsal as a prediction"),
    ("keep the strength of the flood class", "weakened a 'likely flooded' warning"),
    ("Imagined outcomes are conditional", "stated an imagined outcome as fact"),
    ("found no candidate change that helps", "claimed a fix helps when none does"),
    ("stopped at its time limit", "did not say the search was inconclusive"),
    ("No costs or feasibility are modelled", "made up a cost or feasibility claim"),
    ("cannot be repeated from memory", "repeated earlier what-if numbers without re-checking"),
    ("not percentages", "gave percentages instead of simulated counts"),
    ("suggested changes were tested", "called an untested change the best"),
    ("must be called imagined", "did not say the change is imagined"),
    ("Say this is a rehearsal", "did not say it is a rehearsal"),
    ("say so as a data gap", "left out the data gap"),
    ("does not predict what will happen", "predicted what will happen to real residents"),
    ("An imagined change is not a plan", "described an imagined change as a plan"),
    ("Do not advise when to leave", "gave travel advice instead of the rehearsal's facts"),
    ("are not in the rehearsal: quote only its times", "used times the rehearsal did not produce"),
    ("Say what happened to the trip", "did not say what happened to the trip"),
    ("unchecked paths: say how many", "left out the unchecked stretches"),
    ("with a river stage must say", "did not say the flood scenario is not a forecast"),
    ("rest on demo values", "left out that the imagined routes use demo values"),
    ("A what-if is not a real plan", "described a what-if as a real plan"),
    ("A survey plan is conditional", "did not say the plan depends on the checks passing"),
    ("do not appear in the survey plan", "used numbers the survey plan did not produce"),
    ("Planned checks have not happened", "stated a planned result as certain"),
    ("River-stage simulations must say", "did not say the river scenario is not a forecast"),
    ("were not simulated", "named a river level the model did not simulate"),
    ("Say the stage where the trip breaks", "did not say at which river level the trip breaks"),
    ("does not match the rollout", "used a count the rollout did not produce for that stage"),
    ("does not predict who will be", "described a simulation as a prediction"),
    ("not percentages or words", "gave percentages or spelled-out numbers"),
    ("no working route even at normal level", "said a trip works when it never does"),
    ("The trip breaks at", "named the wrong river level for the break"),
    (
        "Confirmed routes in this simulation rest on demo values",
        "left out that values are demo values",
    ),
    ("do not match this turn's tool results", "stated a number no check returned"),
    ("which its cited evidence does not", "gave a claim a number its evidence does not record"),
    ("which no tool recorded this turn", "described a feature no check recorded"),
    ("Never guarantee or rule out risk", "promised more than the data shows"),
    ("caveat", "left out a required caveat"),
    ("scenario_id", "did not name the flood scenario it used"),
)


def issue_labels(errs: list[str]) -> list[str]:
    """Short, resident-readable reasons for validator errors (deduplicated, in order)."""
    out: list[str] = []
    for e in errs:
        label = next((lab for key, lab in _ISSUES if key in e), "did not match the checked data")
        if label not in out:
            out.append(label)
    return out
