import re

from townshiplens_spatial.attributes import ATTRIBUTE_TYPES

from .answer import FinalAnswer
from .labels import CLOSURE_WORDS, DEMO_CONFIRMED, REST_GAP_WORDS, closure_name, closure_until
from .record import TurnRecord

FORBIDDEN = re.compile(r"(?<![\w-])safe(?:ly)?(?![\w-])|\bselamat\b|安全", re.IGNORECASE)
DEPTH = re.compile(
    r"\d+(?:\.\d+)?\s?(?:cm|m|厘米|米)\s*(?:deep|of water|dalam|深)"
    r"|depth\s+of\s+\d|\d+(?:\.\d+)?\s?(?:cm|m)\s+depth|(?:knee|waist|ankle)-deep",
    re.IGNORECASE,
)
# Guesses and reassurance: the engine computes no likelihood for a route, so the answer must not
# imply one ("likely flooded" is a flood class and stays allowed).
REASSURE = re.compile(
    r"\bprobably\b|\bshould be (?:fine|ok(?:ay)?|alright|accessible|passable)\b"
    r"|\byou(?:'ll| will) be (?:fine|ok(?:ay)?)\b|\bno problem\b|\bnothing to worry\b",
    re.IGNORECASE,
)
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
# A what-if described as a real plan ("will be built", "the council plans to build").
WHATIF_AS_PLAN = re.compile(
    r"\b(?:will be|is being|is planned to be|are planned to be)\s+"
    r"(?:built|installed|added|fixed|repaired|upgraded)\b"
    r"|\bwe (?:will|are going to) build\b|\bplans? to (?:build|install|add|upgrade)\b"
    r"|\bwill get an? (?:ramp|lift|new path)\b",
    re.IGNORECASE,
)
# Survey plans (Cycle 2, planner.py): conditional on the checks passing, numbers from the plan.
PLAN_CONDITION = re.compile(r"\bif\b[^.;]{0,60}\bpass", re.IGNORECASE)
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
NEGATED_VERIFIED = re.compile(r"\bnot (?:yet )?$", re.IGNORECASE)


_ST = r"(confirmed|partly_unverified|blocked|no_data)"
STATUS_LABEL = re.compile(rf"\broute status\s*[:=]?\s*{_ST}\b")
STATUS_IS = re.compile(
    rf"\broute (?:is|was) {_ST}\b(?!\s+(?:by|at|near|because|due|on|from|where)\b)"
)
# "route confirmed" / "Route status: confirmed" / "the route is confirmed" NOT followed by the demo
# qualifier (a confirmed route over placeholder evidence must carry it).
BARE_CONFIRMED = re.compile(
    r"\broute\s+(?:status\s*[:=]?\s*|(?:is|was)\s+)?confirmed\b"
    r"(?!\s*\(on demo values, not yet surveyed\))",
    re.IGNORECASE,
)
RAW_ID = re.compile(
    r"\bseg-[\w-]+|\b(?:" + "|".join(sorted(k for k in ATTRIBUTE_TYPES if "_" in k)) + r")\b"
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


def _norm_status_text(text: str) -> str:
    text = text.lower().replace("partly unverified", "partly_unverified")
    text = text.replace("no mapped connection", "no_data")
    return text.replace("no data", "no_data")


def _named_statuses(summary: str, steps: list[str]) -> set[str]:
    """Statuses the answer names for *the* route: "Route status: X" anywhere in the summary or
    steps, and "the route is X" in the summary's first sentence. Segment/element-level mentions,
    ids and other routes are ignored."""
    text = _norm_status_text(" ".join([summary, *steps]))
    out = {m.group(1) for m in STATUS_LABEL.finditer(text)}
    first = re.split(r"(?<=[.!?])\s|\n", _norm_status_text(summary), maxsplit=1)[0]
    for m in STATUS_IS.finditer(first):
        prev = first[: m.start()].split()[-1:] or [""]
        if prev[0] not in OTHER_ROUTE:
            out.add(m.group(1))
    return out


def _claims_verified(text: str) -> bool:
    """True when the text uses "verified" affirmatively ("not (yet) verified" is allowed)."""
    return any(not NEGATED_VERIFIED.search(text[: m.start()]) for m in VERIFIED_WORD.finditer(text))


def _strip_names(text: str, names: set[str]) -> str:
    """Remove place names returned by tools ("Taman Selamat", "Safe Haven Hall")."""
    for n in sorted((n for n in names if n), key=len, reverse=True):
        text = re.sub(re.escape(n), " ", text, flags=re.IGNORECASE)
    return text


def validate_answer(ans: FinalAnswer, rec: TurnRecord) -> list[str]:
    errs: list[str] = []
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
    if status:
        named = _named_statuses(ans.summary, ans.steps) - {status}
        if named:
            errs.append(
                f"Route status contradiction: the route is {status} but the summary/steps name "
                f"{sorted(named)}. Use the status the tool returned."
            )
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
    if ans.answer_status != "cannot_answer":
        for note in rec.inferred_notes:
            if not any(_norm_note(note) in _norm_note(c) for c in ans.caveats):
                errs.append(f"plan_route warned: {note!r} Add that as a caveat (word for word).")
    if ans.answer_status != "cannot_answer":
        for pid, info in rec.flooded_endpoints.items():
            names = {pid.lower(), str(info.get("name", pid)).lower()}
            if not any(n in c.lower() for c in ans.caveats for n in names):
                phrase = (
                    "likely flooded"
                    if info.get("flood_class") == "likely_flooded"
                    else "possibly flooded"
                )
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
        if rests_on and PLACEHOLDER_CAVEAT not in all_text.lower():
            errs.append(
                "Some evidence returned this turn is placeholder data (source_type "
                f"team_survey_placeholder): add a caveat containing the exact phrase "
                f"'{PLACEHOLDER_CAVEAT}'."
            )
    if (
        ans.answer_status != "cannot_answer"
        and status == "confirmed"
        and route.get("demo_evidence")
        and BARE_CONFIRMED.search(" ".join([ans.summary, *ans.steps, *ans.caveats]))
    ):
        errs.append(
            "The route is confirmed only on placeholder (demo) values: say "
            f"'Route status: {DEMO_CONFIRMED}' in the summary instead of a bare 'confirmed'."
        )
    if rec.scenarios_used and not ans.scenario_id:
        errs.append("A flood scenario tool was used: set scenario_id.")
    errs += whatif_errors(ans, rec)
    errs += plan_errors(ans, rec)
    errs += rollout_errors(ans, rec)
    # Honesty rules apply to every answer, whether or not a tool ran.
    errs += text_errors(all_text, rec)
    return errs


def _has_placeholder(rec: TurnRecord) -> bool:
    return any(getattr(e, "source_type", None) == PLACEHOLDER_SOURCE for e in rec.evidence.values())


def text_errors(text: str, rec: TurnRecord) -> list[str]:
    """Wording rules that depend only on the text and this turn's record. Shared by
    `validate_answer` and the draft guard (`draft.DraftStreamer`), so a draft is never allowed
    to show what the final check would reject."""
    errs: list[str] = []
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
            "(element_label, e.g. 'Incline (%)'), never segment ids or snake_case attribute keys."
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
    staged = any(w.get("scenario_id") or w.get("base_scenario_id") for w in rec.what_ifs)
    if staged and "not a forecast" not in text.lower():
        errs.append(
            "A what-if with a river stage must say it is an indicative scenario, not a forecast "
            "(include the words 'not a forecast')."
        )
    demo = any((w.get("summary") or {}).get("confirmed_on_demo_after") for w in rec.what_ifs)
    if demo and PLACEHOLDER_CAVEAT not in text.lower():
        errs.append(
            "Imagined confirmed routes rest on demo values: add a caveat containing the exact "
            f"phrase '{PLACEHOLDER_CAVEAT}'."
        )
    return errs


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
    if "not a forecast" not in low:
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
    for sent in _sentences(text):
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
    if demo and "confirmed" in low and PLACEHOLDER_CAVEAT not in low:
        errs.append(
            "Confirmed routes in this simulation rest on demo values: add the exact phrase "
            f"'{PLACEHOLDER_CAVEAT}'."
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
    ("Imagined outcomes are conditional", "stated an imagined outcome as fact"),
    ("cannot be repeated from memory", "repeated earlier what-if numbers without re-checking"),
    ("not percentages", "gave percentages instead of simulated counts"),
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
