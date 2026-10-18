"""Resident-agent batch runner: replays tasks over the world and ranks data gaps.

Never mutates `world`: gap analysis flips claims on deep copies of the affected edges.
"""

from __future__ import annotations

import copy
import dataclasses
import hashlib
import random
import time
import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any

from . import flood
from .evaluate import _CHECKS, SIDEWALK_TYPES, evaluate_edge
from .models import Claim, Closure
from .routing import _flood_class, _target_pts, plan_route
from .world import World

SIM_PROFILES = ("stroller", "wheelchair", "older_adult_rest")
ORIGIN_TYPES = {"parking", "drop_off", "bus_stop"}
DEST_TYPES = {"facility", "toilet"}
MAX_TASKS = 300
MAX_GAPS = 20
MAX_RERUNS = 2000
MAX_SECONDS = 60.0
OUTCOME = {
    "confirmed": "success",
    "partly_unverified": "success_with_unknowns",
    "blocked": "blocked",
    "no_data": "no_data",
}
# Same keys the evaluator checks; `sidewalk` only on SIDEWALK_TYPES edges (major roads).
GAP_ATTRS = {attr for attr, _ in _CHECKS.values()} | {"sidewalk"}


def snapshot_world(world: World, now: datetime | None = None) -> tuple[World, str]:
    """A consistent copy of the mutable parts of `world` for one run, plus a hash of the closure
    set. The caller holds the API's `world_lock`. Edges and places are deep-copied (claims,
    closures); the graph, flood bundle, profiles and centres are never mutated and are shared.

    Closure time is frozen at `now`: a closure active then stays active for the whole run, one
    that starts or ends mid-run changes nothing. So a staff edit or the clock cannot make two
    halves of one run disagree."""
    now = now or datetime.now(UTC)
    frozen: dict[str, Closure] = {}
    edges, places = {}, {}
    for src, dst in ((world.edges, edges), (world.places, places)):
        for k, el in src.items():
            c = el.model_copy(deep=True)
            if c.closures:
                c.closures = [
                    x.model_copy(update={"ends_at": None}) for x in c.closures if x.is_active(now)
                ]
                frozen.update({x.id: x for x in c.closures})
            dst[k] = c
    digest = hashlib.sha256(
        "|".join(
            f"{c.id}@{c.element_id}@{c.starts_at.isoformat()}"
            for c in sorted(frozen.values(), key=lambda c: c.id)
        ).encode()
    ).hexdigest()[:16]
    snap = dataclasses.replace(
        world, edges=edges, places=places, closures=list(frozen.values()), version=world.version
    )
    return snap, digest


def new_run_id() -> str:
    return "sim-" + uuid.uuid4().hex


def default_tasks(world: World, profiles: list[str] | None = None) -> list[dict[str, Any]]:
    origins = sorted(p.id for p in world.places.values() if p.type in ORIGIN_TYPES)
    dests = sorted(p.id for p in world.places.values() if p.type in DEST_TYPES)
    profs = [p for p in SIM_PROFILES if profiles is None or p in profiles]  # filter before the cap
    tasks = [
        {
            "id": f"{prof}:{o}>{d}",
            "profile": prof,
            "from_id": o,
            "to_id": d,
            "scenario_id": None,
        }
        for o in origins
        for d in dests
        if o != d
        for prof in profs
    ]
    return tasks[:MAX_TASKS]


def _pass_value(world: World, profile_id: str, attribute: str) -> Any:
    if attribute == "sidewalk":
        return "both"
    hard = world.profiles[profile_id].hard
    if attribute == "width_m":
        return round(hard.get("min_width_m", 0.0) + 0.1, 3)
    return 0 if attribute == "step_count" else 0.0


def _flipped(world: World, element_id: str, attribute: str, profile_id: str) -> World | None:
    edge = world.edges.get(element_id)
    if edge is None or attribute not in GAP_ATTRS or profile_id not in world.profiles:
        return None
    if attribute == "sidewalk" and edge.type not in SIDEWALK_TYPES:
        return None
    e2 = copy.deepcopy(edge)
    e2.claims = {
        **e2.claims,
        attribute: Claim(
            value=_pass_value(world, profile_id, attribute),
            status="verified",
            verified_at=date.today().isoformat(),
            evidence_type="sim_hypothetical",
        ),
    }
    return dataclasses.replace(world, edges={**world.edges, element_id: e2})


def _check(world: World, task: dict, route, violations: list[dict]) -> None:
    tid = task["id"]
    listed = {u["element_id"] for u in route.unknowns}
    for s in route.segments:
        if s.eval == "FAIL":
            violations.append(
                {"invariant": "I1", "task_id": tid, "detail": f"FAIL edge {s.edge_id} in route"}
            )
        elif s.eval != "PASS" and s.edge_id not in listed:
            violations.append(
                {"invariant": "I2", "task_id": tid, "detail": f"{s.edge_id} not in unknowns"}
            )
    prof = world.profiles.get(task["profile"])
    limit = prof.max_rest_free_run_m if prof else None
    gap = route.max_gap_between_rest_m
    # A route over the limit that says so (rest_limit_met False, never confirmed) is an
    # advisory (see _rest_advisory); one that claims the limit, or is confirmed, is a bug.
    if limit is None or gap is None or gap <= limit:
        return
    if route.rest_limit_met is False and route.status != "confirmed":
        return
    violations.append(
        {"invariant": "I7", "task_id": tid, "detail": f"rest_gap_exceeds_limit {gap}>{limit}"}
    )


def _long_segments(world: World, route, limit: float) -> list[str]:
    """Distinct segments on the route longer than the limit: a rest point at a node cannot split
    them, so no amount of rest points there brings the route within the limit."""
    ids = (s.edge_id for s in route.segments)
    return list(dict.fromkeys(i for i in ids if world.edges[i].length_m > limit))


def _rest_limit(world: World, tasks: list[dict]) -> float | None:
    """The rest limit of the run's profiles (only older_adult_rest has one), else None."""
    limits = {
        world.profiles[p].max_rest_free_run_m
        for p in {t["profile"] for t in tasks}
        if p in world.profiles and world.profiles[p].max_rest_free_run_m is not None
    }
    return min(limits) if limits else None


def _rest_advisory(world: World, task: dict, rr) -> tuple[dict, list[str]] | None:
    """One advisory per journey, from routes[0], when the router returned a route over the
    rest limit and said so: (advisory, long segment ids) or None."""
    r0 = rr.routes[0] if rr.routes else None
    limit = r0.rest_limit_m if r0 else None
    if r0 is None or limit is None or r0.rest_limit_met is not False or r0.status == "confirmed":
        return None
    long_ids = _long_segments(world, r0, limit)
    n = len(long_ids)
    detail = (
        f"longest stretch without a rest point {r0.max_gap_between_rest_m} m > limit {limit:g} m; "
        f"{n} path {'segment' if n == 1 else 'segments'} longer than {limit:g} m"
    )
    if rr.rest_search_truncated:
        kind = "rest_search_stopped_early"
        detail += "; the search stopped early, so a route within the limit may exist"
    else:
        kind = "rest_limit_no_alternative"
        detail += "; no route within the limit"
    return {"kind": kind, "task_id": task["id"], "detail": detail, "long_segments": n}, long_ids


def run_suite(
    world: World,
    tasks: list[dict],
    scenario_id: str | None = None,
    progress: Callable[[int, int], None] | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    counts: dict[str, dict[str, int]] = {}
    results: list[dict] = []
    violations: list[dict] = []
    advisories: list[dict] = []
    long_segments: set[str] = set()
    gap_tasks: dict[tuple[str, str], list[dict]] = {}
    for i, t in enumerate(tasks):
        if progress:
            progress(i, len(tasks))
        sc = t.get("scenario_id") or scenario_id
        rr = plan_route(world, t["from_id"], t["to_id"], t["profile"], sc)
        outcome = OUTCOME[rr.status]
        res: dict[str, Any] = {"task_id": t["id"], "outcome": outcome, "unknowns": []}
        if rr.routes:
            r0 = rr.routes[0]
            res["route_id"] = r0.id
            res["unknowns"] = [
                {"element_id": u["element_id"], "attribute": u["attribute"]} for u in r0.unknowns
            ]
            for r in rr.routes:
                _check(world, t, r, violations)
            if adv := _rest_advisory(world, t, rr):
                advisories.append(adv[0])
                long_segments.update(adv[1])
            for key in {(u["element_id"], u["attribute"]) for u in r0.unknowns}:
                gap_tasks.setdefault(key, []).append({**t, "scenario_id": sc})
        counts.setdefault(t["profile"], {}).setdefault(outcome, 0)
        counts[t["profile"]][outcome] += 1
        results.append(res)
    gaps = []
    reruns, started, truncated = 0, time.monotonic(), False
    for (eid, attr), ts in sorted(gap_tasks.items()):
        improved: list[dict] = []
        flipped: dict[str, World | None] = {}
        for t in ts:
            if reruns >= MAX_RERUNS or time.monotonic() - started > MAX_SECONDS:
                truncated = True
                break
            prof = t["profile"]
            if prof not in flipped:
                flipped[prof] = _flipped(world, eid, attr, prof)
            w2 = flipped[prof]
            if w2 is None:
                continue
            # Cheap pre-check: the flip must make this edge PASS for the profile/scenario.
            res, _ = evaluate_edge(
                w2.edges[eid],
                w2.profiles[prof],
                _flood_class(w2, t["scenario_id"], eid),
                flood_coverage=w2.flood.coverage_for(t["scenario_id"], eid),
            )
            if res != "PASS":
                continue
            reruns += 1
            if progress:  # the hook also checks cancel and the time budget (Task 55)
                progress(len(tasks), len(tasks))
            rr = plan_route(w2, t["from_id"], t["to_id"], prof, t["scenario_id"])
            if rr.status == "confirmed":
                improved.append(t)
        if improved:
            gaps.append(
                {
                    "element_id": eid,
                    "attribute": attr,
                    "impact": len(improved),
                    "affected_profiles": sorted({t["profile"] for t in improved}),
                    "example_task_ids": [t["id"] for t in improved[:3]],
                }
            )
        if truncated:
            break
    gaps.sort(key=lambda g: (-g["impact"], g["element_id"], g["attribute"]))
    return {
        "run_id": run_id or new_run_id(),
        "world_version": world.version,
        "created_at": datetime.now(UTC).isoformat(),
        "scenario_id": scenario_id,
        "counts": counts,
        "results": results,
        "gaps": gaps[:MAX_GAPS],
        "gaps_truncated": truncated,
        "invariant_violations": violations,
        # One per journey whose route runs over the rest limit (see _rest_advisory).
        "rest_advisories": advisories,
        "rest_limit_m": _rest_limit(world, tasks),
        # Distinct segments longer than the limit on those journeys' routes.
        "rest_long_segments": len(long_segments),
    }


# ---- Evacuation journeys (Task 47, G-07) -------------------------------------------------
# Nothing here computes a route: every journey is one `flood.centres_reachability` call, the same
# logic behind the `list_evacuation_centres` tool. Scenarios are indicative, never forecasts.

EVAC_PROFILES = ("default", "stroller", "wheelchair", "older_adult_rest")
EVAC_SCENARIOS = ("baseline", "stage_p1m", "stage_p3m", "stage_p5m")  # rising river stage
EVAC_N = 50  # sampled origins per profile
EVAC_SEED = 47
EVAC_RESULTS = (
    "reachable_confirmed",
    "reachable_partly_unverified",
    "blocked_by_flood",  # a known FAIL cuts every path (flood, or at baseline a known barrier)
    "no_mapped_connection",  # data gap: never reported as "not reachable"
    "centres_closed",  # every centre that could be reached is under a staff-reported closure
    "no_centre",
)
# The seed maps no residential buildings, so origins are every mapped place residents start from
# except street furniture (a bench or bin is not where a journey begins).
NON_ORIGIN_TYPES = {"seating", "toilet", "shelter", "waste_basket"}


def _centre_origins(world: World) -> set[str]:
    """Places that ARE an evacuation centre (by place id) or whose way into the network is a
    centre's node. A journey from one is 0 m and says nothing about reaching a centre."""
    cn = {c.node_id for c in world.centres.values() if c.node_id}
    cp = {c.place_id for c in world.centres.values() if c.place_id}
    out = set()
    for p in world.places.values():
        nodes = {n for n, _ in _target_pts(world, p.id)}
        if p.id in cp or nodes & cn:
            out.add(p.id)
    return out


def _all_origins(world: World) -> list[str]:
    return sorted(p.id for p in world.places.values() if p.type not in NON_ORIGIN_TYPES)


def _origin_pool(world: World) -> list[str]:
    """Real journeys only: places a resident starts from that are not themselves a centre."""
    centres = _centre_origins(world)
    return [i for i in _all_origins(world) if i not in centres]


def evacuation_origins(world: World, n: int = EVAC_N, seed: int = EVAC_SEED) -> list[str]:
    """Deterministic sample: the same ids for every profile and scenario, so journeys compare."""
    pool = _origin_pool(world)
    if len(pool) <= n:
        return pool
    return sorted(random.Random(seed).sample(pool, n))


def _journey(world: World, origin: str, profile: str, scenario_id: str | None) -> dict[str, Any]:
    # top_routes=1: only the nearest centre's status comes from `plan_route` (it accounts for the
    # older-adult rest gap); every other row keeps the Dijkstra status, which ignores it. So
    # `any_confirmed` can be True from a farther centre that plan_route would call
    # partly_unverified (E1 false positive; none found over 28 origins x 2 stages, Task 47 review).
    rows = flood.centres_reachability(world, scenario_id, profile, origin, top_routes=1)
    reach = [r for r in rows if r.reachable]
    confirmed = any(r.route_status == "confirmed" for r in reach)
    if not world.centres:
        result = "no_centre"
    elif reach:  # rows are ordered nearest reachable first
        result = (
            "reachable_confirmed"
            if reach[0].route_status == "confirmed"
            else "reachable_partly_unverified"
        )
    elif any(r.route_status == "blocked" for r in rows):
        result = "blocked_by_flood"
    elif any(r.route_status == "closed" for r in rows):
        result = "centres_closed"
    else:
        result = "no_mapped_connection"
    return {
        "result": result,
        "any_confirmed": confirmed,
        "any_reachable": bool(reach),
        "centre_id": reach[0].centre.id if reach else None,
    }


def _violation(inv: str, profile: str, origin: str, detail: str) -> dict[str, str]:
    return {
        "invariant": inv,
        "task_id": f"evac:{profile}:{origin}",
        "profile": profile,
        "origin_id": origin,
        "detail": detail,
    }


def run_evacuation(
    world: World,
    profiles: list[str] | None = None,
    scenario_ids: list[str] | None = None,
    n_per_profile: int = EVAC_N,
    seed: int = EVAC_SEED,
    progress: Callable[[int, int], None] | None = None,
) -> dict[str, Any]:
    """profile x scenario table of evacuation results for a seeded sample of origins, plus the
    G-08 (c) invariants: E1 a worse flood never improves a journey, E2 baseline == no scenario."""
    profs = [
        p for p in EVAC_PROFILES if p in world.profiles and (profiles is None or p in profiles)
    ]
    known = {s.id for s in world.flood.scenarios}
    scs = [s for s in (scenario_ids or EVAC_SCENARIOS) if s in known]
    origins_pool = _origin_pool(world)
    origins = evacuation_origins(world, n_per_profile, seed)
    total, done = len(profs) * len(origins) * (len(scs) + ("baseline" in scs)), 0
    violations: list[dict[str, str]] = []
    rows: list[dict[str, Any]] = []
    for prof in profs:
        by: dict[tuple[str, str], dict[str, Any]] = {}
        for sc in scs:
            for o in origins:
                by[(sc, o)] = _journey(world, o, prof, sc)
                done += 1
                if progress:
                    progress(done, total)
        for o in origins:
            if "baseline" in scs:
                none = _journey(world, o, prof, None)
                done += 1
                if progress:
                    progress(done, total)
                b = by[("baseline", o)]
                if b != none:
                    violations.append(
                        _violation(
                            "E2",
                            prof,
                            o,
                            f"baseline gave {b['result']} but no scenario gave {none['result']}",
                        )
                    )
            for lo, hi in zip(scs, scs[1:], strict=False):
                a, c = by[(lo, o)], by[(hi, o)]
                improved = (
                    (a["result"] == "blocked_by_flood" and c["result"] == "reachable_confirmed")
                    or (not a["any_confirmed"] and c["any_confirmed"])
                    or (
                        not a["any_reachable"] and c["any_reachable"] and a["result"] != "no_centre"
                    )
                )
                if improved:
                    violations.append(
                        _violation(
                            "E1",
                            prof,
                            o,
                            f"{lo} gave {a['result']} but the higher stage {hi} gave {c['result']}",
                        )
                    )
        for sc in scs:
            counts = dict.fromkeys(EVAC_RESULTS, 0)
            for o in origins:
                counts[by[(sc, o)]["result"]] += 1
            rows.append(
                {"profile": prof, "scenario_id": sc, "counts": counts, "total": len(origins)}
            )
    return {
        "rows": rows,
        "violations": violations,
        "origins": origins,
        "origins_sampled": len(origins),
        "origins_available": len(origins_pool),
        # places that are evacuation centres (or share a centre's node), left out of the sample
        "origins_excluded_centres": len(_all_origins(world)) - len(origins_pool),
        "seed": seed,
    }
