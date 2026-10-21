"""T-026 seed benchmarks and deterministic residential road-works demo selection.

Run from the repository root with LLM_PROVIDER=mock uv run python
 data/scripts/benchmark_closures.py. No downloads, model calls or persistent writes.
"""

import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from time import perf_counter

from townshiplens_spatial import events
from townshiplens_spatial.routing import route_batch
from townshiplens_spatial.sim import snapshot_world
from townshiplens_spatial.world import load_world

SEED = Path(__file__).resolve().parents[1] / "seed/elmina"
START = datetime.fromisoformat("2030-10-28T07:00:00+08:00")


def request(ids, count=1):
    # Three windows overlap at 09:00; every segment is counted in just one window.
    parts = [ids[i::count] for i in range(count)]
    return events.ClosureScenario(
        name="Benchmark road works",
        reason="works",
        closures=[
            events.ClosureWindow(
                segment_ids=part,
                starts_at=START + timedelta(hours=i if count == 3 else 0),
                ends_at=START + timedelta(hours=4 + (i if count == 3 else 0)),
            )
            for i, part in enumerate(parts)
        ],
    )


def metrics(result):
    return {
        "trips_total": result.trips_total,
        "trips_affected": result.trips_affected,
        "trips_newly_no_route": result.trips_newly_no_route,
        "places_cut_off": len(result.places_cut_off),
        "extra_m_median": result.extra_m_median,
        "per_profile": {p: r.model_dump() for p, r in result.per_profile.items()},
        "detour_roads": [r.model_dump() for r in result.detour_roads[:5]],
    }


def main():
    world = load_world(SEED)
    baseline, digest = snapshot_world(world, START)
    usage = Counter()
    with route_batch():
        for profile in events.DEFAULT_PROFILES:
            journeys = events._journeys(baseline, profile, 100, expanded=True)
            states, _ = events._baseline(baseline, digest, profile, journeys)
            for state in states:
                usage.update(set(state.segment_ids))
    names = defaultdict(list)
    for edge in world.edges.values():
        if edge.name:
            names[edge.name].append(edge.id)
    candidates = [
        (sum(usage[eid] for eid in ids), name, ids)
        for name, ids in names.items()
        if len(ids) <= events.MAX_SEGMENTS
        and all(world.edges[eid].osm_tags.get("highway") == "residential" for eid in ids)
        and any(usage[eid] for eid in ids)
    ]
    _, demo_name, demo_ids = max(candidates, key=lambda item: (item[0], item[1]))
    demo = events.simulate_closure(world, request(demo_ids))
    assert demo.trips_affected >= 3
    print(
        json.dumps(
            {
                "demo_street": demo_name,
                "segment_ids": demo_ids,
                "request": request(demo_ids).model_dump(mode="json"),
                "result": metrics(demo),
            },
            indent=2,
        ),
        flush=True,
    )
    busiest = sorted(
        (eid for eid in usage if world.edges[eid].type in {"street", "major_road"}),
        key=lambda eid: (-usage[eid], eid),
    )[:40]
    assert len(busiest) == 40
    for title, ids, count in [
        ("1 segment", busiest[:1], 1),
        ("40 simultaneous closures (40 segments)", busiest, 40),
        ("3 overlapping closures (39 segments)", busiest[:39], 3),
    ]:
        # New world per case: both baseline and static routing caches start empty.
        fresh = load_world(SEED)
        spec = request(ids, count)
        at = START + timedelta(hours=2 if count == 3 else 0)
        runs = []
        for _ in range(2):
            begin = perf_counter()
            result = events.simulate_closure(fresh, spec, at=at)
            runs.append(
                {
                    "wall_ms": round((perf_counter() - begin) * 1000, 2),
                    "timing_ms": result.timing_ms,
                }
            )
        print(
            json.dumps(
                {
                    "case": title,
                    "request": spec.model_dump(mode="json"),
                    "at": at.isoformat(),
                    "cold": runs[0],
                    "cached_baseline": runs[1],
                    "result": metrics(result),
                },
                indent=2,
            ),
            flush=True,
        )


if __name__ == "__main__":
    main()
