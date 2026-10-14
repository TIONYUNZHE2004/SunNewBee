import re

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
        bad = [i for i in c.evidence_ids if i not in rec.evidence]
        if bad:
            errs.append(
                f"Unknown evidence ids {bad}. Cite only ids returned by tools in this turn."
            )
    if ans.route_id and ans.route_id not in rec.routes:
        errs.append(f"route_id {ans.route_id} was not returned by plan_route in this turn.")
    status = rec.route_status.get(ans.route_id) if ans.route_id else None
    if status in ("blocked", "no_data") and ans.answer_status == "answered":
        errs.append(
            f"The route is {status}: answer_status cannot be 'answered'; "
            "use 'partial' or 'cannot_answer'."
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
    if any(getattr(rec.evidence.get(i), "source_type", None) == PLACEHOLDER_SOURCE for i in cited):
        all_text = " ".join([ans.summary, *ans.steps, *ans.caveats, *(c.text for c in ans.claims)])
        if PLACEHOLDER_CAVEAT not in all_text.lower():
            errs.append(
                "Some cited evidence is placeholder data (source_type team_survey_placeholder): "
                f"add a caveat containing the exact phrase '{PLACEHOLDER_CAVEAT}'."
            )
        if BANNED_PLACEHOLDER.search(all_text) or _claims_verified(all_text):
            errs.append(
                "Placeholder evidence is not verified: remove the word 'verified' "
                "(only 'unverified' or 'not yet verified' are allowed) and 'surveyed on' / "
                f"'staff checked'; say the values are '{PLACEHOLDER_CAVEAT}'."
            )
    if rec.scenarios_used:
        if not ans.scenario_id:
            errs.append("A flood scenario tool was used: set scenario_id.")
        text = " ".join([ans.summary, *ans.steps, *ans.caveats, *(c.text for c in ans.claims)])
        if FORBIDDEN.search(_strip_names(text, rec.place_names)):
            errs.append("Never describe a place or route as safe/selamat/安全 in flood answers.")
        if DEPTH.search(text):
            errs.append("Do not state water depths on paths; scenarios are indicative.")
    return errs
