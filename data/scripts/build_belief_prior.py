# ruff: noqa: E501
"""Regional prior for the Township World Model's belief over unchecked facts (Cycle 2).

One cached Overpass request (tags only, no geometry) over the Klang Valley. It counts how often
mapped footways, paths, crossings and steps carrying accessibility tags pass or fail the
wheelchair profile's limits. The counts become Beta pseudo-counts per (attribute, path type) in
`data/seed/elmina/belief_prior.json`.

Planning use only. The prior ranks which facts staff should check first and never changes an
edge's evaluation or a resident answer. OSM data is ODbL: attribution is kept in the output.

uv run python data/scripts/build_belief_prior.py            # uses data/cache when present
uv run python data/scripts/build_belief_prior.py --max-requests 1
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import overpass  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data/seed/elmina/belief_prior.json"
# Klang Valley (Kuala Lumpur, Petaling Jaya, Shah Alam, Subang): south, west, north, east.
BBOX = (2.85, 101.35, 3.35, 101.85)
QL = f"""[out:json][timeout:120];
way[highway~"^(footway|path|pedestrian|steps|cycleway)$"]
  [~"^(wheelchair|incline|kerb|width|step_count)$"~"."]({",".join(map(str, BBOX))});
out tags;"""
# Wheelchair profile limits (config/profiles/wheelchair.yaml); the strictest walking profile.
MAX_INCLINE_PCT = 8.3
MIN_WIDTH_M = 0.9
TYPE_OF = {
    "footway": "footway",
    "path": "path",
    "pedestrian": "pedestrian",
    "steps": "steps",
    "cycleway": "path",
}
_NUM = re.compile(r"^-?\d+(?:\.\d+)?")


def _num(v: str) -> float | None:
    m = _NUM.match(v.strip().replace(",", "."))
    return float(m.group()) if m else None


def judge(tags: dict[str, str]) -> list[tuple[str, bool]]:
    """(attribute, passes) observations from one way's tags for the wheelchair limits."""
    out: list[tuple[str, bool]] = []
    if (w := tags.get("wheelchair")) in ("yes", "no"):
        out.append(("wheelchair", w == "yes"))
    incline = tags.get("incline", "").strip()
    if incline.endswith("%") and (v := _num(incline)) is not None:
        out.append(("incline_pct", abs(v) <= MAX_INCLINE_PCT))
    if "width" in tags and (v := _num(tags["width"])) is not None:
        out.append(("width_m", v >= MIN_WIDTH_M))
    if "step_count" in tags and (v := _num(tags["step_count"])) is not None:
        out.append(("step_count", v == 0))
    elif tags.get("highway") == "steps":
        out.append(("step_count", False))
    if (k := tags.get("kerb")) in ("flush", "lowered", "raised", "yes", "no"):
        out.append(("kerb", k in ("flush", "lowered", "no")))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-requests", type=int, default=1)
    a = ap.parse_args()
    overpass.MAX_REQUESTS = a.max_requests
    data = overpass.query(QL)
    counts: dict[str, dict[str, dict[str, int]]] = defaultdict(
        lambda: defaultdict(lambda: {"pass": 0, "fail": 0})
    )
    ways = 0
    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        kind = TYPE_OF.get(tags.get("highway", ""), "path")
        obs = judge(tags)
        ways += bool(obs)
        for attr, ok in obs:
            counts[attr][kind]["pass" if ok else "fail"] += 1
    out = {
        "source": "OpenStreetMap (ODbL), Overpass tags-only query",
        "attribution": "© OpenStreetMap contributors (ODbL)",
        "bbox_swne": BBOX,
        "query_sha1": overpass.hashlib.sha1(QL.encode()).hexdigest(),
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "profile_limits": {"max_incline_pct": MAX_INCLINE_PCT, "min_width_m": MIN_WIDTH_M},
        "ways_with_observations": ways,
        "counts": {k: dict(v) for k, v in counts.items()},
        "use": "planning prior only (which facts to verify first); never an edge evaluation",
    }
    OUT.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {ways} ways; requests made {overpass.REQUESTS_MADE}")
    for attr, per in sorted(out["counts"].items()):
        tot = {k: v["pass"] + v["fail"] for k, v in per.items()}
        print(f"  {attr}: {per}  (n={sum(tot.values())})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
