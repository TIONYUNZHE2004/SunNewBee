import json
import shutil

from tests_support import TINY
from townshiplens_spatial.geo import haversine_m
from townshiplens_spatial.world import load_world


def test_haversine_100m():
    assert 110 < haversine_m([101.5100, 3.1810], [101.5110, 3.1810]) < 112


def test_load_counts(world):
    assert len(world.edges) == 8 and "park-b" in world.places
    assert world.graph.number_of_nodes() == 8
    assert world.places["moon-base"].node_id is None
    assert {s.id for s in world.flood.scenarios} >= {"baseline", "stage_p3m"}
    assert world.centres["evc-school"].source == "official_pps"
    assert set(world.profiles) == {"default", "stroller", "wheelchair", "older_adult_rest", "drive"}


def test_overlay_replaces_by_id(tmp_path):
    d = tmp_path / "w"
    shutil.copytree(TINY, d)
    walk = json.loads((d / "base/walk.geojson").read_text())
    feat = next(f for f in walk["features"] if f["properties"]["id"] == "seg-cf")
    feat["properties"]["claims"]["incline_pct"] = {
        "value": 4,
        "status": "verified",
        "verified_at": "2026-10-18",
    }
    (d / "access/overlay.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": [feat]})
    )
    w = load_world(d)
    assert w.edges["seg-cf"].claims["incline_pct"].status == "verified"


def test_place_node_inferred_is_loaded():
    from townshiplens_spatial.world import _place

    f = {
        "properties": {"id": "p", "type": "park", "name": "P", "node_id": "n-1",
                       "node_inferred": True},
        "geometry": {"coordinates": [101.5, 3.18]},
    }  # fmt: skip
    assert _place(f).node_inferred is True
    del f["properties"]["node_inferred"]
    assert _place(f).node_inferred is False
