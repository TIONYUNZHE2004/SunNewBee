import re

from townshiplens_spatial.attributes import ATTRIBUTE_TYPES

from .answer import FinalAnswer
from .record import TurnRecord

FORBIDDEN = re.compile(r"(?<![\w-])safe(?:ly)?(?![\w-])|\bselamat\b|安全", re.IGNORECASE)
DEPTH = re.compile(
    r"\d+(?:\.\d+)?\s?(?:cm|m|厘米|米)\s*(?:deep|of water|dalam|深)"
    r"|depth\s+of\s+\d|\d+(?:\.\d+)?\s?(?:cm|m)\s+depth|(?:knee|waist|ankle)-deep",
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
RAW_ID = re.compile(
    r"\bseg-[\w-]+|\b(?:" + "|".join(sorted(k for k in ATTRIBUTE_TYPES if "_" in k)) + r")\b"
)
ASKED = re.compile(
    r"\b(?:asked|requested|filed|notified)\b[^.;]{0,40}\b(?:team|staff)\b"
    r"|\bstaff (?:have|has) been (?:asked|notified)\b|\bnoted the gap\b",
    re.IGNORECASE,
)
OTHER_ROUTE = {"alternative", "alternate", "other", "another", "second", "different"}


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
        if BANNED_PLACEHOLDER.search(all_text) or _claims_verified(all_text):
            errs.append(
                "Placeholder evidence is not verified: remove the word 'verified' "
                "(only 'unverified' or 'not yet verified' are allowed) and 'surveyed on' / "
                f"'staff checked'; say the values are '{PLACEHOLDER_CAVEAT}'."
            )
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
    if rec.scenarios_used and not ans.scenario_id:
        errs.append("A flood scenario tool was used: set scenario_id.")
    # Honesty rules apply to every answer, whether or not a tool ran.
    if not rec.vrs and ASKED.search(all_text):
        errs.append(
            "No verification request was filed this turn: do not say staff or the team were "
            "asked (or that the gap was noted). Say nothing about a request."
        )
    if RAW_ID.search(all_text):
        errs.append(
            "Write for residents: use the readable names from the tool result "
            "(element_label, e.g. 'Incline (%)'), never segment ids or snake_case attribute keys."
        )
    if FORBIDDEN.search(_strip_names(all_text, rec.place_names)):
        errs.append("Never describe a place or route as safe/selamat/安全.")
    if DEPTH.search(all_text):
        errs.append("Do not state water depths on paths; scenarios are indicative.")
    return errs
