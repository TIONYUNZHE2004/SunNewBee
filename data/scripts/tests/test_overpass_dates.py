"""as_of provenance: the OSM data date of the Overpass answers, never the day of the build run."""

import json
from datetime import date

import pytest

from data.scripts import build_landmarks as bl
from data.scripts import build_signage as bs
from data.scripts import overpass

LON, LAT = 101.5099, 3.1813
D = 1 / 111320.0
DATA_DAY = "2026-09-30"
assert date.today().isoformat() != DATA_DAY


def answer(elements, ts=f"{DATA_DAY}T21:04:02Z"):
    a = {"version": 0.6, "elements": elements}
    if ts is not None:
        a["osm3s"] = {"timestamp_osm_base": ts, "copyright": "ODbL"}
    return a


def cache(ql: str, data: dict, fetched_at: str | None = None) -> None:
    key = overpass._cache_key(ql)
    key.write_text(json.dumps(data), encoding="utf-8")
    if fetched_at is not None:
        meta = {"endpoint": "x", "fetched_at": fetched_at}
        key.with_suffix(".meta.json").write_text(json.dumps(meta), encoding="utf-8")


@pytest.fixture(autouse=True)
def offline_cache(tmp_path, monkeypatch):
    """Answers come from a temporary cache only; any HTTP request fails the test."""
    monkeypatch.setattr(overpass, "CACHE", tmp_path / "cache")
    (tmp_path / "cache").mkdir()

    def boom(*a, **k):
        raise AssertionError("no network in tests")

    monkeypatch.setattr(overpass.requests, "post", boom)
    monkeypatch.setattr(overpass, "MAX_REQUESTS", None)


def test_data_date_is_the_osm_base_timestamp():
    assert overpass.data_date(answer([])) == DATA_DAY


def test_data_date_falls_back_to_the_cache_fetch_time():
    ql = "[out:json];node(1,2,3,4);out;"
    cache(ql, answer([], ts=None), fetched_at="2026-09-12T08:00:00+00:00")
    assert overpass.data_date(overpass.query(ql), ql) == "2026-09-12"


def test_data_date_none_without_timestamp_or_meta():
    assert overpass.data_date(answer([], ts=None)) is None
    assert overpass.data_date(answer([], ts=None), "[out:json];x;") is None
    assert overpass.data_date(answer([], ts="garbage")) is None


def test_fetch_elements_concatenates_and_takes_the_latest_date():
    qs = ["[out:json];a;", "[out:json];b;", "[out:json];c;"]
    cache(qs[0], answer([{"id": 1}], ts="2026-09-01T00:00:00Z"))
    cache(qs[1], answer([{"id": 2}], ts="2026-09-20T23:59:59Z"))
    cache(qs[2], answer([{"id": 3}], ts=None))
    els, as_of = overpass.fetch_elements(qs)
    assert [e["id"] for e in els] == [1, 2, 3]
    assert as_of == "2026-09-20"
    assert overpass.fetch_elements([qs[2]]) == ([{"id": 3}], None)


def _site(out):
    (out / "base").mkdir(parents=True)
    (out / "site.json").write_text(
        json.dumps({"scene": {"home": {"lon": LON, "lat": LAT}}, "buildings": {"radius_m": 300}})
    )
    side = 10 * D
    ring = [[LON, LAT], [LON + side, LAT], [LON + side, LAT + side], [LON, LAT + side], [LON, LAT]]
    (out / "base" / "buildings.geojson").write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"id": "w70", "name": "Elmina Lakeside Mall"},
                        "geometry": {"type": "Polygon", "coordinates": [ring]},
                    }
                ],
            }
        )
    )
    return bs.bbox_around(LON, LAT, 300)


def test_signage_as_of_is_the_data_date_and_rebuilds_are_identical(tmp_path, monkeypatch):
    out = tmp_path / "seed"
    bbox = _site(out)
    monkeypatch.setattr(bs, "OUT", out)
    shop = {
        "type": "node",
        "id": 9,
        "lat": LAT + 5 * D,
        "lon": LON + 5 * D,
        "tags": {"name": "Kedai Runcit Ali", "shop": "convenience"},
    }
    for i, t in enumerate(bs.tiles(bbox, 0.02)):
        cache(bs.signage_query(t), answer([shop] if i == 0 else []))
    bs.main(["--max-requests", "0"])
    path = out / "base" / "signage.geojson"
    first = path.read_bytes()
    signs = json.loads(first)["features"]
    assert signs and all(f["properties"]["as_of"] == DATA_DAY for f in signs)
    bs.main(["--max-requests", "0"])
    assert path.read_bytes() == first


def test_landmarks_as_of_is_the_data_date(tmp_path, monkeypatch):
    out = tmp_path / "seed"
    bbox = _site(out)
    monkeypatch.setattr(bl, "OUT", out)
    cache(bl.landmark_query(bbox), answer([]))
    bl.main(["--max-requests", "0"])
    feats = json.loads((out / "base" / "landmarks.geojson").read_text())["features"]
    assert [f["properties"]["as_of"] for f in feats] == [DATA_DAY]


def test_signage_without_a_data_date_writes_nothing(tmp_path, monkeypatch):
    out = tmp_path / "seed"
    bbox = _site(out)
    monkeypatch.setattr(bs, "OUT", out)
    for t in bs.tiles(bbox, 0.02):
        cache(bs.signage_query(t), answer([], ts=None))
    with pytest.raises(SystemExit) as e:
        bs.main(["--max-requests", "0"])
    assert e.value.code == 3
    assert not (out / "base" / "signage.geojson").exists()
