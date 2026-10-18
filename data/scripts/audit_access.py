"""Compare legacy factual evaluation with the T-020 access levels on one loaded seed.

uv run python data/scripts/audit_access.py --output data/audits/2026-10-18-t020-access.json
No network or model calls. 'Before' removes the newly retained OSM tags, reproducing
control 8d20778's evaluator inputs; geometry and claims are unchanged by this rebuild.
"""

import argparse
import json
from collections import Counter
from pathlib import Path

from townshiplens_spatial.access import assess_access, urban_context
from townshiplens_spatial.evaluate import evaluate_edge
from townshiplens_spatial.world import load_world


def audit(data_dir: Path) -> dict:
    world = load_world(data_dir)
    profiles = {}
    for name, profile in world.profiles.items():
        before, after, metres, rules = Counter(), Counter(), Counter(), Counter()
        for edge in world.edges.values():
            legacy = edge.model_copy(update={"osm_tags": {}})
            before[evaluate_edge(legacy, profile)[0]] += 1
            result = assess_access(edge, profile, urban=urban_context(world, edge))
            after[result.level] += 1
            metres[result.level] += edge.length_m
            rules[result.rule_id] += 1
        profiles[name] = {
            "before_eval_counts": dict(before),
            "after_access_counts": dict(after),
            "after_access_metres": {k: round(v, 1) for k, v in metres.items()},
            "rules": dict(rules),
        }
    return {
        "site": world.site.id,
        "baseline": "8d20778",
        "edges": len(world.edges),
        "method": "same geometry/claims; before omits OSM tags; after applies access rules",
        "limitations": (
            "Map-derived estimates, not field surveys; urban context is a 60 m vertex proxy"
        ),
        "profiles": profiles,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("data/seed/elmina"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = audit(args.data_dir)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    for mode, row in result["profiles"].items():
        print(mode, row["before_eval_counts"], "->", row["after_access_counts"])


if __name__ == "__main__":
    main()
