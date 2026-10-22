"""Demo text fixes (22 Oct integration run): flood place lists, path length, course roads."""

import json
from pathlib import Path

from townshiplens_agent.template import course_rows, path_length, place_list

SEED_ROADS = (
    Path(__file__).parents[3] / "apps/web/src/features/closures/fixtures/seedCourseRoads.json"
)


def _p(name, type_):
    return {"id": name, "name": name, "type": type_, "lonlat": [101.5, 3.1]}


def test_named_places_come_first_and_street_furniture_is_counted_not_named():
    rows = [
        _p("Seating (unnamed, OSM)", "seating"),
        _p("Waste Basket (unnamed, OSM)", "waste_basket"),
        _p("Park (unnamed, OSM)", "park"),
        _p("Elmina Urban Park", "park"),
        _p("Shelter (unnamed, OSM)", "shelter"),
        _p("RSA Elmina S", "building"),
        _p("Harmoni 1", "building"),
        _p("Toilet (unnamed, OSM)", "toilet"),
    ]
    assert place_list(rows) == (
        "Elmina Urban Park, RSA Elmina S, Harmoni 1 and 1 more place, "
        "plus 4 small mapped features (shelters, seats, bins, toilets)"
    )
    # only furniture: still named, so a counted list always names something
    assert place_list(rows[:2]) == "Seating (unnamed, OSM), Waste Basket (unnamed, OSM)"
    assert place_list([]) == ""


def test_path_length_is_km_with_one_decimal_from_a_kilometre():
    assert path_length(141598.68) == "141.6 km"
    assert path_length(999.4) == "999 m"
    assert path_length(1000) == "1.0 km"


def test_course_rows_merge_runs_and_fold_short_unnamed_paths_like_the_card():
    roads = json.loads(SEED_ROADS.read_text())
    rows, short = course_rows(roads)
    assert len(roads) == 59 and len(rows) == 20  # the web card's numbers (courseRows.test.ts)
    assert short["stretches"] == 7 and round(short["length_m"], 1) == 154.4
    total = sum(r["length_m"] for r in rows) + short["length_m"]
    assert abs(total - sum(r["length_m"] for r in roads)) < 1e-6
    assert all(a["name"] != b["name"] for a, b in zip(rows, rows[1:], strict=False))
