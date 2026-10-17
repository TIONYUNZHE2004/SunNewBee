"""Crossing segments on a route are listed with their recorded type (informative only)."""

from types import SimpleNamespace

from townshiplens_spatial.attributes import ATTRIBUTE_TYPES, validate_value
from townshiplens_spatial.models import Claim, Edge, RouteSegment
from townshiplens_spatial.routing import route_crossings


def edge(eid, etype, claims=None, name=None):
    return Edge(
        id=eid,
        type=etype,
        from_node="a",
        to_node="b",
        coords=[(101.5, 3.18), (101.5001, 3.18)],
        length_m=10,
        name=name,
        claims=claims or {},
    )


def test_only_crossing_segments_are_listed_in_route_order():
    world = SimpleNamespace(
        edges={
            "s1": edge("s1", "street"),
            "c1": edge(
                "c1",
                "crossing",
                {"crossing": Claim(value="traffic_signals", status="reported")},
                name="Persiaran Elmina crossing",
            ),
            "c2": edge("c2", "crossing"),
        }
    )
    segs = [RouteSegment(edge_id=i, eval="PASS") for i in ("s1", "c1", "c2")]
    assert route_crossings(world, segs) == [
        {
            "element_id": "c1",
            "name": "Persiaran Elmina crossing",
            "crossing": "traffic_signals",
            "status": "reported",
        },
        {"element_id": "c2", "name": None, "crossing": None, "status": "unknown"},
    ]


def test_crossing_is_a_catalogued_enum():
    assert ATTRIBUTE_TYPES["crossing"][0] == "enum"
    assert validate_value("crossing", "traffic_signals") is None
    assert validate_value("crossing", "zebra") is not None  # OSM synonym; import maps it
