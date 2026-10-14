import re

from .answer import FinalAnswer
from .record import TurnRecord

FORBIDDEN = re.compile(r"(?<![\w-])safe(?:ly)?(?![\w-])|\bselamat\b|安全", re.IGNORECASE)
DEPTH = re.compile(
    r"\d+(?:\.\d+)?\s?(?:cm|m|厘米|米)\s*(?:deep|of water|dalam|深)"
    r"|depth\s+of\s+\d|\d+(?:\.\d+)?\s?(?:cm|m)\s+depth|(?:knee|waist|ankle)-deep",
    re.IGNORECASE,
)


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
    if (
        ans.route_id
        and rec.route_status.get(ans.route_id) == "partly_unverified"
        and not ans.caveats
    ):
        errs.append(
            "The route is partly_unverified: add a caveat naming the unverified segment(s) first."
        )
    if rec.scenarios_used:
        if not ans.scenario_id:
            errs.append("A flood scenario tool was used: set scenario_id.")
        text = " ".join([ans.summary, *ans.steps, *ans.caveats, *(c.text for c in ans.claims)])
        if FORBIDDEN.search(text):
            errs.append("Never describe a place or route as safe/selamat/安全 in flood answers.")
        if DEPTH.search(text):
            errs.append("Do not state water depths on paths; scenarios are indicative.")
    return errs
