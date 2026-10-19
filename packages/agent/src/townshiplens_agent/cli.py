"""Ask one question from the terminal and print the event stream.

    uv run python -m townshiplens_agent.cli "Can I push a stroller from Car Park B to the kiosk?"

Uses the seed data when it has been built, else the tiny test fixture. The model comes from
`.env` (mock when there is no key); `LLM_PROVIDER=mock` forces the mock.
"""

import argparse
import asyncio
import sys

import pydantic_ai
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

from . import demo
from .events import ChatRequest, Done
from .run import run_turn
from .settings import ROOT, AgentSettings

DEFAULT_Q = "Can I push a stroller from Car Park B to the playground without stairs?"


async def main(
    q: str,
    profile: str = "stroller",
    scenario: str | None = None,
    record: bool = False,
    allow_live: bool = False,
    settings: AgentSettings | None = None,
) -> None:
    pydantic_ai.BANNER_ENABLED = False  # this program owns stdout
    settings = settings or AgentSettings()
    if record and settings.provider != "mock" and not allow_live:
        sys.exit(
            "refusing to --record with a live model; set LLM_PROVIDER=mock or pass --allow-live"
        )
    data = ROOT / "data/seed/elmina"
    if not (data / "site.json").exists():
        data = ROOT / "packages/spatial/tests/fixtures/tiny"
    ctx = tools.Ctx(world=load_world(data), vrs=VerificationStore(str(ROOT / ".data/cli.db")))
    if record and (data / "site.json").parent.name == "elmina":
        print("warning: recording on the seed world", file=sys.stderr)
    req = ChatRequest(message=q, profile=profile, scenario_id=scenario)
    events = []
    async for ev in run_turn(ctx, req, settings):
        events.append(ev)
        print(ev.type, ev.model_dump_json(exclude={"type"})[:160])
    if record:
        # Fixed id so a re-recording with the mock is byte-stable (replay mints a fresh one).
        events[-1] = events[-1].model_copy(update={"message_id": "demo"})
        path = demo.save(
            demo.key(req), events, demo.make_meta(req, events, ctx.world), settings.demo_dir
        )
        model = events[-1].model if isinstance(events[-1], Done) else "?"
        print(f"recorded {path} (model {model})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("question", nargs="*")
    ap.add_argument("--record", metavar="QUESTION", help="run the turn and save a demo cache entry")
    ap.add_argument("--profile", default="stroller")
    ap.add_argument("--scenario", default=None)
    ap.add_argument("--allow-live", action="store_true", help="permit --record with a live model")
    a = ap.parse_args()
    question = a.record or " ".join(a.question) or DEFAULT_Q
    asyncio.run(
        main(question, a.profile, a.scenario, record=bool(a.record), allow_live=a.allow_live)
    )
