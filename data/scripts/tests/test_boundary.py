"""AC-A4 as revised by A-T3b: the Elmina outline (display only) follows the owner's master plan.

Coordinator ruling (19 Oct 2026): the owner's official master-plan map supersedes the spec's
AC-A4 exclusion rule (all Subang precincts) and area range (6-15 km2). Bukit Subang and Denai
Alam are inside; Kampung Melayu Subang and Taman Subang Baru are outside; area 15-30 km2.
The outline is traced from docs/03-product/elmina-masterplan.png, georeferenced to OSM lakes.
"""

import json
import math
from pathlib import Path

import pytest
from shapely.geometry import Point, shape
from shapely.validation import explain_validity

from data.scripts.build_boundary import (
    CONTROL_POINTS,
    HARMONI_1,
    anchor_points,
    fit_affine,
)

_M, _RES = fit_affine()
INSIDE, OUTSIDE = anchor_points(_M)

ROOT = Path(__file__).resolve().parents[3]
SEED = ROOT / "data" / "seed" / "elmina"
BOUNDARY = SEED / "base" / "boundary.geojson"

pytestmark = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed missing")

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


def test_area_between_15_and_30_km2():
    # The owner's map: Elmina Green to Denai Alam (~7 km N-S) by ~2-4 km E-W.
    g = _outline()
    lat = math.radians(g.centroid.y)
    km2 = g.area * (111320 * math.cos(lat)) * 110574 / 1e6
    assert 15 <= km2 <= 30, km2


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


def test_contains_the_urban_park_deep_spot_centre():
    g = _outline()
    site = json.loads((SEED / "site.json").read_text(encoding="utf-8"))
    spot = next(s for s in site["deep_spots"] if s["id"] == "urban-park")
    w, s, e, n = spot["bbox"]
    assert g.contains(Point((w + e) / 2, (s + n) / 2))


def test_subang_corridor_deep_spot_overlaps_the_outline():
    # The corridor bbox centre (101.5275, 3.19) is an arithmetic bbox centre, about 190 m east of
    # the master plan's east edge at Elmina Gardens; the owner's map wins (A-T3b), so only the
    # overlap is required: the corridor's flood view still lands on the drawn city.
    from shapely.geometry import box

    g = _outline()
    site = json.loads((SEED / "site.json").read_text(encoding="utf-8"))
    spot = next(s for s in site["deep_spots"] if s["id"] == "subang-corridor")
    assert g.intersection(box(*spot["bbox"])).area > 0.25 * g.area


def test_georeference_fit_is_tight():
    assert len(CONTROL_POINTS) >= 6
    rms = math.sqrt(sum(r * r for r in _RES) / len(_RES))
    assert rms < 40, rms
    assert max(_RES) < 80, max(_RES)


def test_master_plan_image_is_committed():
    assert (ROOT / "docs" / "03-product" / "elmina-masterplan.png").exists()


def _precinct_centroid(name):
    for f in _fc("base/precincts.geojson"):
        if f["properties"]["name"] == name:
            return shape(f["geometry"]).centroid
    raise AssertionError(f"precinct {name} not in seed")


@pytest.mark.parametrize(
    "name",
    [
        "Elmina Green 1",
        "Elmina Gardens",
        "Taman Bukit Subang",
        "Ferrea Denai Alam",
        "Elmina Valley 4",
    ],
)
def test_contains_owner_map_areas_from_the_seed(name):
    assert _outline().contains(_precinct_centroid(name)), name


@pytest.mark.parametrize("name", [a[0] for a in INSIDE])
def test_contains_owner_map_named_areas(name):
    _, lon, lat, _src = next(a for a in INSIDE if a[0] == name)
    assert _outline().contains(Point(lon, lat)), name


@pytest.mark.parametrize("name", ["Kampung Melayu Subang", "Taman Subang Baru"])
def test_excludes_precincts_outside_on_the_owner_map(name):
    assert not _outline().contains(_precinct_centroid(name)), name


@pytest.mark.parametrize(
    "name",
    [
        "Kampung Melayu Subang Tambahan",
        "Kampung Merbau Sempak",
        "Kampung Kubu Gajah",
        "Kenanga Gardens",
        "Sungai Buloh Country Resort",
        "Subang Bestari",
        "Pangsapuri Subang Suria",
        "Taman Setia Warisan",
        "Bandar Saujana Utama",
        "Subang",
    ],
)
def test_excludes_precincts_clearly_beyond_the_edge(name):
    assert not _outline().contains(_precinct_centroid(name)), name


@pytest.mark.parametrize("name", [a[0] for a in OUTSIDE])
def test_excludes_owner_map_outside_anchors(name):
    _, lon, lat, _src = next(a for a in OUTSIDE if a[0] == name)
    assert not _outline().contains(Point(lon, lat)), name


def test_site_json_records_owner_master_plan_source():
    site = json.loads((SEED / "site.json").read_text(encoding="utf-8"))
    assert site["boundary"]["source"] == "owner_master_plan"
    assert "master plan" in site["boundary"]["method"].lower()


def test_site_json_records_boundary():
    site = json.loads((SEED / "site.json").read_text(encoding="utf-8"))
    assert site["boundary"]["file"] == "base/boundary.geojson"
