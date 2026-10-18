from data.scripts.import_osm import split_ways


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
