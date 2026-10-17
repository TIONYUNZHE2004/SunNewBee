# ruff: noqa: E402
"""Independent audit diagnostics; run from repository root. Synthetic PII only.

These record accepted/rejected outputs, not a passing regression test suite.
An exit code of zero means the probes ran, not that the product passed the audit.
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
from pydantic_ai import ModelResponse, ToolCallPart
from pydantic_ai.messages import ModelRequest, UserPromptPart
from pydantic_ai.models.function import FunctionModel
from townshiplens_agent import agent as A
from townshiplens_agent.answer import FinalAnswer
from townshiplens_agent.day_voice import Diary, DiaryLine, diaries
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import AgentSettings
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial import tools
from townshiplens_spatial.day import spotlight as S
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

from evals.audit_probes import PREFIX, answer, plan_hero_route

rec, rid, ev = plan_hero_route()
cases = ["The route is exactly 500 m long.", "The toilet has a baby changing room."]
out = {
    "extra_validation": [
        {"text": t, "errors": validate_answer(answer(PREFIX + t, rid, ev), rec)} for t in cases
    ]
}


async def main():
    captured = []

    def model(messages, info):
        captured.extend(
            p.content
            for m in messages
            if isinstance(m, ModelRequest)
            for p in m.parts
            if isinstance(p, UserPromptPart)
        )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    "final_answer",
                    FinalAnswer(
                        answer_status="cannot_answer",
                        summary="I cannot answer that from the available township data.",
                    ).model_dump(),
                )
            ]
        )

    ctx = tools.Ctx(world=load_world(Path("data/seed/elmina")), vrs=VerificationStore(":memory:"))
    mem = SessionMemory()
    original = A.model_for
    A.model_for = lambda *a, **k: FunctionModel(model)
    try:
        events = [
            e.model_dump()
            async for e in run_turn(
                ctx,
                ChatRequest(
                    message="Call +60 (12) 345 6789. My IC is 900101 14 5678.",
                    session_id="independent-audit",
                ),
                AgentSettings(_env_file=None, llm_provider="mock"),
                memory=mem,
            )
        ]
    finally:
        A.model_for = original
    out["privacy"] = {
        "provider_user_prompts": captured,
        "memory_user_prompts": [
            p.content
            for m in mem.history("independent-audit")
            if isinstance(m, ModelRequest)
            for p in m.parts
            if isinstance(p, UserPromptPart)
        ],
        "done": events[-1],
    }
    f = {
        "trips": [
            {
                "id": "trip-1",
                "status": "cancelled",
                "planned": "08:00",
                "left": None,
                "arrived": None,
                "ended": "08:00",
                "late_by_min": 0,
                "waited_min": 0,
                "children_with_them": 0,
                "direction": "out",
                "place": "School",
                "from": "home",
                "to": "school",
                "what_happened": "Could not get to school.",
            }
        ],
        "decisions": [],
    }
    text = "08:00: I reached school on time and attended class."
    c = S.Spotlight(
        id="r1",
        name="Audit resident",
        age=40,
        role="parent",
        persona="default",
        group="adult",
        household="h",
        home_coord=[0, 0],
    )

    class FakeVoice:
        rejected = 0

        async def ask(self, *a, **k):
            return Diary(lines=[DiaryLine(trip="trip-1", text=text)])

    out["spotlight"] = {
        "engine_fact": f,
        "errors": S.check_text(text, f, "trip-1"),
        "diary_result": await diaries(FakeVoice(), [c], {"r1": f}),
    }


asyncio.run(main())
Path(__file__).with_name("supplementary-probes.json").write_text(json.dumps(out, indent=2))
print(json.dumps(out, indent=2))
