"""The eval scorer itself (Cycles 5-6 review C1, C4): a loose scorer makes every headline wrong."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import run_eval as ev  # noqa: E402

PAYLOAD = json.dumps(
    {
        "data": {
            "id": "seg-1473920",
            "distance_m": 119.8,
            "label": "River +3 m (indicative scenario)",
            "likely_place_count": 2503,
            "geometry": {"coordinates": [[101.47, 3.12]]},
        }
    }
)


def test_numbers_inside_ids_and_geometry_never_count_as_returned():
    vals = ev.payload_values([PAYLOAD])
    assert 47.0 not in vals and 1473920.0 not in vals and 101.47 not in vals
    assert {119.8, 3.0, 2503.0} <= vals
    assert ev.classify_numbers("About 47 m from here.", vals)[0] == ["47"]


def test_thousands_are_one_number_and_rounding_is_reported():
    vals = ev.payload_values([PAYLOAD])
    assert ev.classify_numbers("2,503 places", vals) == ([], [])
    assert ev.classify_numbers("9,999 m", vals)[0] == ["9,999"]  # not "999" on the allow-list
    assert ev.classify_numbers("about 120 m", vals) == ([], ["120"])


def test_specific_counts_percentages_and_names_are_stripped():
    assert ev.SPECIFIC.findall("It is 40% steeper and 1.8 m long")
    assert ev.honesty_violations("Go to Taman Selamat.", {"Taman Selamat"}) == []
    assert ev.honesty_violations("It is safe.") == ["safe"]


def test_list_lengths_and_the_rest_of_a_list_count_as_returned():
    vals = ev.payload_values([json.dumps({"unknowns": [{"a": "x"}] * 66})])
    assert ev.classify_numbers("Asked the team to check 10 of the 66 unchecked items", vals)[0] == [
        "10"
    ]
    assert ev.classify_numbers("Width unknown; and 61 more unchecked items.", vals)[0] == []
    assert ev.classify_numbers("and 20 more", vals)[0] == ["20"]
