"""OSM crossing tags map onto the catalogue's crossing type."""

from data.scripts.import_osm import _claims, crossing_value


def test_signals_win_over_the_crossing_value():
    assert crossing_value({"crossing": "uncontrolled", "crossing:signals": "yes"}) == (
        "traffic_signals"
    )
    assert crossing_value({"highway": "traffic_signals"}) == "traffic_signals"


def test_synonyms_and_unknowns():
    assert crossing_value({"crossing": "zebra"}) == "marked"
    assert crossing_value({"crossing_ref": "zebra"}) == "marked"
    assert crossing_value({"crossing": "uncontrolled"}) == "marked"
    assert crossing_value({"crossing": "informal"}) == "unmarked"
    assert crossing_value({"crossing": "no"}) == "no"
    assert crossing_value({}) is None
    assert crossing_value({"crossing": "something_new"}) is None


def test_only_crossing_segments_get_the_claim_as_reported_osm_data():
    tags = {"highway": "footway", "footway": "crossing", "crossing": "traffic_signals"}
    assert _claims(tags, "crossing")["crossing"] == {
        "value": "traffic_signals",
        "status": "reported",
        "evidence_type": "osm_import",
    }
    assert "crossing" not in _claims({"highway": "residential", "crossing": "zebra"}, "street")
