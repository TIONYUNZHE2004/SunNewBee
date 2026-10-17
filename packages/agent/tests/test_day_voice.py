"""Elmina Day voices with the mock (no AI calls): the template voice is complete and honest."""

import asyncio
from pathlib import Path

import pytest
from townshiplens_agent.day_voice import record_day
from townshiplens_agent.settings import AgentSettings
from townshiplens_spatial.day import spotlight as S
from townshiplens_spatial.day.engine import Scenario
from townshiplens_spatial.world import load_world

TINY = Path(__file__).resolve().parents[2] / "spatial" / "tests" / "fixtures" / "tiny"


def test_mock_recording_makes_no_calls_and_every_line_passes_the_check():
    w = load_world(TINY)
    sc = Scenario(
        id="t", label="t", summary="", stages=[(0, None), (400, "stage_p3m"), (460, None)]
    )
    rec = asyncio.run(record_day(w, sc, AgentSettings(_env_file=None, llm_provider="mock"), n=300))
    assert rec["model"] == "template (no AI)" and rec["stats"]["calls"] == 0
    assert rec["cast"]
    for lines in rec["diaries"].values():
        assert all(x["voice"] == "template" for x in lines)
    assert all(p["voice"] in ("template", "engine") for p in rec["feed"])
    assert any(p["author"] == "township" for p in rec["feed"])  # the river notices


@pytest.mark.parametrize("bad", ["fly", "", "teleport"])
def test_an_invalid_ai_choice_never_overrides_the_rule(bad):
    from townshiplens_agent import day_voice as V

    class P:
        key, resident, kind, t, purpose, direction = (
            "k",
            "r",
            "no_way_at_departure",
            400,
            "school",
            "out",
        )
        options = [{"id": "wait", "label": "Wait"}, {"id": "cancel", "label": "Stay home"}]
        default = "wait"

    class FakeVoice:
        async def ask(self, *a, **k):
            return V.Choice(option=bad, reason="x")

    by = {
        "r": S.Spotlight(
            id="r",
            name="A",
            age=40,
            role="parent",
            persona="default",
            group="adult",
            household="h",
            home_coord=[0, 0],
        )
    }
    choices, _ = asyncio.run(V.decide(FakeVoice(), [P()], by, lambda rid: {"trips": []}))
    assert choices == {"k": "wait"}
