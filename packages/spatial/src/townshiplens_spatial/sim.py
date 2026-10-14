"""Resident-agent batch runner: replays tasks over the world and ranks data gaps.

Never mutates `world`: gap analysis flips claims on deep copies of the affected edges.
"""

from __future__ import annotations

import copy
import dataclasses
import time
import uuid
from datetime import UTC, date, datetime
from typing import Any

from .evaluate import _CHECKS, SIDEWALK_TYPES, evaluate_edge
from .models import Claim
from .routing import _flood_class, plan_route
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
    if (
        task["profile"] == "older_adult_rest"
        and limit is not None
        and route.max_gap_between_rest_m is not None
        and route.max_gap_between_rest_m > limit
    ):
        violations.append(
            {
                "invariant": "I7",
                "task_id": tid,
                "detail": f"rest_gap_exceeds_limit {route.max_gap_between_rest_m}>{limit}",
            }
        )


def run_suite(world: World, tasks: list[dict], scenario_id: str | None = None) -> dict[str, Any]:
    counts: dict[str, dict[str, int]] = {}
    results: list[dict] = []
    violations: list[dict] = []
    gap_tasks: dict[tuple[str, str], list[dict]] = {}
    for t in tasks:
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
                w2.edges[eid], w2.profiles[prof], _flood_class(w2, t["scenario_id"], eid)
            )
            if res != "PASS":
                continue
            reruns += 1
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
        "run_id": "sim-" + uuid.uuid4().hex,
        "world_version": world.version,
        "created_at": datetime.now(UTC).isoformat(),
        "scenario_id": scenario_id,
        "counts": counts,
        "results": results,
        "gaps": gaps[:MAX_GAPS],
        "gaps_truncated": truncated,
        "invariant_violations": violations,
    }
