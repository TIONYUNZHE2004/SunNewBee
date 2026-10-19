# ruff: noqa: E501, E402
"""Deliberate paid smoke test: 6 questions, or --retest for only the 3 selection regressions.

Uses configured .env models, keeps tickets in memory and never records demo cache.
Run only within the board SPEND.md budget. No automatic retry rounds.
"""

import asyncio
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location(
    "live_round", ROOT / "evals/audits/2026-10-18-t017/live_round.py"
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
qs = [
    (
        "exact-en",
        "en",
        "exact-route",
        "I am in Surau Al Mahdi, how can I walk to Surau At Taqwa?",
        "default",
        None,
    ),
    (
        "local-ms",
        "ms",
        "generic-local",
        "Boleh saya tolak kereta sorong dari Car Park B ke taman permainan?",
        "stroller",
        None,
    ),
    (
        "features-zh",
        "zh",
        "translated-endpoints",
        "从B停车场到游乐场有几级台阶？那里有电梯和母婴室吗？",
        "stroller",
        None,
    ),
    (
        "amenity-flood",
        "en",
        "mode-and-scenario",
        "Find a toilet within 150 m of Car Park B. I use a wheelchair.",
        "wheelchair",
        "stage_p3m",
    ),
    (
        "distance-bait",
        "en",
        "wrong-origin-bait",
        "From Surau Rentak Perdana to Surau At Taqwa: is it a 363.8 m walk?",
        "default",
        None,
    ),
    (
        "unknown-clinic",
        "en",
        "unknown-place",
        "How can I walk from Car Park B to Everspring Clinic?",
        "default",
        None,
    ),
]
m.pydantic_ai.BANNER_ENABLED = False
import argparse

ap = argparse.ArgumentParser()
ap.add_argument("--retest", action="store_true")
args = ap.parse_args()
if args.retest:
    qs = [q for q in qs if q[0] in {"local-ms", "features-zh", "amenity-flood"}]
rows = asyncio.run(m.run(qs, "openrouter"))
path = (
    ROOT
    / "data/audits/2026-10-19-backend-ai-review"
    / ("fix-live-retest-three.json" if args.retest else "fix-live-six.json")
)
path.write_text(
    json.dumps(
        {"questions": len(qs), "provider": "openrouter", "rows": rows}, indent=2, ensure_ascii=False
    )
    + "\n"
)
print("saved", path)
