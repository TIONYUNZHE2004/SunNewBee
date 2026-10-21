"""Development Simulation answers inside a chat turn (developer lens, ADR 0014, spec §5.2).

The fixed brief (the Management starter text) calls `simulate_development`. The answer restates
the brief and says in one sentence that this is illustrative. It carries no computed number: the
walking times and the detour are shown by the player, from the plan the server attaches to the
`development.play` intent. The only digits in the answer are the brief's own storeys and homes,
which `simulate_development` echoes back in `data.brief` and the validator checks against it.
"""

from __future__ import annotations

import re

BRIEF = "Simulate a 30-storey, 500-home tower near Lakeside Mall, from construction to daily life"
ILLUSTRATIVE = (
    "This is an illustrative simulation of a hypothetical development, not a forecast and not "
    "an SDP project; walking times come from the mapped routes."
)
EVIDENCE_PREFIX = "ev-devsim-"
ILLUSTRATIVE_WORD = "illustrative"
NOT_SDP = "not an sdp project"
_BRIEF_RE = re.compile(
    r"simulate\s+a\s+30-storey,\s*500-home\s+tower\s+near\s+lakeside\s+mall", re.I
)


def is_brief(question: str) -> bool:
    """True when the message equals, or contains, the fixed brief (case-insensitive)."""
    return bool(_BRIEF_RE.search(question or ""))


def restatement(storeys: int, homes: int) -> str:
    return f"Brief: {storeys} storeys · ~{homes} homes · parcel near Lakeside Mall"


def devsim_answer(d: dict, evidence_ids: list[str]) -> dict:
    """FinalAnswer fields for a simulate_development result (shared by the mock and the template).
    Ruling R2: the same answer whether or not a plan was built; the web fetches the plan itself
    when the intent carries none."""
    b = d.get("brief") or {}
    line = restatement(int(b.get("storeys", 30)), int(b.get("homes", 500)))
    return {
        "answer_status": "answered",
        "summary": f"{line}. {ILLUSTRATIVE}",
        "claims": [
            {
                "text": "Hypothetical development brief",
                "status": "indicative",
                "evidence_ids": evidence_ids,
            }
        ],
        "caveats": [],
        "scene_intents": [{"kind": "development.play"}],
    }
