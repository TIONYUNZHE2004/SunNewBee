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
    demo.save(demo.key(req), live, demo.make_meta(req, live, ctx.world), st.demo_dir)
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
    demo.save(demo.key(req), live, demo.make_meta(req, live, ctx.world), st.demo_dir)
    evs = await run(ctx, settings(tmp_path, demo_mode=False))
    assert not evs[-1].model.endswith("+demo-cache")


async def test_corrupt_file_ignored_with_warning(ctx, tmp_path, caplog):
    st = settings(tmp_path)
    st.demo_dir.mkdir()
    req = ChatRequest(message=Q, profile="stroller")
    (st.demo_dir / f"{demo.key(req)}.jsonl").write_text(
        '{"meta": {}}\n{not json\n', encoding="utf-8"
    )
    with caplog.at_level(logging.WARNING):
        evs = await run(ctx, st)
    assert "corrupt demo cache" in caplog.text
    assert evs[-1].type == "done" and not evs[-1].model.endswith("+demo-cache")


async def test_replay_keeps_vr_queue_consistent(ctx, tmp_path):
    st = settings(tmp_path)
    kq = "Can I push a stroller from Car Park B to the kiosk without stairs?"
    req = ChatRequest(message=kq, profile="stroller")
    live = await run(ctx, st, kq)
    rec_vr = next(e for e in live if e.type == "verification.requested")
    meta = demo.make_meta(req, live, ctx.world)
    demo.save(demo.key(req), live, meta, st.demo_dir)
    # Fresh store, as on a demo laptop: replay must file the VR itself.
    fresh = tools.Ctx(world=ctx.world, vrs=VerificationStore(str(tmp_path / "fresh.db")))
    evs = await run(fresh, st, kq)
    vr = next(e for e in evs if e.type == "verification.requested")
    assert evs[-1].model.endswith("+demo-cache")
    assert (vr.element_id, vr.attribute) == (rec_vr.element_id, rec_vr.attribute)
    rows = [r for r in fresh.vrs.list() if r.element_id == vr.element_id]
    assert len(rows) == 1 and rows[0].id == vr.request_id and rows[0].demand == vr.demand == 1
    assert vr.created is True
    evs2 = await run(fresh, st, kq)
    vr2 = next(e for e in evs2 if e.type == "verification.requested")
    assert vr2.created is False and vr2.demand == 2 and vr2.request_id == vr.request_id


async def test_world_mismatch_is_a_miss(ctx, tmp_path, caplog):
    st = settings(tmp_path)
    live = await run(ctx, st)
    req = ChatRequest(message=Q, profile="stroller")
    demo.save(demo.key(req), live, demo.make_meta(req, live, "elmina"), st.demo_dir)
    with caplog.at_level(logging.WARNING):
        evs = await run(ctx, st)
    assert "current is" in caplog.text and not evs[-1].model.endswith("+demo-cache")


def test_committed_entries_load_and_are_mock():
    import json

    files = sorted((AgentSettings(_env_file=None).demo_dir).glob("*.jsonl"))
    assert len(files) >= 3
    for f in files:
        meta = json.loads(f.read_text(encoding="utf-8").splitlines()[0])["meta"]
        assert demo.load(f.stem, f.parent) is not None, f.name
        assert meta["model"].startswith("mock") and meta["world"], f.name


async def test_replay_files_the_recorded_reason(tmp_path):
    """Review (final review Minor 10): a missing_place VR replays as missing_place."""
    from townshiplens_agent.events import Done, VerificationRequested

    store = VerificationStore(str(tmp_path / "reason.db"))
    events = [
        VerificationRequested(
            request_id="x",
            element_id="unknown_place",
            attribute="existence",
            created=True,
            demand=1,
            reason="missing_place",
        ),
        Done(message_id="m", answer_status="cannot_answer", model="mock-scripted"),
    ]
    out = [e async for e in demo.replay(events, store)]
    row = next(r for r in store.list() if r.id == out[0].request_id)
    assert row.reason == "missing_place"


async def test_active_closure_makes_replay_a_miss(ctx, tmp_path):
    """R33/I3: a recording cannot reflect a live closure: no replay while one is active."""
    from datetime import UTC, datetime, timedelta

    from townshiplens_spatial.models import Closure

    st = settings(tmp_path)
    live = await run(ctx, st)
    req = ChatRequest(message=Q, profile="stroller")
    demo.save(demo.key(req), live, demo.make_meta(req, live, ctx.world), st.demo_dir)
    assert (await run(ctx, st))[-1].model.endswith("+demo-cache")  # no closure: replays
    now = datetime.now(UTC)
    ctx.world.set_closures(
        [
            Closure(
                id="cl-x",
                element_id="toilet-1",
                reason="works",
                starts_at=now - timedelta(hours=1),
                ends_at=now + timedelta(days=1),
            )
        ]
    )
    assert ctx.world.active_closures()
    evs = await run(ctx, st)
    assert not evs[-1].model.endswith("+demo-cache")


async def test_cli_record_uses_a_fresh_vr_store(tmp_path, monkeypatch, capsys):
    """A recording files its verification requests in a fresh store, so every re-record writes
    created: true and demand 1 (byte-stable), whatever earlier CLI runs left in .data/cli.db."""
    import json

    from townshiplens_agent import cli

    st = AgentSettings(_env_file=None, llm_provider="mock", demo_dir=tmp_path)
    # names its origin (PR #15: no silent demo origin); files requests on seed and tiny
    q = "Can I get from Car Park B to the lakeside mall with a stroller?"
    for _ in range(2):
        await cli.main(q, "stroller", record=True, settings=st)
        (path,) = tmp_path.glob("*.jsonl")
        rows = [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines() if ln]
        vrs = [r for r in rows[1:] if r.get("type") == "verification.requested"]
        assert vrs and all(r["created"] and r["demand"] == 1 for r in vrs)


async def test_staff_fact_changes_invalidate_replay(ctx, tmp_path):
    from datetime import date

    from townshiplens_spatial.models import Claim

    st = settings(tmp_path)
    req = ChatRequest(message=Q, profile="stroller")
    live = await run(ctx, st)
    demo.save(demo.key(req), live, demo.make_meta(req, live, ctx.world), st.demo_dir)
    for edge in ctx.world.edges.values():
        ctx.world.refresh_claim(
            edge.id,
            "width_m",
            Claim(value=0.1, status="verified", verified_at=date.today().isoformat()),
        )
    events = await run(ctx, st)
    assert not events[-1].model.endswith("+demo-cache")
    assert not any(
        e.type == "scene.intent"
        and e.intent.kind == "route.highlight"
        and e.intent.route_status == "confirmed"
        for e in events
    )


def test_world_signature_changes_with_expiry_day(ctx, monkeypatch):
    from datetime import date

    first = demo.world_fingerprint(ctx.world)

    class Tomorrow(date):
        @classmethod
        def today(cls):
            return cls(2100, 1, 1)

    monkeypatch.setattr(demo, "date", Tomorrow)
    assert demo.world_fingerprint(ctx.world) != first
