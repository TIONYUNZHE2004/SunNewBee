"""Verify-next planner: which unchecked facts should staff verify first?

Value of information on the Township World Model (docs/superpowers/specs/
2026-10-16-verify-next-planner-design.md). Almost every real route crosses many unchecked
facts, so flipping one fact rarely changes a journey: the objective needs *all* facts on a
route (not submodular). The planner therefore covers **route bundles** greedily:

1. For each `partly_unverified` sample journey, take the checkable unknown facts on its route.
2. Repeatedly pick the journey with the best ratio until the budget runs out. The ratio is the
   journeys newly covered divided by the new facts needed.
3. Verify the plan with the engine: `twm.compare` with `VerifyFact(pass)` on every selected
   fact. The reported number is the simulated one ("would be confirmed if they pass"), never
   the greedy estimate.

The belief (`belief.py`) adds an expected value for staff planning. Greedy carries no guarantee
(optimal probing is PSPACE-complete, Canadian Traveller variants).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from . import flood, twm
from .belief import Belief
from .belief import build as build_belief
from .routing import CENTRE_PREFIX, eval_memo, plan_route
from .world import World

DISCLAIMER = (
    "Survey plan from the township model: journeys would be confirmed only if they pass when "
    "staff check these facts on site. A planning estimate, not a promise."
)
MAX_BUDGET = 40
SUITE_SAMPLE = 60  # same deterministic sample as chat what-ifs (tools.SUITE_SAMPLE)


@dataclass(frozen=True)
class Fact:
    element_id: str
    attribute: str


@dataclass
class _Bundle:
    journey: twm.Journey
    facts: frozenset[Fact]
    edge_types: dict[Fact, str] = field(default_factory=dict)


class PlanFact(BaseModel):
    element_id: str
    attribute: str
    label: str
    path_label: str  # where: "the street on Jalan Bidara 10" (group checks by place on site)
    check: str  # what: "incline" / "steps" / "width" / "sidewalk"
    journeys_relying: int  # sample journeys in the plan whose route needs this fact
    ticket_id: str | None = None  # an open verification request for it, if any
    q: float  # belief that it passes (planning estimate only)


class VerificationPlan(BaseModel):
    profile: str
    scope: str
    budget: int
    facts: list[PlanFact]
    summary: dict[str, int]  # from twm.compare: total, confirmed_before/after, reach_*, changed
    expected_confirmed: float
    belief_sources: dict[str, int]
    evidence_id: str
    disclaimer: str = DISCLAIMER


def _route(world: World, j: twm.Journey):
    if j.to_id == twm.NEAREST_CENTRE:
        rows = flood.centres_reachability(world, None, j.profile, j.from_id, top_routes=1)
        reach = [r for r in rows if r.reachable]
        if not reach:
            return None
        rr = plan_route(world, j.from_id, f"{CENTRE_PREFIX}{reach[0].centre.id}", j.profile)
    else:
        rr = plan_route(world, j.from_id, j.to_id, j.profile)
    return rr.routes[0] if rr.routes and rr.status == "partly_unverified" else None


def _bundles(world: World, journeys: list[twm.Journey]) -> list[_Bundle]:
    out = []
    with eval_memo():
        for j in journeys:
            r = _route(world, j)
            if r is None or r.rest_points_unverified:
                continue  # nothing to verify, or rest points (places) are out of v1 scope
            facts = {Fact(u["element_id"], u["attribute"]) for u in r.unknowns}
            if not facts or any(f.attribute not in twm.CHECKED_ATTRS for f in facts):
                continue  # e.g. "possibly flooded": no site check can confirm that
            types = {
                f: world.edges[f.element_id].type for f in facts if f.element_id in world.edges
            }
            out.append(_Bundle(journey=j, facts=frozenset(facts), edge_types=types))
    return out


def candidate_facts(world: World, journeys: list[twm.Journey]) -> set[Fact]:
    return {f for b in _bundles(world, journeys) for f in b.facts}


def _greedy(bundles: list[_Bundle], budget: int) -> list[Fact]:
    chosen: list[Fact] = []
    have: set[Fact] = set()
    covered: set[int] = set()
    while True:
        best = None
        for i, b in enumerate(bundles):
            if i in covered:
                continue
            need = b.facts - have
            if not need:
                covered.add(i)
                continue
            if len(chosen) + len(need) > budget:
                continue
            after = have | need
            gain = sum(1 for k, c in enumerate(bundles) if k not in covered and c.facts <= after)
            key = (gain / len(need), -len(need), -i)
            if best is None or key > best[0]:
                best = (key, need)
        if best is None:
            return chosen
        new = sorted(best[1], key=lambda f: (f.element_id, f.attribute))
        chosen += new
        have |= set(new)


def plan_verifications(
    world: World,
    profile: str,
    scope: str = "suite",
    budget: int = 10,
    open_tickets: dict[tuple[str, str], str] | None = None,
    prior: dict | None = None,
    belief: Belief | None = None,
) -> VerificationPlan:
    budget = max(1, min(budget, MAX_BUDGET))
    journeys = (
        twm.evacuation_journeys(world, profile)
        if scope == "evacuation"
        else twm.suite_journeys(world, profile)[:SUITE_SAMPLE]
    )
    bundles = _bundles(world, journeys)
    chosen = _greedy(bundles, budget)
    bel = belief or build_belief(world, prior)
    acts = [twm.VerifyFact(element_id=f.element_id, attribute=f.attribute) for f in chosen]
    res = twm.compare(world, acts, journeys, max_actions=MAX_BUDGET)
    have = set(chosen)
    planned = [b for b in bundles if b.facts <= have]
    types = {f: t for b in bundles for f, t in b.edge_types.items()}
    expected = 0.0
    for b in planned:
        p = 1.0
        for f in b.facts:
            p *= bel.q(types.get(f, "path"), f.attribute)
        expected += p
    tickets = open_tickets or {}
    facts = [
        PlanFact(
            element_id=f.element_id,
            attribute=f.attribute,
            label=_label(world, f),
            path_label=twm.path_label(world, f.element_id),
            check=twm._ATTR_WORDS.get(f.attribute, f.attribute),
            journeys_relying=sum(1 for b in planned if f in b.facts),
            ticket_id=tickets.get((f.element_id, f.attribute)),
            q=round(bel.q(types.get(f, "path"), f.attribute), 3),
        )
        for f in chosen
    ]
    return VerificationPlan(
        profile=profile,
        scope=scope,
        budget=budget,
        facts=facts,
        summary=res.summary,
        expected_confirmed=round(min(expected, res.summary["confirmed_after"]), 2),
        belief_sources=bel.sources,
        evidence_id=res.evidence.id.replace("ev-whatif-", "ev-plan-"),
    )


def _label(world: World, f: Fact) -> str:
    act = twm.VerifyFact(element_id=f.element_id, attribute=f.attribute)
    return twm.describe(world, act).replace(" (passes)", "")


def plan_payload(plan: VerificationPlan) -> dict[str, Any]:
    return plan.model_dump(mode="json")
