"""Compare models on the same eval suite: which one is stronger for TownshipLens?

uv run python evals/compare_models.py \
    --models anthropic/claude-haiku-5.5,deepseek/deepseek-v4.1-flash
    Runs evals/run_eval.py once per model on OpenRouter (costs money), then compares.
uv run python evals/compare_models.py --reports a.json b.json
    Compares reports that already exist (free).
Options: --only id1,id2 (a subset of the suite), --out table.md (also write the table).

"Stronger" is decided in this order, from the run_eval report of each model:
1. Gate: 0 honesty violations, 0 answers with invented numbers, 0 ID-number echoes, and every
   turn served by the model that was asked for. A model that fails the gate is never ranked first.
2. Fewest template fallbacks (the model's answer rejected on every attempt).
3. Most answers accepted on the first attempt.
4. Most answers that called the expected tool family.
5. Lowest median time to the first visible text.
6. Lowest estimated cost (evals/model_prices.yaml).
This is one run per model on one suite: a ranking, not a confidence interval.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
PRICES = HERE / "model_prices.yaml"
RESULTS = HERE / "results"


def slug(model: str) -> str:
    return re.sub(r"[^a-z0-9.]+", "-", model.lower()).strip("-")


def load_prices(path: Path = PRICES) -> dict[str, dict[str, float]]:
    if not path.exists():
        return {}
    return (yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("models") or {}


def requested_model(report: dict) -> str:
    """The model a report was run for: the one stamped by this script, else the rows' own."""
    if m := report.get("summary", {}).get("requested_model"):
        return m
    served = {r["model"].removesuffix("+template") for r in report.get("rows", [])}
    return served.pop() if len(served) == 1 else "unknown"


def score(report: dict, prices: dict[str, dict[str, float]]) -> dict:
    s, rows = report["summary"], report.get("rows", [])
    model = requested_model(report)
    served = {r["model"].removesuffix("+template") for r in rows}
    price = prices.get(model)
    cost = (
        round(
            s["input_tokens"] / 1e6 * price["input"] + s["output_tokens"] / 1e6 * price["output"],
            4,
        )
        if price
        else None
    )
    gate = {
        "honesty_violations": s["answers_with_honesty_violations"],
        "invented_numbers": s["answers_with_unfaithful_numbers"],
        "id_number_echo": s["pii_echo"],
        "served_by_other_model": sorted(served - {model}),
    }
    return {
        "model": model,
        "turns": s["turns"],
        "gate_ok": not (
            gate["honesty_violations"]
            or gate["invented_numbers"]
            or gate["id_number_echo"]
            or gate["served_by_other_model"]
        ),
        "gate": gate,
        "fallbacks": s["template_fallbacks"],
        "first_ok": s["first_attempt_accepted"],
        "tool_hit": s["expected_tool_called"],
        "grounded": s.get("grounded_answers"),
        "first_text_s": s["median_first_text_s"],
        "total_s": s["median_total_s"],
        "tool_s": s.get("median_tool_s"),
        "cost_usd": cost,
        "cost_per_turn_usd": (
            round(cost / s["turns"], 5) if cost is not None and s["turns"] else None
        ),
    }


def rank(scores: list[dict]) -> list[dict]:
    def key(x: dict):
        return (
            not x["gate_ok"],
            x["fallbacks"],
            -x["first_ok"],
            -x["tool_hit"],
            x["first_text_s"] if x["first_text_s"] is not None else float("inf"),
            x["cost_usd"] if x["cost_usd"] is not None else float("inf"),
        )

    return sorted(scores, key=key)


def differing_questions(reports: list[dict]) -> list[str]:
    """Question ids where the models did not all end the same way (fallback, first-attempt
    acceptance or expected tool), so a reader knows which rows to open."""
    by_model = [{r["id"]: r for r in rep.get("rows", [])} for rep in reports]
    common = set.intersection(*(set(m) for m in by_model)) if by_model else set()
    out = []
    for qid in sorted(common):
        outcomes = {
            (m[qid]["fallback"], m[qid]["first_attempt_ok"], m[qid]["tool_hit"]) for m in by_model
        }
        if len(outcomes) > 1:
            out.append(qid)
    return out


def table(ranked: list[dict]) -> str:
    def f(v, unit=""):
        return "n/a" if v is None else f"{v}{unit}"

    lines = [
        "| Rank | Model | Gate | Fallbacks | Accepted 1st try | Expected tool | Grounded | "
        "First text (median) | Checked answer (median) | Engine time (median) | Est. cost | "
        "Per turn |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for i, x in enumerate(ranked, 1):
        n = x["turns"]
        gate = "PASS" if x["gate_ok"] else "FAIL " + ", ".join(k for k, v in x["gate"].items() if v)
        lines.append(
            f"| {i} | `{x['model']}` | {gate} | {x['fallbacks']}/{n} | {x['first_ok']}/{n} | "
            f"{x['tool_hit']}/{n} | {f(x['grounded'])}/{n} | {f(x['first_text_s'], ' s')} | "
            f"{f(x['total_s'], ' s')} | {f(x['tool_s'], ' s')} | {f(x['cost_usd'], ' $')} | "
            f"{f(x['cost_per_turn_usd'], ' $')} |"
        )
    return "\n".join(lines)


def run_model(model: str, only: str | None) -> Path:
    out = RESULTS / f"{date.today().isoformat()}-cmp-{slug(model)}.json"
    env = {
        **os.environ,
        "LLM_PROVIDER": "openrouter",
        "LLM_MODEL_DEFAULT": model,
        "EVAL_REAL": "1",
        "EVAL_REPORT": str(out),
    }
    env.pop("EVAL_BARE", None)
    if only:
        env["EVAL_ONLY"] = only
    print(f"== {model}: running the suite (live, costs money) -> {out.name}", flush=True)
    subprocess.run([sys.executable, str(HERE / "run_eval.py")], env=env, check=True)
    report = json.loads(out.read_text(encoding="utf-8"))
    report["summary"]["requested_model"] = model
    out.write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--models", help="comma-separated OpenRouter model ids (live run)")
    src.add_argument("--reports", nargs="+", type=Path, help="existing run_eval reports")
    ap.add_argument("--only", help="comma-separated question ids")
    ap.add_argument("--out", type=Path, help="also write the table as Markdown")
    args = ap.parse_args(argv)

    if args.models:
        paths = [run_model(m.strip(), args.only) for m in args.models.split(",") if m.strip()]
    else:
        paths = args.reports
    reports = [json.loads(p.read_text(encoding="utf-8")) for p in paths]
    prices = load_prices()
    ranked = rank([score(r, prices) for r in reports])
    md = table(ranked)
    diff = differing_questions(reports)
    note = (
        f"\nCost is an estimate from evals/model_prices.yaml (as of "
        f"{(yaml.safe_load(PRICES.read_text(encoding='utf-8')) or {}).get('as_of', '?')}); "
        "check openrouter.ai before quoting it.\n"
        f"Questions where the models ended differently: {', '.join(diff) or 'none'}.\n"
        "One run per model on one suite: a ranking, not a confidence interval."
    )
    print(md + "\n" + note)
    if args.out:
        args.out.write_text(md + "\n" + note + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
