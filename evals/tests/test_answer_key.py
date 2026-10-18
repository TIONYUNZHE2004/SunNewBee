"""The independent answer-key scorer must fail meaningful counterexamples."""

import asyncio
import importlib.util
import json
from pathlib import Path

import pytest
from townshiplens_agent import agent as A
from townshiplens_agent.events import ChatRequest, Done, TextDelta
from townshiplens_agent.record import TurnRecord
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

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


# T-015: the two false positives in Codex's live diagnostic (evals/audits/2026-10-18), replayed
# with the engine's own tool results for that turn (no model).
SEED = Path(__file__).parents[2] / "data/seed/elmina"
LIVE = json.loads(
    (Path(__file__).parents[1] / "audits/2026-10-18/system-verification.json").read_text()
)


def _key_case(cid):
    key = json.loads((Path(__file__).parents[1] / "answer_key/deep_spot.json").read_text())
    return next(c for c in key["cases"] if c["id"] == cid)


def _turn(calls, profile, scenario=None):
    ctx = tools.Ctx(world=load_world(SEED), vrs=VerificationStore(":memory:"))
    rec = TurnRecord()
    deps = A.Deps(
        ctx=ctx, rec=rec, request=ChatRequest(message="x", profile=profile, scenario_id=scenario)
    )

    async def go():
        for name, kw in calls:
            await A.call_tool(deps, name, **kw)

    asyncio.run(go())
    return rec


@pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed missing")
def test_live_false_positives_are_scored_as_supported():
    route_text, centre_text = (r["text"] for r in LIVE["live"]["rows"][:2])
    assert "about 440 m" in route_text and "about 17 minutes" in centre_text
    rec = _turn(
        [("plan_route", {"from_id": "park-b", "to_id": "playground", "profile": "stroller"})],
        "stroller",
    )
    assert runner.unsupported_claims(route_text, _key_case("route-01"), rec) == []
    centre = "__centre__evc-osm-way-1150791981"  # SJK (C) Ladang Regent, Elmina
    rec = _turn(
        [
            (
                "list_evacuation_centres",
                {
                    "scenario_id": "stage_p3m",
                    "profile": "wheelchair",
                    "near_place": "lakeside-mall",
                },
            ),
            (
                "plan_route",
                {
                    "from_id": "lakeside-mall",
                    "to_id": centre,
                    "profile": "wheelchair",
                    "scenario_id": "stage_p3m",
                },
            ),
        ],
        "wheelchair",
        "stage_p3m",
    )
    assert runner.unsupported_claims(centre_text, _key_case("centre-en"), rec) == []
    # Without this turn's route, 17 minutes has no source: the scorer still catches it.
    assert runner.unsupported_claims(centre_text, _key_case("centre-en")) != []


def test_rounding_follows_the_validator_rule():
    c = case()
    assert not runner.unsupported_claims("About 440 m.", c)
    assert not runner.unsupported_claims("Kira-kira 440 m.", c)
    assert not runner.unsupported_claims("约440米。", c)
    assert runner.unsupported_claims("Exactly 440 m.", c)  # "exactly" allows no rounding
    assert runner.unsupported_claims("Over 450 m.", c)  # wrong direction and too far
    assert not runner.unsupported_claims("About 400 m.", c)  # a round 100 within 15 %
    assert runner.unsupported_claims("About 600 m.", c)  # too far off
