from data.scripts import build_landmarks as bl

LON, LAT = 101.5, 3.18
D = 1 / 111320.0  # one metre in degrees of latitude

SPEC = {
    "id": "elmina-lakeside-mall",
    "name": "Elmina Lakeside Mall",
    "model": "lakeside_mall",
    "match": r"elmina lakeside mall",
    "info_url": "https://example.test/mall",
}


def square(lon, lat, side_m=10.0, bid="w1", name=None):
    dlat = side_m * D
    dlon = side_m * D / 0.99998
    ring = [
        [lon, lat],
        [lon + dlon, lat],
        [lon + dlon, lat + dlat],
        [lon, lat + dlat],
        [lon, lat],
    ]
    props = {"id": bid}
    if name:
        props["name"] = name
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


def poi(i, name, lon, lat, kind="node"):
    return {"type": kind, "id": i, "lon": lon, "lat": lat, "tags": {"name": name}}


def test_building_name_match_wins_over_poi():
    named = square(LON, LAT, bid="w10", name="Elmina Lakeside Mall")
    other = square(LON + 100 * D, LAT, bid="w11")
    p = poi(5, "Elmina Lakeside Mall", LON + 105 * D, LAT + 5 * D)
    got = bl.resolve(SPEC, [other, named], [p])
    assert got["properties"]["building_id"] == "w10"
    assert got["properties"]["osm"] == "way/10"


def test_poi_only_match_picks_containing_footprint():
    a = square(LON, LAT, bid="w20")
    b = square(LON + 100 * D, LAT, bid="w21")
    p = poi(7, "Elmina Lakeside Mall", LON + 105 * D, LAT + 5 * D)
    got = bl.resolve(SPEC, [a, b], [p])
    assert got["properties"]["building_id"] == "w21"
    assert got["properties"]["osm"] == "node/7"
    assert got["geometry"] == b["geometry"]


def test_poi_far_from_every_footprint_is_unplaced():
    a = square(LON, LAT, bid="w30")
    p = poi(8, "Elmina Lakeside Mall", LON + 60 * D, LAT + 60 * D)
    assert bl.resolve(SPEC, [a], [p]) is None


def test_poi_near_footprint_uses_nearest_within_30m():
    a = square(LON, LAT, bid="w40")
    p = poi(9, "Elmina Lakeside Mall", LON + 10 * D, LAT + 30 * D)  # 20 m north of the edge
    assert bl.resolve(SPEC, [a], [p])["properties"]["building_id"] == "w40"


def test_unmatched_spec_is_none():
    a = square(LON, LAT, bid="w50", name="Some Shop")
    p = poi(1, "Other Place", LON + 5 * D, LAT + 5 * D)
    assert bl.resolve(SPEC, [a], [p]) is None


def test_way_poi_uses_center():
    a = square(LON, LAT, bid="w60")
    el = {
        "type": "way",
        "id": 3,
        "center": {"lon": LON + 5 * D, "lat": LAT + 5 * D},
        "tags": {"name": "ELMINA LAKESIDE MALL"},
    }
    assert bl.resolve(SPEC, [a], [el])["properties"]["osm"] == "way/3"


def test_output_feature_carries_sources():
    a = square(LON, LAT, bid="w70", name="Elmina Lakeside Mall")
    feats, unplaced = bl.build_landmarks([SPEC], [a], [], "2026-10-17")
    assert unplaced == []
    p = feats[0]["properties"]
    assert p["source_url"] == "https://www.openstreetmap.org/way/70"
    assert p["info_url"] == "https://example.test/mall"
    assert p["as_of"] == "2026-10-17"
    assert (p["id"], p["name"], p["model"]) == (SPEC["id"], SPEC["name"], "lakeside_mall")
    assert feats[0]["geometry"]["type"] == "Polygon"


def test_unplaced_landmark_gets_no_feature_and_is_reported():
    feats, unplaced = bl.build_landmarks([SPEC], [], [], "2026-10-17")
    assert feats == []
    assert unplaced == ["elmina-lakeside-mall"]
