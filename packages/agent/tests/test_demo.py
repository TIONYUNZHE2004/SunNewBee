import logging

import pytest
from tests_support import TINY
from townshiplens_agent import demo
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.run import run_turn
from townshiplens_agent.settings import AgentSettings
from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

Q = "Can I push a stroller from Car Park B to the playground without stairs?"


@pytest.fixture
def ctx(tmp_path):
    return tools.Ctx(world=load_world(TINY), vrs=VerificationStore(str(tmp_path / "vr.db")))


def settings(tmp_path, demo_mode=True):
    return AgentSettings(
        _env_file=None, llm_provider="mock", demo_mode=demo_mode, demo_dir=tmp_path / "demo"
    )


async def run(ctx, st, msg=Q):
    return [e async for e in run_turn(ctx, ChatRequest(message=msg, profile="stroller"), st)]


def test_key_stable_under_whitespace_and_case():
    a = demo.key(ChatRequest(message="Can I  push\n a Stroller?", profile="stroller"))
    b = demo.key(ChatRequest(message=" can i push a stroller? ", profile="stroller"))
    assert a == b and len(a) == 16
    assert a != demo.key(ChatRequest(message="can i push a stroller?", profile="wheelchair"))
    assert a != demo.key(
        ChatRequest(message="can i push a stroller?", profile="stroller", scenario_id="stage_p3m")
    )


async def test_replay_matches_recording(ctx, tmp_path):
    st = settings(tmp_path)
    live = await run(ctx, st)  # miss: runs normally
    assert live[-1].model == "mock-scripted"
    req = ChatRequest(message=Q, profile="stroller")
    demo.save(demo.key(req), live, demo.make_meta(req, live), st.demo_dir)
    replayed = await run(ctx, st)
    assert [e.type for e in replayed] == [e.type for e in live]
    assert replayed[-1].type == "done" and replayed[-1].model == "mock-scripted+demo-cache"
    assert replayed[:-1] == live[:-1]


async def test_miss_falls_through(ctx, tmp_path):
    evs = await run(ctx, settings(tmp_path))
    assert evs[-1].type == "done" and not evs[-1].model.endswith("+demo-cache")


async def test_demo_off_ignores_cache(ctx, tmp_path):
    st = settings(tmp_path)
    live = await run(ctx, st)
    req = ChatRequest(message=Q, profile="stroller")
    demo.save(demo.key(req), live, demo.make_meta(req, live), st.demo_dir)
    evs = await run(ctx, settings(tmp_path, demo_mode=False))
    assert not evs[-1].model.endswith("+demo-cache")


async def test_corrupt_file_ignored_with_warning(ctx, tmp_path, caplog):
    st = settings(tmp_path)
    st.demo_dir.mkdir()
    req = ChatRequest(message=Q, profile="stroller")
    (st.demo_dir / f"{demo.key(req)}.jsonl").write_text('{"meta": {}}\n{not json\n')
    with caplog.at_level(logging.WARNING):
        evs = await run(ctx, st)
    assert "corrupt demo cache" in caplog.text
    assert evs[-1].type == "done" and not evs[-1].model.endswith("+demo-cache")
