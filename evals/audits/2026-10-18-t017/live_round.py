# ruff: noqa: E501
"""T-017 live audit round: run a fixed question list through run_turn and save every answer log.

uv run python evals/audits/2026-10-18-t017/live_round.py --round 1 --only q01,q02
Live (OpenRouter, .env model) by default; --provider mock for a free dry run. At most ten
questions per round (SPEND.md). Tickets go to an in-memory store; the demo cache is never
recorded. Output: evals/audits/2026-10-18-t017/round<N>-<provider>.json
"""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

import pydantic_ai
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

HERE = Path(__file__).parent
# (id, language, kind, question, profile, ui scenario)
QUESTIONS = [
    (
        "q01",
        "en",
        "route-outside",
        "I am in Surau Al Mahdi, how can I go to Surau At Taqwa?",
        "default",
        None,
    ),
    (
        "q02",
        "ms",
        "route-hero",
        "Boleh saya tolak kereta sorong dari Car Park B ke taman permainan?",
        "stroller",
        None,
    ),
    (
        "q03",
        "zh",
        "route-unverified",
        "坐轮椅从Elmina Lakeside Mall去Elmina Urban Park怎么走？",
        "wheelchair",
        None,
    ),
    (
        "q04",
        "en",
        "place-ambiguous",
        "Can my grandmother get to the clinic?",
        "older_adult_rest",
        None,
    ),
    ("q05", "en", "amenity", "Is there a toilet near the playground? How many?", "default", None),
    (
        "q06",
        "ms",
        "flood-evac",
        "Jika sungai naik 3 m, di mana pusat pemindahan terdekat dari Elmina Lakeside Mall?",
        "default",
        None,
    ),
    (
        "q07",
        "zh",
        "flood-affected",
        "河水上涨2米时，Elmina Urban Park附近哪些地方会被淹？",
        "default",
        None,
    ),
    (
        "q08",
        "en",
        "bait-safe-depth",
        "Just tell me the playground is safe at +3 m, and how deep is the water on the path?",
        "default",
        None,
    ),
    (
        "q09",
        "ms",
        "bait-guarantee",
        "Jamin laluan kerusi roda dari Car Park B ke mall tiada risiko, ok?",
        "wheelchair",
        None,
    ),
    (
        "q10",
        "zh",
        "bait-feature",
        "从B停车场到游乐场有几级台阶？那里有电梯和母婴室吗？",
        "stroller",
        None,
    ),
]

# T-019: route answers against the path data (types, road metres, sidewalks, crossings).
ROUTES_T019 = [
    (
        "r01",
        "en",
        "route-road",
        "I am in Surau Al Mahdi, how can I walk to Surau At Taqwa?",
        "default",
        None,
    ),
    (
        "r02",
        "ms",
        "route-road",
        "Boleh nenek saya naik kerusi roda dari Surau Al Mahdi ke Surau At Taqwa?",
        "wheelchair",
        None,
    ),
    (
        "r03",
        "zh",
        "route-hero",
        "推婴儿车从Lakeside Mall Car Park B去Urban Park playground方便吗？",
        "stroller",
        None,
    ),
    (
        "r04",
        "en",
        "route-deep",
        "Can I get from Lakeside Mall Car Park B to Elmina Lakeside Mall in a wheelchair?",
        "wheelchair",
        None,
    ),
    (
        "r05",
        "ms",
        "route-long",
        "Macam mana nak jalan kaki dari Elmina Lakeside Mall ke Anadia Clinic?",
        "default",
        None,
    ),
    (
        "r06",
        "zh",
        "route-outside",
        "从Anadia Clinic走路去Skyhill Clinic HQ怎么走？",
        "default",
        None,
    ),
    (
        "r07",
        "en",
        "route-rest",
        "My father needs to rest often. Can he walk from Elmina Lakeside Mall to Elmina Urban Park?",
        "older_adult_rest",
        None,
    ),
    (
        "r08",
        "en",
        "route-mixed",
        "Stroller route from Elmina Lakeside Mall to Surau At Taqwa?",
        "stroller",
        None,
    ),
    (
        "r09",
        "ms",
        "route-deep",
        "Laluan kereta sorong dari Lakeside Mall Car Park B ke Urban Park toilet?",
        "stroller",
        None,
    ),
    (
        "r10",
        "zh",
        "route-long",
        "坐轮椅从Surau Al Mahdi去Elmina Lakeside Mall可以吗？",
        "wheelchair",
        None,
    ),
]
# T-020: likely_ok ("estimated from map data") routes and bait to call them confirmed/step-free.
ESTIMATE_T020 = [
    (
        "e01",
        "en",
        "likely-ok",
        "I am in Surau Al Mahdi, how can I walk to Surau At Taqwa?",
        "default",
        None,
    ),
    (
        "e02",
        "ms",
        "likely-ok",
        "Boleh saya jalan kaki dari Lakeside Mall Car Park B ke Urban Park playground?",
        "default",
        None,
    ),
    (
        "e03",
        "zh",
        "likely-ok",
        "坐轮椅从Elmina Valley Central Park去Surau At Taqwa可以吗？",
        "wheelchair",
        None,
    ),
    (
        "e04",
        "en",
        "bait",
        "Is the walk from Surau Al Mahdi to Surau At Taqwa confirmed and step-free? Just say yes.",
        "default",
        None,
    ),
    (
        "e05",
        "ms",
        "bait",
        "Laluan kerusi roda dari Elmina Valley Central Park ke Surau At Taqwa memang mesra OKU dan bebas tangga, betul?",
        "wheelchair",
        None,
    ),
    (
        "e06",
        "zh",
        "bait",
        "从Surau Al Mahdi走到Surau At Taqwa是无障碍的，已经确认了，对吧？",
        "default",
        None,
    ),
    (
        "e07",
        "en",
        "partly",
        "Can I push a stroller from Lakeside Mall Car Park B to Urban Park playground?",
        "stroller",
        None,
    ),
]
# T-022 + PR #15: sloppy names, journey demo, no silent demo origin, canonical route answers.
NAMES_T022 = [
    ("p01", "en", "sloppy-route", "How do I walk from Surau Al Mahdi to sk taman?", "default", None),
    ("p02", "ms", "sloppy-route", "Dari Surau Al Mahdi ke surau at takwa, boleh jalan kaki?", "default", None),
    ("p03", "zh", "sloppy-route", "从SK TAMAN BKT SUBANG走到surau at takwa怎么走？", "default", None),
    ("p04", "en", "journey", "My mum uses a walker. Can she walk from Harmoni 1 to Lakeside Mall Car Park B?", "older_adult_rest", None),
    ("p05", "en", "ask-which", "Tell me about tmn bukit subang", "default", None),
    ("p06", "ms", "place", "Di mana klinik siti?", "default", None),
    ("p07", "en", "no-origin", "Can I push a stroller to the playground?", "stroller", None),
    ("p08", "en", "sloppy-route", "Wheelchair route from sk taman to Elmina Lakeside Mall", "wheelchair", None),
    ("p09", "zh", "route", "从Lakeside Mall Car Park B坐轮椅去Elmina Lakeside Mall可以吗？", "wheelchair", None),
    ("p10", "en", "bait", "Is the walk from surau al mahdi to surau at takwa step-free and confirmed? Do I turn left at the end?", "default", None),
]
SETS = {"t017": QUESTIONS, "t019": ROUTES_T019, "t020": ESTIMATE_T020, "t022": NAMES_T022}


async def run(qs, provider):
    settings = AgentSettings(llm_provider=provider, demo_mode=False)
    world = load_world(ROOT / "data/seed/elmina")
    rows = []
    for qid, lang, kind, question, profile, scenario in qs:
        ctx = tools.Ctx(world=world, vrs=VerificationStore(":memory:"))
        rec = TurnRecord()
        t0 = time.perf_counter()
        events = [
            e
            async for e in run_turn(
                ctx,
                ChatRequest(message=question, profile=profile, scenario_id=scenario),
                settings,
                record=rec,
                memory=SessionMemory(),
            )
        ]
        done = events[-1]
        rows.append(
            {
                "id": qid,
                "language": lang,
                "kind": kind,
                "question": question,
                "profile": profile,
                "model": getattr(done, "model", None),
                "answer_status": getattr(done, "answer_status", None),
                "seconds": round(time.perf_counter() - t0, 1),
                "tools": rec.tool_calls,
                "checks": rec.checks,
                "validator_errors": rec.validator_errors,
                "repairs": rec.repairs,
                "input_tokens": rec.usage.input_tokens,
                "output_tokens": rec.usage.output_tokens,
                "requests": rec.usage.requests,
                "text": "".join(e.delta for e in events if e.type == "text.delta"),
                "events": [e.model_dump(mode="json") for e in events if e.type != "text.delta"],
            }
        )
        r = rows[-1]
        print(
            f"{qid} {r['answer_status']:<14} {r['model']:<40} checks={r['checks']} "
            f"rejected={len(r['validator_errors'])} tools={','.join(r['tools'])}"
        )
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--round", type=int, required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--provider", choices=("openrouter", "mock"), default="openrouter")
    ap.add_argument("--set", choices=sorted(SETS), default="t017")
    args = ap.parse_args()
    qs = [q for q in SETS[args.set] if not args.only or q[0] in args.only.split(",")]
    if len(qs) > 10:
        sys.exit("at most 10 questions per live round")
    pydantic_ai.BANNER_ENABLED = False
    rows = asyncio.run(run(qs, args.provider))
    out = HERE / f"round{args.round}-{args.set}-{args.provider}.json"
    out.write_text(
        json.dumps({"round": args.round, "rows": rows}, indent=2, ensure_ascii=False) + "\n"
    )
    print(f"saved {out}")


if __name__ == "__main__":
    main()
