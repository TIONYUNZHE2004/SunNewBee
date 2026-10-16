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
    not_evidence = set(rec.routes) | {str(v.get("id")) for v in rec.vrs}
    stripped = [
        c.model_copy(update={"evidence_ids": [i for i in c.evidence_ids if i not in not_evidence]})
        for c in ans.claims
    ]
    notes = [
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
