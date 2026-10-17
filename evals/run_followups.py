"""Multi-turn follow-up smoke: a what-if, then "and if it rises another metre?" in one session.

uv run python evals/run_followups.py               # mock
GOLDEN_REAL=1 uv run python evals/run_followups.py # OpenRouter (costs money; a few turns)
Prints each turn's tools, validator verdicts and text; exit 1 if a turn falls back or the
follow-up does not re-run the simulation with a higher river stage.
"""

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

import pydantic_ai
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

TURNS = [
    "What if the river rises 3 m and we build a ramp at the steps? "
    "Can wheelchair users still reach an evacuation centre?",
    "And what if it rises another 2 metres?",
]


async def main() -> int:
    pydantic_ai.BANNER_ENABLED = False
    real = os.environ.get("GOLDEN_REAL") == "1"
    settings = (
        AgentSettings(llm_provider="openrouter")
        if real
        else AgentSettings(_env_file=None, llm_provider="mock")
    )
    mem, sid = SessionMemory(), "eval-followup-0001"
    rows, ok = [], True
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        ctx = tools.Ctx(
            world=load_world(ROOT / "packages/spatial/tests/fixtures/tiny"),
            vrs=VerificationStore(str(Path(tmp) / "vr.db")),
        )
        for q in TURNS:
            req = ChatRequest(message=q, profile="wheelchair", session_id=sid)
            evs = [e async for e in run_turn(ctx, req, settings, memory=mem)]
            calls = [e for e in evs if e.type == "tool.call"]
            stages = [
                a.get("scenario_id")
                for c in calls
                if c.name == "simulate_what_if"
                for a in c.args.get("actions", [])
                if a.get("kind") == "set_river_stage"
            ]
            row = {
                "question": q,
                "model": evs[-1].model,
                "tools": [c.name for c in calls],
                "stages": stages,
                "checks": [(e.ok, e.issues) for e in evs if e.type == "answer.check"],
                "text": "".join(e.delta for e in evs if e.type == "text.delta"),
            }
            rows.append(row)
            ok &= not row["model"].endswith("+template")
    if real:
        follow = rows[1]
        ok &= "simulate_what_if" in follow["tools"] and "stage_p5m" in follow["stages"]
    print(json.dumps(rows, indent=1, ensure_ascii=False))
    print(f"followups: {'PASS' if ok else 'FAIL'} ({'openrouter' if real else 'mock'})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
