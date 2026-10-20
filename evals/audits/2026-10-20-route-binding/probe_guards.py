# ruff: noqa: E501
"""Try to break the route binding (route_binding.py) with honest questions: free, engine only.

Each case is a question a resident could ask, with the plan_route call an honest model would
make. A guard that blocks it (ModelRetry) or silently changes its mode/scenario is a finding.
uv run python evals/audits/2026-10-20-route-binding/probe_guards.py
"""

import asyncio
import json
from pathlib import Path

from pydantic_ai import ModelRetry
from townshiplens_agent import agent as A
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.settings import ROOT
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

MAHDI, TAQWA = "osm-way-910405528", "osm-way-910378231"
# (id, question, ui profile, ui scenario, plan_route args, expected profile, expected scenario)
CASES = [
    (
        "b01",
        "My mum is not in a wheelchair, she walks with a stick. How does she get from Surau Al Mahdi to Surau At Taqwa?",
        "default",
        None,
        dict(from_id=MAHDI, to_id=TAQWA, profile="default"),
        "default",
        None,
    ),
    (
        "b02",
        "Take me to Surau At Taqwa, starting at Surau Al Mahdi.",
        "default",
        None,
        dict(from_id=MAHDI, to_id=TAQWA, profile="default"),
        "default",
        None,
    ),
    (
        "b03",
        "My house is 2 m from the river. How do I walk from Surau Al Mahdi to Surau At Taqwa?",
        "default",
        None,
        dict(from_id=MAHDI, to_id=TAQWA, profile="default"),
        "default",
        None,
    ),
    (
        "b04",
        "Can my father in a wheelchair go from Surau Al Mahdi to Surau At Taqwa, and are there rest points?",
        "wheelchair",
        None,
        dict(from_id=MAHDI, to_id=TAQWA, profile="wheelchair"),
        "wheelchair",
        None,
    ),
    (
        "b05",
        "Boleh saya tolak kereta sorong dari Lakeside Mall Car Park B ke taman permainan?",
        "stroller",
        None,
        dict(from_id="park-b", to_id="playground", profile="stroller"),
        "stroller",
        None,
    ),
    (
        "b06",
        "从B停车场推婴儿车去游乐场怎么走？",
        "stroller",
        None,
        dict(from_id="park-b", to_id="playground", profile="stroller"),
        "stroller",
        None,
    ),
    (
        "b07",
        "How do I get to the playground from Car Park B?",
        "default",
        None,
        dict(from_id="park-b", to_id="playground", profile="default"),
        "default",
        None,
    ),
    (
        "b08",
        "Surau Al Mahdi → Surau At Taqwa, walking",
        "default",
        None,
        dict(from_id=MAHDI, to_id=TAQWA, profile="default"),
        "default",
        None,
    ),
    (
        "b09",
        "I'm at Surau Al Mahdi. Is Surau At Taqwa reachable on foot?",
        "default",
        None,
        dict(from_id=MAHDI, to_id=TAQWA, profile="default"),
        "default",
        None,
    ),
    (
        "b10",
        "From Surau Al Mahdi to Surau At Taqwa, the 5 m wide path please",
        "default",
        None,
        dict(from_id=MAHDI, to_id=TAQWA, profile="default"),
        "default",
        None,
    ),
    (
        "b11",
        "If the river rises 3 m, can I walk from Surau Al Mahdi to Surau At Taqwa?",
        "default",
        None,
        dict(from_id=MAHDI, to_id=TAQWA, profile="default"),
        "default",
        "stage_p3m",
    ),
    (
        "b12",
        "Dari Surau Al Mahdi ke Surau At Taqwa, saya tidak guna kerusi roda.",
        "wheelchair",
        None,
        dict(from_id=MAHDI, to_id=TAQWA, profile="default"),
        "default",
        None,
    ),
    (
        "b13",
        "Walking from Elmina Lakeside Mall to Elmina Urban Park, then I need a toilet",
        "default",
        None,
        dict(from_id="lakeside-mall", to_id="osm-way-1309457596", profile="default"),
        "default",
        None,
    ),
    (
        "b14",
        "How far is Surau At Taqwa from Surau Al Mahdi?",
        "default",
        None,
        dict(from_id=MAHDI, to_id=TAQWA, profile="default"),
        "default",
        None,
    ),
]


async def one(world, case):
    cid, q, ui, scen, args, want_profile, want_scen = case
    ctx = tools.Ctx(world=world, vrs=VerificationStore(":memory:"))
    rec = TurnRecord()
    rec.strict_selection = True
    deps = A.Deps(ctx=ctx, rec=rec, request=ChatRequest(message=q, profile=ui, scenario_id=scen))
    try:
        out = await A.call_tool(deps, "plan_route", **args)
    except ModelRetry as exc:
        return {"id": cid, "question": q, "result": "BLOCKED", "why": str(exc)}
    r = (out["data"].get("routes") or [{}])[0]
    got = (r.get("profile"), r.get("scenario_id"))
    ok = got == (want_profile, want_scen)
    return {
        "id": cid,
        "question": q,
        "result": "OK" if ok else "CHANGED",
        "profile/scenario": got,
        "expected": (want_profile, want_scen),
    }


async def main():
    world = load_world(ROOT / "data/seed/elmina")
    rows = [await one(world, c) for c in CASES]
    for r in rows:
        print(f"{r['id']} {r['result']:<8} {r.get('why') or r.get('profile/scenario')}")
    out = Path(__file__).with_name("probe_guards.json")
    out.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")


asyncio.run(main())
