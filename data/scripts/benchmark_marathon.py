"""Reproducible mock-free marathon timings and audit denominators (no network/LLM).

uv run python data/scripts/benchmark_marathon.py [--distance-km 5] [--cold-runs 1]
--profile FILE writes cProfile stats on a separate fresh world after the timed runs.
Seed loading is reported separately. Every cold trial has a new world/graph and empty
course/baseline caches; the next call on that same world is the warm trial.
"""

import argparse
import cProfile
import json
import pstats
from collections import Counter
from pathlib import Path
from time import perf_counter

from townshiplens_spatial import events, marathon
from townshiplens_spatial.world import load_world

ROOT = Path(__file__).resolve().parents[2]


def describe(world, result):
    course, impact = result.course, result.impact
    counts = Counter(course.segment_ids)
    repeated = sum(world.edges[e].length_m * (n - 1) for e, n in counts.items())
    profiles = {}
    for profile, metrics in impact.per_profile.items():
        trips = [t for t in impact.trips if t.profile == profile]
        origin = Counter(t.from_id for t in trips)
        destination = Counter(t.to_id for t in trips)
        profiles[profile] = {
            **metrics.model_dump(),
            "distinct_origins": len(origin),
            "distinct_destinations": len(destination),
            "max_origin_share": max(origin.values(), default=0) / len(trips) if trips else None,
            "max_destination_share": max(destination.values(), default=0) / len(trips)
            if trips
            else None,
        }
    return {
        "length_m": course.length_m,
        "segments": len(course.segment_ids),
        "segment_ids": course.segment_ids,
        "repeated_m": round(repeated, 1),
        "repeated_share": repeated / course.length_m,
        "road_revisits": marathon._road_revisits(world, course.segment_ids, course.shape == "loop"),
        "roads": [r.model_dump() for r in course.roads],
        "affected": impact.trips_affected,
        "on_course": impact.trips_on_course,
        "lost": impact.trips_newly_no_route,
        "cut_off": [
            {"id": p.id, "name": p.name, "type": world.places[p.id].type}
            for p in impact.places_cut_off
        ],
        "profiles": profiles,
        "warnings": course.warnings + impact.warnings,
        "animation_examples": len(result.animation.rerouted_trips),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--distance-km", type=float, default=5)
    parser.add_argument("--cold-runs", type=int, default=1)
    parser.add_argument("--profile", type=Path)
    args = parser.parse_args(argv)
    request = marathon.MarathonRequest(
        start="osm-way-866543394",
        distance_km=args.distance_km,
        starts_at="2026-10-25T06:00:00+08:00",
        ends_at="2026-10-25T10:00:00+08:00",
    )
    for trial in range(args.cold_runs):
        start = perf_counter()
        world = load_world(ROOT / "data/seed/elmina")
        load_s = perf_counter() - start
        events._BASELINES.clear()
        marathon._COURSES.clear()
        for title in ("cold", "warm"):
            start = perf_counter()
            result = marathon.simulate_marathon(world, request)
            elapsed = perf_counter() - start
            print(
                json.dumps(
                    {
                        "case": title,
                        "trial": trial + 1,
                        "seconds": round(elapsed, 3),
                        "load_seconds": round(load_s, 3),
                        **describe(world, result),
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
    if args.profile:
        world = load_world(ROOT / "data/seed/elmina")
        events._BASELINES.clear()
        marathon._COURSES.clear()
        profile = cProfile.Profile()
        profile.enable()
        marathon.simulate_marathon(world, request)
        profile.disable()
        profile.dump_stats(str(args.profile))
        stats = pstats.Stats(profile)
        rows = sorted(stats.stats.items(), key=lambda row: -row[1][3])[:15]
        print(
            json.dumps(
                {
                    "case": "profile",
                    "functions": [
                        {
                            "file": str(Path(key[0]).relative_to(ROOT))
                            if str(key[0]).startswith(str(ROOT))
                            else key[0],
                            "line": key[1],
                            "function": key[2],
                            "calls": value[1],
                            "cumulative_s": round(value[3], 3),
                        }
                        for key, value in rows
                    ],
                }
            ),
            flush=True,
        )


if __name__ == "__main__":
    main()
