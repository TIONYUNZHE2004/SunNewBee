"""AC-A4: the Elmina outline (display only) contains the demo places and route, excludes Subang."""

import json
import math
from pathlib import Path

import pytest
from shapely.geometry import Point, shape
from shapely.validation import explain_validity

ROOT = Path(__file__).resolve().parents[3]
SEED = ROOT / "data" / "seed" / "elmina"
BOUNDARY = SEED / "base" / "boundary.geojson"

pytestmark = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed missing")

HARMONI_1 = "osm-way-909868201"
CAR_PARK_B = "park-b"


def _outline():
    fc = json.loads(BOUNDARY.read_text(encoding="utf-8"))
    assert len(fc["features"]) == 1
    return shape(fc["features"][0]["geometry"])


def _fc(path):
    return json.loads((SEED / path).read_text(encoding="utf-8"))["features"]


def _place_point(place_id):
    for f in _fc("base/places.geojson") + _fc("access/overlay.geojson"):
        if f["properties"].get("id") == place_id:
            return shape(f["geometry"])
    raise AssertionError(f"place {place_id} not in seed")


def _named_point(name):
    for f in _fc("base/places.geojson"):
        if f["properties"].get("name") == name:
            return shape(f["geometry"])
    raise AssertionError(f"{name} not in seed")


def test_valid_single_polygon_without_self_intersection():
    g = _outline()
    assert g.geom_type in ("Polygon", "MultiPolygon")
    assert g.is_valid, explain_validity(g)
    if g.geom_type == "Polygon":
        assert g.exterior.is_simple


def test_area_between_6_and_15_km2():
    g = _outline()
    lat = math.radians(g.centroid.y)
    km2 = g.area * (111320 * math.cos(lat)) * 110574 / 1e6
    assert 6 <= km2 <= 15, km2


def test_contains_demo_places():
    g = _outline()
    assert g.contains(_place_point(HARMONI_1)), "Harmoni 1"
    assert g.contains(_place_point(CAR_PARK_B)), "Car Park B"
    assert g.contains(_named_point("Elmina Urban Park")), "Elmina Urban Park"
    mall = next(
        shape(f["geometry"])
        for f in _fc("base/landmarks.geojson")
        if f["properties"].get("id") == "elmina-lakeside-mall"
        or "Lakeside Mall" in str(f["properties"].get("name"))
    )
    assert g.contains(mall), "Lakeside Mall footprint"


def test_contains_every_node_of_the_demo_route():
    from townshiplens_spatial.routing import plan_route
    from townshiplens_spatial.world import load_world

    world = load_world(SEED, ROOT / "config" / "profiles")
    result = plan_route(world, HARMONI_1, CAR_PARK_B, "older_adult_rest")
    assert result.routes, result.status
    g = _outline()
    nodes = set()
    for seg in result.routes[0].segments:
        e = world.edges[seg.edge_id]
        nodes.update((e.from_node, e.to_node))
    assert nodes
    for n in nodes:
        lon, lat = world.node_coords[n]
        assert g.contains(Point(lon, lat)), n


def test_contains_both_deep_spot_centres():
    g = _outline()
    site = json.loads((SEED / "site.json").read_text(encoding="utf-8"))
    assert site["deep_spots"]
    for spot in site["deep_spots"]:
        w, s, e, n = spot["bbox"]
        assert g.contains(Point((w + e) / 2, (s + n) / 2)), spot["id"]


def test_excludes_subang_precinct_centroids():
    g = _outline()
    subang = [
        f for f in _fc("base/precincts.geojson") if "subang" in f["properties"]["name"].lower()
    ]
    assert subang
    for f in subang:
        c = shape(f["geometry"]).centroid
        assert not g.contains(c), f["properties"]["name"]


def test_site_json_records_boundary():
    site = json.loads((SEED / "site.json").read_text(encoding="utf-8"))
    assert site["boundary"]["file"] == "base/boundary.geojson"
