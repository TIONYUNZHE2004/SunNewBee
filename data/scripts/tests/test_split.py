import pytest

from data.scripts.import_osm import TopologyError, split_ways


def test_sidewalk_subtag_survives_splitting_with_osm_sidewalk_claims_on_streets():
    ways = [
        {
            "id": 1,
            "nodes": [10, 11],
            "geometry": [{"lon": 0, "lat": 0}, {"lon": 1, "lat": 0}],
            "tags": {"highway": "footway", "footway": "sidewalk"},
        },
        {
            "id": 2,
            "nodes": [11, 12],
            "geometry": [{"lon": 1, "lat": 0}, {"lon": 2, "lat": 0}],
            "tags": {"highway": "residential", "sidewalk": "both"},
        },
    ]
    sidewalk, street = split_ways(ways)
    assert sidewalk["type"] == "sidewalk"
    assert sidewalk["osm_tags"] == {"highway": "footway", "footway": "sidewalk"}
    assert street["type"] == "street"
    claim = street["claims"]["sidewalk"]
    assert claim["value"] == "both" and claim["status"] == "reported"
    assert claim["evidence_type"] == "osm_import" and "sidewalk=both" in claim["notes"]


def test_split_at_shared_nodes():
    ways = [
        {
            "id": 1,
            "nodes": [10, 11, 12],
            "geometry": [{"lon": 0, "lat": 0}, {"lon": 1, "lat": 0}, {"lon": 2, "lat": 0}],
            "tags": {"highway": "footway"},
        },
        {
            "id": 2,
            "nodes": [11, 20],
            "geometry": [{"lon": 1, "lat": 0}, {"lon": 1, "lat": 1}],
            "tags": {"highway": "steps", "step_count": "4"},
        },
    ]
    segs = split_ways(ways)
    ids = sorted((s["from"], s["to"]) for s in segs)
    assert ids == [("n-10", "n-11"), ("n-11", "n-12"), ("n-11", "n-20")]
    steps = next(s for s in segs if s["to"] == "n-20")
    assert steps["type"] == "steps" and steps["claims"]["step_count"]["value"] == 4
    assert steps["claims"]["step_count"]["status"] == "reported"


def test_split_retains_mode_restrictions_and_surface_inputs():
    tags = {
        "highway": "service",
        "service": "driveway",
        "access": "no",
        "foot": "yes",
        "motor_vehicle": "no",
        "surface": "unpaved",
        "name": "Test",
    }
    segments = split_ways(
        [
            {
                "id": 1,
                "nodes": [1, 2],
                "tags": tags,
                "geometry": [{"lon": 0, "lat": 0}, {"lon": 0.001, "lat": 0}],
            }
        ]
    )
    assert segments[0]["osm_tags"] == {k: v for k, v in tags.items() if k != "name"}


def _crossing_ways():
    return [
        {
            "id": 1,
            "nodes": [10, 11, 12],
            "geometry": [{"lon": 0, "lat": 0}, {"lon": 1, "lat": 1}, {"lon": 2, "lat": 2}],
            "tags": {"highway": "footway", "bridge": "yes", "layer": "1"},
        },
        {
            "id": 2,
            "nodes": [20, 21, 22],
            "geometry": [{"lon": 0, "lat": 2}, {"lon": 1, "lat": 1}, {"lon": 2, "lat": 0}],
            "tags": {"highway": "residential", "layer": "0"},
        },
    ]


def test_equal_coordinates_with_different_osm_ids_never_create_a_junction():
    segments = split_ways(_crossing_ways())
    assert len(segments) == 2  # no invented split/junction at the coincident midpoints
    assert {segments[0]["from"], segments[0]["to"]}.isdisjoint(
        {segments[1]["from"], segments[1]["to"]}
    )


@pytest.mark.parametrize("nodes", [None, [], [10, 11], [10, None, 12], ["0_0", "1_1", "2_2"]])
def test_missing_or_synthetic_identity_is_rejected_instead_of_guessing(nodes):
    ways = _crossing_ways()
    ways[0]["nodes"] = nodes
    with pytest.raises(TopologyError, match="original OSM node IDs"):
        split_ways(ways)


def test_incomplete_geometry_is_rejected_instead_of_silently_losing_a_road():
    ways = _crossing_ways()
    ways[0]["geometry"][1] = None
    with pytest.raises(TopologyError, match="complete matching geometry"):
        split_ways(ways)


def test_conflicting_source_positions_cannot_create_a_teleporting_junction():
    ways = _crossing_ways()
    ways[1]["nodes"][1] = 11
    ways[1]["geometry"][1] = {"lon": 1.001, "lat": 1}
    with pytest.raises(TopologyError, match="conflicting coordinates"):
        split_ways(ways)


def test_fetch_queries_request_node_members_and_geometry(monkeypatch):
    from data.scripts import import_osm

    queries = []

    def query(ql):
        queries.append(ql)
        return {"elements": []}

    monkeypatch.setattr(import_osm.overpass, "query", query)
    import_osm._fetch_ways()
    import_osm._fetch_major_ways()
    assert len(queries) == 15
    assert all(q.endswith("out body geom;") for q in queries)


def test_import_stops_before_writing_when_source_topology_is_unusable(monkeypatch, tmp_path):
    from data.scripts import import_osm

    bad = _crossing_ways()[0]
    del bad["nodes"]
    monkeypatch.setattr(import_osm, "OUT", tmp_path)
    monkeypatch.setattr(import_osm, "_fetch_ways", lambda: [bad])
    monkeypatch.setattr(import_osm, "_fetch_major_ways", lambda _: ([], []))
    monkeypatch.setattr(import_osm, "_place_tile_results", lambda: [])
    monkeypatch.setattr(import_osm, "_fetch_places", lambda _: [])
    monkeypatch.setattr(import_osm, "fetch_area_geometry", lambda _: {})
    monkeypatch.setattr(import_osm, "_fetch_hydrology", lambda: [])
    original = tmp_path / "walk.geojson"
    original.write_text("unchanged")
    with pytest.raises(SystemExit) as error:
        import_osm.main(["--max-requests", "0"])
    assert error.value.code == 2
    assert original.read_text() == "unchanged"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["walk.geojson"]
