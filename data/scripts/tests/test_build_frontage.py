import copy
import math

from shapely.geometry import LineString
from shapely.strtree import STRtree

from data.scripts import build_frontage as bf

LAT0 = bf.REF_LAT
LON0 = 101.5
KX = bf.M_PER_DEG * math.cos(math.radians(LAT0))


def ll(x: float, y: float) -> list[float]:
    return [LON0 + x / KX, LAT0 + y / bf.M_PER_DEG]


def rect(w: float, l: float, angle_deg: float = 0.0) -> list[list[float]]:  # noqa: E741
    """Closed lon/lat ring, w east-west x l north-south, centred on the origin, then rotated."""
    a = math.radians(angle_deg)
    pts = []
    for x, y in ((-w / 2, -l / 2), (w / 2, -l / 2), (w / 2, l / 2), (-w / 2, l / 2)):
        pts.append(ll(x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)))
    return [*pts, pts[0]]


def streets(*lines):
    geoms = [LineString([ll(*p) for p in line]) for line in lines]
    geoms = [bf.project_line(g) for g in geoms]
    return STRtree(geoms), geoms


def feat(fid, arch, ring):
    return {
        "type": "Feature",
        "properties": {"id": fid, "archetype": arch},
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


def test_obb_sides_are_four_outward_normals():
    xy = [((x - 0) * 1.0, y * 1.0) for x, y in ((-3, -7), (3, -7), (3, 7), (-3, 7))]
    sides = bf.obb_sides(xy)
    assert len(sides) == 4
    for (mx, my), (nx, ny) in sides:
        assert math.hypot(nx, ny) == 1 or abs(math.hypot(nx, ny) - 1) < 1e-9
        assert mx * nx + my * ny > 0  # points away from the centre


def test_street_south_of_short_side_faces_south():
    tree, geoms = streets([(-50, -15.5 / 2 - 8), (50, -15.5 / 2 - 8)])
    deg, src = bf.front_of(rect(6.4, 15.5), tree, geoms)
    assert abs(deg - 180) <= 1 and src == "street"


def test_street_east_of_long_side_faces_east():
    tree, geoms = streets([(3.2 + 8, -50), (3.2 + 8, 50)])
    deg, _ = bf.front_of(rect(6.4, 15.5), tree, geoms)
    assert abs(deg - 90) <= 1


def test_street_50m_away_gives_none():
    tree, geoms = streets([(-50, -57.75), (50, -57.75)])
    assert bf.front_of(rect(6.4, 15.5), tree, geoms) is None


def test_rotated_footprint_gives_rotated_azimuth():
    # footprint rotated 30 deg anticlockwise; street to the south of its (rotated) short side
    ring = rect(6.4, 15.5, 30)
    tree, geoms = streets([(-60, -12), (60, -12)])
    deg, _ = bf.front_of(ring, tree, geoms)
    assert abs(deg - 150) <= 1  # south normal turned 30 deg anticlockwise


def test_footways_ignored():
    line = {"type": "LineString", "coordinates": [ll(-50, -16), ll(50, -16)]}

    def f(t):
        return {"type": "Feature", "properties": {"type": t}, "geometry": line}

    assert bf.street_geoms([f("footway"), f("path"), f("steps")]) == []
    assert len(bf.street_geoms([f("street"), f("major_road"), f("pedestrian"), f("footway")])) == 3


def test_transform_idempotent_and_generic_untouched():
    tree, geoms = streets([(-50, -15.5 / 2 - 8), (50, -15.5 / 2 - 8)])
    feats = [
        feat("a", "link_intermediate", rect(6.4, 15.5)),
        feat("g", "generic", rect(6.4, 15.5)),
        feat("far", "bungalow", [[p[0] + 0.01, p[1]] for p in rect(6.4, 15.5)]),
    ]
    once = bf.transform(feats, tree, geoms)
    assert once[0]["properties"]["front_source"] == "street"
    assert "front_deg" not in once[1]["properties"]
    assert "front_deg" not in once[2]["properties"]
    assert bf.transform(copy.deepcopy(once), tree, geoms) == once
    assert "front_deg" not in feats[0]["properties"]  # input not mutated


def test_azimuth_just_below_360_wraps_to_zero():
    # footprint turned 0.03 deg anticlockwise, street to the north: azimuth 359.97 rounds to 360.0
    tree, geoms = streets([(-50, 15.5 / 2 + 8), (50, 15.5 / 2 + 8)])
    deg, _ = bf.front_of(rect(6.4, 15.5, 0.03), tree, geoms)
    assert deg == 0.0


def test_tie_goes_to_the_longer_side():
    # streets 8 m off the east long side and 8 m off the north short side: equal distances
    tree, geoms = streets([(3.2 + 8, -50), (3.2 + 8, 50)], [(-50, 7.75 + 8), (50, 7.75 + 8)])
    deg, _ = bf.front_of(rect(6.4, 15.5), tree, geoms)
    assert abs(deg - 90) <= 1
