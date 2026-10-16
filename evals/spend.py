"""Print OpenRouter spend for the configured key (never the key itself).

uv run python evals/spend.py              # usage now
uv run python evals/spend.py --mark X     # also append {time, label X, usage} to .data/spend.jsonl

Uses GET https://openrouter.ai/api/v1/key, which reports the key's cumulative and daily usage in
US$. OpenRouter accounts with a short delay, so read it a minute after a live run.
"""

import argparse
import json
import sys
from datetime import UTC, datetime

import httpx
from townshiplens_agent.settings import ROOT, AgentSettings

LEDGER = ROOT / ".data" / "spend.jsonl"


def fetch() -> dict:
    key = AgentSettings().openrouter_api_key
    if not key:
        raise SystemExit("no OpenRouter key configured")
    r = httpx.get(
        "https://openrouter.ai/api/v1/key",
        headers={"Authorization": f"Bearer {key}"},
        timeout=20,
    )
    if r.status_code != 200:
        raise SystemExit(f"OpenRouter /key returned HTTP {r.status_code}")
    d = r.json().get("data", {})
    keep = ("usage", "usage_daily", "usage_weekly", "usage_monthly", "limit", "limit_remaining")
    return {k: d[k] for k in keep if k in d}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mark", help="label for a ledger row in .data/spend.jsonl")
    args = ap.parse_args()
    usage = fetch()
    row = {"time": datetime.now(UTC).isoformat(timespec="seconds"), **usage}
    if args.mark:
        row["label"] = args.mark
        LEDGER.parent.mkdir(exist_ok=True)
        with LEDGER.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
    print(json.dumps(row))
    return 0


if __name__ == "__main__":
    sys.exit(main())
