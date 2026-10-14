"""Ask one question from the terminal and print the event stream.

    uv run python -m townshiplens_agent.cli "Can I push a stroller from Car Park B to the kiosk?"

Uses the seed data when it has been built, else the tiny test fixture. The model comes from
`.env` (mock when there is no key); `LLM_PROVIDER=mock` forces the mock.
"""

import asyncio
import sys

import pydantic_ai
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

from .events import ChatRequest
from .run import run_turn
from .settings import ROOT

DEFAULT_Q = "Can I push a stroller from Car Park B to the playground without stairs?"


async def main(q: str, profile: str = "stroller") -> None:
    pydantic_ai.BANNER_ENABLED = False  # this program owns stdout
    data = ROOT / "data/seed/elmina"
    if not (data / "site.json").exists():
        data = ROOT / "packages/spatial/tests/fixtures/tiny"
    ctx = tools.Ctx(world=load_world(data), vrs=VerificationStore(str(ROOT / ".data/cli.db")))
    async for ev in run_turn(ctx, ChatRequest(message=q, profile=profile)):
        print(ev.type, ev.model_dump_json(exclude={"type"})[:160])


if __name__ == "__main__":
    asyncio.run(main(" ".join(sys.argv[1:]) or DEFAULT_Q))
