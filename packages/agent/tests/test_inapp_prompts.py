"""Every in-app prompt on the Elmina seed gets a real mock answer that passes the validator.

Keeps keyless demos and DEMO_MODE replays from showing "I don't know" for the app's own chips.
"""

import re
from pathlib import Path

import pytest
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SEED = ROOT / "data/seed/elmina"
SUGGESTIONS_TS = ROOT / "apps/web/src/features/chat/suggestions.ts"
pytestmark = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
MOCK = AgentSettings(_env_file=None, llm_provider="mock")

# (message, profile, scenario_id). Copied from apps/web/src/features/chat/suggestions.ts
# (SUGGESTIONS and WHERE_CAN_I_GO); test_prompts_match_suggestions_ts catches drift.
ACCESS = [
    ("Can I get to the lakeside mall with a stroller?", "stroller", None),
    ("Can I get to the lakeside mall in a wheelchair?", "wheelchair", None),
    (
        "Can I get to the lakeside mall if I am an older adult who needs to rest?",
        "older_adult_rest",
        None,
    ),
    ("Is the walk from the urban park to the lakeside mall easy?", "default", None),
]
FLOOD = [
    ("Where is the nearest evacuation centre if the water rises 3 m?", "default", "stage_p3m"),
    (
        "Which routes to the lakeside mall are cut off if the water rises 3 m?",
        "default",
        "stage_p3m",
    ),
    ("Where is the nearest evacuation centre if the water rises 1 m?", "default", "stage_p1m"),
]
WASTE = [("Where can I drop off recycling nearby?", "default", None)]
WHERE = [
    ("Where can I go?", "default", "stage_p3m"),
    ("Where can I go?", "wheelchair", "stage_p3m"),
]
ALL = ACCESS + FLOOD + WASTE + WHERE


@pytest.fixture(scope="module")
def world():
    return load_world(SEED)


async def _turn(world, tmp_path, msg, profile, scenario):
    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    req = ChatRequest(message=msg, profile=profile, scenario_id=scenario)
    return [e async for e in run_turn(ctx, req, MOCK)]


def _text(evs) -> str:
    return "".join(e.delta for e in evs if e.type == "text.delta")


@pytest.mark.parametrize("msg,profile,scenario", ALL)
async def test_inapp_prompt_is_answered_by_the_mock(world, tmp_path, msg, profile, scenario):
    evs = await _turn(world, tmp_path, msg, profile, scenario)
    done = evs[-1]
    assert done.type == "done"
    assert done.model == "mock-scripted", "validator rejected the mock answer (template used)"
    assert done.answer_status != "cannot_answer", _text(evs)
    assert not [e for e in evs if e.type == "error"]
    assert any(e.type == "citation" for e in evs)
    text = _text(evs).lower()
    assert "safe" not in re.findall(r"[a-z]+", text)
    if scenario:
        assert "indicative" in text and "not a forecast" in text


async def test_older_adult_chip_uses_that_profile(world, tmp_path):
    msg, profile, scenario = ACCESS[2]
    evs = await _turn(world, tmp_path, msg, profile, scenario)
    plans = [e.args for e in evs if e.type == "tool.call" and e.name == "plan_route"]
    assert plans and plans[0]["profile"] == "older_adult_rest"


async def test_urban_park_to_mall_routes_between_both(world, tmp_path):
    msg, profile, scenario = ACCESS[3]
    evs = await _turn(world, tmp_path, msg, profile, scenario)
    finds = [e.args["query"] for e in evs if e.type == "tool.call" and e.name == "find_place"]
    assert finds == ["urban park", "lakeside mall"]


@pytest.mark.parametrize("profile", ["default", "wheelchair"])
async def test_where_can_i_go_names_the_demo_start(world, tmp_path, profile):
    evs = await _turn(world, tmp_path, "Where can I go?", profile, "stage_p3m")
    assert "from Elmina Lakeside Mall (demo start point)" in _text(evs)
    finds = [e.args["query"] for e in evs if e.type == "tool.call" and e.name == "find_place"]
    assert finds == ["lakeside mall"]


async def test_where_can_i_go_without_scenario_asks_for_a_river_level(world, tmp_path):
    evs = await _turn(world, tmp_path, "Where can I go?", "default", None)
    assert evs[-1].answer_status == "cannot_answer"
    assert "river level" in _text(evs)


def test_prompts_match_suggestions_ts():
    src = Path(SUGGESTIONS_TS).read_text(encoding="utf-8")
    texts = set(re.findall(r'text:\s*\n?\s*"([^"]+)"', src))
    texts.add(re.search(r'WHERE_CAN_I_GO\s*=\s*"([^"]+)"', src).group(1))
    assert {m for m, _, _ in ALL} == texts
