import pytest
from tl_assets.geo import ring_centroid, to_local

ORIGIN = (101.5099, 3.1813)


def test_north_is_minus_z():
    x, z = to_local(101.5099, 3.1913, ORIGIN)
    assert x == pytest.approx(0, abs=1e-9)
    assert z == pytest.approx(-1105.8, abs=0.5)


def test_east_is_plus_x():
    x, z = to_local(101.5199, 3.1813, ORIGIN)
    assert x == pytest.approx(1111.5, abs=0.5)
    assert z == 0


def test_ring_centroid_of_a_rectangle_is_its_centre():
    ring = [[101.0, 3.0], [101.2, 3.0], [101.2, 3.1], [101.0, 3.1], [101.0, 3.0]]
    lon, lat = ring_centroid(ring)
    assert lon == pytest.approx(101.1)
    assert lat == pytest.approx(3.05)
    # winding and an open ring do not matter
    lon2, lat2 = ring_centroid(list(reversed(ring[:-1])))
    assert (lon2, lat2) == pytest.approx((101.1, 3.05))
