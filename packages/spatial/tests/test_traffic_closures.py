from datetime import UTC, datetime, timedelta
from itertools import product

import pytest
from townshiplens_spatial import events, traffic, twm
from townshiplens_spatial.models import Closure
from townshiplens_spatial.routing import plan_route, route_batch

START = datetime(2030, 10, 28, 7, tzinfo=UTC)  # Monday


def scenario(*ids, reason="works", starts=START, ends=None):
    return events.ClosureScenario(
        name="Drain repairs",
        reason=reason,
        closures=[
            events.ClosureWindow(
                segment_ids=list(ids), starts_at=starts, ends_at=ends or starts + timedelta(hours=4)
            )
        ],
    )


def test_overlapping_windows_and_end_boundaries(world):
    first = scenario("seg-bc")
    second = scenario("seg-be", starts=START + timedelta(hours=1))
    both = first.model_copy(update={"closures": first.closures + second.closures})
    early = events.simulate_closure(world, both, ("default",))
    overlap = events.simulate_closure(world, both, ("default",), START + timedelta(hours=1))
    ended = events.simulate_closure(world, both, ("default",), START + timedelta(hours=6))

    def trip(r):
        return next(t for t in r.trips if t.from_id == "park-b" and t.to_id == "kiosk")

    assert "seg-be" in trip(early).segment_ids and not trip(early).no_route
    assert trip(overlap).no_route and trip(overlap).affected
    assert ended.trips_affected == 0 and ended.detour_roads == []
    at_end = events.simulate_closure(world, first, ("default",), START + timedelta(hours=4))
    assert at_end.trips_affected == 0  # end exclusive
    assert world.closures == []


@pytest.mark.parametrize("reason", ["event", "works", "accident", "flooding", "other"])
def test_named_closure_label_uses_its_real_reason(reason):
    closure = Closure(
        id="test", element_id="seg-bc", reason=reason, event_name="Named closure", starts_at=START
    )
    assert closure.label().startswith(f"Closed: {reason} (Named closure)")


@pytest.mark.parametrize(
    "weighted,road_class,band",
    [
        (0.5, "residential", "low"),
        (1, "residential", "medium"),
        (3, "residential", "medium"),
        (3.1, "residential", "high"),
        (2, "secondary", "low"),
        (2, "service", "high"),
        (2, "unmapped", "medium"),
    ],
)
def test_pressure_capacity_and_boundary_bands(weighted, road_class, band):
    assert traffic.pressure(weighted, road_class) == band


@pytest.mark.parametrize(
    "kind,stamp,weight",
    [
        ("school", "2030-10-28T07:00:00+08:00", 3),
        ("kindergarten", "2030-10-28T13:59:00+08:00", 3),
        ("school", "2030-10-28T08:00:00+08:00", 1),
        ("school", "2030-11-02T07:30:00+08:00", 1),
        ("mall", "2030-10-28T17:00:00+08:00", 2),
        ("shops", "2030-10-28T18:59:00+08:00", 2),
        ("work", "2030-10-28T19:00:00+08:00", 1),
        ("park", "2030-11-02T09:59:00+08:00", 2),
        ("playground", "2030-10-28T18:00:00+08:00", 2),
        ("clinic", "2030-10-28T09:00:00+08:00", 2),
        ("place_of_worship", "2030-11-01T12:30:00+08:00", 2),
        ("place_of_worship", "2030-10-28T12:30:00+08:00", 1),
        ("other", "2030-10-28T07:00:00+08:00", 1),
    ],
)
def test_config_peak_rules_use_site_local_weekdays_and_windows(kind, stamp, weight):
    assert (
        traffic.trip_weight(
            kind, datetime.fromisoformat(stamp).astimezone(UTC), "Asia/Kuala_Lumpur"
        )
        == weight
    )


def test_peak_changes_weighted_trips_but_not_routes(world):
    world.places["kiosk"].type = "school"
    morning = datetime.fromisoformat("2030-10-28T07:30:00+08:00")
    spec = scenario("seg-bc", starts=morning, ends=morning + timedelta(hours=5))
    peak = events.simulate_closure(world, spec, ("default",))
    off = events.simulate_closure(world, spec, ("default",), morning + timedelta(hours=2))
    assert peak.trips == off.trips
    assert sum(r.weighted_trips for r in peak.detour_roads) > sum(
        r.weighted_trips for r in off.detour_roads
    )
    assert all(r.weighted_trips == r.trips for r in off.detour_roads)
    assert peak.weights_note == "Peak weights are an assumed travel pattern, not measured."
    assert peak.disclaimer == events.PRESSURE_DISCLAIMER


@pytest.fixture
def pressured(world):
    world.edges["seg-be"].name = "Garden Lane"
    world.edges["seg-be"].osm_tags = {"highway": "residential", "oneway": "yes"}
    world.edges["seg-ef"].name = "Main Road"
    world.edges["seg-ef"].osm_tags = {"highway": "secondary"}
    # Extra destinations share a mapped node, each remains a separate sample trip.
    for i in range(5):
        p = world.places["kiosk"].model_copy(update={"id": f"kiosk-{i}", "name": f"Kiosk {i}"})
        world.places[p.id] = p
    return world


def test_signpost_rule_names_mapped_higher_capacity_alternative(pressured):
    result = events.simulate_closure(pressured, scenario("seg-bc"), ("default",))
    suggestion = next(s for s in result.suggestions if s.kind == "signpost")
    assert "Main Road" in suggestion.text and "Garden Lane" in suggestion.text
    assert "capacity[residential]=1" in suggestion.basis
    assert "capacity[secondary]=4" in suggestion.basis
    assert "not been simulated" in suggestion.text


def test_marshal_rule_names_sample_trip_count(pressured):
    result = events.simulate_closure(pressured, scenario("seg-bc"), ("default",))
    suggestion = next(s for s in result.suggestions if s.kind == "marshal")
    road = next(r for r in result.detour_roads if r.name in suggestion.text)
    assert f"trips={road.trips}" in suggestion.basis and str(road.trips) in suggestion.text


def test_two_way_rule_is_based_on_mapped_direction(pressured):
    result = events.simulate_closure(pressured, scenario("seg-bc"), ("default",))
    suggestion = next(s for s in result.suggestions if s.kind == "two_way")
    assert "Garden Lane" in suggestion.text and "oneway_segments=1" in suggestion.basis


def test_crossing_rule_names_a_mapped_junction_and_new_cutoff_count(world):
    result = events.simulate_closure(world, scenario("seg-ab"), ("default",))
    suggestion = next(s for s in result.suggestions if s.kind == "crossing_point")
    assert "mapped closure-boundary junction" in suggestion.text
    assert any(f"mapped_junction={n}" in suggestion.basis for n in world.graph)
    assert f"count={len(result.places_cut_off)}" in suggestion.basis
    assert {p.id for p in result.places_cut_off} == {"park-b"}


def test_split_rule_is_for_multiple_active_segments(pressured):
    result = events.simulate_closure(pressured, scenario("seg-bc", "seg-cd"), ("default",))
    suggestion = next(s for s in result.suggestions if s.kind == "split")
    assert "active_segments=2" in suggestion.basis
    assert f"trips_affected={result.trips_affected}" in suggestion.basis


def test_reschedule_rule_discloses_unassessed_times(pressured):
    result = events.simulate_closure(pressured, scenario("seg-bc"), ("default",))
    suggestion = next(s for s in result.suggestions if s.kind == "reschedule")
    assert f"trips_affected={result.trips_affected}" in suggestion.basis
    assert "Other times have not been simulated" in suggestion.text


def test_existing_data_gaps_never_become_closure_losses(world):
    result = events.simulate_closure(world, scenario("seg-ab", "seg-bc"))
    gaps = [t for t in result.trips if t.before_status == "no_data"]
    assert gaps and all(t.after_status == "no_data" and not t.affected for t in gaps)
    assert "moon-base" not in {p.id for p in result.places_cut_off}
    assert result.trips_no_route == result.trips_no_route_before + result.trips_newly_no_route


def test_batch_routes_match_regular_search_including_direction_and_parallel_edges(world):
    world.edges["seg-be"].osm_tags = {"oneway": "-1"}
    world.edges["seg-ab"].type = world.edges["seg-be"].type = "street"
    ids = ["park-b", "kiosk", "toilet-1", "moon-base", "island-hut"]
    journeys = list(product(ids, ids, ("default", "wheelchair", "drive")))
    plain = [plan_route(world, a, b, p) for a, b, p in journeys]
    with route_batch():
        batched = [plan_route(world, a, b, p) for a, b, p in journeys]
    for before, after in zip(plain, batched, strict=True):
        assert before.status == after.status
        assert before.routes == after.routes


def test_baseline_cache_invalidates_on_world_version_and_closure_clock(world, monkeypatch):
    calls = []
    real = twm.rollout

    def count(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(twm, "rollout", count)
    spec = scenario("seg-bc")
    events.simulate_closure(world, spec, ("default",))
    events.simulate_closure(world, spec, ("default",))
    assert len(calls) == 1
    world.refresh_claim("seg-bc", "width_m", world.edges["seg-bc"].claims["width_m"])
    events.simulate_closure(world, spec, ("default",))
    assert len(calls) == 2
    world.set_closures(
        [
            Closure(
                id="later",
                element_id="seg-ab",
                reason="accident",
                starts_at=START + timedelta(hours=1),
            )
        ]
    )
    events.simulate_closure(world, spec, ("default",))
    events.simulate_closure(world, spec, ("default",), START + timedelta(hours=1))
    assert len(calls) == 4


def test_road_names_and_stretches_resolve_without_inventing_segments(world):
    for eid, name in [
        ("seg-bc", "Main Road"),
        ("seg-cd", "Main Road"),
        ("seg-ab", "West Lane"),
        ("seg-fd", "East Lane"),
    ]:
        world.edges[eid].name = name
    window = events.ClosureWindow(
        road_names=["Main Road between West Lane and East Lane"],
        starts_at=START,
        ends_at=START + timedelta(hours=1),
    )
    spec = scenario("seg-bc").model_copy(update={"closures": [window]})
    assert events.resolve_scenario(world, spec).closures[0].segment_ids == ["seg-bc", "seg-cd"]
    window.road_names = ["Invented Road"]
    with pytest.raises(ValueError, match="No mapped road"):
        events.resolve_scenario(world, spec)


def test_management_closure_tool_returns_weights_pressure_and_evidence_without_writes(
    world, tmp_path
):
    from townshiplens_spatial import tools
    from townshiplens_spatial.vr_store import VerificationStore

    ctx = tools.Ctx(world, VerificationStore(str(tmp_path / "vrs.db")))
    kwargs = scenario("seg-bc").model_dump(mode="json")
    result = tools.TOOLS["simulate_closure"](ctx, **kwargs, profiles=["default"])
    assert result.ok and result.evidence[0].id == result.data["evidence_id"]
    assert result.evidence[0].status == "indicative"
    assert result.data["event"]["reason"] == "works" and result.data["detour_roads"]
    assert result.data["reason"] == "works"
    assert result.data["weights_note"] in result.warnings
    assert world.closures == [] and ctx.vrs.list("all") == []
    assert not tools.simulate_closure(ctx, **(kwargs | {"reason": "invented"})).ok
    assert not tools.simulate_closure(ctx, **kwargs, at="bad-date").ok
    assert not tools.simulate_closure(ctx, **kwargs, profiles=[]).ok


def test_static_road_snaps_reuse_geometry_but_invalidate_changed_road_membership(world):
    from townshiplens_spatial import routing
    from townshiplens_spatial.sim import snapshot_world

    world.edges["seg-bc"].type = "street"
    roads = routing._road_nodes(world, world.profiles["drive"])
    before = routing._targets(world, "toilet-1", world.profiles["drive"])
    snapshot, _ = snapshot_world(world)
    assert routing._road_nodes(snapshot, snapshot.profiles["drive"]) is roads
    assert routing._targets(snapshot, "toilet-1", snapshot.profiles["drive"]) == before
    world.edges["seg-be"].type = "street"
    changed = routing._road_nodes(world, world.profiles["drive"])
    assert changed is not roads and "n-e" in changed
    assert routing._targets(world, "toilet-1", world.profiles["drive"]) == ["n-e"]


def test_mixed_class_named_road_counts_each_rerouted_trip_once(world):
    for eid, road_class in [("seg-be", "residential"), ("seg-ef", "secondary")]:
        world.edges[eid].name = "Garden Loop"
        world.edges[eid].osm_tags = {"highway": road_class}
    result = events.simulate_closure(world, scenario("seg-bc"), ("default",))
    rows = [r for r in result.detour_roads if r.name == "Garden Loop"]
    assert len(rows) == 1
    road = rows[0]
    assert set(road.segment_ids) == {"seg-be", "seg-ef"}
    assert road.trips == sum(
        t.affected and bool({"seg-be", "seg-ef"}.intersection(t.segment_ids)) for t in result.trips
    )
    assert road.weighted_trips == road.trips  # off-peak fixture destinations
    assert road.road_class == "residential"
    assert road.pressure == traffic.pressure(road.weighted_trips, "residential")
