"""Task 31: major roads (primary/secondary/trunk + links) join the walk network as `major_road`,
with an honest `sidewalk` claim that only ever comes from OSM tags."""

import pytest

from data.scripts import overpass
from data.scripts.import_osm import _claims, _seg_type, merge_ways, sidewalk_value, split_ways


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"sidewalk": "both"}, "both"),
        ({"sidewalk": "left"}, "one_side"),
        ({"sidewalk": "right"}, "one_side"),
        ({"sidewalk": "no"}, "none"),
        ({"sidewalk": "none"}, "none"),
        ({"sidewalk": "separate"}, "separate"),
        ({"sidewalk:both": "yes"}, "both"),
        ({"sidewalk:both": "no"}, "none"),
        ({"sidewalk:both": "separate"}, "separate"),
        ({"sidewalk:left": "yes", "sidewalk:right": "yes"}, "both"),
        ({"sidewalk:left": "yes", "sidewalk:right": "no"}, "one_side"),
        ({"sidewalk:left": "no", "sidewalk:right": "separate"}, "separate"),
        ({"sidewalk:left": "separate", "sidewalk:right": "yes"}, "one_side"),
        ({"sidewalk:left": "no", "sidewalk:right": "no"}, "none"),
        # A side-specific tag refines the general one.
        ({"sidewalk": "both", "sidewalk:right": "no"}, "one_side"),
        # "yes" says at least one side; with the other side known to be "no" that is one side.
        ({"sidewalk": "yes", "sidewalk:right": "no"}, "one_side"),
    ],
)
def test_sidewalk_normalised(tags, expected):
    assert sidewalk_value(tags) == expected


@pytest.mark.parametrize(
    "tags",
    [
        {},
        {"highway": "primary"},
        # Under-specified: never guess the missing side or the number of sides.
        {"sidewalk": "yes"},
        {"sidewalk:left": "yes"},
        {"sidewalk:right": "no"},
        {"sidewalk": "lane"},
        {"sidewalk:left": "maybe", "sidewalk:right": "yes"},
    ],
)
def test_sidewalk_unknown_gives_no_value(tags):
    assert sidewalk_value(tags) is None


@pytest.mark.parametrize(
    "hw", ["primary", "secondary", "trunk", "primary_link", "secondary_link", "trunk_link"]
)
def test_major_highways_are_major_road(hw):
    assert _seg_type({"highway": hw}) == "major_road"


def test_other_types_unchanged():
    assert _seg_type({"highway": "tertiary"}) == "street"
    assert _seg_type({"highway": "tertiary_link"}) == "street"
    assert _seg_type({"highway": "footway"}) == "footway"


def test_major_road_sidewalk_claim_is_osm_reported_with_raw_tags():
    c = _claims({"highway": "primary", "sidewalk": "left"}, "major_road")["sidewalk"]
    assert c["value"] == "one_side"
    assert c["status"] == "reported" and c["evidence_type"] == "osm_import"
    assert "sidewalk=left" in c["notes"]


def test_major_road_without_sidewalk_tag_has_no_claim():
    assert "sidewalk" not in _claims({"highway": "primary"}, "major_road")
    assert "sidewalk" not in _claims({"highway": "primary", "sidewalk": "yes"}, "major_road")


def test_major_road_drops_carriageway_width_and_surface():
    tags = {"highway": "primary", "width": "7", "surface": "asphalt", "lit": "yes"}
    claims = _claims(tags, "major_road")
    assert "width_m" not in claims and "surface" not in claims
    assert claims["lit"]["value"] == "yes"
    # Other types keep them as before.
    assert "width_m" in _claims({"highway": "footway", "width": "2"}, "footway")


def _way(wid, nodes, xs, tags):
    return {
        "id": wid,
        "nodes": nodes,
        "geometry": [{"lon": x, "lat": 0.0} for x in xs],
        "tags": tags,
    }


def test_merge_ways_skips_foot_no_major_roads_and_dedupes():
    walk = [
        _way(1, [1, 2], [0, 1], {"highway": "footway"}),
        _way(3, [2, 3], [1, 2], {"highway": "secondary_link"}),
    ]
    major = [
        _way(3, [2, 3], [1, 2], {"highway": "secondary_link"}),
        _way(4, [3, 4], [2, 3], {"highway": "primary", "foot": "no"}),
        _way(5, [3, 5], [2, 4], {"highway": "trunk", "foot": "yes"}),
    ]
    merged, skipped = merge_ways(walk, major)
    assert sorted(w["id"] for w in merged) == [1, 3, 5]
    assert skipped == 1


def test_merge_ways_skips_foot_no_link_already_in_walk_fetch():
    walk = [_way(3, [2, 3], [1, 2], {"highway": "secondary_link", "foot": "no"})]
    merged, skipped = merge_ways(walk, [])
    assert merged == [] and skipped == 1


def test_major_road_splits_at_shared_nodes_and_joins_network():
    ways = [
        _way(1, [10, 11, 12], [0, 1, 2], {"highway": "footway"}),
        _way(2, [20, 11, 21], [1, 1, 1], {"highway": "primary", "sidewalk": "both"}),
    ]
    ways[1]["geometry"] = [{"lon": 1, "lat": la} for la in (-1, 0, 1)]
    segs = split_ways(ways)
    major = [s for s in segs if s["type"] == "major_road"]
    assert sorted((s["from"], s["to"]) for s in major) == [("n-11", "n-21"), ("n-20", "n-11")]
    assert all(s["claims"]["sidewalk"]["value"] == "both" for s in major)


def test_overpass_budget_stops_before_a_request(monkeypatch, tmp_path):
    monkeypatch.setattr(overpass, "CACHE", tmp_path)
    monkeypatch.setattr(overpass, "REQUESTS_MADE", 3)
    monkeypatch.setattr(overpass, "MAX_REQUESTS", 3)

    def boom(*a, **k):
        raise AssertionError("no HTTP request may be made over budget")

    monkeypatch.setattr(overpass.requests, "post", boom)
    with pytest.raises(overpass.BudgetExceeded):
        overpass.query("[out:json];way(1,2,3,4);out;")
    assert overpass.REQUESTS_MADE == 3


def test_overpass_budget_counts_retries(monkeypatch, tmp_path):
    monkeypatch.setattr(overpass, "CACHE", tmp_path)
    monkeypatch.setattr(overpass, "REQUESTS_MADE", 0)
    monkeypatch.setattr(overpass, "MAX_REQUESTS", 2)
    monkeypatch.setattr(overpass.time, "sleep", lambda s: None)

    class R:
        status_code = 504
        text = ""

    monkeypatch.setattr(overpass.requests, "post", lambda *a, **k: R())
    with pytest.raises(overpass.BudgetExceeded):
        overpass.query("[out:json];way(1,2,3,4);out;")
    assert overpass.REQUESTS_MADE == 2


def test_overpass_cache_hit_costs_nothing(monkeypatch, tmp_path):
    import hashlib

    ql = "[out:json];way(1,2,3,4);out;"
    (tmp_path / (hashlib.sha1(ql.encode()).hexdigest() + ".json")).write_text(
        '{"elements":[]}', encoding="utf-8"
    )
    monkeypatch.setattr(overpass, "CACHE", tmp_path)
    monkeypatch.setattr(overpass, "REQUESTS_MADE", 0)
    monkeypatch.setattr(overpass, "MAX_REQUESTS", 0)
    assert overpass.query(ql) == {"elements": []}
    assert overpass.REQUESTS_MADE == 0


def test_major_tiles_split_the_ne_tile_south_then_north_west_east():
    from data.scripts.import_osm import ENVELOPE, major_tiles

    base = list(overpass.tiles(ENVELOPE, 2))
    tiles = major_tiles()
    # The three tiles cached under R22 keep their exact query bboxes (cache keys).
    assert tiles[:3] == base[:3]
    s, w, n, e = base[3]
    mid, mid_lon = (s + n) / 2, (w + e) / 2
    # R23: south half (cached); R24: north half split into west and east.
    assert tiles[3:] == [(s, w, mid, e), (mid, w, n, mid_lon), (mid, mid_lon, n, e)]


def test_fetch_major_ways_can_skip_unfetchable_tiles(monkeypatch):
    from data.scripts import import_osm

    calls = []

    def fake_query(ql):
        calls.append(ql)
        if len(calls) == 5:
            raise overpass.BudgetExceeded("cap")
        return {"elements": [{"type": "way", "id": len(calls), "geometry": [], "tags": {}}]}

    monkeypatch.setattr(overpass, "query", fake_query)
    ways, missing = import_osm._fetch_major_ways(allow_missing=True)
    assert sorted(w["id"] for w in ways) == [1, 2, 3, 4, 6]
    assert missing == [import_osm.major_tiles()[4]]
    calls.clear()
    with pytest.raises(overpass.BudgetExceeded):
        import_osm._fetch_major_ways(allow_missing=False)


def test_site_json_records_missing_major_road_bboxes_as_wsen():
    from data.scripts.import_osm import site_json

    assert "major_roads_missing_bbox" not in site_json("2026-10-15")
    site = site_json("2026-10-15", [(3.2175, 101.495, 3.24, 101.5125)])
    assert site["major_roads_missing_bbox"] == [[101.495, 3.2175, 101.5125, 3.24]]


def test_walk_rebuild_keeps_display_assets_datum_and_external_attribution():
    from data.scripts.import_osm import site_json

    previous = {
        "data_as_of": "2026-09-01",
        "buildings": {"file": "base/buildings.geojson", "count": 12},
        "scene": {"datum_offset_m": -3.74},
        "attribution": ["© OpenStreetMap contributors (ODbL)", "ESA WorldCover licence"],
        "major_roads_missing_bbox": [[1, 2, 3, 4]],
    }
    site = site_json("2026-10-18", previous=previous)
    assert site["buildings"] == previous["buildings"]
    assert site["scene"]["datum_offset_m"] == -3.74
    assert site["attribution"].count("© OpenStreetMap contributors (ODbL)") == 1
    assert "ESA WorldCover licence" in site["attribution"]
    assert site["data_as_of"] == "2026-10-18"
    assert "major_roads_missing_bbox" not in site


def test_overpass_endpoints_override_moves_on_only_after_connection_errors(monkeypatch, tmp_path):
    import json

    monkeypatch.setattr(overpass, "CACHE", tmp_path)
    monkeypatch.setattr(overpass, "REQUESTS_MADE", 0)
    monkeypatch.setattr(overpass, "MAX_REQUESTS", None)
    monkeypatch.setattr(overpass, "ENDPOINTS", ["https://a/api", "https://b/api"])
    monkeypatch.setattr(overpass.time, "sleep", lambda s: None)
    urls = []

    class R:
        def __init__(self, code):
            self.status_code, self.text = code, '{"elements":[]}'

        def json(self):
            return json.loads(self.text)

    script = ["504", "conn", "200"]

    def post(url, **kw):
        urls.append(url)
        step = script[len(urls) - 1]
        if step == "conn":
            raise overpass.requests.ConnectionError("refused")
        return R(int(step))

    monkeypatch.setattr(overpass.requests, "post", post)
    ql = "[out:json];way(1,2,3,4);out;"
    assert overpass.query(ql) == {"elements": []}
    assert urls == ["https://a/api", "https://a/api", "https://b/api"]
    meta = json.loads(next(tmp_path.glob("*.meta.json")).read_text(encoding="utf-8"))
    assert meta["endpoint"] == "https://b/api" and "fetched_at" in meta


def test_overpass_default_mirrors_unchanged():
    assert overpass.ENDPOINTS is None
    assert overpass.MIRRORS[0] == "https://overpass-api.de/api/interpreter"


# --- Review M-6: pin the Task 31 outcomes on the committed Elmina seed ----------------------


@pytest.fixture(scope="module")
def elmina():
    from pathlib import Path

    from townshiplens_spatial.world import load_world

    return load_world(Path(__file__).resolve().parents[2] / "seed" / "elmina")


def test_seed_major_roads_carry_no_carriageway_width_or_surface(elmina):
    major = [e for e in elmina.edges.values() if e.type == "major_road"]
    assert major
    assert not [e.id for e in major if "width_m" in e.claims or "surface" in e.claims]


def test_seed_no_strict_walking_profile_passes_a_major_road_without_verified_sidewalk(elmina):
    from townshiplens_spatial.evaluate import evaluate_edge

    for e in elmina.edges.values():
        if e.type != "major_road":
            continue
        c = e.claims.get("sidewalk")
        if c is not None and c.status == "verified":
            continue
        for pid in ("stroller", "wheelchair", "older_adult_rest"):
            assert evaluate_edge(e, elmina.profiles[pid])[0] != "PASS", (e.id, pid)


def test_seed_hero_route_still_confirmed_without_major_roads(elmina):
    from townshiplens_spatial.routing import plan_route

    rr = plan_route(elmina, "park-b", "playground", "stroller")
    assert rr.status == "confirmed"
    assert rr.routes[0].distance_m == pytest.approx(440.6, abs=5)
    assert not [s for s in rr.routes[0].segments if elmina.edges[s.edge_id].type == "major_road"]


def test_overpass_http_error_logs_the_response_head(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(overpass, "CACHE", tmp_path)
    monkeypatch.setattr(overpass, "REQUESTS_MADE", 0)
    monkeypatch.setattr(overpass, "MAX_REQUESTS", 1)
    monkeypatch.setattr(overpass.time, "sleep", lambda s: None)

    class R:
        status_code = 500
        text = "<p>runtime error: Query failed with the exception: x</p>" + "y" * 500

    monkeypatch.setattr(overpass.requests, "post", lambda *a, **k: R())
    with pytest.raises(overpass.BudgetExceeded):
        overpass.query("[out:json];way(1,2,3,4);out;")
    out = capsys.readouterr().out
    assert "runtime error: Query failed" in out and "y" * 300 not in out


def test_overpass_error_text_is_extracted_from_the_html_page():
    page = (
        '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 '
        'Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"><html><head>'
        "<title>OSM3S Response</title></head><body><p>The data included in this document is "
        'from www.openstreetmap.org.</p><p><strong style="color:#FF0000">Error</strong>: '
        "runtime error: open64: 0 Success /osm3s_osm_base Dispatcher_Client::request_read_and_idx"
        "::timeout. The server is probably too busy to handle your request. </p></body></html>"
    )
    msg = overpass.error_text(page)
    assert msg.startswith("Error: runtime error: open64")
    assert "too busy" in msg and "<" not in msg and "DOCTYPE" not in msg
    assert overpass.error_text("plain failure") == "plain failure"


def test_overpass_response_with_remark_is_not_cached(monkeypatch, tmp_path):
    """Review I1: Overpass answers 200 + `remark` on timeout/out-of-memory with truncated
    elements; that must not be cached as a complete result."""
    import json

    monkeypatch.setattr(overpass, "CACHE", tmp_path)
    monkeypatch.setattr(overpass, "REQUESTS_MADE", 0)
    monkeypatch.setattr(overpass, "MAX_REQUESTS", 2)
    monkeypatch.setattr(overpass.time, "sleep", lambda s: None)
    body = {"elements": [{"type": "way", "id": 1}], "remark": "runtime error: Query timed out"}
    text = json.dumps(body)

    class R:
        status_code = 200

        def __init__(self):
            self.text = text

        def json(self):
            return body

    monkeypatch.setattr(overpass.requests, "post", lambda *a, **k: R())
    with pytest.raises(overpass.BudgetExceeded):
        overpass.query("[out:json];way(id:1);out geom;")
    assert not list(tmp_path.glob("*.json"))
    assert overpass.REQUESTS_MADE == 2


def test_overpass_failure_classes():
    assert issubclass(overpass.BudgetExceeded, overpass.OverpassError)
    assert issubclass(overpass.OverpassFailed, overpass.OverpassError)
