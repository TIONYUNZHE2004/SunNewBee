"""Run the provisional deep-spot key through run_turn; no shared validator scoring.

The scorer finds numbers with its own patterns and reads values with its own walker; only the
rounding rule is the validator's (facts._matches), so "about 440 m" for 440.6 m is judged the
same way the validator judges it (T-015).

uv run python evals/run_answer_key.py --output evals/results/answer-key-mock.json
Live: --provider openrouter --only id1,id2 (at most ten turns).
These constraint checks are not semantic entailment or a replacement for human review.
"""

import argparse
import asyncio
import hashlib
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

import pydantic_ai
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.facts import _matches as fact_matches
from townshiplens_agent.facts import extract_facts
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

KEY = ROOT / "evals/answer_key/deep_spot.json"
MEASURE = re.compile(
    r"(?<![\w/+])(\d+(?:,\d{3})*(?:\.\d+)?)\s*(km|m|metres?|meters?|minutes?|mins?|minit|%|米|分钟|公里)\b",
    re.I,
)
COUNT = re.compile(r"\b(\d+)\s+(steps?|toilets?|wheelchair toilets?|benches?|seats?)\b", re.I)
PROMISE = re.compile(
    r"\b(?:I guarantee|zero risk|no risk|definitely open|guaranteed open)\b|保证|毫无风险", re.I
)
STATUS = {
    "confirmed": ["confirmed", "no known barrier", "disahkan", "已确认"],
    "partly_unverified": ["partly unverified", "not fully verified", "belum", "未核实", "未验证"],
    "no_data": ["no mapped connection", "not mapped", "couldn't find", "cannot", "can't", "无法"],
    "blocked": ["blocked", "known barrier", "terhalang", "受阻"],
}


def seed_fingerprint(seed):
    digest = hashlib.sha256()
    for path in sorted(p for p in seed.rglob("*") if p.is_file()):
        digest.update(path.relative_to(seed).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def measure_values(case, rec=None):
    """Only typed engine fields supply measurements; never ids, dates or arbitrary numbers.

    Values come from the key's captured engine calls and from what the tools actually returned
    this turn (routes and evidence): an answer may quote the centre route the assistant really
    planned, even if the key captured only the centre list (T-015)."""
    out = {"m": set(), "min": set(), "%": set()}

    def walk(value, key=""):
        if isinstance(value, dict):
            for k, v in value.items():
                walk(v, k)
        elif isinstance(value, list):
            for v in value:
                walk(v, key)
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            unit = (
                "m"
                if key.endswith("_m")
                else "min"
                if "minutes" in key
                else "%"
                if key.endswith("_pct")
                else None
            )
            if unit:
                out[unit].add(float(value))

    for call in case["engine_calls"]:
        walk(call["result"]["data"])
    if rec is not None:
        walk({"routes": list(rec.routes.values())})
        for e in rec.evidence.values():
            if isinstance(e.value, (int, float)) and not isinstance(e.value, bool):
                walk({e.attribute: e.value})
    return out


def _rounds_to(text, m, x, v):
    """The validator's rounding rule (facts._matches): exact, decimal rounding, whole number,
    or a coarser round number with "about" / "kira-kira" / "约"; "under"/"over" must point the
    right way; "exactly" allows no rounding. Compared in the unit written."""
    stated = next(iter(extract_facts(text[max(0, m.start() - 30) : m.end()])[-1:]), None)
    if stated is None:
        return math.isclose(x, v, abs_tol=0.051)
    return fact_matches(stated, v)


def unsupported_claims(text, case, rec=None):
    errors = []
    for match in PROMISE.finditer(text):
        if not re.search(
            r"not |cannot |can't ", text[max(0, match.start() - 15) : match.start()], re.I
        ):
            errors.append("unsupported assurance: " + match.group())
    values = measure_values(case, rec)
    for m in MEASURE.finditer(text):
        x = float(m[1].replace(",", ""))
        unit = m[2].lower()
        if unit in ("km", "公里"):
            x *= 1000
        cls = "min" if unit.startswith("min") or unit == "分钟" else "%" if unit == "%" else "m"
        if not any(_rounds_to(text, m, x, v) for v in values[cls]):
            errors.append("unsupported measurement: " + m.group())
    for m in COUNT.finditer(text):
        noun = m[2].lower()
        supported = set()
        for call in case["engine_calls"]:
            result = call["result"]
            if noun.startswith("step"):
                supported.update(
                    e["value"]
                    for e in result.get("evidence", [])
                    if e.get("attribute") == "step_count"
                    and isinstance(e.get("value"), (int, float))
                )
            elif call["tool"] == "nearby_amenities":
                amenity = call["args"]["amenity"]
                if ("toilet" in noun and amenity == "toilet") or (
                    noun.startswith(("bench", "seat")) and amenity == "seating"
                ):
                    supported.add(len(result["data"]))
        if float(m[1]) not in supported:
            errors.append("unsupported count for this attribute: " + m.group())
    for phrase in case["must_not_include"]:
        if phrase.casefold() in text.casefold():
            errors.append("forbidden factual assertion: " + phrase)
    return list(dict.fromkeys(errors))


def score(case, events, rec):
    text = "".join(e.delta for e in events if e.type == "text.delta")
    folded = text.casefold()
    done = events[-1] if events and events[-1].type == "done" else None
    fails = []
    if done is None:
        fails.append("missing done")
    for group in case["must_include"]:
        if not any(s.casefold() in folded for s in group):
            fails.append("missing any phrase: " + repr(group))
    if case.get("no_tools") and rec.tool_calls:
        fails.append("out-of-scope request called tools")
    facts = case["expected_facts"]
    for item in facts.get("amenities", []):
        if item["name"].casefold() not in folded:
            fails.append("expected amenity not named: " + item["name"])
    if facts.get("centres"):
        nearest = next((c for c in facts["centres"] if c["route_status"] == "confirmed"), None)
        if nearest and nearest["name"].casefold() not in folded:
            fails.append("nearest confirmed candidate not named: " + nearest["name"])
    if "likely_place_ids" in facts:
        names = {
            "playground": "Urban Park playground",
            "lakeside-mall": "Elmina Lakeside Mall",
            "park-b": "Lakeside Mall Car Park B",
            "osm-way-1309457596": "Elmina Urban Park",
        }
        for pid in facts["likely_place_ids"]:
            if names[pid].casefold() not in folded:
                fails.append("affected deep-spot place not named: " + names[pid])
        if facts["likely_place_ids"] and not any(
            s in folded for s in ("likely flooded", "besar kemungkinan", "很可能", "极可能")
        ):
            fails.append("likely flood class not stated at its recorded strength")
    if "status" in facts and not any(s in folded for s in STATUS[facts["status"]]):
        fails.append("missing expected route status: " + facts["status"])
    if case["expected_outcome"] == "refused_correctly":
        if done is None or done.answer_status != "cannot_answer":
            fails.append("expected refusal")
    elif done is None or done.answer_status == "cannot_answer":
        fails.append("answerable/gap question refused")
    if case["engine_calls"] and case["expected_outcome"] != "refused_correctly":
        expected = case["engine_calls"][0]
        if expected["tool"] not in rec.tool_calls:
            fails.append("expected tool not called: " + expected["tool"])
        if expected["tool"] == "plan_route":
            args = expected["args"]
            routes = [
                r
                for r in rec.routes.values()
                if all(r.get(k) == args[k] for k in ("from_id", "to_id", "profile"))
            ]
            if not routes:
                # Engine fields are from_place/to_place, not the tool argument names.
                routes = [
                    r
                    for r in rec.routes.values()
                    if r.get("from_place") == args["from_id"]
                    and r.get("to_place") == args["to_id"]
                    and r.get("profile") == args["profile"]
                ]
            if not routes or routes[0]["status"] != facts["status"]:
                fails.append("tool route endpoints/profile/status differ from key")
            if "routes.0.distance_m" in facts:
                v = facts["routes.0.distance_m"]
                if not any(s in folded for s in (str(v), str(round(v)), f"{v / 1000:g}")):
                    fails.append("expected route distance not stated")
    unsupported = unsupported_claims(text, case, rec)
    fails.extend(unsupported)
    return {
        "id": case["id"],
        "language": case["language"],
        "reviewed": case["reviewed"],
        "expected_outcome": case["expected_outcome"],
        "outcome": "wrong" if fails else case["expected_outcome"],
        "failures": fails,
        "unsupported_claims": unsupported,
        "tools": rec.tool_calls,
        "answer_status": done.answer_status if done else None,
        "model": done.model if done else None,
        "text": text,
    }


def summarize(rows):
    counts = Counter(r["outcome"] for r in rows)
    n = len(rows)
    metrics = {
        k: {"numerator": counts[k], "denominator": n}
        for k in ("correct", "honestly_unverified", "refused_correctly", "wrong")
    }
    metrics["unsupported_claims"] = {
        "numerator": sum(bool(r["unsupported_claims"]) for r in rows),
        "denominator": n,
    }
    return {
        "turns": n,
        "reviewed": sum(r["reviewed"] for r in rows),
        "metrics": metrics,
        "unsupported_claims_overlap_wrong": True,
        "by_expected_outcome": {
            k: {
                "matched": sum(r["outcome"] == k for r in rows),
                "denominator": sum(r["expected_outcome"] == k for r in rows),
            }
            for k in ("correct", "honestly_unverified", "refused_correctly")
        },
    }


async def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key", type=Path, default=KEY)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--provider", choices=("mock", "openrouter"), default="mock")
    parser.add_argument("--only", default="")
    args = parser.parse_args(argv)
    doc = json.loads(args.key.read_text())
    if doc["seed_sha256"] != seed_fingerprint(ROOT / "data/seed/elmina"):
        parser.error("seed changed since capture; regenerate the key and reset human review")
    cases = doc["cases"]
    if args.only:
        wanted = set(args.only.split(","))
        cases = [c for c in cases if c["id"] in wanted]
        if wanted != {c["id"] for c in cases}:
            parser.error("unknown case id")
    if not cases:
        parser.error("no cases selected")
    if args.provider == "openrouter" and (not args.only or len(cases) > 10):
        parser.error("live checks require explicit --only and at most 10 turns")
    settings = AgentSettings(
        llm_provider=args.provider, demo_mode=False, assistant_scope=doc["scope"]
    )
    world = load_world(ROOT / "data/seed/elmina")
    rows = []
    pydantic_ai.BANNER_ENABLED = False
    for case in cases:
        ctx = tools.Ctx(world=world, vrs=VerificationStore(":memory:"))
        rec = TurnRecord()
        events = [
            e
            async for e in run_turn(
                ctx,
                ChatRequest(
                    message=case["question"],
                    profile=case["profile"],
                    scenario_id=case.get("scenario_id"),
                ),
                settings,
                record=rec,
                memory=SessionMemory(),
            )
        ]
        row = score(case, events, rec)
        rows.append(row)
        print(f"{case['id']:<25} {row['outcome']}")
    report = {
        "mode": args.provider,
        "key_seed_sha256": doc["seed_sha256"],
        "provisional": any(not c["reviewed"] for c in cases),
        "limitations": (
            "Constraint checks and typed numeric checks, not complete semantic entailment. "
            "Human review is required. Unsupported claims counts detected turns "
            "and overlaps wrong."
        ),
        "summary": summarize(rows),
        "rows": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(report["summary"], indent=2))
    return int(any(r["outcome"] == "wrong" for r in rows))


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
