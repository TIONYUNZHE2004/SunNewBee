import numpy as np
import pytest
from affine import Affine
from shapely.geometry import box

from data.scripts import build_landcover as bl

PX = 10 / 111320.0  # about 10 m in degrees
T = Affine(PX, 0, 101.5, 0, -PX, 3.2)  # north-up, 20 x 20 grid


def cell_box(r0, c0, r1, c1):
    return box(101.5 + c0 * PX, 3.2 - r1 * PX, 101.5 + c1 * PX, 3.2 - r0 * PX)


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"landuse": "forest"}, "forest"),
        ({"natural": "wood"}, "forest"),
        ({"natural": "scrub"}, "scrub"),
        ({"landuse": "grass"}, "grass"),
        ({"landuse": "meadow"}, "grass"),
        ({"natural": "grassland"}, "grass"),
        ({"landuse": "farmland"}, "farmland"),
        ({"landuse": "orchard"}, "farmland"),
        ({"landuse": "plantation"}, "farmland"),
        ({"landuse": "plantation", "crop": "oil_palm"}, "oil_palm"),
        ({"landuse": "farmland", "produce": "oil_palm"}, "oil_palm"),
        ({"landuse": "orchard", "trees": "oil_palm"}, "oil_palm"),
        ({"landuse": "construction"}, "construction"),
        ({"landuse": "brownfield"}, "construction"),
        ({"amenity": "parking"}, "parking"),
        ({"landuse": "residential"}, "residential"),
        ({"landuse": "commercial"}, "commercial"),
        ({"landuse": "retail"}, "commercial"),
        ({"landuse": "industrial"}, "industrial"),
        ({"natural": "water"}, "water"),
        ({"landuse": "reservoir"}, "water"),
        ({"landuse": "basin"}, "water"),
        ({"natural": "wetland"}, "wetland"),
        ({"natural": "bare_rock"}, "bare"),
        ({"natural": "sand"}, "bare"),
        ({"leisure": "park"}, None),
        ({"highway": "residential"}, None),
        ({}, None),
    ],
)
def test_osm_class(tags, expected):
    assert bl.osm_class(tags) == expected


def way(i, pts, **tags):
    return {
        "type": "way",
        "id": i,
        "tags": tags,
        "geometry": [{"lon": x, "lat": y} for x, y in pts],
    }


def test_osm_polygons_closed_ways_only_and_deduped():
    ring = [(101.5, 3.18), (101.501, 3.18), (101.501, 3.181), (101.5, 3.181), (101.5, 3.18)]
    els = [
        way(1, ring, landuse="forest"),
        way(1, ring, landuse="forest"),  # tiled duplicate
        way(2, ring[:3], landuse="forest"),  # open
        way(3, ring, leisure="park"),  # not land cover
        {"type": "node", "id": 4, "lon": 1, "lat": 1, "tags": {"landuse": "forest"}},
    ]
    feats = bl.osm_polygons(els)
    assert len(feats) == 1
    assert feats[0]["properties"] == {"class": "forest", "source": "osm", "osm": "way/1"}
    assert feats[0]["geometry"]["type"] == "Polygon"


def test_gap_covered_area_yields_nothing():
    r = np.zeros((20, 20), "uint8")
    r[0:10, 0:10] = 10
    assert bl.gap_polygons(r, T, cell_box(0, 0, 10, 10).buffer(PX / 4)) == []


def test_gap_small_speck_dropped():
    r = np.zeros((20, 20), "uint8")
    r[5:8, 5:8] = 10  # 900 m2
    assert bl.gap_polygons(r, T, None) == []


def test_gap_built_up_class_not_drawn():
    r = np.zeros((20, 20), "uint8")
    r[0:10, 0:10] = 50
    assert bl.gap_polygons(r, T, None) == []


def test_gap_forest_block_one_feature():
    r = np.zeros((20, 20), "uint8")
    r[0:10, 0:10] = 10
    feats = bl.gap_polygons(r, T, None)
    assert len(feats) == 1
    assert feats[0]["properties"] == {"class": "forest", "source": "esa_worldcover_2021"}


def test_gap_partial_cover_keeps_remainder():
    r = np.zeros((20, 20), "uint8")
    r[0:10, 0:10] = 10
    feats = bl.gap_polygons(r, T, cell_box(0, 0, 10, 5))
    assert len(feats) == 1  # 50 x 100 m = 5000 m2 left
