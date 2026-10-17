# ruff: noqa: E402
"""Recheck remaining T-001 counterexamples from an audited checkout, with no LLM.

Run from the Cannon checkout using its environment, passing this script's absolute path.
--output must point outside that checkout. Exit 1 means a dishonest case passed or an
honest control failed. This diagnostic never edits the audited application.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
from townshiplens_agent.validate import validate_answer

from evals.audit_probes import PREFIX, answer, plan_hero_route

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
if args.output.resolve().is_relative_to(Path.cwd().resolve()):
    parser.error("write diagnostic output outside the audited checkout")
rec, rid, ev = plan_hero_route()
cases = [
    ("There are two toilets beside the playground.", True),
    ("There is one toilet beside the playground.", True),
    ("The toilet is 440.6 m from the mall.", True),
    ("No steps, so the toilet has a baby changing room.", True),
    ("The toilet is open 6.3 minutes every day.", True),
    ("That is not a guarantee.", False),
    ("I cannot guarantee this route.", False),
]
rows = []
for text, should_reject in cases:
    errors = validate_answer(answer(PREFIX + text, rid, ev), rec)
    rows.append(
        {"text": text, "should_reject": should_reject, "accepted": not errors, "errors": errors}
    )
result = {
    "audited_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    "rows": rows,
}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
print(json.dumps(rows, indent=2, ensure_ascii=False))
raise SystemExit(int(any(r["accepted"] == r["should_reject"] for r in rows)))
