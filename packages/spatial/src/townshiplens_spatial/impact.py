"""Ticket impact: what one verification would change, or did change (Cycle 7).

Value of information on one ticket, by rollout on the world model:

- **Open ticket:** the sampled journeys with the fact as it is now, imagined passing, and
  imagined failing. The result is how many would become confirmed, and how many would lose
  their route.
- **Resolved ticket:** the world as it is now against an imagined world where the fact was never
  checked (`twm.ForgetFact`). The result is how many journeys the check changed.

The journeys are the ticket's own (parsed from "<profile> route <A> -> <B>") plus the profile's
first everyday trips. Counts only; nothing is stored or shown to residents.
"""

from __future__ import annotations

import re

from pydantic import BaseModel

from . import belief as _belief
from . import twm
from .routing import eval_memo
from .world import World

SAMPLE = 20
_SUMMARY = re.compile(r"^(\w+) route (.+?) -> (.+)$")


class OwnJourney(BaseModel):
    from_name: str
    to_name: str
    statuses: dict[str, str]  # "now" / "pass" / "fail" (open) or "before" / "now" (resolved)


class FactImpact(BaseModel):
    element_id: str
    attribute: str
    mode: str  # "would" (open fact) | "did" (verified fact) | "none" (not a path fact)
    profile: str
    sampled: int
    became_confirmed: int = 0  # open: if it passes; resolved: because it was checked
    lost_route: int = 0  # open: if it fails; resolved: always 0 (a pass cannot cut a route)
    changed: int = 0  # resolved: journeys whose status the check changed
    own: OwnJourney | None = None
    # Open ticket: unchecked facts still on the own journey's route if this check passes.
    own_other_checks: int | None = None
    belief_q: float | None = None  # P(this kind of fact passes), planning estimate
    belief_q_before: float | None = None  # resolved: without this verification
    note: str = (
        "Sampled journeys on the township model; a planning estimate, not a promise. "
        "Residents never see these numbers."
    )


def _place_id(world: World, name: str) -> str | None:
    hits = [p.id for p in world.places.values() if (p.name or "").strip() == name.strip()]
    return hits[0] if hits else None


def _own(world: World, summary: str | None) -> tuple[str | None, twm.Journey | None]:
    m = _SUMMARY.match((summary or "").strip())
    if not m or m.group(1) not in twm.WALKING:
        return None, None
    a, b = _place_id(world, m.group(2)), _place_id(world, m.group(3))
    if not a or not b:
        return m.group(1), None
    return m.group(1), twm.Journey(from_id=a, to_id=b, profile=m.group(1))


def _confirmed(st) -> bool:
    return st.status == "confirmed"


def _reached(st) -> bool:
    return st.status in twm.REACHED


def fact_impact(
    world: World, element_id: str, attribute: str, summary: str | None = None, prior=None
) -> FactImpact:
    profile, own = _own(world, summary)
    profile = profile or "wheelchair"
    edge = world.edges.get(element_id)
    if edge is None or attribute not in twm.CHECKED_ATTRS:
        return FactImpact(
            element_id=element_id, attribute=attribute, mode="none", profile=profile, sampled=0
        )
    journeys = ([own] if own else []) + [
        j for j in twm.suite_journeys(world, profile)[:SAMPLE] if not own or j != own
    ]
    claim = edge.claims.get(attribute)
    verified = bool(
        claim
        and claim.status == "verified"
        and (claim.evidence_type or "") not in _belief.EXCLUDED_EVIDENCE
    )
    bel = _belief.build(world, prior)
    out = FactImpact(
        element_id=element_id,
        attribute=attribute,
        mode="did" if verified else "would",
        profile=profile,
        sampled=len(journeys),
        belief_q=round(bel.q(edge.type, attribute), 3),
    )
    with eval_memo():
        now = twm.rollout(world, None, journeys)
        if verified:
            before_world = twm.apply(
                world, [twm.ForgetFact(element_id=element_id, attribute=attribute)]
            ).world
            before = twm.rollout(before_world, None, journeys)
            out.changed = sum(a.status != b.status for a, b in zip(before, now, strict=True))
            out.became_confirmed = sum(
                _confirmed(b) and not _confirmed(a) for a, b in zip(before, now, strict=True)
            )
            out.belief_q_before = round(
                _belief.build(before_world, prior).q(edge.type, attribute), 3
            )
            if own:
                out.own = OwnJourney(
                    from_name=world.places[own.from_id].name,
                    to_name=world.places[own.to_id].name,
                    statuses={"before": before[0].status, "now": now[0].status},
                )
        else:
            acts = {
                o: [twm.VerifyFact(element_id=element_id, attribute=attribute, outcome=o)]
                for o in ("pass", "fail")
            }
            passed = twm.rollout(twm.apply(world, acts["pass"]).world, None, journeys, True)
            failed = twm.rollout(twm.apply(world, acts["fail"]).world, None, journeys, True)
            out.became_confirmed = sum(
                _confirmed(p) and not _confirmed(n) for n, p in zip(now, passed, strict=True)
            )
            out.lost_route = sum(
                _reached(n) and not _reached(f) for n, f in zip(now, failed, strict=True)
            )
            if own:
                out.own = OwnJourney(
                    from_name=world.places[own.from_id].name,
                    to_name=world.places[own.to_id].name,
                    statuses={
                        "now": now[0].status,
                        "pass": passed[0].status,
                        "fail": failed[0].status,
                    },
                )
                out.own_other_checks = passed[0].unknowns
    return out
