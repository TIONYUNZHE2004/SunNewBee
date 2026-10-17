"""The independent answer-key scorer must fail meaningful counterexamples."""

import importlib.util
from pathlib import Path

from townshiplens_agent.events import Done, TextDelta
from townshiplens_agent.record import TurnRecord

spec = importlib.util.spec_from_file_location(
    "answer_key_runner", Path(__file__).parents[1] / "run_answer_key.py"
)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def case():
    return {
        "id": "test",
        "language": "en",
        "reviewed": False,
        "expected_outcome": "correct",
        "expected_facts": {},
        "engine_calls": [
            {
                "tool": "plan_route",
                "args": {},
                "result": {
                    "data": {"distance_m": 440.6, "incline_pct": 3, "steps": [{"id": "seg-99"}]}
                },
            }
        ],
        "must_include": [],
        "must_not_include": [],
    }


def test_measurements_need_the_right_unit_and_rounding():
    c = case()
    assert not runner.unsupported_claims("About 440 m.", c)
    assert runner.unsupported_claims("The walk takes 3 minutes.", c)
    assert runner.unsupported_claims("It is exactly 500 m.", c)
    assert runner.unsupported_claims("There are 99 steps.", c)


def test_missing_required_tool_or_fact_is_wrong_even_if_validator_accepts():
    c = case()
    c["engine_calls"][0]["tool"] = "get_place_details"
    c["must_include"] = [["Elmina Lakeside Mall"]]
    events = [
        TextDelta(delta="A generic answer."),
        Done(message_id="x", answer_status="answered", model="test"),
    ]
    row = runner.score(c, events, TurnRecord())
    assert row["outcome"] == "wrong"
    assert any("expected tool" in f for f in row["failures"])
    assert any("missing any phrase" in f for f in row["failures"])


def test_metrics_have_explicit_denominators_and_overlap_is_disclosed():
    rows = [
        {
            "outcome": "wrong",
            "expected_outcome": "correct",
            "reviewed": False,
            "unsupported_claims": ["bad distance"],
        },
        {
            "outcome": "honestly_unverified",
            "expected_outcome": "honestly_unverified",
            "reviewed": False,
            "unsupported_claims": [],
        },
    ]
    summary = runner.summarize(rows)
    assert summary["metrics"]["wrong"] == {"numerator": 1, "denominator": 2}
    assert summary["metrics"]["unsupported_claims"] == {"numerator": 1, "denominator": 2}
    assert summary["by_expected_outcome"]["correct"] == {"matched": 0, "denominator": 1}
    assert summary["reviewed"] == 0
