"""Benchmark cheap models for Elmina Day's spotlight voices (Cycle 11). Costs money (cents).

uv run python evals/bench_sim_models.py deepseek/deepseek-v4.1-flash xiaomi/mimo-v2.6-flash ...

The same storm day, cast and facts for every model: 1 voices call, 6 decisions, 6 diaries and
one feed round of 6 residents. Reports valid outputs (decisions among the offered options; lines
that pass spotlight.check_text), tokens including reasoning, seconds and an estimated cost from
OpenRouter's public list prices.
"""

import asyncio
import json
import sys
import time
import urllib.request

import pydantic_ai
from townshiplens_agent import day_voice as V
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_spatial.day import spotlight as S
from townshiplens_spatial.day.engine import Day
from townshiplens_spatial.day.population import synthesize
from townshiplens_spatial.day.scenarios import scenarios
from townshiplens_spatial.world import load_world


def prices() -> dict[str, tuple[float, float]]:
    with urllib.request.urlopen("https://openrouter.ai/api/v1/models", timeout=30) as r:
        data = json.load(r)["data"]
    return {
        m["id"]: (float(m["pricing"]["prompt"]), float(m["pricing"]["completion"])) for m in data
    }


async def bench(model: str, world, sc, pop, cast, price) -> dict:
    s = AgentSettings(llm_provider="openrouter", llm_model_sim=model)
    v = V.Voice(s)
    t0 = time.perf_counter()
    import copy

    cast = copy.deepcopy(cast)
    by_id = {c.id: c for c in cast}
    await V.give_voices(v, cast)
    day = Day(world, sc, pop=pop, spotlight=set(by_id))
    res = day.run()
    facts = S.facts_for(res, day, cast)
    points = day.points[:6]
    choices, reasons = await V.decide(v, points, by_id, facts.__getitem__)
    valid_dec = sum(1 for p in points if choices[p.key] in {o["id"] for o in p.options})
    used_ai_dec = len(reasons)
    sample = [c for c in cast if facts[c.id]["trips"]][:6]
    v.rejected = 0
    di = await V.diaries(v, sample, facts)
    ai_lines = sum(1 for c in sample for ln in di[c.id] if ln["voice"] == "ai")
    rejected_lines = v.rejected
    v.rejected = 0
    old_max = V.MAX_ACTIVE
    V.MAX_ACTIVE = 6
    posts = await V.feed(v, sample, facts)
    V.MAX_ACTIVE = old_max
    ai_posts = sum(1 for p in posts if p["voice"] == "ai")
    cost = v.tokens_in * price[0] + v.tokens_out * price[1]
    return {
        "model": model,
        "calls": v.calls,
        "failed": v.failed,
        "decisions_valid": f"{valid_dec}/{len(points)} (AI reasons {used_ai_dec})",
        "diary_ai_lines": ai_lines,
        "diary_rejected": rejected_lines,
        "feed_ai_posts": ai_posts,
        "feed_rejected": v.rejected,
        "tokens_in": v.tokens_in,
        "tokens_out": v.tokens_out,
        "seconds": round(time.perf_counter() - t0, 1),
        "cost_usd": round(cost, 4),
        "example": (di[sample[0].id][0]["text"] if di.get(sample[0].id) else None),
        "voice_example": cast[0].voice,
    }


async def main(models: list[str]) -> None:
    pydantic_ai.BANNER_ENABLED = False
    world = load_world(ROOT / "data/seed/elmina")
    sc = scenarios(world)["storm"]
    pop = synthesize(world, 5000)
    cast = S.choose(pop)
    pr = prices()
    rows = []
    for m in models:
        row = await bench(m, world, sc, pop, cast, pr.get(m, (0.0, 0.0)))
        print(json.dumps(row, ensure_ascii=False))
        rows.append(row)
    out = ROOT / "evals/results/2026-10-17-sim-model-bench.json"
    out.write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
