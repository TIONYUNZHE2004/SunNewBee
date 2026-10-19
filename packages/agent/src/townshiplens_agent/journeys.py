"""Journey plans inside a chat turn (spec 2026-10-19-resident-journey-simulation-design.md §6.3).

`call_tool` builds a `JourneyPlan` for every route `plan_route` returns (the same
`townshiplens_spatial.journey.build_journey` that `run.py` and `POST /journeys` use) and keeps it
in `TurnRecord.journeys`. The model sees only the counts and names below (`route["journey"]`), so
it can say how many rest stops and unchecked places the walk shows without computing anything;
the validator checks the answer against the plan, never against model text.

A plan's events do not depend on its start time (only the clock does), so the plan built here
with `JOURNEY_START` has exactly the events the played plan has.
"""

from __future__ import annotations

import logging
import re

from townshiplens_spatial.journey import MAX_RAMP_EVENTS, JourneyEvidenceError, build_journey
from townshiplens_spatial.models import JourneyPlan, Route

log = logging.getLogger(__name__)

# The walk's start time when the question names none: a fixed, documented demo value, so the
# demo replays identically (spec §6.6). A time in the question ("at 3pm", "08:15") wins.
JOURNEY_START = "09:00"
# Routes the walk is played for: a resident can follow them. A blocked route has no walk.
PLAYABLE = ("confirmed", "partly_unverified")

_TIME = re.compile(
    r"\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])|\b([01]?\d|2[0-3])[:.]([0-5]\d)\b",
    re.IGNORECASE,
)


def start_time_for(question: str) -> str:
    """ "HH:MM" from a time in the question ("at 3pm", "08:15"), else JOURNEY_START."""
    m = _TIME.search(question)
    if not m:
        return JOURNEY_START
    if m.group(3):
        h, mm = int(m.group(1)), int(m.group(2) or 0)
        if not (1 <= h <= 12 and mm < 60):
            return JOURNEY_START
        h = h % 12 + (12 if m.group(3).lower().startswith("p") else 0)
    else:
        h, mm = int(m.group(4)), int(m.group(5))
    return f"{h:02d}:{mm:02d}"


def plan_for(world, route: dict) -> JourneyPlan | None:
    """The journey plan for a plan_route route (the tool's JSON), or None when it cannot be built
    (a data or rule bug: logged, and the answer then cannot play a journey for that route).
    Any failure is caught: the walk is an extra, and must never cost the resident the route."""
    try:
        r = Route.model_validate(route)
        return build_journey(world, r, r.profile, JOURNEY_START)
    except JourneyEvidenceError as e:
        log.error("no journey plan for route %s: %s", route.get("id"), e)
    except Exception:
        log.exception("no journey plan for route %s", route.get("id"))
    return None


def journey_facts(plan: JourneyPlan) -> dict:
    """What the model may say about the walk: counts and names straight from the plan's events."""
    rests = [e for e in plan.events if e.kind == "rest"]
    unknown = [e for e in plan.events if e.kind == "unknown"]
    verified = next((e for e in plan.events if e.kind == "verified"), None)
    return {
        "rest_stops": len(rests),
        "rest_stops_demo": any(e.demo for e in rests),
        "unchecked_places": len(unknown),
        "unchecked_place_names": [e.title for e in unknown],
        "checked_stretch": verified.title if verified else None,
        "checked_stretch_demo": bool(verified and verified.demo),
        "demo_values": any(e.demo for e in plan.events),
    }


def _place_phrase(title: str) -> str:
    """A card title as a phrase in a sentence: "Crossing X" -> "the X crossing", "Ramp" -> "a
    ramp"; a street name stays as it is."""
    if title == "Ramp":
        return "a ramp"
    if title.startswith("Crossing ") and title != "Crossing a main road":
        return f"the {title.removeprefix('Crossing ')} crossing"
    if title == "Crossing a main road":
        return "a main road crossing"
    return title


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


DEMO_TAIL = " (demo values, not yet surveyed)"


def journey_steps(facts: dict) -> list[str]:
    """The answer lines the walk shows (prototype chat bubble), shared by the mock and template:
    the checked stretch and rest stops, then the unchecked places by name. The rest gap and the
    request sentence come from the route's own caveats."""
    out: list[str] = []
    n, stretch = facts["rest_stops"], facts["checked_stretch"]
    rests = f"{n} rest {'stop' if n == 1 else 'stops'} on the way"
    if stretch:
        line = f"No known barrier on the {stretch[:1].lower()}{stretch[1:]}"
        demo = facts["checked_stretch_demo"] or (n and facts["rest_stops_demo"])
        out.append(line + (f", with {rests}" if n else "") + (DEMO_TAIL if demo else "") + ".")
    elif n:
        tail = DEMO_TAIL if facts["rest_stops_demo"] else ""
        out.append(f"{rests[:1].upper()}{rests[1:]}{tail}.")
    m = facts["unchecked_places"]
    if m:
        names = list(dict.fromkeys(_place_phrase(t) for t in facts["unchecked_place_names"]))
        out.append(
            f"Not checked yet: {m} {'place' if m == 1 else 'places'} on the way, including "
            f"{_join(names)}."
        )
    return out


# Upper bound on the requests one walk can add: its unknown events are the first main-road crossing,
# the longest named street run and at most MAX_RAMP_EVENTS ramps (journey.py), so 2 + 2.
MAX_JOURNEY_VRS = MAX_RAMP_EVENTS + 2
# plan_route never files these (flood is a scenario fact, not something staff survey).
_NO_VR_ATTRS = ("flood", "flood_coverage")


def journey_vr_targets(
    plan: JourneyPlan, route: dict, filed: set[tuple[str, str]]
) -> list[tuple[str, str, str]]:
    """(element_id, attribute, reason) to ask staff about so every unchecked place the walk stops
    at has a verification request (D-T10; a card says "verification request filed" only when one
    was filed for its element and attribute). plan_route files at most MAX_ROUTE_VRS in route
    order, which can leave out a place the walk shows; this asks for one attribute of each such
    event and nothing for events that already have a request. Unknown events only: no other card
    claims a request.

    Only real route unknowns are asked about: a pair must be in the route's `unknowns` (with its
    reason), never a flood attribute. An event whose attributes are not route unknowns (e.g. a ramp
    UNKNOWN only for flood under a scenario, where journey.py falls back to "incline_pct") gets no
    request, so request_sentence's count and the tickets agree. At most MAX_JOURNEY_VRS."""
    reasons = {
        (u.get("element_id"), u.get("attribute")): u.get("reason") or "unknown"
        for u in route.get("unknowns") or []
        if u.get("attribute") not in _NO_VR_ATTRS
    }
    out: list[tuple[str, str, str]] = []
    asked = set(filed)
    for e in plan.events:
        if e.kind != "unknown" or not e.element_id or not e.attributes:
            continue
        if any((e.element_id, a) in asked for a in e.attributes):
            continue
        attr = next((a for a in e.attributes if (e.element_id, a) in reasons), None)
        if attr is None:
            continue
        asked.add((e.element_id, attr))
        out.append((e.element_id, attr, reasons[(e.element_id, attr)]))
    return out[:MAX_JOURNEY_VRS]
