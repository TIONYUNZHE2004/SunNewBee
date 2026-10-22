"""Compile static unnamed-path labels from the committed seed; no network or LLM.

uv run python data/scripts/build_closure_labels.py [--data-dir data/seed/elmina]
Run after geometry/name updates. Runtime validates the source fingerprint and falls
back to recomputing labels when this optional derived index is absent or stale.
"""

import argparse
import json
from collections import defaultdict
from pathlib import Path

from townshiplens_spatial import events
from townshiplens_spatial.world import load_world

ROOT = Path(__file__).resolve().parents[2]


def build(data_dir):
    world = load_world(data_dir)
    path = data_dir / "base/closure_labels.json"
    labels = events._unnamed_stretches(world, use_compiled=False)
    groups = defaultdict(list)
    for eid, label in sorted(labels.items()):
        groups[label].append(eid)
    result = {
        "rules_version": events.LABEL_RULES_VERSION,
        "source_fingerprint": events.label_fingerprint(world),
        "groups": [{"label": label, "segment_ids": ids} for label, ids in sorted(groups.items())],
    }
    path.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data/seed/elmina")
    args = parser.parse_args()
    result = build(args.data_dir)
    print(
        json.dumps(
            {
                "groups": len(result["groups"]),
                "segments": sum(len(g["segment_ids"]) for g in result["groups"]),
                "source_fingerprint": result["source_fingerprint"],
            }
        )
    )


if __name__ == "__main__":
    main()
