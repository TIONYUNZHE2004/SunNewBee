from datetime import UTC, datetime, timedelta

import pytest
from townshiplens_spatial import events, models, tools
from townshiplens_spatial.models import Closure
from townshiplens_spatial.routing import plan_route
from townshiplens_spatial.vr_store import VerificationStore

START = datetime(2030, 10, 27, 23, tzinfo=UTC)


def spec(*ids):
    return events.EventSpec(
        name="Elmina Marathon",
        segment_ids=list(ids),
        starts_at=START,
        ends_at=START + timedelta(hours=4),
    )


def test_course_reroutes_known_trip_and_ranks_new_segments(world):
    world.edges["seg-be"].name = "Garden Steps"
    baseline = plan_route(world, "park-b", "kiosk", "default").routes[0]
    assert "seg-bc" in [s.edge_id for s in baseline.segments]
    result = events.simulate_event(world, spec("seg-bc"), ("default",))
    trip = next(t for t in result.trips if t.from_id == "park-b" and t.to_id == "kiosk")
    assert trip.affected and not trip.no_route
    assert "seg-bc" not in trip.segment_ids and "seg-be" in trip.segment_ids
    assert trip.extra_m == pytest.approx(trip.after_m - trip.before_m, abs=0.1)
    assert result.trips_affected > 0 and result.extra_m_median is not None
    road = next(r for r in result.detour_roads if r.name == "Garden Steps")
    assert road.segment_ids == ["seg-be"]
    assert road.trips == sum("seg-be" in t.segment_ids and t.affected for t in result.trips)
    assert result.detour_roads == sorted(result.detour_roads, key=lambda r: (-r.trips, r.name))
    assert all(
        any(c.isdigit() for c in s.basis) and any(c.isdigit() for c in s.text)
        for s in result.suggestions
    )
    assert result.disclaimer == "Estimate from mapped roads and sample trips, not traffic counts."
    assert plan_route(world, "park-b", "kiosk", "default").routes[0] == baseline
    assert world.closures == []


def test_cut_course_loses_routes_but_existing_data_gap_remains_no_data(world):
    result = events.simulate_event(world, spec("seg-ab"), ("default", "wheelchair", "drive"))
    lost = next(
        t
        for t in result.trips
        if t.from_id == "park-b" and t.to_id == "kiosk" and t.profile == "default"
    )
    assert lost.on_closed_course and not lost.affected
    assert lost.no_route and lost.after_status == "blocked"
    gaps = [t for t in result.trips if t.before_status == "no_data"]
    assert gaps and all(t.after_status == "no_data" and not t.affected for t in gaps)
    assert result.trips_newly_no_route == 0 and result.trips_on_course > 0
    assert result.trips_no_route == result.trips_no_route_before + result.trips_newly_no_route
    assert result.per_profile["drive"].trips_affected == 0  # tiny has no roads
    assert "park-b" in {p.id for p in result.places_cut_off}
    assert "moon-base" not in {p.id for p in result.places_cut_off}
    assert any(s.kind == "crossing_point" for s in result.suggestions)
    assert result.extra_m_median is None  # every affected trip lost its route


def test_future_simulation_freezes_other_closures_at_event_start(world, monkeypatch):
    world.set_closures(
        [
            Closure(
                id="future",
                element_id="seg-ab",
                reason="works",
                starts_at=START,
                ends_at=START + timedelta(hours=1),
            ),
            Closure(
                id="expired",
                element_id="seg-cd",
                reason="works",
                starts_at=START - timedelta(days=2),
                ends_at=START - timedelta(days=1),
            ),
        ]
    )
    monkeypatch.setattr(models, "utcnow", lambda: START - timedelta(days=30))
    result = events.simulate_event(world, spec("seg-bc"), ("default",))
    trip = next(t for t in result.trips if t.from_id == "park-b" and t.to_id == "kiosk")
    assert trip.before_status == trip.after_status == "blocked" and not trip.affected


def test_unknown_segment_profile_and_bad_window_are_rejected(world):
    with pytest.raises(ValueError, match="unknown segments"):
        events.simulate_event(world, spec("invented"))
    with pytest.raises(ValueError, match="profile"):
        events.simulate_event(world, spec("seg-ab"), ("invented",))
    with pytest.raises(ValueError, match="ends_at"):
        events.EventSpec(name="Bad", segment_ids=["seg-ab"], starts_at=START, ends_at=START)
    assert spec("seg-ab", "seg-ab").segment_ids == ["seg-ab"]


def test_management_tool_returns_indicative_evidence_and_no_writes(world, tmp_path):
    ctx = tools.Ctx(world, VerificationStore(str(tmp_path / "vrs.db")))
    kwargs = spec("seg-bc").model_dump(mode="json")
    result = tools.TOOLS["simulate_event"](ctx, **kwargs, profiles=["default"])
    assert result.ok and result.evidence[0].id == result.data["evidence_id"]
    assert result.evidence[0].status == "indicative"
    assert ctx.vrs.list("all") == [] and world.closures == []
    assert not tools.simulate_event(ctx, **(kwargs | {"segment_ids": ["invented"]})).ok
