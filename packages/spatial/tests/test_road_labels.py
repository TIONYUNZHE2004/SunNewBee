import json

from shapely.geometry import Point, box, mapping
from townshiplens_spatial.models import BoundaryRef
from townshiplens_spatial.road_labels import road_labels


def test_labels_clip_to_boundary_and_anchor_on_longest_part(world, tmp_path):
    # One east-west road crosses both sides of the boundary. Unnamed/outside roads
    # must not affect the label or its measured in-boundary length.
    edge = world.edges["seg-ab"]
    edge.name = "Crossing Road"
    edge.osm_tags = {"highway": "residential"}
    edge.coords = [[101.508, 3.181], [101.512, 3.181]]
    boundary = box(101.509, 3.180, 101.511, 3.182)
    world.data_dir = tmp_path
    (tmp_path / "boundary.geojson").write_text(json.dumps(mapping(boundary)))
    world.site.boundary = BoundaryRef(
        file="boundary.geojson",
        source="fallback_union",
        method="test",
        area_km2=1,
        as_of="2030-01-01",
    )
    row = road_labels(world)[0]
    assert row.name == "Crossing Road" and row.road_class == "residential"
    assert boundary.covers(Point(row.anchor))
    assert abs(row.anchor[0] - 101.510) < 1e-8
    assert 200 < row.length_m < 230
    assert row.bearing_deg == 90


def test_same_name_aggregates_length_but_anchors_longest_segment(world):
    a, b = world.edges["seg-ab"], world.edges["seg-cd"]
    a.name = b.name = "Main Road"
    a.coords = [[101.509, 3.181], [101.5105, 3.181]]
    rows = road_labels(world)
    assert len(rows) == 1 and rows[0].length_m > 210
    assert rows[0].anchor == [101.50975, 3.181]
