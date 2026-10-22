import json
from pathlib import Path
from time import perf_counter

from townshiplens_spatial import marathon
from townshiplens_spatial.world import load_world

world = load_world(Path("data/seed/elmina"))
request = marathon.MarathonRequest(
    start="osm-way-866543394",
    distance_km=5,
    starts_at="2030-10-27T06:00:00+08:00",
    ends_at="2030-10-27T10:00:00+08:00",
)
for title in ["cold", "warm"]:
    t = perf_counter()
    r = marathon.simulate_marathon(world, request)
    print(
        json.dumps(
            {
                "case": title,
                "seconds": round(perf_counter() - t, 3),
                "length_m": r.course.length_m,
                "segments": len(r.course.segment_ids),
                "affected": r.impact.trips_affected,
                "on_course": r.impact.trips_on_course,
                "lost": r.impact.trips_newly_no_route,
                "cut_off": len(r.impact.places_cut_off),
                "warnings": r.course.warnings,
            }
        ),
        flush=True,
    )
