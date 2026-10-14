"""Resident-agent batch runner: replays tasks over the world and ranks data gaps.

Never mutates `world`: gap analysis flips claims on deep copies of the affected edges.
"""

from __future__ import annotations

import copy
import dataclasses
import uuid
from datetime import UTC, date, datetime
from typing import Any

from .models import Claim
from .routing import plan_route
from .world import World

SIM_PROFILES = ("stroller", "wheelchair", "older_adult_rest")
ORIGIN_TYPES = {"parking", "drop_off", "bus_stop"}
DEST_TYPES = {"facility", "toilet"}
MAX_TASKS = 300
MAX_GAPS = 20
OUTCOME = {
    "confirmed": "success",
    "partly_unverified": "success_with_unknowns",
    "blocked": "blocked",
    "no_data": "no_data",
}
# Verified passing value used when flipping a gap (passes every profile limit).
PASS_VALUE = {"step_count": 0, "incline_pct": 0.0, "width_m": 2.0}


def default_tasks(world: World) -> list[dict[str, Any]]:
    origins = sorted(p.id for p in world.places.values() if p.type in ORIGIN_TYPES)
    dests = sorted(p.id for p in world.places.values() if p.type in DEST_TYPES)
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
        for prof in SIM_PROFILES
    ]
    return tasks[:MAX_TASKS]


def _flipped(world: World, element_id: str, attribute: str) -> World | None:
    edge = world.edges.get(element_id)
    if edge is None or attribute not in PASS_VALUE:
        return None
    e2 = copy.deepcopy(edge)
    e2.claims = {
        **e2.claims,
        attribute: Claim(
            value=PASS_VALUE[attribute],
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
        and route.status == "confirmed"  # only a confirmed route promises the rest interval
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
            res["unknowns"] = r0.unknowns
            for r in rr.routes:
                _check(world, t, r, violations)
            for key in {(u["element_id"], u["attribute"]) for u in r0.unknowns}:
                gap_tasks.setdefault(key, []).append({**t, "scenario_id": sc})
        counts.setdefault(t["profile"], {}).setdefault(outcome, 0)
        counts[t["profile"]][outcome] += 1
        results.append(res)
    gaps = []
    for (eid, attr), ts in gap_tasks.items():
        w2 = _flipped(world, eid, attr)
        if w2 is None:
            continue
        improved = [
            t
            for t in ts
            if plan_route(w2, t["from_id"], t["to_id"], t["profile"], t["scenario_id"]).status
            == "confirmed"
        ]
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
    gaps.sort(key=lambda g: (-g["impact"], g["element_id"], g["attribute"]))
    return {
        "run_id": "sim-" + uuid.uuid4().hex[:8],
        "created_at": datetime.now(UTC).isoformat(),
        "scenario_id": scenario_id,
        "counts": counts,
        "results": results,
        "gaps": gaps[:MAX_GAPS],
        "invariant_violations": violations,
    }
