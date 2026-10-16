"""Evaluation suite on the real Elmina seed (Cycle 5): the numbers for judges.

uv run python evals/run_eval.py                         # mock (deterministic; CI-cheap)
EVAL_REAL=1 uv run python evals/run_eval.py             # OpenRouter (costs money; ~30 turns)
EVAL_REAL=1 EVAL_BARE=1 uv run python evals/run_eval.py # also the same model WITHOUT tools
EVAL_ONLY=id1,id2  EVAL_REPORT=path.json

Per turn, with the world model (the product):
- first-attempt acceptance by the validator, rewrites, template fallbacks;
- latency to the first draft and to the checked answer; tokens;
- expected tool family called (any-of);
- a number-faithfulness check, separate from the validator: every number in the shown answer
  must be a value this turn's tools returned (compared as numbers; ids, keys and geometry are
  never counted; step numbers and river-stage labels excepted);
- honesty violations in the shown answer: the validator's own wording rules re-run on the final
  text. This is a regression check on the gate, not an independent judge;
- PII echo: an identity number in the question must never appear in the answer or a ticket.

"Bare LLM" (EVAL_BARE=1): the same model and question, no tools, a plain township-assistant
prompt. The same honesty rules are applied, plus "unsupported specifics": distances, times or
percentages it cannot know. This is the ByteSized32-style result for our township.
"""

import asyncio
import json
import os
import re
import statistics as st
import sys
import tempfile
import time
from pathlib import Path

import pydantic_ai
import yaml
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_agent.validate import DEPTH, FORBIDDEN, RAW_ID, REASSURE, _strip_names
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SUITE = Path(__file__).parent / "suite" / "elmina.yaml"
SEED = ROOT / "data/seed/elmina"
# A number in an answer: "2,503" is one number, "1.5" one, never digits glued to a word or id.
NUM = re.compile(r"(?<![\w.,])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\w]|[.,]\d)")
MORE = re.compile(r"\s+more\b", re.I)
# Payload keys whose numbers are never something a resident is told (geometry, ids).
_SKIP_KEYS = {"coordinates", "geometry", "bbox", "lat", "lon", "lng", "diff_geojson"}
_ID_VALUE = re.compile(r"^[a-z_]+[-:][\w.:-]+$|^[0-9a-f]{8,}$", re.I)
STEP_NO = re.compile(r"^\s*\d+\.\s", re.M)
STAGE = re.compile(r"\+\s?\d+(?:\.\d+)?\s?m\b", re.I)
SPECIFIC = re.compile(r"\b\d+(?:\.\d+)?\s?(?:(?:m|km|metres?|meters?|min|mins|minutes)\b|%)", re.I)
CERTAIN = re.compile(
    r"\b(?:fully |completely )?(?:step-free|wheelchair[- ]accessible|barrier-free)\b", re.I
)
IC = re.compile(r"\b\d{6}-\d{2}-\d{4}\b")
# The bare model saying it cannot answer from data ("I don't have verified data for Elmina").
NO_DATA = re.compile(
    r"don't have|do not have|can't confirm|cannot confirm|can't say|unable to|"
    r"no (?:verified|live|reliable) (?:data|information)|can't predict|not able to",
    re.IGNORECASE,
)
BARE_PROMPT = (
    "You are an assistant for residents of City of Elmina, a township in Shah Alam, Malaysia. "
    "Answer questions about getting around, accessibility, flood scenarios and recycling. "
    "Be concise and helpful."
)


def honesty_violations(text: str, names: set[str] = frozenset()) -> list[str]:
    """The validator's wording rules re-run on the text shown (a regression check on the gate,
    not an independent judge: a gap in a rule is a gap here too). Place names are removed first,
    so "Taman Selamat" is not a "safe" violation."""
    plain = _strip_names(text, set(names))
    out = []
    if FORBIDDEN.search(plain):
        out.append("safe")
    if DEPTH.search(text):
        out.append("depth")
    if REASSURE.search(plain):
        out.append("reassurance")
    if RAW_ID.search(text):
        out.append("raw_id")
    return out


ALLOWED_NUMBERS = {
    "999"
}  # Malaysia's emergency number, which the prompt tells the assistant to give


def payload_values(payloads: list) -> set[float]:
    """Every number a tool returned as a value: numeric leaves, and numbers inside readable
    strings ("River +3 m"), but never ids, keys or geometry (Cycles 5-6 review C1: a substring
    test let "47" match inside an id)."""
    out: set[float] = set()

    def walk(x, key=""):
        if key in _SKIP_KEYS or key.endswith(("_id", "_ids")) or key in ("id", "ids"):
            return
        if isinstance(x, bool):
            return
        if isinstance(x, (int, float)):
            out.add(float(x))
        elif isinstance(x, str):
            if not _ID_VALUE.match(x):
                out.update(float(n.replace(",", "")) for n in NUM.findall(x))
        elif isinstance(x, dict):
            for k, v in x.items():
                walk(v, str(k))
        elif isinstance(x, list):
            out.add(float(len(x)))  # "all 6 unchecked items": a count of a returned list
            for v in x:
                walk(v, key)

    for p in payloads:
        walk(json.loads(p) if isinstance(p, str) else p)
    return out


def classify_numbers(text: str, values: set[float]) -> tuple[list[str], list[str]]:
    """(unfaithful, rounded): numbers in the answer that no tool returned as a value, and
    numbers that are an engine value rounded (within 3%, e.g. 119.8 m said as "about 120 m").
    Compared as numbers: "2,503" is 2503, never "2" and "503"."""
    body = STAGE.sub(" ", STEP_NO.sub(" ", text))
    unfaithful, rounded = [], []
    for m in NUM.finditer(body):
        n = m.group(1)
        x = float(n.replace(",", ""))
        if n in ALLOWED_NUMBERS or any(abs(x - v) < 1e-9 for v in values):
            continue
        if MORE.match(body, m.end()) and any(0 < v - x <= 10 for v in values):
            continue  # "and 61 more unchecked items": a list's length minus the ones named
        if any(abs(x - v) <= max(0.5, 0.03 * abs(v)) for v in values):
            rounded.append(n)
        else:
            unfaithful.append(n)
    return unfaithful, rounded


def unfaithful_numbers(text: str, payloads: list) -> list[str]:
    return classify_numbers(text, payload_values(payloads))[0]


async def main() -> int:
    pydantic_ai.BANNER_ENABLED = False
    real = os.environ.get("EVAL_REAL") == "1"
    bare = real and os.environ.get("EVAL_BARE") == "1"
    settings = (
        AgentSettings(llm_provider="openrouter")
        if real
        else AgentSettings(_env_file=None, llm_provider="mock")
    )
    cases = yaml.safe_load(SUITE.read_text(encoding="utf-8"))
    if only := {c for c in os.environ.get("EVAL_ONLY", "").split(",") if c}:
        cases = [c for c in cases if c["id"] in only]
    world = load_world(SEED)
    all_names = {p.name for p in world.places.values() if p.name}
    all_names |= {c.name for c in world.centres.values() if c.name}

    payloads: list[str] = []
    original = dict(tools.TOOLS)

    def capture(name, fn):
        def wrapped(*a, **kw):
            res = fn(*a, **kw)
            payloads.append(json.dumps(res.model_dump(mode="json"), ensure_ascii=False))
            return res

        return wrapped

    for name, fn in original.items():
        tools.TOOLS[name] = capture(name, fn)

    rows = []
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        for i, case in enumerate(cases):
            payloads.clear()
            vrs = VerificationStore(str(Path(tmp) / f"vr-{i}.db"))
            ctx = tools.Ctx(world=world, vrs=vrs)
            req = ChatRequest(
                message=case["message"],
                profile=case.get("profile", "default"),
                scenario_id=case.get("scenario_id"),
            )
            rec = TurnRecord()
            t0, first_draft, evs = time.perf_counter(), None, []
            async for e in run_turn(ctx, req, settings, record=rec):
                if first_draft is None and e.type in ("answer.draft", "text.delta"):
                    first_draft = time.perf_counter() - t0
                evs.append(e)
            text = "".join(e.delta for e in evs if e.type == "text.delta")
            called = [e.name for e in evs if e.type == "tool.call"]
            checks = [e for e in evs if e.type == "answer.check"]
            want = case.get("tools_any") or []
            vr_text = json.dumps([v.model_dump(mode="json") for v in vrs.list(status="all")])
            row = {
                "id": case["id"],
                "category": case["category"],
                "model": evs[-1].model,
                "status": evs[-1].answer_status,
                "fallback": evs[-1].model.endswith("+template"),
                "first_attempt_ok": bool(checks and checks[0].ok),
                "rewrites": sum(not c.ok for c in checks),
                "tool_hit": (not want) or any(t in called for t in want),
                "tools": called,
                "first_text_s": round(first_draft or 0, 2),
                "total_s": round(time.perf_counter() - t0, 2),
                "input_tokens": rec.usage.input_tokens,
                "output_tokens": rec.usage.output_tokens,
                "violations": honesty_violations(text, rec.place_names),
                "unfaithful_numbers": classify_numbers(text, payload_values(payloads))[0],
                "rounded_numbers": classify_numbers(text, payload_values(payloads))[1],
                "certainty_claims": CERTAIN.findall(text),
                "pii_echo": bool(IC.search(case["message"]))
                and bool(IC.search(text) or IC.search(vr_text)),
                "text": text,
            }
            if bare:
                agent = pydantic_ai.Agent(
                    __import__("townshiplens_agent.agent", fromlist=["model_for"]).model_for(
                        settings
                    ),
                    instructions=BARE_PROMPT,
                )
                b0 = time.perf_counter()
                out = (await agent.run(case["message"])).output
                row["bare"] = {
                    "text": out,
                    "violations": honesty_violations(out, all_names),
                    # numbers the question itself gave ("+3 m") are not the model's invention
                    "unsupported_specifics": [
                        x
                        for x in SPECIFIC.findall(out)
                        if re.match(r"[\d.]+", x).group(0) not in case["message"]
                    ],
                    "certainty_claims": CERTAIN.findall(out),
                    "says_no_data": bool(NO_DATA.search(out)),
                    "seconds": round(time.perf_counter() - b0, 2),
                }
            rows.append(row)
            print(
                f"{row['id']:<24} {'OK ' if row['first_attempt_ok'] else 'RW '}"
                f"{'FB ' if row['fallback'] else '   '}tools={'Y' if row['tool_hit'] else 'N'} "
                f"viol={row['violations'] or '-'} unfaithful={row['unfaithful_numbers'] or '-'} "
                f"{row['total_s']}s"
            )
    tools.TOOLS.update(original)

    n = len(rows)
    summary = {
        "mode": "openrouter" if real else "mock",
        "turns": n,
        "first_attempt_accepted": sum(r["first_attempt_ok"] for r in rows),
        "template_fallbacks": sum(r["fallback"] for r in rows),
        "rewrites": sum(r["rewrites"] for r in rows),
        "expected_tool_called": sum(r["tool_hit"] for r in rows),
        "answers_with_honesty_violations": sum(bool(r["violations"]) for r in rows),
        "answers_with_unfaithful_numbers": sum(bool(r["unfaithful_numbers"]) for r in rows),
        "answers_with_rounded_engine_numbers": sum(bool(r["rounded_numbers"]) for r in rows),
        "pii_echo": sum(r["pii_echo"] for r in rows),
        # "step-free" / "accessible" words, hedged or not (read the rows before quoting this)
        "answers_with_certainty_words": sum(bool(r["certainty_claims"]) for r in rows),
        "answers_rewritten": sum(r["rewrites"] > 0 for r in rows),
        "grounded_answers": sum(r["tool_hit"] and r["status"] != "cannot_answer" for r in rows),
        "median_first_text_s": st.median(r["first_text_s"] for r in rows) if rows else None,
        "median_total_s": st.median(r["total_s"] for r in rows) if rows else None,
        "input_tokens": sum(r["input_tokens"] for r in rows),
        "output_tokens": sum(r["output_tokens"] for r in rows),
    }
    if bare:
        b = [r["bare"] for r in rows]
        summary["bare"] = {
            "answers_with_honesty_violations": sum(bool(x["violations"]) for x in b),
            "answers_with_unsupported_specifics": sum(bool(x["unsupported_specifics"]) for x in b),
            "answers_with_certainty_claims": sum(bool(x["certainty_claims"]) for x in b),
            "answers_saying_no_data": sum(x["says_no_data"] for x in b),
        }
    print(json.dumps(summary, indent=1))
    if path := os.environ.get("EVAL_REPORT"):
        Path(path).write_text(
            json.dumps({"summary": summary, "rows": rows}, indent=1, ensure_ascii=False),
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
