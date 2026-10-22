from types import SimpleNamespace

import networkx as nx
from hypothesis import given, settings
from hypothesis import strategies as st
from townshiplens_spatial.geo import haversine_m
from townshiplens_spatial.routing import SNAP_CAP_M, _snap_to_road


@given(
    st.floats(-89, 89, allow_nan=False),
    st.floats(-180, 180, allow_nan=False),
    st.lists(
        st.tuples(
            st.floats(-0.003, 0.003, allow_nan=False), st.floats(-0.003, 0.003, allow_nan=False)
        ),
        min_size=1,
        max_size=80,
    ),
)
@settings(max_examples=60, deadline=None)
def test_spherical_snap_index_matches_full_exact_search(lat, lon, offsets):
    points = {
        f"n{i:03}": [((lon + dx + 180) % 360) - 180, lat + dy] for i, (dx, dy) in enumerate(offsets)
    }
    world = SimpleNamespace(graph=nx.Graph(), node_coords=points)
    roads = set(points)
    nearest = min(((haversine_m([lon, lat], p), n) for n, p in points.items()), default=None)
    expected = nearest[1] if nearest and nearest[0] <= SNAP_CAP_M else None
    assert _snap_to_road(world, roads, "off-road", [lon, lat]) == expected


def test_snap_id_ties_radius_and_road_set_invalidation():
    world = SimpleNamespace(
        graph=nx.Graph(),
        node_coords={"a": [101.51, 3.18], "z": [101.51, 3.18], "far": [101.52, 3.18]},
    )
    assert _snap_to_road(world, {"a", "z"}, "off", [101.51, 3.18]) == "a"
    assert _snap_to_road(world, {"far"}, "off", [101.51, 3.18]) is None
    assert _snap_to_road(world, {"z"}, "off", [101.51, 3.18]) == "z"
