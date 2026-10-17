"""Fix-it planner: which few changes would help the most? (Cycle 4)

"The LLM proposes, the world model disposes" (LLM-MCTS, FunSearch, Code World Models):

1. Candidates are *changes*, generated from the same journeys and river stage that are scored:
   - "check every unknown fact on this path" (strict profiles need all of them verified);
   - "build a ramp at these steps", for steps that block the profile on a journey's
     unconstrained route.

   Legal actions the language model proposes get reserved slots. Every action passes
   `twm.legal`, and only passing verifications or ramps count as fixes.
2. Beam search over sets of up to `budget` changes. Each set is scored by one rollout of its
   imagined world against a "before" computed once: confirmed journeys first, then journeys
   that still reach their destination.
3. The search has one time budget, which covers candidate generation too. A search that ran
   out of time before finding a helpful set is *inconclusive*, never "no change helps".

Search pattern after maitrix-org/llm-reasoners (Apache-2.0) `algorithm/beam_search.py`. That is
an inspiration only; no code is copied (see CREDITS.md). No costs are modelled.
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from pydantic import BaseModel, TypeAdapter, ValidationError

from . import flood, twm
from .evaluate import evaluate_edge
from .routing import CENTRE_PREFIX, eval_memo, plan_route
from .world import World

MAX_BUDGET = 3
MAX_ENGINE = 6  # engine candidates
MAX_PROPOSALS = 3  # reserved for the assistant's proposals
MAX_SECONDS = 20.0  # whole search, candidate generation included
JOURNEYS = 20  # sampled journeys per search (evacuation origins or everyday trips)
DISCLAIMER = (
    "What-if search on the township model: the best set of imagined changes, not a plan or a "
    "cost estimate. Imagined changes are not real; unverified facts stay unverified."
)


def key(a: Any) -> str:
    return json.dumps(a.model_dump(mode="json"), sort_keys=True)


class Candidate(BaseModel):
    actions: list[twm.Action]  # one change may be several facts on one path
    label: str
    source: str  # "engine" | "assistant"
    journeys: int = 0  # sample journeys whose route this change is on (engine candidates)


class FixSet(BaseModel):
    actions: list[twm.Action]
    labels: list[str]  # one per change
    summary: dict[str, int]
    score: int


class FixResult(BaseModel):
    profile: str
    scope: str
    stage: str | None
    budget: int
    best: FixSet
    runners_up: list[FixSet]  # sets that also improve on doing nothing
    candidates: list[Candidate]
    rejected: list[str]
    rollouts: int
    stopped_early: bool = False  # the time budget ran out before every set was scored
    conclusive: bool = True  # False: stopped early without finding a helpful set
    evidence_id: str
    disclaimer: str = DISCLAIMER


def _score(summary: dict[str, int]) -> int:
    return summary["confirmed_after"] * 1000 + summary["reach_after"]


def _journeys(world: World, profile: str, scope: str) -> list[twm.Journey]:
    if scope == "evacuation":
        return twm.evacuation_journeys(world, profile, JOURNEYS)
    return twm.suite_journeys(world, profile)[:JOURNEYS]


def _route(world, j: twm.Journey, profile: str, sid: str | None):
    if j.to_id == twm.NEAREST_CENTRE:
        rows = flood.centres_reachability(world, sid, profile, j.from_id, top_routes=1)
        reach = [r for r in rows if r.reachable]
        if not reach:
            return None
        to = f"{CENTRE_PREFIX}{reach[0].centre.id}"
    else:
        to = j.to_id
    rr = plan_route(world, j.from_id, to, profile, sid)
    return rr.routes[0] if rr.routes else None


def _engine_candidates(world, profile, journeys, sid, deadline) -> list[Candidate]:
    prof = world.profiles[profile]
    on_routes: dict[str, set[str]] = {}  # edge -> unknown checked attributes
    used: dict[str, int] = {}
    steps: dict[str, int] = {}
    for j in journeys:
        if time.monotonic() > deadline:
            break
        r = _route(world, j, profile, sid)
        if r is not None and r.status == "partly_unverified":
            for u in r.unknowns:
                if u["attribute"] in twm.CHECKED_ATTRS and u["element_id"] in world.edges:
                    on_routes.setdefault(u["element_id"], set()).add(u["attribute"])
            for e in {u["element_id"] for u in r.unknowns}:
                used[e] = used.get(e, 0) + 1
        if r is None or r.status != "confirmed":
            free = _route(world, j, "default", sid)
            for s in free.segments if free else []:
                e = world.edges.get(s.edge_id)
                if e is not None and e.type == "steps" and evaluate_edge(e, prof)[0] == "FAIL":
                    steps[e.id] = steps.get(e.id, 0) + 1
    out: list[Candidate] = []
    for eid, n in sorted(steps.items(), key=lambda kv: (-kv[1], kv[0])):
        a = twm.BuildRamp(element_id=eid)
        out.append(
            Candidate(actions=[a], label=twm.describe(world, a), source="engine", journeys=n)
        )
    for eid in sorted(on_routes, key=lambda e: (-used.get(e, 0), e)):
        acts = [twm.VerifyFact(element_id=eid, attribute=a) for a in sorted(on_routes[eid])]
        what = ", ".join(twm._ATTR_WORDS.get(a, a) for a in sorted(on_routes[eid]))
        label = f"Staff check {twm.path_label(world, eid)}: {what}"
        out.append(Candidate(actions=acts, label=label, source="engine", journeys=used.get(eid, 0)))
    return out[:MAX_ENGINE]


def _proposals(world, extra) -> tuple[list[Candidate], list[str]]:
    out: list[Candidate] = []
    rejected: list[str] = []
    adapter = TypeAdapter(twm.Action)
    for raw in extra or []:
        try:
            a = adapter.validate_python(raw)
        except ValidationError:
            rejected.append(f"invalid action {raw!r}"[:120])
            continue
        eid = getattr(a, "element_id", "?")
        if not (
            isinstance(a, twm.BuildRamp) or (isinstance(a, twm.VerifyFact) and a.outcome == "pass")
        ):
            rejected.append(f"{a.kind} on {eid} is not a fix (only ramps or passing checks)")
        elif reason := twm.legal(world, a):
            rejected.append(f"{eid}: {reason}")
        elif len(out) >= MAX_PROPOSALS:
            rejected.append(f"{eid}: dropped, at most {MAX_PROPOSALS} proposals are searched")
        else:
            out.append(Candidate(actions=[a], label=twm.describe(world, a), source="assistant"))
    return out, rejected


def find_fixes(
    world: World,
    profile: str,
    scope: str = "evacuation",
    stage: str | None = None,
    budget: int = 2,
    extra_actions: list[dict] | None = None,
    beam: int = 2,
    max_seconds: float = MAX_SECONDS,
) -> FixResult:
    started = time.monotonic()
    deadline = started + max_seconds
    budget = max(1, min(budget, MAX_BUDGET))
    stage = None if stage in (None, "", "baseline") else stage
    journeys = _journeys(world, profile, scope)
    rollouts = 0
    cache: dict[frozenset[int], FixSet] = {}
    today: list = []
    with eval_memo():  # one memo for the whole search: untouched edges are evaluated once
        proposed, rejected = _proposals(world, extra_actions)
        engine = _engine_candidates(world, profile, journeys, stage, deadline)
        cands: list[Candidate] = []
        seen: set[str] = set()
        for c in [*proposed, *engine]:
            k = json.dumps(sorted(key(a) for a in c.actions))
            if k not in seen:
                seen.add(k)
                cands.append(c)

        def evaluate(idx: frozenset[int]) -> FixSet:
            nonlocal rollouts
            if idx not in cache:
                chosen = [cands[i] for i in sorted(idx)]
                acts = [a for c in chosen for a in c.actions]
                rollouts += 1
                im = twm.apply(world, acts, max_actions=64)
                after = (
                    twm.rollout(im.world, stage, journeys, imagined=im.imagined) if acts else today
                )
                s = {
                    "total": len(journeys),
                    "reach_before": sum(st.status in twm.REACHED for st in today),
                    "reach_after": sum(st.status in twm.REACHED for st in after),
                    "confirmed_before": sum(st.status == "confirmed" for st in today),
                    "confirmed_after": sum(st.status == "confirmed" for st in after),
                    "changed": sum(a.status != b.status for a, b in zip(today, after, strict=True)),
                    "confirmed_on_demo_after": sum(
                        st.status == "confirmed" and st.demo_evidence for st in after
                    ),
                }
                cache[idx] = FixSet(
                    actions=acts, labels=[c.label for c in chosen], summary=s, score=_score(s)
                )
            return cache[idx]

        today[:] = twm.rollout(world, stage, journeys)
        empty = evaluate(frozenset())
        frontier: list[frozenset[int]] = [frozenset()]
        scored: list[FixSet] = []
        stopped = time.monotonic() > deadline
        for _ in range(budget):
            if stopped:
                break
            children = sorted(
                {f | {i} for f in frontier for i in range(len(cands)) if i not in f}, key=sorted
            )
            done: list[frozenset[int]] = []
            for c in children:
                if time.monotonic() > deadline:
                    stopped = True
                    break
                evaluate(c)
                done.append(c)
            ranked = sorted(done, key=lambda c: (-evaluate(c).score, sorted(c)))
            scored += [evaluate(c) for c in ranked]
            frontier = ranked[:beam]
            if not frontier:
                break
    # Prefer the smallest set that reaches the best score (no extra change for no gain).
    pool = sorted(
        {json.dumps(fs.labels): fs for fs in [empty, *scored]}.values(),
        key=lambda fs: (-fs.score, len(fs.actions), fs.labels),
    )
    best = pool[0]
    runners = [fs for fs in pool[1:] if fs.actions and fs.score > empty.score][:3]
    helped = best.score > empty.score
    blob = json.dumps(
        [profile, scope, stage, budget, [c.label for c in cands], world.version, stopped]
    )
    return FixResult(
        profile=profile,
        scope=scope,
        stage=stage,
        budget=budget,
        best=best if helped else empty,
        runners_up=runners,
        candidates=cands,
        rejected=rejected,
        rollouts=rollouts,
        stopped_early=stopped,
        conclusive=helped or not stopped,
        evidence_id="ev-fixit-" + hashlib.sha1(blob.encode()).hexdigest()[:10],
    )
