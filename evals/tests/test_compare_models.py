"""The model comparison ranks by the honesty gate first, then reliability, speed and cost."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import compare_models as cm  # noqa: E402

PRICES = {
    "a/cheap": {"input": 0.1, "output": 0.5},
    "b/strong": {"input": 1.0, "output": 5.0},
}


def row(qid, model, fallback=False, first_ok=True):
    return {
        "id": qid,
        "model": model,
        "fallback": fallback,
        "first_attempt_ok": first_ok,
        "tool_hit": True,
    }


def report(model, *, violations=0, unfaithful=0, fallbacks=0, first_ok=3, first_s=5.0, rows=None):
    rows = rows or [row(f"q{i}", model) for i in range(3)]
    return {
        "summary": {
            "turns": 3,
            "answers_with_honesty_violations": violations,
            "answers_with_unfaithful_numbers": unfaithful,
            "pii_echo": 0,
            "template_fallbacks": fallbacks,
            "first_attempt_accepted": first_ok,
            "expected_tool_called": 3,
            "grounded_answers": 3,
            "median_first_text_s": first_s,
            "median_total_s": first_s + 3,
            "input_tokens": 1_000_000,
            "output_tokens": 100_000,
        },
        "rows": rows,
    }


def test_cost_comes_from_the_price_file():
    s = cm.score(report("a/cheap"), PRICES)
    assert s["cost_usd"] == 0.15  # 1M x 0.1 + 0.1M x 0.5
    assert s["cost_per_turn_usd"] == 0.05
    assert cm.score(report("x/unpriced"), PRICES)["cost_usd"] is None


def test_a_gate_failure_is_never_ranked_first_even_if_faster_and_cheaper():
    honest = cm.score(report("b/strong", first_s=9.0), PRICES)
    fast_but_invents = cm.score(report("a/cheap", unfaithful=1, first_s=2.0), PRICES)
    ranked = cm.rank([fast_but_invents, honest])
    assert [x["model"] for x in ranked] == ["b/strong", "a/cheap"]
    assert not ranked[1]["gate_ok"]


def test_among_honest_models_fewer_fallbacks_then_first_attempts_win():
    a = cm.score(report("a/cheap", fallbacks=1, first_ok=3), PRICES)
    b = cm.score(report("b/strong", fallbacks=0, first_ok=1), PRICES)
    assert cm.rank([a, b])[0]["model"] == "b/strong"
    c = cm.score(report("a/cheap", first_ok=2, first_s=1.0), PRICES)
    d = cm.score(report("b/strong", first_ok=3, first_s=9.0), PRICES)
    assert cm.rank([c, d])[0]["model"] == "b/strong"


def test_speed_breaks_a_tie_before_cost():
    slow_cheap = cm.score(report("a/cheap", first_s=8.0), PRICES)
    fast_dear = cm.score(report("b/strong", first_s=3.0), PRICES)
    assert cm.rank([slow_cheap, fast_dear])[0]["model"] == "b/strong"


def test_a_turn_served_by_another_model_fails_the_gate():
    rows = [row("q0", "a/cheap"), row("q1", "z/backup")]
    rep = report("a/cheap", rows=rows)
    rep["summary"]["requested_model"] = "a/cheap"
    s = cm.score(rep, PRICES)
    assert not s["gate_ok"]
    assert s["gate"]["served_by_other_model"] == ["z/backup"]


def test_template_rows_count_as_the_same_model():
    rows = [row("q0", "a/cheap+template", fallback=True, first_ok=False)]
    assert cm.requested_model(report("a/cheap", rows=rows)) == "a/cheap"


def test_differing_questions_lists_only_rows_that_ended_differently():
    a = report("a/cheap")
    b = report("b/strong")
    b["rows"][1] = {**b["rows"][1], "fallback": True, "first_attempt_ok": False}
    assert cm.differing_questions([a, b]) == ["q1"]


def test_reports_mode_prints_a_ranked_table(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(cm, "load_prices", lambda path=cm.PRICES: PRICES)
    pa, pb = tmp_path / "a.json", tmp_path / "b.json"
    pa.write_text(json.dumps(report("a/cheap", first_s=4.0)), encoding="utf-8")
    pb.write_text(json.dumps(report("b/strong", violations=1)), encoding="utf-8")
    out = tmp_path / "t.md"
    assert cm.main(["--reports", str(pa), str(pb), "--out", str(out)]) == 0
    text = capsys.readouterr().out
    assert text.index("`a/cheap`") < text.index("`b/strong`")
    assert "FAIL honesty_violations" in text
    assert out.read_text(encoding="utf-8").startswith("| Rank |")


def test_the_price_file_parses_and_names_its_date():
    prices = cm.load_prices()
    assert prices and all({"input", "output"} <= set(v) for v in prices.values())
