from datetime import UTC, datetime, timedelta

import pytest
from townshiplens_spatial import tools
from townshiplens_spatial.closure_store import ClosureStore
from townshiplens_spatial.evaluate import evaluate_edge
from townshiplens_spatial.models import Closure
from townshiplens_spatial.vr_store import VerificationStore

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)
H = timedelta(hours=1)


def _cl(el="seg-ab", start=NOW - H, end=NOW + 24 * H, reason="works", cid="cl-0001"):
    return Closure(id=cid, element_id=el, reason=reason, starts_at=start, ends_at=end)


@pytest.fixture
def ctx(world, tmp_path):
    return tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "t.db")))


@pytest.mark.parametrize("profile", ["default", "stroller", "wheelchair", "older_adult_rest"])
def test_active_closure_fails_every_profile_with_reason(world, profile):
    world.set_closures([_cl()])
    r, why = evaluate_edge(world.edges["seg-ab"], world.profiles[profile], now=NOW)
    assert r == "FAIL"
    assert why[0]["attribute"] == "closure"
    assert why[0]["why"] == "Closed: works until 2026-10-16"


def test_open_ended_closure_says_further_notice(world):
    world.set_closures([_cl(end=None)])
    _, why = evaluate_edge(world.edges["seg-ab"], world.profiles["default"], now=NOW)
    assert why[0]["why"] == "Closed: works until further notice"


def test_window_edges_start_inclusive_end_exclusive(world):
    world.set_closures([_cl(start=NOW, end=NOW + H)])
    e, p = world.edges["seg-ab"], world.profiles["stroller"]
    assert evaluate_edge(e, p, now=NOW - timedelta(seconds=1))[0] == "PASS"  # not started
    assert evaluate_edge(e, p, now=NOW)[0] == "FAIL"
    assert evaluate_edge(e, p, now=NOW + H)[0] == "PASS"  # ends_at is exclusive


def test_expired_closure_has_no_effect_and_never_upgrades(world):
    world.set_closures([_cl(el="seg-cf", start=NOW - 3 * H, end=NOW - H)])
    assert evaluate_edge(world.edges["seg-cf"], world.profiles["stroller"], now=NOW)[0] == "UNKNOWN"


def test_closure_beats_flood_class_text(world):
    world.set_closures([_cl()])
    r, why = evaluate_edge(world.edges["seg-ab"], world.profiles["default"], "possible", now=NOW)
    assert r == "FAIL" and why[0]["attribute"] == "closure"


def test_set_closures_bumps_version_and_replaces(world):
    v = world.version
    world.set_closures([_cl()])
    assert world.version == v + 1 and len(world.edges["seg-ab"].closures) == 1
    world.set_closures([])
    assert world.version == v + 2 and world.edges["seg-ab"].closures == []


def test_set_closures_drops_unknown_elements(world):
    world.set_closures([_cl(el="nope")])
    assert world.active_closures(NOW) == []


def test_closed_edge_blocks_route_and_is_named(ctx):
    live = Closure(
        id="cl-0001",
        element_id="seg-ab",
        reason="works",
        starts_at=datetime.now(UTC) - H,
        ends_at=datetime.now(UTC) + 24 * H,
    )
    before = tools.plan_route(ctx, "park-b", "playground", "default")
    assert before.data["status"] != "blocked"
    ctx.world.set_closures(
        [live, live.model_copy(update={"id": "cl-0002", "element_id": "seg-be"})]
    )
    r = tools.plan_route(ctx, "park-b", "playground", "default")
    assert r.data["status"] == "blocked"
    assert any("Reported closure (staff)" in w and "Closed: works" in w for w in r.warnings)
    assert any(e.id == "ev-closure-cl-0001" for e in r.evidence)
    assert "safe" not in " ".join(r.warnings).lower().replace("unsafe", "")


def test_get_closures_tool(ctx):
    now = datetime.now(UTC)
    ctx.world.set_closures(
        [
            _cl("seg-ab", now - H, now + H, cid="cl-0001"),
            _cl("seg-gh", now + 5 * H, now + 9 * H, "event", "cl-0002"),  # not started yet
            _cl("toilet-1", now - H, None, "other", "cl-0003"),
        ]
    )
    r = tools.get_closures(ctx)
    assert r.ok and [d["id"] for d in r.data] == ["cl-0001", "cl-0003"]
    assert r.data[0]["source_label"] == "Reported closure (staff)"
    assert r.data[0]["label"].startswith("Closed: works")
    assert r.evidence[0].status == "reported" and r.evidence[0].attribute == "closure"
    all_ids = [d["id"] for d in tools.get_closures(ctx, active_only=False).data]
    assert sorted(all_ids) == ["cl-0001", "cl-0002", "cl-0003"]


def test_get_closures_near_place_and_empty(ctx):
    now = datetime.now(UTC)
    assert tools.get_closures(ctx).data == []
    assert "not a guarantee" in tools.get_closures(ctx).warnings[0]
    ctx.world.set_closures([_cl("toilet-1", now - H, None, "other")])
    near = tools.get_closures(ctx, near_place="toilet-1")
    assert [d["element_id"] for d in near.data] == ["toilet-1"]
    assert tools.get_closures(ctx, near_place="nowhere").ok is False


def test_place_details_lists_active_closures(ctx):
    now = datetime.now(UTC)
    ctx.world.set_closures([_cl("toilet-1", now - H, now + H, "works")])
    d = tools.get_place_details(ctx, "toilet-1").data
    assert d["closures"][0]["label"].startswith("Closed: works")
    assert tools.get_place_details(ctx, "kiosk").data["closures"] == []


def test_store_create_end_and_rules(tmp_path):
    s = ClosureStore(str(tmp_path / "c.db"))
    c = s.create(element_id="seg-ab", reason="works", starts_at=NOW, ends_at=None, note="n")
    assert c.id == "cl-0001" and c.source == "staff_report" and c.created_by == "staff"
    with pytest.raises(ValueError):
        s.create(element_id="seg-ab", reason="works", starts_at=NOW, ends_at=NOW, note=None)
    old, new = s.end(c.id, now=NOW + H)
    assert old.ends_at is None and new.ends_at == NOW + H
    with pytest.raises(ValueError):
        s.end(c.id, now=NOW + 2 * H)
    with pytest.raises(KeyError):
        s.end("cl-9999")
    assert s.list(active=True, now=NOW + H / 2) == [s.get(c.id)]
    assert s.current(now=NOW + 2 * H) == []
    assert ClosureStore(str(tmp_path / "c.db")).get(c.id) is not None  # persisted
