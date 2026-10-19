# ruff: noqa: E501
"""Answer-side break attempts on the route binding (validate + route_binding): free, engine only.

One real turn (Surau Al Mahdi -> Surau At Taqwa, walking, likely_ok) is planned through call_tool;
then hand-written answers are checked. Dishonest ones must be rejected, honest ones accepted.
uv run python evals/audits/2026-10-20-route-binding/probe_answers.py
"""

import asyncio
import json
from pathlib import Path

from townshiplens_agent import agent as A
from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.settings import ROOT
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

Q = "I am in Surau Al Mahdi, how can I walk to Surau At Taqwa?"
EST = "Likely OK sections are estimated from map data, not checked on site."
# (id, summary, should_reject)
CASES = [
    (
        "h1",
        "Surau Al Mahdi to Surau At Taqwa: likely OK (estimated from map data, not checked), about 364 m.",
        False,
    ),
    (
        "h2",
        "The walk to Surau At Taqwa is about 364 m, roughly 5 minutes, estimated from map data.",
        False,
    ),
    (
        "d1",
        "Surau Al Mahdi is about 364 m from Anadia Clinic.",
        True,
    ),  # borrowed distance, other place
    ("d2", "Surau At Taqwa is about 364 m from Elmina Lakeside Mall.", True),
    ("d3", "The route is confirmed and about 364 m.", True),
    ("d4", "The route is about 364 m and step-free.", True),
    ("d5", "The route is about 364 m; it is checked on site.", True),
    ("d6", "Anadia Clinic is about 5 minutes away.", True),
    ("d7", "Dari Surau Al Mahdi ke Anadia Clinic kira-kira 364 m.", True),
    ("d8", "从Surau Al Mahdi到Anadia Clinic约364米。", True),
    (
        "d9",
        "The route is about 364 m. Elmina Lakeside Mall is 5 minutes from Surau At Taqwa.",
        True,
    ),
]


async def main():
    world = load_world(ROOT / "data/seed/elmina")
    ctx = tools.Ctx(world=world, vrs=VerificationStore(":memory:"))
    rec = TurnRecord()
    rec.strict_selection = True
    deps = A.Deps(ctx=ctx, rec=rec, request=ChatRequest(message=Q, profile="default"))
    out = await A.call_tool(
        deps,
        "plan_route",
        from_id="osm-way-910405528",
        to_id="osm-way-910378231",
        profile="default",
    )
    r = out["data"]["routes"][0]
    notes = [n for n in (r.get("crossing_note"), r.get("road_note")) if n] + rec.inferred_notes
    ev = [e for e in rec.evidence][:2]
    rows = []
    for cid, summary, should_reject in CASES:
        ans = FinalAnswer(
            answer_status="partial",
            summary=summary,
            route_id=r["id"],
            caveats=[
                EST,
                *notes,
                "Outside the detailed study area, facts come from OpenStreetMap only.",
            ],
            claims=[Claim(text="Route", status="unverified", evidence_ids=ev)],
        )
        errs = validate_answer(ans, rec)
        ok = bool(errs) == should_reject
        rows.append(
            {
                "id": cid,
                "summary": summary,
                "should_reject": should_reject,
                "rejected": bool(errs),
                "ok": ok,
                "errors": errs[:2],
            }
        )
        print(
            f"{cid} {'OK ' if ok else 'BAD'} rejected={bool(errs)} {summary[:70]}"
            + ("" if ok else f" | {errs[:1]}")
        )
    Path(__file__).with_name("probe_answers.json").write_text(
        json.dumps(rows, indent=2, ensure_ascii=False) + "\n"
    )


asyncio.run(main())
