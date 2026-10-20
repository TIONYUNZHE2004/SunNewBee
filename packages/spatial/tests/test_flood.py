from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from townshiplens_spatial import flood
from townshiplens_spatial.routing import plan_route

ORDER = ["baseline", "stage_p1m", "stage_p2m", "stage_p3m"]


def test_affected_lists_playground(world):
    a = flood.affected(world, "stage_p3m")
    assert any(x["id"] == "playground" for x in a.likely)
    assert "not a forecast" in a.disclaimer


def test_impact_markers_distinguish_flooded_cut_off_and_unmapped(world):
    # The place itself floods at D; cutting B-C strands A/B without flooding them.
    world.flood.edge_classes["stage_p3m"]["seg-bc"] = "likely_flooded"
    result = flood.affected(world, "stage_p3m", "stroller")
    assert [p.model_dump() for p in result.flooded_places] == [
        {
            "id": "playground",
            "name": world.places["playground"].name,
            "type": "playground",
            "lonlat": world.places["playground"].coord,
        }
    ]
    cut_off = {p.id: p for p in result.cut_off_places}
    assert "park-b" in cut_off and "lakeside-mall" in cut_off
    assert cut_off["park-b"].lonlat == world.places["park-b"].coord
    assert "playground" not in cut_off and "moon-base" not in cut_off
    assert result.flooded_path_m == sum(world.edges[e].length_m for e in ("seg-bc", "seg-cd"))


def test_impact_markers_use_every_entrance_and_unknown_edges(world):
    world.flood.edge_classes["stage_p3m"]["seg-bc"] = "likely_flooded"
    world.places["park-b"].entrance_ids = ["lakeside-mall", "bench-1"]
    result = flood.affected(world, "stage_p3m", "stroller", kind="path")
    assert "park-b" not in {p.id for p in result.cut_off_places}
    # New map fields are complete even when the older briefing lists filter to paths.
    assert [p.id for p in result.flooded_places] == ["playground"]
    assert result.likely_place_ids == []


def test_impact_markers_include_mapped_isolation_without_claiming_a_flood_cause(world):
    from townshiplens_spatial.models import Place

    world.graph.add_node("n-isolated")
    world.places["isolated"] = Place(
        id="isolated", type="facility", name="Isolated", coord=[101.52, 3.18], node_id="n-isolated"
    )
    result = flood.affected(world, "baseline")
    assert "isolated" in {p.id for p in result.cut_off_places}
    assert result.isolated_components == []  # legacy field remains flood-induced only
    assert result.flooded_path_m == 0 and result.flooded_places == []


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
    world.flood.edge_classes["stage_p3m"]["seg-bc"] = "likely_flooded"
    # island = connected component of the passable (non-FAIL) graph containing no centre (R5)
    a = flood.affected(world, "stage_p3m", "stroller")
    centre_nodes = {c.node_id for c in world.centres.values()}
    assert any("n-a" in c["sample_node_ids"] for c in a.isolated_components)
    assert all(not (set(c["sample_node_ids"]) & centre_nodes) for c in a.isolated_components)


def test_affected_unknown_profile_falls_back(world):
    a = flood.affected(world, "stage_p3m", "bogus")
    assert a.scenario_id == "stage_p3m"


def test_centres_reachability_does_not_mutate_places(world):
    before = set(world.places)
    flood.centres_reachability(world, "stage_p3m", "stroller", "park-b")
    assert set(world.places) == before


def test_at_most_three_route_ids(world):
    from townshiplens_spatial.models import EvacCentre

    for i in range(5):
        world.centres[f"extra-{i}"] = EvacCentre(
            id=f"extra-{i}",
            name=f"Extra {i}",
            coord=[101.51, 3.181],
            node_id="n-c",
            source="osm_candidate",
        )
    res = flood.centres_reachability(world, "stage_p3m", "stroller", "park-b")
    assert len(res) == 7
    assert 1 <= sum(1 for r in res if r.route_id) <= 3
    assert all(r.route_id for r in res[:3] if r.reachable)


def test_islands_only_flood_induced(world):
    assert flood.affected(world, "baseline", "stroller").isolated_components == []
    assert flood.affected(world, "stage_p3m", "stroller").isolated_components == []
    world.flood.edge_classes["stage_p3m"]["seg-bc"] = "likely_flooded"
    a = flood.affected(world, "stage_p3m", "stroller")
    assert a.isolated_total == len(a.isolated_components) >= 1
    assert all(c["sample_place_ids"] for c in a.isolated_components)


def test_islands_ignore_never_connected_components(world):
    world.flood.edge_classes["stage_p3m"]["seg-bc"] = "likely_flooded"
    from townshiplens_spatial.models import Edge

    world.edges["seg-far"] = Edge(
        id="seg-far",
        type="footway",
        from_node="n-x",
        to_node="n-y",
        coords=[[101.6, 3.2], [101.6001, 3.2]],
        length_m=10,
    )
    world.graph.add_edge("n-x", "n-y", key="seg-far", edge_id="seg-far")
    a = flood.affected(world, "stage_p3m", "stroller")
    assert not any("n-x" in c["sample_node_ids"] for c in a.isolated_components)


def _add_unnamed_edges(world, n):
    from townshiplens_spatial.models import Edge

    for i in range(n):
        eid = f"seg-u{i}"
        world.edges[eid] = Edge(
            id=eid,
            type="footway",
            from_node="n-a",
            to_node="n-b",
            coords=[[101.5, 3.18], [101.5001, 3.18]],
            length_m=1,
        )
        world.flood.edge_classes["stage_p3m"][eid] = "likely_flooded"


def test_affected_groups_and_caps(world):
    _add_unnamed_edges(world, 30)
    a = flood.affected(world, "stage_p3m")
    unnamed = [x for x in a.likely if x["kind"] == "path" and x["name"] == "Unnamed paths"]
    assert len(unnamed) == 1 and unnamed[0]["count"] >= 30
    assert len(a.likely) <= 20
    assert a.likely_total >= 31
    assert "seg-u0" in a.likely_edge_ids and "playground" in a.likely_place_ids


def test_affected_unknown_profile_warns(world):
    a = flood.affected(world, "stage_p3m", "bogus")
    assert any("bogus" in w for w in a.warnings)


def test_drive_flood_fail_for_possible(world):
    from townshiplens_spatial.evaluate import evaluate_edge
    from townshiplens_spatial.models import Edge

    road = Edge(
        id="rd",
        type="street",
        from_node="n-a",
        to_node="n-b",
        coords=[[0.0, 0.0], [0.001, 0.0]],
        length_m=100.0,
    )
    assert evaluate_edge(road, world.profiles["drive"], None)[0] == "PASS"
    assert evaluate_edge(road, world.profiles["drive"], "possible")[0] == "FAIL"
    assert evaluate_edge(road, world.profiles["drive"], "likely_flooded")[0] == "FAIL"
    # a possibly flooded path is still only UNKNOWN for a stroller
    fw = world.edges["seg-ab"]
    assert evaluate_edge(fw, world.profiles["stroller"], "possible")[0] == "UNKNOWN"


def test_drive_fails_non_road_edge_types(world):
    from townshiplens_spatial.evaluate import evaluate_edge

    for eid in ("seg-ab", "seg-be", "seg-cf", "seg-gh"):  # footway, steps, ramp, path
        assert evaluate_edge(world.edges[eid], world.profiles["drive"])[0] == "FAIL"


def test_islands_exclude_baseline_disconnected_components(world):
    from townshiplens_spatial.models import Place

    # a place on its own mapped component, with no centre: disconnected at baseline = data gap
    world.node_coords["n-q"] = [101.5085, 3.181]
    world.graph.add_node("n-q")
    world.places["lone"] = Place(
        id="lone", type="facility", name="Lone", coord=[101.5085, 3.181], node_id="n-q"
    )
    world._place_by_node.setdefault("n-q", []).append("lone")
    for scen in ("baseline", "stage_p3m"):
        a = flood.affected(world, scen, "stroller")
        assert all("lone" not in c["sample_place_ids"] for c in a.isolated_components)
