"""Recorded route.compare fixtures for the web (demo polish B6, supports AC-N3).

Regenerate with `uv run python -m townshiplens_agent.compare_intent` (writes both files), then
`pnpm exec biome check --write <files>`."""

import pytest
from townshiplens_agent.compare_intent import DEMO, FIXTURES, build_intent
from townshiplens_agent.events import ChatRequest, SceneIntent
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import ROOT, AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SEED = ROOT / "data/seed/elmina"
pytestmark = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")


@pytest.fixture(scope="module")
def built():
    return build_intent(load_world(SEED), *DEMO)


def test_demo_pair_is_the_overlay_corridor():
    import importlib.util

    path = ROOT / "data/scripts/build_overlay.py"
    spec = importlib.util.spec_from_file_location("build_overlay_for_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # it puts the repo root on sys.path for its own imports
    DEMO_CORRIDOR = mod.DEMO_CORRIDOR

    assert (DEMO_CORRIDOR["from"], DEMO_CORRIDOR["to"], DEMO_CORRIDOR["profile"]) == DEMO


@pytest.mark.parametrize("rel", FIXTURES)
def test_committed_fixture_equals_a_fresh_build(rel, built):
    got = SceneIntent.model_validate_json((ROOT / rel).read_text(encoding="utf-8"))
    assert got == built


async def test_fixture_is_what_the_chat_turn_emits(built, tmp_path):
    """The corridor question through the mock emits exactly this intent."""
    ctx = tools.Ctx(world=load_world(SEED), vrs=VerificationStore(str(tmp_path / "vr.db")))
    req = ChatRequest(
        message="Wheelchair route from Elmina Lakeside Mall to Surau Kiambang?",
        profile="wheelchair",
    )
    settings = AgentSettings(_env_file=None, llm_provider="mock")
    evs = [e async for e in run_turn(ctx, req, settings)]
    intent = next(
        e.intent for e in evs if e.type == "scene.intent" and e.intent.kind == "route.compare"
    )
    assert intent == built
