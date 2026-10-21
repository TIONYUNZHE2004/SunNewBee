from collections import Counter
from types import SimpleNamespace

from townshiplens_spatial import events


def test_both_sample_endpoints_are_diverse():
    places = {
        **{f"o{i:03}": SimpleNamespace(id=f"o{i:03}", type="parking") for i in range(60)},
        **{f"d{i:03}": SimpleNamespace(id=f"d{i:03}", type="facility") for i in range(40)},
    }
    sample = events._journeys(SimpleNamespace(places=places), "default", 100, True)
    assert len(sample) == len({(j.from_id, j.to_id) for j in sample}) == 100
    for attr in ("from_id", "to_id"):
        assert max(Counter(getattr(j, attr) for j in sample).values()) <= 10


def test_course_access_is_not_an_ordinary_disconnection(world):
    from datetime import UTC, datetime, timedelta

    start = datetime(2030, 1, 1, tzinfo=UTC)
    spec = events.ClosureScenario(
        name="Course",
        reason="event",
        closures=[
            events.ClosureWindow(
                segment_ids=["seg-ab"], starts_at=start, ends_at=start + timedelta(hours=2)
            )
        ],
    )
    result = events.simulate_closure(world, spec, ("default",))
    course = [t for t in result.trips if t.on_closed_course]
    assert course and result.trips_on_course == len(course)
    assert all(not t.affected for t in course)
    assert result.trips_newly_no_route == sum(
        t.before_m is not None and t.no_route for t in result.trips if not t.on_closed_course
    )
    assert any("start or end on the course" in w for w in result.warnings)
