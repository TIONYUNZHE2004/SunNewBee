from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from townshiplens_spatial import flood
from townshiplens_spatial.routing import plan_route

ORDER = ["baseline", "stage_p1m", "stage_p3m", "stage_p5m"]


def test_affected_lists_playground(world):
    a = flood.affected(world, "stage_p3m")
    assert any(x["id"] == "playground" for x in a.likely)
    assert "not a forecast" in a.disclaimer


def test_monotonic_flooded_sets(world):
    def flooded(s):
        return {e for e, c in world.flood.edge_classes.get(s, {}).items() if c == "likely_flooded"}

    for lo, hi in zip(ORDER, ORDER[1:], strict=False):
        assert flooded(lo) <= flooded(hi)


@settings(
    max_examples=30,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    st.sampled_from(ORDER),
    st.sampled_from(["park-b", "lakeside-mall", "kiosk"]),
    st.sampled_from(["playground", "kiosk", "toilet-1", "bench-1"]),
    st.sampled_from(["default", "stroller", "wheelchair", "older_adult_rest"]),
)
def test_no_route_through_likely_flooded(world, scen, a, b, prof):
    rr = plan_route(world, a, b, prof, scen)
    likely = {e for e, c in world.flood.edge_classes.get(scen, {}).items() if c == "likely_flooded"}
    for r in rr.routes:
        assert not ({s.edge_id for s in r.segments} & likely)


def test_centres_reachability(world):
    res = flood.centres_reachability(world, "stage_p3m", "stroller", "park-b")
    by_id = {r.centre.id: r for r in res}
    assert by_id["evc-hall"].reachable is True
    assert by_id["evc-school"].reachable is False  # island
    assert by_id["evc-school"].centre.source == "official_pps"


def test_centres_without_origin_are_no_data(world):
    res = flood.centres_reachability(world, "stage_p3m", "stroller", None)
    assert {r.route_status for r in res} == {"no_data"}
    assert not any(r.reachable for r in res)


def test_centres_unknown_origin_or_profile_no_crash(world):
    assert all(
        not r.reachable for r in flood.centres_reachability(world, None, "stroller", "nowhere")
    )
    assert all(not r.reachable for r in flood.centres_reachability(world, None, "bogus", "park-b"))


def test_islands_reported(world):
    # island = connected component of the passable (non-FAIL) graph containing no centre (R5)
    a = flood.affected(world, "stage_p5m", "stroller")
    centre_nodes = {c.node_id for c in world.centres.values()}
    assert any("n-a" in c["sample_node_ids"] for c in a.isolated_components)
    assert all(not (set(c["sample_node_ids"]) & centre_nodes) for c in a.isolated_components)


def test_affected_unknown_profile_falls_back(world):
    a = flood.affected(world, "stage_p3m", "bogus")
    assert a.scenario_id == "stage_p3m"
