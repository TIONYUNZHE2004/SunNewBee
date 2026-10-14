"""Golden hero questions against the tiny fixture. Exit 1 on any failure.

pnpm golden                  # deterministic mock model (CI)
GOLDEN_REAL=1 pnpm golden    # OpenRouter, model from .env (costs money; manual only)
"""

import asyncio
import os
import sys
import tempfile
from pathlib import Path

import pydantic_ai
import yaml
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

GOLDEN = Path(__file__).parent / "golden" / "hero.yaml"
TINY = ROOT / "packages/spatial/tests/fixtures/tiny"
KNOWN = {"tools_include", "events_include", "done_status_in", "text_excludes"}


def check(expect: dict, evs: list) -> list[str]:
    fails = [f"unknown expect key {k}" for k in expect if k not in KNOWN]
    tool_names = [e.name for e in evs if e.type == "tool.call"]
    types = [e.type for e in evs]
    text = "".join(e.delta for e in evs if e.type == "text.delta").lower()
    done = evs[-1] if evs and evs[-1].type == "done" else None
    if done is None:
        fails.append("stream did not end with done")
    fails += [
        f"tool {t} not called" for t in expect.get("tools_include", []) if t not in tool_names
    ]
    fails += [f"no {t} event" for t in expect.get("events_include", []) if t not in types]
    allowed = expect.get("done_status_in")
    if allowed and (done is None or done.answer_status not in allowed):
        fails.append(f"done status {done and done.answer_status} not in {allowed}")
    fails += [f"text contains {s!r}" for s in expect.get("text_excludes", []) if s.lower() in text]
    return fails


async def main() -> int:
    pydantic_ai.BANNER_ENABLED = False
    real = os.environ.get("GOLDEN_REAL") == "1"
    settings = (
        AgentSettings(llm_provider="openrouter")
        if real
        else AgentSettings(_env_file=None, llm_provider="mock")
    )
    cases = yaml.safe_load(GOLDEN.read_text(encoding="utf-8"))
    world = load_world(TINY)
    rows, failed = [], 0
    with tempfile.TemporaryDirectory() as tmp:
        for i, case in enumerate(cases):
            ctx = tools.Ctx(world=world, vrs=VerificationStore(str(Path(tmp) / f"vr-{i}.db")))
            req = ChatRequest(
                message=case["message"],
                profile=case.get("profile", "default"),
                scenario_id=case.get("scenario_id"),
            )
            evs = [e async for e in run_turn(ctx, req, settings)]
            fails = check(case.get("expect", {}), evs)
            failed += bool(fails)
            done = evs[-1] if evs and evs[-1].type == "done" else None
            rows.append(
                (
                    case["id"],
                    "PASS" if not fails else "FAIL",
                    done.answer_status if done else "-",
                    done.model if done else "-",
                    ",".join(e.name for e in evs if e.type == "tool.call") or "-",
                    "; ".join(fails),
                )
            )
    head = ("case", "result", "status", "model", "tools", "failures")
    widths = [max(len(str(r[c])) for r in [head, *rows]) for c in range(len(head))]
    for r in [head, *rows]:
        print("  ".join(str(v).ljust(w) for v, w in zip(r, widths, strict=True)).rstrip())
    print(f"\ngolden: {len(rows) - failed}/{len(rows)} passed ({'openrouter' if real else 'mock'})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
