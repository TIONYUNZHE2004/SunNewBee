import pytest

from data.scripts import build_signage as bs

LON, LAT = 101.5, 3.18
D = 1 / 111320.0  # one metre in degrees of latitude


def square(lon, lat, side_m=10.0, bid="w1"):
    dlat = side_m * D
    dlon = side_m * D / 0.99998
    ring = [
        [lon, lat],
        [lon + dlon, lat],
        [lon + dlon, lat + dlat],
        [lon, lat + dlat],
        [lon, lat],
    ]
    return {
        "type": "Feature",
        "properties": {"id": bid},
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


def node(i, name, lon=LON + 5 * D, lat=LAT + 5 * D, **tags):
    return {
        "type": "node",
        "id": i,
        "lat": lat,
        "lon": lon,
        "tags": {"name": name, "shop": "x", **tags},
    }


@pytest.mark.parametrize(
    "name",
    [
        "Only seen in Google Maps. Not OSV.",
        "Clinic (unnamed, OSM)",
        "fixme",
        "  ",
        "todo: name",
        "?",
        "...",
        "",
    ],
)
def test_sign_text_rejects_mapper_notes(name):
    assert bs.sign_text({"name": name}) is None


def test_sign_text_keeps_real_names_and_collapses_whitespace():
    assert bs.sign_text({"name": "Ediya  Coffee"}) == "Ediya Coffee"
    assert bs.sign_text({"name": "Kedai Ah Seng"}) == "Kedai Ah Seng"


def test_sign_text_uses_brand_without_name():
    assert bs.sign_text({"brand": "KFC"}) == "KFC"
    assert bs.sign_text({"name": "", "brand": "KFC"}) == "KFC"


def test_sign_text_junk_name_does_not_fall_back_to_brand():
    assert bs.sign_text({"name": "fixme", "brand": "KFC"}) is None


def test_sign_text_none_without_tags():
    assert bs.sign_text({"shop": "yes"}) is None


def test_attach_containing_footprint():
    b = [square(LON, LAT)]
    assert bs.attach((LON + 5 * D, LAT + 5 * D), b) == "w1"


def test_attach_nearest_within_limit_and_none_beyond():
    b = [square(LON, LAT, bid="w1"), square(LON + 200 * D, LAT, bid="w2")]
    assert bs.attach((LON - 10 * D, LAT + 5 * D), b) == "w1"
    assert bs.attach((LON - 30 * D, LAT + 5 * D), b) is None


def test_attach_picks_nearer_of_two():
    b = [square(LON, LAT, bid="w1"), square(LON + 40 * D, LAT, bid="w2")]
    assert bs.attach((LON + 30 * D, LAT + 5 * D), b) == "w2"


def test_build_signs_fields_and_sources():
    els = [
        node(7, "Ediya Coffee"),
        {
            "type": "way",
            "id": 9,
            "center": {"lat": LAT + 4 * D, "lon": LON + 4 * D},
            "tags": {"name": "Klinik Sihat", "amenity": "clinic"},
        },
    ]
    feats, stats = bs.build_signs(els, [square(LON, LAT)], "2026-10-17")
    assert stats == {"kept": 2, "junk": 0, "unattached": 0, "capped": 0}
    by = {f["properties"]["id"]: f for f in feats}
    n = by["sign-n7"]["properties"]
    assert n["text"] == "Ediya Coffee"
    assert n["building_id"] == "w1"
    assert n["osm"] == "node/7"
    assert n["source_url"] == "https://www.openstreetmap.org/node/7"
    assert n["source_label"] == "OpenStreetMap"
    assert n["as_of"] == "2026-10-17"
    assert by["sign-w9"]["properties"]["source_url"] == "https://www.openstreetmap.org/way/9"
    for f in feats:
        assert f["properties"]["source_url"] and f["properties"]["as_of"]
        assert f["geometry"]["type"] == "Point"
        assert not any("logo" in k for k in f["properties"])


def test_build_signs_counts_junk_and_unattached():
    els = [node(1, "fixme"), node(2, "Far Shop", lon=LON + 500 * D), node(3, "Good")]
    feats, stats = bs.build_signs(els, [square(LON, LAT)], "2026-10-17")
    assert [f["properties"]["text"] for f in feats] == ["Good"]
    assert stats == {"kept": 1, "junk": 1, "unattached": 1, "capped": 0}


def test_building_gets_at_most_four_signs_in_id_order():
    els = [node(i, f"Shop {i}") for i in (9, 3, 8, 1, 7, 5)]
    feats, stats = bs.build_signs(els, [square(LON, LAT)], "2026-10-17")
    assert [f["properties"]["osm"] for f in feats] == ["node/1", "node/3", "node/5", "node/7"]
    assert stats["kept"] == 4 and stats["capped"] == 2


def test_duplicates_from_tiled_requests_are_dropped():
    els = [node(1, "Dup"), node(1, "Dup"), node(2, "Other")]
    feats, stats = bs.build_signs(els, [square(LON, LAT)], "2026-10-17")
    assert len(feats) == 2 and stats["kept"] == 2


def test_signage_query_shape():
    q = bs.signage_query((3.1, 101.4, 3.2, 101.5))
    assert "out center tags" in q
    for k in (
        "name",
        "brand",
        "shop",
        "amenity",
        "office",
        "leisure",
        "tourism",
        "craft",
        "healthcare",
    ):
        assert k in q


def test_information_boards_are_never_signs_whatever_other_tags():
    assert bs.sign_text({"name": "Selamat Datang", "tourism": "information"}) is None
    assert bs.sign_text({"name": "Kedai", "shop": "yes", "tourism": "information"}) is None
    assert bs.sign_text({"name": "Hotel Ria", "tourism": "hotel"}) == "Hotel Ria"


@pytest.mark.parametrize(
    "tags",
    [
        {"amenity": v}
        for v in (
            "parking",
            "bench",
            "toilets",
            "waste_basket",
            "bicycle_parking",
            "shelter",
            "drinking_water",
            "fountain",
        )
    ]
    + [{"leisure": v} for v in ("pitch", "playground")],
)
def test_non_business_amenity_and_leisure_get_no_sign(tags):
    assert bs.sign_text({"name": "Car Park B", **tags}) is None


def test_business_amenity_still_signs():
    assert bs.sign_text({"name": "Klinik Sihat", "amenity": "clinic"}) == "Klinik Sihat"


def test_non_business_elements_count_as_junk():
    els = [node(1, "Welcome board", tourism="information"), node(2, "Good")]
    feats, stats = bs.build_signs(els, [square(LON, LAT)], "2026-10-17")
    assert [f["properties"]["text"] for f in feats] == ["Good"]
    assert stats["junk"] == 1


def test_todo_only_rejected_as_a_whole_word():
    assert bs.sign_text({"name": "Mastodon Cafe"}) == "Mastodon Cafe"
    assert bs.sign_text({"name": "Kedai Todoroki"}) == "Kedai Todoroki"
    assert bs.sign_text({"name": "TODO name"}) is None


def test_api_sign_guard_mirrors_junk():
    from townshiplens_api.routes.core import SIGN_JUNK

    assert (SIGN_JUNK.pattern, SIGN_JUNK.flags) == (bs.JUNK.pattern, bs.JUNK.flags)
