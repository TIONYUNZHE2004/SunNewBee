"""T-029: low-lying terrain questions use the terrain screen (possible only), alone or with the
river level asked; a plain river question never picks a combined scenario."""

import re

import pytest
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.memory import SessionMemory
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.route_binding import RouteSelectionError, effective_scenario
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SEED = ROOT / "data/seed/elmina"
needs_lowlying = pytest.mark.skipif(
    not (SEED / "flood/lowlying.geojson").exists(), reason="low-lying layer not generated"
)
SETTINGS = AgentSettings(_env_file=None, llm_provider="mock", turn_timeout_s=600)


@pytest.fixture(scope="module")
def seed():
    return load_world(SEED)


async def _ask(world, tmp_path, q):
    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    rec = TurnRecord()
    evs = [
        e
        async for e in run_turn(
            ctx, ChatRequest(message=q), SETTINGS, record=rec, memory=SessionMemory()
        )
    ]
    calls = [e for e in evs if e.type == "tool.call"]
    return evs, rec, calls, "".join(e.delta for e in evs if e.type == "text.delta")


@needs_lowlying
async def test_a_low_lying_question_uses_the_terrain_screen_possible_only(seed, tmp_path):
    evs, rec, calls, text = await _ask(seed, tmp_path, "Which low-lying areas may collect water?")
    affected = next(c for c in calls if c.name == "affected_places")
    assert affected.args["scenario_id"] == "lowlying"
    assert evs[-1].answer_status == "answered" and rec.validator_errors == []
    assert "may collect water (possible" in text and "likely flooded" not in text
    assert not re.search(r"\bsafe\b|\d+(?:\.\d+)?\s*(?:cm|m) deep", text, re.I)
    assert "Flash floods" not in text  # the terrain screen states its own limits


@needs_lowlying
async def test_with_a_river_level_the_combined_screen_is_used(seed, tmp_path):
    q = "Which places are in low-lying areas if the river rises 3 m?"
    evs, rec, calls, text = await _ask(seed, tmp_path, q)
    assert next(c for c in calls if c.name == "affected_places").args["scenario_id"] == (
        "stage_p3m+lowlying"
    )
    assert rec.validator_errors == [] and "likely flooded by the river rise" in text


@needs_lowlying
def test_a_plain_river_question_never_picks_a_combined_scenario(seed):
    q = "Which places are cut off if the river rises 3 m?"
    assert effective_scenario(q, seed, None, "stage_p3m") == "stage_p3m"
    with pytest.raises(RouteSelectionError):
        effective_scenario(q, seed, None, "stage_p3m+lowlying")
    assert effective_scenario("low-lying areas please", seed, None, "lowlying") == "lowlying"


@needs_lowlying
def test_with_terrain_on_screen_a_river_question_uses_the_river_component(seed):
    q = "Which places are cut off by the river?"
    assert effective_scenario(q, seed, "stage_p3m+lowlying", "stage_p3m") == "stage_p3m"
    with pytest.raises(RouteSelectionError):
        effective_scenario(q, seed, "stage_p3m+lowlying", "stage_p3m+lowlying")
    # asking about low-lying areas keeps the combined scenario on screen
    q2 = "Which low-lying areas may collect water?"
    assert effective_scenario(q2, seed, "stage_p3m+lowlying", "lowlying") == "lowlying"
