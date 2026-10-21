"""Search Elmina place pairs for the navigation-compare demo corridor (demo polish B5, spec 5.2).

A pair qualifies when, with a temporary placeholder `step_count = N` on the real OSM steps:
- the fastest walk (compare(): length-shortest walk) crosses one of the 3 `highway=steps` edges,
  and that steps edge is the stop point under wheelchair;
- the wheelchair route exists, adds 1-4 min and is >= 60 % footway/path/pedestrian by length
  (OSM `highway=footway` includes the `sidewalk` and `crossing` edge types);
- it can hold exactly one 30-60 m unchecked stretch (a run of non-crossing edges).

Prints the top 10 with names, distances, minutes and the steps edge. Read-only: nothing is
written; the chosen pair goes into `build_overlay.DEMO_CORRIDOR` with a ruling.

    uv run python data/scripts/pick_demo_corridor.py [--top 10]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from townshiplens_spatial.compare import compare  # noqa: E402
from townshiplens_spatial.geo import haversine_m  # noqa: E402
from townshiplens_spatial.models import Claim  # noqa: E402
from townshiplens_spatial.world import load_world  # noqa: E402

from data.scripts.build_overlay import (  # noqa: E402
    FOOT_TYPES,
    PLACEHOLDER,
    PLACEHOLDER_DATE,
    SEED,
    STEP_COUNT_N,
    STEPS_EDGES,
    unchecked_run,
)

MAX_PAIR_M = 1500.0
ORIGIN_PREF = {"parking": 2.0, "bus_stop": 2.0}
DEST_PREF = {"playground": 2.0, "park": 1.5, "clinic": 1.5}
# Spec 5.4: walker reaches each beat at (t - 3) / 26 of the recommended route.
STOP_FRACTION = (16.7 - 3) / 26


def _ll(p):
    return (p.coord[0], p.coord[1])


def candidates(world, top: int = 10) -> list[dict]:
    for sid in STEPS_EDGES:
        world.edges[sid].claims = {
            **world.edges[sid].claims,
            "step_count": Claim(
                value=STEP_COUNT_N,
                status="verified",
                evidence_type=PLACEHOLDER,
                verified_at=PLACEHOLDER_DATE,
            ),
        }
    places = [p for p in world.places.values() if p.node_id and p.node_id in world.graph]
    steps_mid = {sid: world.edges[sid].coords[0] for sid in STEPS_EDGES}
    out = []
    for a in places:
        for b in places:
            if a.id == b.id:
                continue
            dab = haversine_m(_ll(a), _ll(b))
            if dab > MAX_PAIR_M or dab < 150:
                continue
            near = [
                sid
                for sid, s in steps_mid.items()
                if haversine_m(_ll(a), s) + haversine_m(s, _ll(b)) <= 1.3 * dab + 150
            ]
            if not near:
                continue
            r = compare(world, a.id, b.id, "wheelchair")
            if r.recommended is None or r.same_path or r.stop is None:
                continue
            if r.stop.edge_id not in STEPS_EDGES:
                continue
            if not 1.0 <= (r.extra_minutes or 0) <= 4.0:
                continue
            if not (
                r.fastest.distance_m < r.recommended.distance_m
                and r.fastest.est_minutes < r.recommended.est_minutes
            ):
                continue
            rec = r.recommended
            edges = [world.edges[s.edge_id] for s in rec.segments]
            foot = sum(e.length_m for e in edges if e.type in FOOT_TYPES) / rec.distance_m
            if foot < 0.6:
                continue
            if any(e.type == "major_road" for e in edges):
                continue  # a major road needs a verified sidewalk: a second unchecked kind
            run = unchecked_run(world, rec)
            if run is None:
                continue
            stop_frac = r.stop.at_m / rec.distance_m
            score = (
                ORIGIN_PREF.get(a.type, 1.0)
                + DEST_PREF.get(b.type, 1.0)
                + foot
                - 3 * abs(stop_frac - STOP_FRACTION)
                - 0.2 * abs((r.extra_minutes or 0) - 2.0)
            )
            out.append(
                {
                    "score": round(score, 3),
                    "from": a.id,
                    "from_name": a.name,
                    "from_type": a.type,
                    "to": b.id,
                    "to_name": b.name,
                    "to_type": b.type,
                    "steps_edge": r.stop.edge_id,
                    "fast_m": r.fastest.distance_m,
                    "fast_min": r.fastest.est_minutes,
                    "rec_m": rec.distance_m,
                    "rec_min": rec.est_minutes,
                    "extra_min": r.extra_minutes,
                    "foot_share": round(foot, 2),
                    "stop_at_m": r.stop.at_m,
                    "stop_frac": round(stop_frac, 2),
                    "unchecked": run,
                }
            )
    out.sort(key=lambda c: (-c["score"], c["from"], c["to"]))
    return out[:top]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--top", type=int, default=10)
    args = ap.parse_args()
    world = load_world(SEED)
    rows = candidates(world, args.top)
    print(
        "score | from (type) -> to (type) | steps edge | fastest m/min | wheelchair m/min | "
        "+min | foot | stop at m (frac) | unchecked run"
    )
    for c in rows:
        print(
            f"{c['score']:.2f} | {c['from_name']} [{c['from']}] ({c['from_type']}) -> "
            f"{c['to_name']} [{c['to']}] ({c['to_type']}) | {c['steps_edge']} | "
            f"{c['fast_m']:.0f}/{c['fast_min']} | {c['rec_m']:.0f}/{c['rec_min']} | "
            f"{c['extra_min']} | {c['foot_share']} | {c['stop_at_m']:.0f} ({c['stop_frac']}) | "
            f"{c['unchecked']}"
        )
    if not rows:
        print("no pair qualifies: fall back to a real raised-kerb crossing (spec 11) by ruling")


if __name__ == "__main__":
    main()
