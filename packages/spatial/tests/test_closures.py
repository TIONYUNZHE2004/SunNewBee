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
    assert why[0]["why"] == "Closed: works until 16 Oct 2026"


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


def test_label_uses_kuala_lumpur_date_not_utc(world):
    # 06:00 KL on the 20th is 22:00 UTC on the 19th: residents must read "until 20 Oct".
    end = datetime(2026, 10, 19, 22, 0, tzinfo=UTC)
    c = _cl(end=end)
    assert c.label() == "Closed: works until 20 Oct 2026"
    assert c.label("UTC") == "Closed: works until 19 Oct 2026"
    world.set_closures([c])
    _, why = evaluate_edge(world.edges["seg-ab"], world.profiles["default"], now=NOW)
    assert why[0]["why"] == "Closed: works until 20 Oct 2026"


def test_site_timezone_default_and_row_offsets(ctx):
    assert ctx.world.site.timezone == "Asia/Kuala_Lumpur"
    c = _cl(start=datetime(2026, 10, 14, 17, 0, tzinfo=UTC), end=NOW + 24 * H)
    ctx.world.set_closures([c])
    row = tools.closure_row(ctx.world, c)
    assert row["starts_at"] == "2026-10-15T01:00:00+08:00"
    ev = tools._closure_ev(ctx.world, c)
    assert ev.verified_at == "2026-10-15"  # KL date, not the UTC date (14th)


def _chain(ctx, n=7):
    """park-b -> n closed chain edges -> new place `far`; the only way to `far`."""
    from townshiplens_spatial.models import Edge, Place

    w = ctx.world
    prev = w.places["park-b"].node_id
    now = datetime.now(UTC)
    cls = []
    for i in range(n):
        nxt = f"n-ch{i}"
        w.node_coords[nxt] = [101.52 + i * 0.0001, 3.19]
        e = Edge(
            id=f"ch-{i}",
            type="footway",
            from_node=prev,
            to_node=nxt,
            coords=[w.node_coords[prev], w.node_coords[nxt]],
            length_m=10,
            name=f"Chain {i}",
        )
        w.edges[e.id] = e
        w.graph.add_edge(prev, nxt, key=e.id, edge_id=e.id)
        cls.append(_cl(e.id, now - H, now + H, cid=f"cl-{i + 1:04d}"))
        prev = nxt
    w.places["far"] = Place(
        id="far", type="kiosk", name="Far kiosk", coord=w.node_coords[prev], node_id=prev
    )
    w._place_by_node.setdefault(prev, []).append("far")
    w.set_closures(cls)


def test_blocked_answer_keeps_every_closure_beyond_the_five_reason_cap(ctx):
    _chain(ctx, 7)
    r = tools.plan_route(ctx, "park-b", "far", "default")
    assert r.data["status"] == "blocked"
    assert len(r.data["closures"]) == 7  # every closure on the opened route
    assert {c["impact"] for c in r.data["closures"]} == {"blocked"}
    assert sum("Reported closure (staff)" in w for w in r.warnings) == 7


def test_detour_is_named_when_a_closure_forced_it(ctx):
    now = datetime.now(UTC)
    base = tools.plan_route(ctx, "park-b", "playground", "default").data["routes"][0]
    first = base["segments"][0]["edge_id"]
    assert not tools.plan_route(ctx, "park-b", "playground", "default").data["closures"]
    ctx.world.set_closures([_cl(first, now - H, now + H)])
    r = tools.plan_route(ctx, "park-b", "playground", "default")
    if r.data["status"] != "blocked":  # a detour exists in the fixture
        assert r.data["closures"] and r.data["closures"][0]["impact"] == "detour"
        assert any("detours around it" in w for w in r.warnings)
        assert first not in {s["edge_id"] for s in r.data["routes"][0]["segments"]}


def test_closure_off_the_route_is_not_reported(ctx):
    now = datetime.now(UTC)
    ctx.world.set_closures([_cl("seg-gh", now - H, now + H)])  # island path, nowhere near
    r = tools.plan_route(ctx, "park-b", "playground", "default")
    assert r.data["closures"] == []


def test_closure_stops_applying_when_the_clock_passes_ends_at(ctx, monkeypatch):
    from townshiplens_spatial import models

    start = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)
    monkeypatch.setattr(models, "utcnow", lambda: start)
    ctx.world.set_closures([_cl(start=start - H, end=start + H)])
    e, p = ctx.world.edges["seg-ab"], ctx.world.profiles["default"]
    assert evaluate_edge(e, p)[0] == "FAIL"
    assert [d["id"] for d in tools.get_closures(ctx).data] == ["cl-0001"]
    monkeypatch.setattr(models, "utcnow", lambda: start + 2 * H)  # no restart, no set_closures
    assert evaluate_edge(e, p)[0] == "PASS"
    assert tools.get_closures(ctx).data == []
    assert ctx.world.active_closures() == []


def test_ending_a_scheduled_closure_twice_is_refused(tmp_path):
    s = ClosureStore(str(tmp_path / "c.db"))
    c = s.create(
        element_id="seg-ab",
        reason="works",
        starts_at=datetime.now(UTC) + 5 * H,
        ends_at=None,
        note=None,
    )
    s.end(c.id)
    with pytest.raises(ValueError):
        s.end(c.id)


def test_parallel_closed_links_all_reported_past_the_reason_cap(ctx):
    """7 closed links in parallel: routing keeps 5 reasons, the closure list keeps all 7."""
    from townshiplens_spatial.models import Edge, Place

    w = ctx.world
    src = w.places["park-b"].node_id
    w.node_coords["n-far"] = [101.53, 3.19]
    now = datetime.now(UTC)
    cls = []
    for i in range(7):
        mid = f"n-m{i}"
        w.node_coords[mid] = [101.52 + i * 0.0001, 3.19]
        for eid, a, b in ((f"pa-{i}", src, mid), (f"pb-{i}", mid, "n-far")):
            w.edges[eid] = Edge(
                id=eid,
                type="footway",
                from_node=a,
                to_node=b,
                coords=[w.node_coords[a], w.node_coords[b]],
                length_m=10,
                name=eid,
            )
            w.graph.add_edge(a, b, key=eid, edge_id=eid)
        cls.append(_cl(f"pa-{i}", now - H, now + H, cid=f"cl-{i + 1:04d}"))
    w.places["far"] = Place(
        id="far", type="kiosk", name="Far", coord=[101.53, 3.19], node_id="n-far"
    )
    w._place_by_node.setdefault("n-far", []).append("far")
    w.set_closures(cls)
    r = tools.plan_route(ctx, "park-b", "far", "default")
    assert r.data["status"] == "blocked"
    assert len(r.data["blocked_reasons"]) == 5
    assert len(r.data["closures"]) == 7


# --- Task 55 I1: a centre whose place is closed is never "reachable" -------------------------
def _closed_hall(world):
    """evc-hall stands on the place 'bench-1' (same node n-c); close that place."""
    world.centres["evc-hall"].place_id = "bench-1"
    world.set_closures(
        [_cl(el="bench-1", reason="flooding", start=datetime.now(UTC) - H, end=None)]
    )


def test_closed_centre_is_closed_not_reachable(world):
    from townshiplens_spatial import flood

    _closed_hall(world)
    by_id = {r.centre.id: r for r in flood.centres_reachability(world, None, "stroller", "park-b")}
    hall = by_id["evc-hall"]
    assert hall.reachable is False
    assert hall.route_status == "closed"
    assert hall.closure and "Closed: flooding" in hall.closure
    assert hall.route_id is None


def test_closed_centre_never_the_nearest_reachable(world):
    from townshiplens_spatial import flood

    open_rows = [r for r in flood.centres_reachability(world, None, "stroller", "park-b")]
    assert open_rows[0].centre.id == "evc-hall" and open_rows[0].reachable
    _closed_hall(world)
    rows = flood.centres_reachability(world, None, "stroller", "park-b")
    assert not any(r.reachable and r.centre.id == "evc-hall" for r in rows)


def test_list_evacuation_centres_tool_marks_closed(world, ctx):
    _closed_hall(world)
    res = tools.list_evacuation_centres(ctx, None, "stroller", "park-b")
    row = next(d for d in res.data if d["centre"]["id"] == "evc-hall")
    assert row["reachable"] is False and row["route_status"] == "closed"
    assert "Closed" in row["closure"]
    assert any("closed" in w.lower() for w in res.warnings)
    assert any(e.attribute == "closure" for e in res.evidence)


def test_centre_details_reachability_closed(world, ctx):
    _closed_hall(world)
    res = tools.get_place_details(ctx, "evc-hall", None, "stroller", "park-b")
    assert res.data["reachability"]["route_status"] == "closed"
    assert res.data["reachability"]["reachable"] is False
    assert "Closed" in res.data["reachability"]["closure"]


def test_route_to_closed_centre_names_the_closure(world, ctx):
    _closed_hall(world)
    res = tools.plan_route(ctx, "park-b", "__centre__evc-hall", "stroller", file_vrs=False)
    assert any(c["impact"] == "endpoint" for c in res.data["closures"])


def test_closed_centre_ended_closure_is_reachable_again(world):
    from townshiplens_spatial import flood

    world.centres["evc-hall"].place_id = "bench-1"
    n = datetime.now(UTC)
    world.set_closures([_cl(el="bench-1", start=n - 3 * H, end=n - H)])
    rows = flood.centres_reachability(world, None, "stroller", "park-b")
    assert next(r for r in rows if r.centre.id == "evc-hall").reachable is True


def test_evacuation_journey_skips_a_closed_centre(world):
    from townshiplens_spatial import sim

    before = sim._journey(world, "park-b", "stroller", None)
    assert before["centre_id"] == "evc-hall"
    _closed_hall(world)
    after = sim._journey(world, "park-b", "stroller", None)
    assert after["centre_id"] != "evc-hall"
    assert after["result"] != "blocked_by_flood"  # a closure is not a flood block
