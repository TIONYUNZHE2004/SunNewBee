import re

from .answer import FinalAnswer
from .record import TurnRecord

FORBIDDEN = re.compile(r"(?<![\w-])safe(?:ly)?(?![\w-])|\bselamat\b|安全", re.IGNORECASE)
DEPTH = re.compile(
    r"\d+(?:\.\d+)?\s?(?:cm|m|厘米|米)\s*(?:deep|of water|dalam|深)"
    r"|depth\s+of\s+\d|\d+(?:\.\d+)?\s?(?:cm|m)\s+depth|(?:knee|waist|ankle)-deep",
    re.IGNORECASE,
)


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
    if rec.scenarios_used:
        if not ans.scenario_id:
            errs.append("A flood scenario tool was used: set scenario_id.")
        text = " ".join([ans.summary, *ans.steps, *ans.caveats, *(c.text for c in ans.claims)])
        if FORBIDDEN.search(_strip_names(text, rec.place_names)):
            errs.append("Never describe a place or route as safe/selamat/安全 in flood answers.")
        if DEPTH.search(text):
            errs.append("Do not state water depths on paths; scenarios are indicative.")
    return errs
