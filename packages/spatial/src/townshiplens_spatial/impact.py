"""Ticket impact: what one verification would change, or did change (Cycle 7).

Value of information on one ticket, by rollout on the world model:

- **Open ticket:** the sampled journeys with the fact as it is now, imagined passing, and
  imagined failing. The result is how many would become confirmed, and how many would lose
  their route.
- **Resolved ticket:** the world as it is now against an imagined world where the fact was never
  checked (`twm.ForgetFact`). The result is how many journeys the check changed.

The journeys are the profile's first everyday trips; the ticket's own journey (parsed from
"<profile> route <A> -> <B>", only when both names are unambiguous) is reported separately.
Counts only; nothing is stored or shown to residents.
"""

from __future__ import annotations

import re

from pydantic import BaseModel

from . import belief as _belief
from . import twm
from .evaluate import _CHECKS
from .routing import CENTRE_PREFIX, eval_memo
from .world import World

SAMPLE = 20
_SUMMARY = re.compile(r"^(\w+) route (.+)$")
_ARROW = " -> "
# A ticket that does not name a profile: the first walking profile whose rules use the fact.
_PROFILE_ORDER = ("wheelchair", "stroller", "older_adult_rest", "default")
_HARD_ATTR = {key: attr for key, (attr, _) in _CHECKS.items()}


class OwnJourney(BaseModel):
    from_name: str
    to_name: str
    statuses: dict[str, str]  # "now" / "pass" / "fail" (open) or "before" / "now" (resolved)
    # The route on screen rests on demo values (team_survey_placeholder), not yet surveyed.
    demo_values: bool = False


class FactImpact(BaseModel):
    element_id: str
    attribute: str
    # "would" (an open ticket: what a pass or a fail would do), "did" (resolved and verified:
    # what the check changed), "none" (not a path fact, or resolved without a counted
    # verification; `note` says which).
    mode: str
    profile: str
    profile_assumed: bool = False  # the ticket did not name a profile
    sampled: int  # everyday journeys sampled, not counting the ticket's own journey
    became_confirmed: int = 0  # open: if it passes; resolved: because it was checked
    lost_route: int = 0  # open: if it fails; resolved: journeys the check cut
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


def _endpoint_id(world: World, name: str) -> str | None:
    """A place or centre with exactly this name; an ambiguous name gives None (no guessing)."""
    name = name.strip()
    hits = [p.id for p in world.places.values() if (p.name or "").strip() == name]
    hits += [
        f"{CENTRE_PREFIX}{c.id}" for c in world.centres.values() if (c.name or "").strip() == name
    ]
    return hits[0] if len(hits) == 1 else None


def _own(world: World, summary: str | None) -> tuple[str | None, twm.Journey | None]:
    m = _SUMMARY.match((summary or "").strip())
    if not m or m.group(1) not in twm.WALKING:
        return None, None
    profile, rest = m.group(1), m.group(2)
    found = []  # every split of "A -> B" whose two sides both name one known endpoint
    at = rest.find(_ARROW)
    while at != -1:
        a, b = _endpoint_id(world, rest[:at]), _endpoint_id(world, rest[at + len(_ARROW) :])
        if a and b:
            found.append((a, b))
        at = rest.find(_ARROW, at + 1)
    if len(found) != 1:
        return profile, None
    a, b = found[0]
    return profile, twm.Journey(from_id=a, to_id=b, profile=profile)


def _default_profile(world: World, attribute: str) -> str:
    for p in _PROFILE_ORDER:
        prof = world.profiles.get(p)
        if prof is None:
            continue
        if attribute == "sidewalk" or any(_HARD_ATTR.get(k) == attribute for k in prof.hard):
            return p
    return "wheelchair"


def _confirmed(st) -> bool:
    return st.status == "confirmed"


def _reached(st) -> bool:
    return st.status in twm.REACHED


def fact_impact(
    world: World,
    element_id: str,
    attribute: str,
    summary: str | None = None,
    prior=None,
    ticket_status: str = "open",
) -> FactImpact:
    profile, own = _own(world, summary)
    assumed = profile is None
    profile = profile or _default_profile(world, attribute)
    edge = world.edges.get(element_id)
    base = {"element_id": element_id, "attribute": attribute, "profile": profile}
    base["profile_assumed"] = assumed
    if edge is None or attribute not in twm.CHECKED_ATTRS:
        return FactImpact(**base, mode="none", sampled=0, note="Not a path fact on the model.")
    suite = [j for j in twm.suite_journeys(world, profile)[:SAMPLE] if j != own]
    journeys = ([own] if own else []) + suite
    k = 1 if own else 0  # counts below are over the sample only; the own journey is separate
    claim = edge.claims.get(attribute)
    verified = bool(
        claim
        and claim.status == "verified"
        and (claim.evidence_type or "") not in _belief.EXCLUDED_EVIDENCE
    )
    if ticket_status == "resolved" and not verified:
        state = claim.status if claim else "unknown"
        return FactImpact(
            **base,
            mode="none",
            sampled=0,
            note=(
                f"Resolved, but the model does not count this fact as verified ({state}), "
                "so no change is counted."
            ),
        )
    bel = _belief.build(world, prior)
    out = FactImpact(
        **base,
        mode="did" if verified else "would",
        sampled=len(suite),
        belief_q=round(bel.q(edge.type, attribute), 3),
    )

    def own_journey(statuses: dict[str, str], demo: bool) -> OwnJourney:
        return OwnJourney(
            from_name=twm._name(world, own.from_id) or "a mapped place",
            to_name=twm._name(world, own.to_id) or "a mapped place",
            statuses=statuses,
            demo_values=demo,
        )

    with eval_memo():
        now = twm.rollout(world, None, journeys)
        if verified:
            before_world = twm.apply(
                world, [twm.ForgetFact(element_id=element_id, attribute=attribute)]
            ).world
            before = twm.rollout(before_world, None, journeys)
            pairs = list(zip(before[k:], now[k:], strict=True))
            out.changed = sum(a.status != b.status for a, b in pairs)
            out.became_confirmed = sum(_confirmed(b) and not _confirmed(a) for a, b in pairs)
            out.lost_route = sum(_reached(a) and not _reached(b) for a, b in pairs)
            out.belief_q_before = round(
                _belief.build(before_world, prior).q(edge.type, attribute), 3
            )
            if own:
                out.own = own_journey(
                    {"before": before[0].status, "now": now[0].status}, now[0].demo_evidence
                )
        else:
            acts = {
                o: [twm.VerifyFact(element_id=element_id, attribute=attribute, outcome=o)]
                for o in ("pass", "fail")
            }
            passed = twm.rollout(twm.apply(world, acts["pass"]).world, None, journeys, True)
            failed = twm.rollout(twm.apply(world, acts["fail"]).world, None, journeys, True)
            out.became_confirmed = sum(
                _confirmed(p) and not _confirmed(n)
                for n, p in zip(now[k:], passed[k:], strict=True)
            )
            out.lost_route = sum(
                _reached(n) and not _reached(f) for n, f in zip(now[k:], failed[k:], strict=True)
            )
            if own:
                out.own = own_journey(
                    {
                        "now": now[0].status,
                        "pass": passed[0].status,
                        "fail": failed[0].status,
                    },
                    now[0].demo_evidence or passed[0].demo_evidence,
                )
                out.own_other_checks = passed[0].unknowns
    return out
