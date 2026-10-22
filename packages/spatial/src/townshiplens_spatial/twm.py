"""Township World Model: actions, a pure transition, journey rollouts and what-if diffs.

The township's state is the `World`: the walk graph, every claim with its status, staff
closures, and the flood stage chosen per question. This module turns the state into a world
model in the planning sense:

- **actions:** a closed vocabulary of interventions and events (`Action`);
- **transition:** `apply(world, actions) -> Imagined`, a copy-on-write imagined world;
- **rollouts:** `rollout(...)`, the same routing engine run over a set of journeys;
- **diffs:** `compare(...)`, real versus imagined, for planners and the agent.

The language model may *propose* actions. `legal()` gates every one, and only the engine
computes outcomes (see docs/02-research/world-models-2026.md).

Honesty rules:
- The live world is never mutated: an imagined world shares only the immutable graph topology.
- Imagined claims and closures are tagged `whatif`.
- An outcome that rests on an imagined change is `whatif=True` ("would be confirmed").
- A river stage is a scenario, not an imagined fix: it only adds FAIL/UNKNOWN, as everywhere else.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from . import flood
from .attributes import ATTRIBUTE_TYPES, validate_value
from .evaluate import _CHECKS, SIDEWALK_TYPES
from .models import Claim, Closure, Evidence
from .routing import CENTRE_PREFIX, eval_memo, plan_route
from .world import World

WHATIF = "whatif"  # evidence_type / closure source of every imagined change
DISCLAIMER = (
    "What-if simulation of the township model, not a forecast or a plan. "
    "Imagined changes are not real; unverified facts stay unverified."
)
CHECKED_ATTRS = {attr for attr, _ in _CHECKS.values()} | {"sidewalk"}
MAX_ACTIONS = 8
MAX_JOURNEYS = 300
NEAREST_CENTRE = "__nearest_centre__"  # Journey.to_id: the nearest reachable evacuation centre
REACHED = ("confirmed", "likely_ok", "partly_unverified")
# What-ifs cover the walking profiles (a drive what-if would be both slow and off-topic).
WALKING = ("default", "stroller", "wheelchair", "older_adult_rest")


# ---- actions ---------------------------------------------------------------------------------


class SetRiverStage(BaseModel):
    """River rise scenario (indicative stages only; a stage never upgrades anything)."""

    kind: Literal["set_river_stage"] = "set_river_stage"
    scenario_id: str


class ClosePath(BaseModel):
    """Imagine a path closed (works, an event, a fallen tree)."""

    kind: Literal["close_path"] = "close_path"
    element_id: str


class BuildRamp(BaseModel):
    """Imagine a capital work: the path rebuilt step-free (steps become a ramp)."""

    kind: Literal["build_ramp"] = "build_ramp"
    element_id: str


class AssumeFact(BaseModel):
    """Imagine one recorded fact on a path, e.g. width_m = 1.2."""

    kind: Literal["assume_fact"] = "assume_fact"
    element_id: str
    attribute: str
    value: Any


class VerifyFact(BaseModel):
    """Imagine staff verifying a fact: it passes every profile's limit, or it fails."""

    kind: Literal["verify_fact"] = "verify_fact"
    element_id: str
    attribute: str
    outcome: Literal["pass", "fail"] = "pass"


class RaisePaths(BaseModel):
    """Imagine a capital work against floods: these path segments rebuilt above the township's
    indicative flood levels (they no longer flood in any scenario). Imagined only: the real flood
    data is never changed, and nothing says the real path is above any water level."""

    kind: Literal["raise_paths"] = "raise_paths"
    element_ids: list[str] = Field(min_length=1, max_length=40)
    label: str | None = Field(default=None, max_length=80)


Action = Annotated[
    SetRiverStage | ClosePath | BuildRamp | AssumeFact | VerifyFact | RaisePaths,
    Field(discriminator="kind"),
]


class ForgetFact(BaseModel):
    """Internal (never offered to the language model): imagine a fact as never checked, to see
    what its verification changed (ticket impact)."""

    kind: Literal["forget_fact"] = "forget_fact"
    element_id: str
    attribute: str


class IllegalAction(ValueError):
    pass


def legal(world: World, a: Any) -> str | None:
    """None when `a` can be applied to `world`, else a readable reason (never applied)."""
    if isinstance(a, SetRiverStage):
        known = {s.id for s in world.flood.scenarios}
        return None if a.scenario_id in known else f"unknown scenario {a.scenario_id!r}"
    if isinstance(a, RaisePaths):
        flooded = {e for m in world.flood.edge_classes.values() for e in m}
        for eid in a.element_ids:
            if eid not in world.edges:
                return f"unknown path {eid!r}"
            if eid not in flooded:
                return f"{eid} does not flood in any scenario: nothing to raise"
        return None
    if a.element_id not in world.edges:
        return f"unknown path {a.element_id!r}"
    if isinstance(a, BuildRamp) and not _has_steps(world.edges[a.element_id]):
        return "build_ramp needs a path with steps (use assume_fact for other changes)"
    if isinstance(a, AssumeFact):
        if a.attribute not in ATTRIBUTE_TYPES:
            return f"unknown attribute {a.attribute!r}"
        if err := validate_value(a.attribute, a.value):
            return f"wrong value type: {err}"
    if isinstance(a, VerifyFact) and a.attribute not in CHECKED_ATTRS:
        return f"{a.attribute!r} is not checked by any profile"
    return None


def _has_steps(edge) -> bool:
    c = edge.claims.get("step_count")
    return edge.type == "steps" or bool(c and isinstance(c.value, int | float) and c.value > 0)


# ---- transition ------------------------------------------------------------------------------


@dataclasses.dataclass
class Imagined:
    world: World
    scenario_id: str | None
    actions: list[Any]
    touched: list[str]  # edges an imagined (non-stage) action changed
    imagined: bool  # any non-stage action applied


def _walking(world: World):
    return [p for p in world.profiles.values() if p.allowed_types is None]


def _passing(world: World, attr: str) -> Any:
    """A value that passes every walking profile's limit for `attr`."""
    hard = [p.hard for p in _walking(world)]
    if attr == "step_count":
        return 0
    if attr == "incline_pct":
        return min((h["max_incline_pct"] for h in hard if "max_incline_pct" in h), default=5.0)
    if attr == "width_m":
        return round(max((h.get("min_width_m", 0.0) for h in hard), default=0.9) + 0.3, 2)
    if attr == "sidewalk":
        return "both"
    return None


def _failing(world: World, attr: str) -> Any:
    """A value that breaks the strictest walking profile's limit for `attr`."""
    hard = [p.hard for p in _walking(world)]
    if attr == "step_count":
        return 3
    if attr == "incline_pct":
        return max((h["max_incline_pct"] for h in hard if "max_incline_pct" in h), default=8) + 6
    if attr == "width_m":
        return 0.5
    return "none"  # sidewalk


def _claim(value: Any) -> Claim:
    return Claim(
        value=value,
        status="verified",
        verified_at=date.today().isoformat(),
        evidence_type=WHATIF,
        notes="Imagined in a what-if; not a real record.",
    )


def apply(world: World, actions: list[Any], max_actions: int = MAX_ACTIONS) -> Imagined:
    """The transition function: apply `actions` in order to a copy of `world`. `max_actions`
    caps model- or user-proposed lists; engine planners (planner.py) pass their own budget."""
    if len(actions) > max_actions:
        raise IllegalAction(f"at most {max_actions} actions")
    for a in actions:
        if reason := legal(world, a):
            raise IllegalAction(reason)
    edges = dict(world.edges)
    copied: dict[str, Any] = {}

    def edge(eid: str):
        if eid not in copied:
            copied[eid] = edges[eid] = world.edges[eid].model_copy(deep=True)
        return copied[eid]

    scenario_id: str | None = None
    flood = world.flood
    for a in actions:
        if isinstance(a, SetRiverStage):
            scenario_id = None if a.scenario_id == "baseline" else a.scenario_id
            continue
        if isinstance(a, RaisePaths):
            raised = set(a.element_ids)
            flood = flood.model_copy(
                update={
                    "edge_classes": {
                        sid: {k: v for k, v in m.items() if k not in raised}
                        for sid, m in flood.edge_classes.items()
                    },
                    # place classes stay: a place is not raised with the paths beside it
                }
            )
            for eid in a.element_ids:
                edge(eid)  # a new object, so batch memos evaluate it afresh
            continue
        e = edge(a.element_id)
        if isinstance(a, ClosePath):
            e.closures = [
                *e.closures,
                Closure(
                    id=f"{WHATIF}-{e.id}",
                    element_id=e.id,
                    reason="other",
                    starts_at=datetime(2000, 1, 1, tzinfo=UTC),
                    created_by=WHATIF,
                    source=WHATIF,
                ),
            ]
        elif isinstance(a, BuildRamp):
            if e.type == "steps":
                e.type = "ramp"
            attrs = ["step_count", "incline_pct", "width_m"]
            if e.type in SIDEWALK_TYPES:
                attrs.append("sidewalk")
            e.claims = {**e.claims, **{k: _claim(_passing(world, k)) for k in attrs}}
        elif isinstance(a, AssumeFact):
            e.claims = {**e.claims, a.attribute: _claim(a.value)}
        elif isinstance(a, ForgetFact):
            e.claims = {**e.claims, a.attribute: Claim(status="unknown", evidence_type=WHATIF)}
        elif isinstance(a, VerifyFact):
            value = (_passing if a.outcome == "pass" else _failing)(world, a.attribute)
            if a.attribute == "step_count" and a.outcome == "pass" and e.type == "steps":
                e.type = "ramp"  # verified step-free: the "steps" type no longer applies
            e.claims = {**e.claims, a.attribute: _claim(value)}
    touched = sorted(copied)
    return Imagined(
        world=dataclasses.replace(world, edges=edges, flood=flood),
        scenario_id=scenario_id,
        actions=list(actions),
        touched=touched,
        imagined=bool(touched),
    )


# ---- rollouts and diffs ----------------------------------------------------------------------


class Journey(BaseModel):
    from_id: str
    to_id: str
    profile: str


class RouteState(BaseModel):
    status: str  # confirmed | partly_unverified | blocked | no_data
    route_id: str | None = None
    distance_m: float | None = None
    est_minutes: float | None = None
    segment_ids: list[str] = Field(default_factory=list)
    unknowns: int = 0
    geometry: dict[str, Any] | None = None
    target_name: str | None = None  # the destination (for evacuation: the centre reached)
    # True when this state is in an imagined world (any non-stage action): "would be ...".
    whatif: bool = False
    # The route rests on demo values (team_survey_placeholder): "demo values, not yet surveyed".
    demo_evidence: bool = False


class JourneyOutcome(BaseModel):
    journey: Journey
    before: RouteState
    after: RouteState


class WhatIfResult(BaseModel):
    actions: list[Action]
    scenario_id: str | None  # the stage of the imagined ("after") state
    base_scenario_id: str | None = None  # the stage of the "before" state (the one on screen)
    journeys: list[JourneyOutcome]
    changed: list[JourneyOutcome]
    counts_before: dict[str, dict[str, int]]
    counts_after: dict[str, dict[str, int]]
    touched: list[str]
    evidence: Evidence
    # Headline numbers the agent may say (the validator checks spoken numbers against these):
    # total journeys, reached (confirmed + partly unverified) before/after, confirmed before/after,
    # changed journeys.
    summary: dict[str, int] = Field(default_factory=dict)
    disclaimer: str = DISCLAIMER


def _name(world: World, place_id: str) -> str | None:
    if place_id.startswith(CENTRE_PREFIX):
        c = world.centres.get(place_id.removeprefix(CENTRE_PREFIX))
        return c.name if c else None
    p = world.places.get(place_id)
    return p.name if p else None


def _route_state(world, rr, to_id: str, imagined: bool) -> RouteState:
    r0 = rr.routes[0] if rr.routes else None
    return RouteState(
        status=rr.status,
        route_id=r0.id if r0 else None,
        distance_m=r0.distance_m if r0 else None,
        est_minutes=r0.est_minutes if r0 else None,
        segment_ids=[s.edge_id for s in r0.segments] if r0 else [],
        unknowns=len(r0.unknowns) if r0 else 0,
        geometry=r0.geometry if r0 else None,
        target_name=_name(world, to_id),
        whatif=imagined,
        demo_evidence=bool(r0 and r0.demo_evidence),
    )


def _evac_state(world: World, j: Journey, scenario_id: str | None, imagined: bool) -> RouteState:
    """The nearest reachable centre (same logic as list_evacuation_centres and sim.py)."""
    rows = flood.centres_reachability(world, scenario_id, j.profile, j.from_id, top_routes=1)
    reach = [r for r in rows if r.reachable]
    if reach:
        to_id = f"{CENTRE_PREFIX}{reach[0].centre.id}"
        rr = plan_route(world, j.from_id, to_id, j.profile, scenario_id)
        if rr.routes:
            return _route_state(world, rr, to_id, imagined)
    status = "blocked" if any(r.route_status in ("blocked", "closed") for r in rows) else "no_data"
    return RouteState(status=status, whatif=imagined)


def _state(world: World, j: Journey, scenario_id: str | None, imagined: bool) -> RouteState:
    if j.to_id == NEAREST_CENTRE:
        return _evac_state(world, j, scenario_id, imagined)
    rr = plan_route(world, j.from_id, j.to_id, j.profile, scenario_id)
    return _route_state(world, rr, j.to_id, imagined)


def suite_journeys(world: World, profile: str) -> list[Journey]:
    """The standard resident journeys (car parks and stops -> facilities) for one profile."""
    from .sim import default_tasks

    # The same origin -> destination pairs for every walking profile (the sim's task list).
    pairs = dict.fromkeys((t["from_id"], t["to_id"]) for t in default_tasks(world, ["wheelchair"]))
    return [Journey(from_id=o, to_id=d, profile=profile) for o, d in pairs]


def evacuation_journeys(world: World, profile: str, n: int | None = None) -> list[Journey]:
    """Seeded sample of origins (sim.evacuation_origins), each to its nearest reachable centre."""
    from .sim import EVAC_N, evacuation_origins

    return [
        Journey(from_id=o, to_id=NEAREST_CENTRE, profile=profile)
        for o in evacuation_origins(world, n or EVAC_N)
    ]


def rollout(
    world: World, scenario_id: str | None, journeys: list[Journey], imagined: bool = False
) -> list[RouteState]:
    return [_state(world, j, scenario_id, imagined) for j in journeys[:MAX_JOURNEYS]]


def _counts(states: list[tuple[Journey, RouteState]]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for j, s in states:
        per = out.setdefault(j.profile, {})
        per[s.status] = per.get(s.status, 0) + 1
    return out


def _evidence_id(
    actions: list[Any], journeys: list[Journey], world: World, base: str | None = None
) -> str:
    blob = json.dumps(
        [
            [a.model_dump(mode="json") for a in actions],
            [j.model_dump() for j in journeys],
            world.version,
            base,
        ],
        sort_keys=True,
    )
    return "ev-whatif-" + hashlib.sha1(blob.encode()).hexdigest()[:10]


def compare(
    world: World,
    actions: list[Any],
    journeys: list[Journey],
    base_scenario_id: str | None = None,
    max_actions: int = MAX_ACTIONS,
) -> WhatIfResult:
    """Roll the journeys out in the real state (with the scenario on screen, if any) and in the
    imagined one, and diff them. Deterministic for the same world version and inputs."""
    journeys = journeys[:MAX_JOURNEYS]
    im = apply(world, actions, max_actions)
    sid_after = (
        im.scenario_id if any(isinstance(a, SetRiverStage) for a in actions) else base_scenario_id
    )
    staged = any(isinstance(a, SetRiverStage) for a in actions)
    with eval_memo():
        before = rollout(world, base_scenario_id, journeys)
        after = rollout(im.world, sid_after, journeys, imagined=im.imagined)
        # River rise plus interventions: also the river alone, so the intervention's own effect
        # under the flood can be told apart from the flood's.
        stage_only = rollout(world, sid_after, journeys) if staged and im.imagined else None
    outcomes = [
        JourneyOutcome(journey=j, before=b, after=a)
        for j, b, a in zip(journeys, before, after, strict=True)
    ]
    eid = _evidence_id(actions, journeys, world, base_scenario_id)
    changed = [o for o in outcomes if o.before.status != o.after.status]
    summary = {
        "total": len(outcomes),
        "reach_before": sum(o.before.status in REACHED for o in outcomes),
        "reach_after": sum(o.after.status in REACHED for o in outcomes),
        "confirmed_before": sum(o.before.status == "confirmed" for o in outcomes),
        "confirmed_after": sum(o.after.status == "confirmed" for o in outcomes),
        "changed": len(changed),
        # confirmed only on demo values (placeholder evidence): the answer must say so
        "confirmed_on_demo_after": sum(
            o.after.status == "confirmed" and o.after.demo_evidence for o in outcomes
        ),
    }
    if stage_only is not None:
        summary["reach_stage_only"] = sum(st.status in REACHED for st in stage_only)
        summary["confirmed_stage_only"] = sum(st.status == "confirmed" for st in stage_only)
    return WhatIfResult(
        actions=actions,
        scenario_id=sid_after,
        base_scenario_id=base_scenario_id,
        journeys=outcomes,
        changed=changed,
        summary=summary,
        counts_before=_counts([(o.journey, o.before) for o in outcomes]),
        counts_after=_counts([(o.journey, o.after) for o in outcomes]),
        touched=im.touched,
        evidence=Evidence(
            id=eid,
            element_id="whatif",
            attribute="whatif",
            value={"actions": len(actions), "journeys": len(journeys)},
            status="indicative",
            source_type=WHATIF,
        ),
    )


# ---- engine-suggested interventions ----------------------------------------------------------


SUGGEST_TASKS = 60  # journeys scanned for suggestions (deterministic prefix of the suite)


def suggest_actions(
    world: World, profile: str, limit: int = 6, near_place: str | None = None
) -> list[Any]:
    """Candidate interventions from the engine (never from the model), most-shared first:

    - steps that block `profile` on the standard journeys -> build_ramp;
    - unknown facts those journeys cross -> verify_fact pass (one per path).

    With `near_place`, only journeys to or from that place are scanned. Every suggestion is
    legal by construction."""
    from .evaluate import evaluate_edge

    prof = world.profiles.get(profile)
    if prof is None:
        return []
    journeys = suite_journeys(world, profile)
    if near_place:
        journeys = [j for j in journeys if near_place in (j.from_id, j.to_id)] or [
            Journey(from_id=p.id, to_id=near_place, profile=profile)
            for p in sorted(world.places.values(), key=lambda p: p.id)
            if p.id != near_place and p.type in {"parking", "drop_off", "bus_stop"}
        ]
    steps: dict[str, int] = {}
    unknown: dict[str, tuple[int, str]] = {}  # edge -> (count, first attribute)
    with eval_memo():
        for j in journeys[:SUGGEST_TASKS]:
            rr = plan_route(world, j.from_id, j.to_id, profile, None)
            for r in rr.routes[:1]:
                for u in r.unknowns:
                    if u["attribute"] in CHECKED_ATTRS:
                        n, attr = unknown.get(u["element_id"], (0, u["attribute"]))
                        unknown[u["element_id"]] = (n + 1, attr)
            if rr.status in ("blocked", "partly_unverified"):
                lenient = plan_route(world, j.from_id, j.to_id, "default", None)
                for r in lenient.routes[:1]:
                    for s in r.segments:
                        e = world.edges.get(s.edge_id)
                        if (
                            e is not None
                            and e.type == "steps"
                            and evaluate_edge(e, prof)[0] == "FAIL"
                        ):
                            steps[e.id] = steps.get(e.id, 0) + 1
    out: list[Any] = [
        BuildRamp(element_id=eid)
        for eid, _ in sorted(steps.items(), key=lambda kv: (-kv[1], kv[0]))
    ]
    out += [
        VerifyFact(element_id=eid, attribute=attr)
        for eid, (_, attr) in sorted(unknown.items(), key=lambda kv: (-kv[1][0], kv[0]))
    ]
    return out[:limit]


# ---- readable labels (resident-facing; no ids, no attribute keys) ------------------------------

_ATTR_WORDS = {
    "step_count": "steps",
    "incline_pct": "incline",
    "width_m": "width",
    "sidewalk": "sidewalk",
}
_TYPE_WORDS = {"steps": "steps", "major_road": "major road", "pedestrian": "pedestrian path"}


def path_label(world: World, element_id: str) -> str:
    e = world.edges.get(element_id)
    if e is None:
        return "an unknown path"
    kind = _TYPE_WORDS.get(e.type, e.type.replace("_", " "))
    if e.name and e.name.strip():
        return f"the {kind} on {e.name.strip()}"
    return f"an unnamed {kind}" if kind != "steps" else "a set of unnamed steps"


def describe(world: World, a: Any) -> str:
    """One readable line per action, for the agent, the template and the UI."""
    if isinstance(a, SetRiverStage):
        sc = next((s for s in world.flood.scenarios if s.id == a.scenario_id), None)
        if sc is None or a.scenario_id == "baseline":
            return "River at its normal level"
        if sc.kind != "river_stage":
            return sc.label
        return f"River +{sc.stage_m:g} m (indicative scenario)"
    if isinstance(a, RaisePaths):
        n = len(a.element_ids)
        m = sum(world.edges[e].length_m for e in a.element_ids if e in world.edges)
        what = a.label or f"{n} flooded path segment{'s' if n != 1 else ''}"
        return (
            f"Imagine {what} (about {m:.0f} m) raised so it never floods in any scenario "
            "(best case)"
        )
    where = path_label(world, a.element_id)
    if isinstance(a, ClosePath):
        return f"Close {where}"
    if isinstance(a, BuildRamp):
        return f"Build a step-free ramp at {where}"
    if isinstance(a, AssumeFact):
        word = _ATTR_WORDS.get(a.attribute, a.attribute.replace("_", " "))
        return f"Assume the {word} of {where} is {a.value}"
    word = _ATTR_WORDS.get(a.attribute, a.attribute.replace("_", " "))
    return f"Staff verify the {word} of {where} ({'passes' if a.outcome == 'pass' else 'fails'})"


def keystone_paths(world: World, profile: str, near_place: str | None = None, limit: int = 3):
    """Paths the most sample journeys rely on: candidates for "what if this closes?"."""
    journeys = suite_journeys(world, profile)
    if near_place:
        journeys = [j for j in journeys if near_place in (j.from_id, j.to_id)]
    use: dict[str, int] = {}
    with eval_memo():
        for j in journeys[:SUGGEST_TASKS]:
            rr = plan_route(world, j.from_id, j.to_id, profile, None)
            for r in rr.routes[:1]:
                for s in r.segments:
                    use[s.edge_id] = use.get(s.edge_id, 0) + 1
    ranked = sorted(use.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]
    return [(ClosePath(element_id=eid), n) for eid, n in ranked]
