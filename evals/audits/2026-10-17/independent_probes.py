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
from pydantic_ai.models.function import FunctionModel
from townshiplens_agent import agent as A
from townshiplens_agent.draft import DraftStreamer
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.redact import redact
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import AgentSettings
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

from evals.audit_probes import PREFIX, answer, plan_hero_route

rec, rid, ev = plan_hero_route()
rows = []


def check(label, text, expected_reject=True, **changes):
    a = answer(PREFIX + text, rid, ev).model_copy(update=changes)
    errors = validate_answer(a, rec)
    rows.append(
        {
            "label": label,
            "text": text,
            "expected_reject": expected_reject,
            "accepted": not errors,
            "errors": errors,
        }
    )


check("honest rounding", "The route is about 440 m.", False)
check("invented large count", "There are 99 steps on this route.")
check("invented amenity count", "There are 27 wheelchair toilets beside the playground.")
check("borrow slope as time", "The walk takes 3 minutes.")
check("borrow a list count as distance", "The route is 1 km long.")
check("borrow slope as width", "The whole route is 3 m wide.")
check("unmeasured opening hours", "The Urban Park toilet is open 24 hours every day.")
check("unmeasured time written out", "You will arrive in two minutes.")
check("negation scope", "No steps, so I guarantee this route is accessible.")
check("reassurance variant", "There is zero risk on this route.")
check("empty citations", "There are 99 steps on this route.", claims=[])
check("refusal bypass", "It is 950 m long and takes 2 minutes.", answer_status="cannot_answer")


async def async_checks():
    rec.queue = asyncio.Queue()
    draft = DraftStreamer(type("Deps", (), {"rec": rec})())
    await draft._start_attempt()
    await draft._emit(PREFIX + "I guarantee there are no steps. It is 950 m long.", final=True)
    draft_events = []
    while not rec.queue.empty():
        draft_events.append(rec.queue.get_nowait().model_dump())
    world = load_world(Path("data/seed/elmina"))
    ctx = tools.Ctx(world=world, vrs=VerificationStore("/tmp/independent-audit-vrs.db"))
    amenities = tools.TOOLS["nearby_amenities"](
        ctx, origin_id="playground", amenity="toilet", max_walk_m=500, profile="wheelchair"
    )
    # Real run_turn with a deterministic adversarial model, no network or paid calls.
    count = 0

    def model(messages, info):
        nonlocal count
        count += 1
        if count == 1:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "plan_route",
                        {"from_id": "park-b", "to_id": "playground", "profile": "stroller"},
                    )
                ]
            )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    "final_answer",
                    answer(PREFIX + "There are 99 steps on this route.", rid, ev).model_dump(),
                )
            ]
        )

    original = A.model_for
    A.model_for = lambda *args, **kwargs: FunctionModel(model)
    try:
        events = [
            e.model_dump()
            async for e in run_turn(
                ctx,
                ChatRequest(message="How many steps are on the route?", profile="stroller"),
                AgentSettings(_env_file=None, llm_provider="mock"),
                memory=SessionMemory(),
            )
        ]
    finally:
        A.model_for = original
    return {
        "draft_events": draft_events,
        "amenity_tool": amenities.model_dump(mode="json"),
        "end_to_end_events": events,
        "model_calls": count,
    }


out = {
    "route_distance_m": rec.routes[rid]["distance_m"],
    "route_minutes": rec.routes[rid].get("est_minutes"),
    "route_measures": {k: sorted(v) for k, v in rec.tool_measures.items()},
    "validator_cases": rows,
    "redaction_cases": [
        {"input": s, "output": redact(s)}
        for s in [
            "Call +60 (12) 345 6789",
            "My IC is 900101 14 5678",
            "Email aisyah@example.com or phone 012-345 6789",
        ]
    ],
    **asyncio.run(async_checks()),
}
Path(__file__).with_name("independent-probes.json").write_text(json.dumps(out, indent=2))
for r in rows:
    print(("ACCEPTED" if r["accepted"] else "REJECTED"), r["label"], r["errors"])
print("Draft:", out["draft_events"])
print("End-to-end done:", out["end_to_end_events"][-1])
print(
    "End-to-end text:",
    "".join(e["delta"] for e in out["end_to_end_events"] if e["type"] == "text.delta"),
)
print("Redaction:", out["redaction_cases"])
print("Amenity:", json.dumps(out["amenity_tool"])[:2500])
