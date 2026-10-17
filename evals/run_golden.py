"""Golden hero questions against the tiny fixture. Exit 1 on any failure.

pnpm golden                  # deterministic mock model (CI)
GOLDEN_REAL=1 pnpm golden    # OpenRouter, model from .env (costs money; manual only)
GOLDEN_ONLY=id1,id2          # run only these cases
GOLDEN_REPORT=path.json      # write per-case diagnostics (latency, validator errors, tokens)

A live run also prints, per case, how many final_answer attempts the validator rejected and
whether the turn fell back to the template answer (model "...+template").
"""

import asyncio
import json
import os
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
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

GOLDEN = Path(__file__).parent / "golden" / "hero.yaml"
TINY = ROOT / "packages/spatial/tests/fixtures/tiny"
KNOWN = {
    "tools_include",
    "events_include",
    "done_status_in",
    "text_includes",
    "text_excludes",
    "first_line",
    "text_includes_any",
    "first_line_excludes",
}
# `mock_only: {...}` holds expectations on the mock's exact wording; a live model phrases the
# same facts differently, so they are skipped in GOLDEN_REAL runs.


def check(expect: dict, evs: list, real: bool = False) -> list[str]:
    expect = dict(expect)
    mock_only = expect.pop("mock_only", {}) or {}
    if not real:
        for k, v in mock_only.items():
            expect[k] = [*expect.get(k, []), *v] if isinstance(v, list) else v
    fails = [f"unknown expect key {k}" for k in [*expect, *mock_only] if k not in KNOWN]
    tool_names = [e.name for e in evs if e.type == "tool.call"]
    types = [e.type for e in evs]
    text = "".join(e.delta for e in evs if e.type == "text.delta").lower()
    done = evs[-1] if evs and evs[-1].type == "done" else None
    if done is None:
        fails.append("stream did not end with done")
    fails += [
        f"tool {t} not called" for t in expect.get("tools_include", []) if t not in tool_names
    ]
    fails += [f"no {t} event" for t in expect.get("events_include", []) if t not in types]
    allowed = expect.get("done_status_in")
    if allowed and (done is None or done.answer_status not in allowed):
        fails.append(f"done status {done and done.answer_status} not in {allowed}")
    fails += [f"text lacks {s!r}" for s in expect.get("text_includes", []) if s.lower() not in text]
    fails += [f"text contains {s!r}" for s in expect.get("text_excludes", []) if s.lower() in text]
    anyof = expect.get("text_includes_any")
    if anyof and not any(s.lower() in text for s in anyof):
        fails.append(f"text lacks any of {anyof!r}")
    first = text.split("\n", 1)[0]
    if "first_line_excludes" in expect and expect["first_line_excludes"].lower() in first:
        fails.append(f"first line {first[:60]!r} contains {expect['first_line_excludes']!r}")
    if "first_line" in expect and not first.startswith(expect["first_line"].lower()):
        fails.append(f"first line {first!r} does not start with {expect['first_line']!r}")
    return fails


def answered_without_citations(evs: list) -> int:
    """1 when an answered/partial turn emitted no citation event at all, else 0.

    Turn-level, not claim-level: it cannot see claims (the validator rejects empty-evidence
    claims per claim). It fails the mock run only; a live model may legitimately answer without
    citations, so real mode just prints it.
    """
    done = evs[-1] if evs and evs[-1].type == "done" else None
    if done is None or done.answer_status == "cannot_answer":
        return 0
    return 0 if any(e.type == "citation" for e in evs) else 1


async def main() -> int:
    pydantic_ai.BANNER_ENABLED = False
    real = os.environ.get("GOLDEN_REAL") == "1"
    settings = (
        AgentSettings(llm_provider="openrouter")
        if real
        else AgentSettings(_env_file=None, llm_provider="mock")
    )
    cases = yaml.safe_load(GOLDEN.read_text(encoding="utf-8"))
    only = {c for c in os.environ.get("GOLDEN_ONLY", "").split(",") if c}
    if only:
        cases = [c for c in cases if c["id"] in only]
    report: list[dict] = []
    world = load_world(TINY)
    rows, failed, uncited = [], 0, 0
    # ignore_cleanup_errors: the stores keep their SQLite files open, which Windows cannot delete.
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        for i, case in enumerate(cases):
            settings = settings.model_copy(
                update={"assistant_scope": case.get("assistant_scope", "access_flood")}
            )
            ctx = tools.Ctx(world=world, vrs=VerificationStore(str(Path(tmp) / f"vr-{i}.db")))
            req = ChatRequest(
                message=case["message"],
                profile=case.get("profile", "default"),
                scenario_id=case.get("scenario_id"),
            )
            rec = TurnRecord()
            t0 = time.perf_counter()
            first_text: float | None = None
            first_draft: float | None = None
            evs = []
            async for e in run_turn(ctx, req, settings, record=rec):
                if first_text is None and e.type == "text.delta":
                    first_text = time.perf_counter() - t0
                if first_draft is None and e.type == "answer.draft":
                    first_draft = time.perf_counter() - t0
                evs.append(e)
            elapsed = time.perf_counter() - t0
            fails = check(case.get("expect", {}), evs, real)
            failed += bool(fails)
            uncited += answered_without_citations(evs)
            done = evs[-1] if evs and evs[-1].type == "done" else None
            report.append(
                {
                    "id": case["id"],
                    "assistant_scope": settings.assistant_scope,
                    "pass": not fails,
                    "failures": fails,
                    "status": done.answer_status if done else None,
                    "model": done.model if done else None,
                    "fallback": bool(done and done.model.endswith("+template")),
                    "rejected_attempts": len(rec.validator_errors),
                    "validator_errors": rec.validator_errors,
                    "seconds": round(elapsed, 2),
                    "first_text_s": round(first_text, 2) if first_text is not None else None,
                    "first_draft_s": round(first_draft, 2) if first_draft is not None else None,
                    "repairs": rec.repairs,
                    "checks": [
                        {"ok": e.ok, "issues": e.issues} for e in evs if e.type == "answer.check"
                    ],
                    "requests": rec.usage.requests,
                    "cache_read_tokens": rec.usage.cache_read_tokens,
                    "cache_write_tokens": rec.usage.cache_write_tokens,
                    "input_tokens": rec.usage.input_tokens,
                    "output_tokens": rec.usage.output_tokens,
                    "tools": [e.name for e in evs if e.type == "tool.call"],
                    "text": "".join(e.delta for e in evs if e.type == "text.delta"),
                }
            )
            rows.append(
                (
                    case["id"],
                    "PASS" if not fails else "FAIL",
                    done.answer_status if done else "-",
                    done.model if done else "-",
                    ",".join(e.name for e in evs if e.type == "tool.call") or "-",
                    "; ".join(fails),
                )
            )
    head = ("case", "result", "status", "model", "tools", "failures")
    widths = [max(len(str(r[c])) for r in [head, *rows]) for c in range(len(head))]
    for r in [head, *rows]:
        print("  ".join(str(v).ljust(w) for v, w in zip(r, widths, strict=True)).rstrip())
    print(f"\nanswered_without_citations: {uncited}")
    fallbacks = sum(r["fallback"] for r in report)
    rejected = sum(r["rejected_attempts"] for r in report)
    print(f"template_fallbacks: {fallbacks}  rejected_attempts: {rejected}")
    if path := os.environ.get("GOLDEN_REPORT"):
        Path(path).write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"golden: {len(rows) - failed}/{len(rows)} passed ({'openrouter' if real else 'mock'})")
    return 1 if failed or (uncited and not real) else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
