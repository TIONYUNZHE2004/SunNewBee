"""Task 43: area places (parks, schools) snap to the nearest walk node inside the OSM polygon or
within 40 m of its boundary, marked as inferred (`node_inferred`, `access_point` claim)."""

import math

import pytest

from data.scripts import import_osm, overpass
from data.scripts.import_osm import assign_nodes, build_places, place_feature

LAT = 3.18
M_LAT = 1 / 111320.0  # degrees per metre (north)
M_LON = 1 / (
    111320.0 * math.cos(math.radians((import_osm.ENVELOPE[0] + import_osm.ENVELOPE[2]) / 2))
)


def _pt(dx_m: float, dy_m: float, lon0: float = 101.50) -> list[float]:
    return [lon0 + dx_m * M_LON, LAT + dy_m * M_LAT]


def _seg(sid: str, a: str, b: str, ca, cb) -> dict:
    return {"id": sid, "from": a, "to": b, "coords": [ca, cb]}


def _square(half_m: float) -> list[dict]:
    """A closed square way geometry centred on (0, 0), side 2 * half_m."""
    corners = [(-half_m, -half_m), (half_m, -half_m), (half_m, half_m), (-half_m, half_m)]
    ring = [*corners, corners[0]]
    return [{"lon": _pt(x, y)[0], "lat": _pt(x, y)[1]} for x, y in ring]


def _area_place(half_m: float = 200.0, pid: int = 7) -> dict:
    el = {"type": "way", "id": pid, "center": {"lon": _pt(0, 0)[0], "lat": _pt(0, 0)[1]},
          "tags": {"leisure": "park", "name": "Big Park"}}  # fmt: skip
    (p,) = build_places([el], {pid: _square(half_m)})
    return p


def test_area_place_snaps_to_node_inside_polygon_far_from_centre():
    p = _area_place(200.0)
    # The only path runs inside the park, 150 m from the centre (beyond the 60 m point rule).
    segs = [_seg("s1", "n-in1", "n-in2", _pt(150, 0), _pt(150, 100))]
    assign_nodes([p], segs)
    assert p["node_id"] == "n-in1"
    assert p["node_inferred"] is True
    c = p["claims"]["access_point"]
    assert c["value"] == "n-in1"
    assert c["status"] == "reported" and c["evidence_type"] == "osm_area_boundary_snap"
    assert "inside" in c["notes"]


def test_area_place_snaps_within_40_m_outside_boundary():
    p = _area_place(100.0)
    # A street 30 m outside the east edge of the park.
    segs = [_seg("s1", "n-out1", "n-out2", _pt(130, 0), _pt(130, 80))]
    assign_nodes([p], segs)
    assert p["node_id"] == "n-out1" and p["node_inferred"] is True
    assert "30 m outside" in p["claims"]["access_point"]["notes"]


def test_area_place_beyond_40_m_stays_unsnapped():
    p = _area_place(100.0)
    segs = [_seg("s1", "n-far1", "n-far2", _pt(145, 0), _pt(145, 80))]  # 45 m outside
    assign_nodes([p], segs)
    assert p["node_id"] is None
    assert not p.get("node_inferred")
    assert "access_point" not in p["claims"]


def test_area_place_picks_candidate_nearest_the_centre():
    p = _area_place(200.0)
    segs = [
        _seg("s1", "n-edge", "n-x", _pt(190, 0), _pt(230, 0)),
        _seg("s2", "n-mid", "n-y", _pt(0, 60), _pt(0, 120)),
    ]
    assign_nodes([p], segs)
    assert p["node_id"] == "n-mid"


def test_area_place_ignores_the_60_m_centre_rule_when_outside_40_m():
    # A small 20 m lot whose centre is 55 m from a node: 45 m beyond its boundary, so no snap.
    p = _area_place(10.0)
    segs = [_seg("s1", "n-a", "n-b", _pt(55, 0), _pt(55, 50))]
    assign_nodes([p], segs)
    assert p["node_id"] is None


def test_point_place_keeps_the_60_m_rule_and_is_not_inferred():
    el = {"type": "node", "id": 1, "lon": _pt(0, 0)[0], "lat": _pt(0, 0)[1],
          "tags": {"amenity": "bench"}}  # fmt: skip
    (p,) = build_places([el], {})
    segs = [_seg("s1", "n-a", "n-b", _pt(50, 0), _pt(200, 0))]
    assign_nodes([p], segs)
    assert p["node_id"] == "n-a"
    assert "node_inferred" not in p and "access_point" not in p["claims"]


def test_way_place_without_fetched_geometry_falls_back_to_centre_rule():
    el = {"type": "way", "id": 9, "center": {"lon": _pt(0, 0)[0], "lat": _pt(0, 0)[1]},
          "tags": {"amenity": "school"}}  # fmt: skip
    (p,) = build_places([el], {})
    segs = [_seg("s1", "n-a", "n-b", _pt(50, 0), _pt(200, 0))]
    assign_nodes([p], segs)
    assert p["node_id"] == "n-a" and "node_inferred" not in p


def test_place_feature_drops_the_internal_polygon():
    p = _area_place(50.0)
    assign_nodes([p], [_seg("s1", "n-a", "n-b", _pt(0, 0), _pt(10, 0))])
    props = place_feature(p)["properties"]
    assert "area" not in props and props["node_inferred"] is True


def test_fetch_area_geometry_one_id_query_for_all_place_ways(monkeypatch):
    tiles = list(overpass.tiles(import_osm.ENVELOPE, 2))
    tile_results = [
        (tiles[0], [{"type": "way", "id": 5}, {"type": "node", "id": 1}, {"type": "way", "id": 3}]),
        (tiles[1], [{"type": "way", "id": 3}]),  # already seen in tile 0
        (tiles[2], []),
        (tiles[3], [{"type": "way", "id": 8}]),
    ]
    calls = []

    def fake_query(ql):
        calls.append(ql)
        ids = [int(i) for i in ql.split("way(id:")[1].split(")")[0].split(",")]
        return {
            "elements": [{"type": "way", "id": i, "geometry": [{"lon": 1, "lat": 2}]} for i in ids]
        }

    monkeypatch.setattr(overpass, "query", fake_query)
    geoms = import_osm.fetch_area_geometry(tile_results)
    # One light id lookup (all way places, sorted): the tiled version hit HTTP 500s (Task 43).
    assert calls == ["[out:json][timeout:180];way(id:3,5,8);out geom;"]
    assert sorted(geoms) == [3, 5, 8]


def test_unclosed_way_place_uses_distance_to_the_line():
    el = {"type": "way", "id": 7, "center": {"lon": _pt(0, 0)[0], "lat": _pt(0, 0)[1]},
          "tags": {"leisure": "park"}}  # fmt: skip
    line = [{"lon": _pt(x, 0)[0], "lat": _pt(x, 0)[1]} for x in (-100, 100)]
    (p,) = build_places([el], {7: line})
    assign_nodes([p], [_seg("s1", "n-a", "n-b", _pt(90, 35), _pt(90, 300))])
    assert p["node_id"] == "n-a"
    assert "35 m outside" in p["claims"]["access_point"]["notes"]


def test_snap_notes_inside_wording():
    p = _area_place(100.0)
    assign_nodes([p], [_seg("s1", "n-a", "n-b", _pt(0, 50), _pt(0, 60))])
    assert p["claims"]["access_point"]["notes"].startswith("nearest walk node inside the OSM area")


# --- seed regression (Task 43) ---------------------------------------------------------------

URBAN_PARK = "osm-way-1309457596"


@pytest.mark.xfail(
    strict=True,
    reason="Task 43 BLOCKED: area geometry not fetched (Overpass HTTP 500, budget used); "
    "remove this mark after the seed rebuild",
)
def test_seed_elmina_urban_park_has_inferred_node_and_warned_route(tmp_path):
    from pathlib import Path

    from townshiplens_spatial import tools
    from townshiplens_spatial.vr_store import VerificationStore
    from townshiplens_spatial.world import load_world

    w = load_world(Path(__file__).resolve().parents[2] / "seed" / "elmina")
    park = w.places[URBAN_PARK]
    assert park.name == "Elmina Urban Park"
    assert park.node_id and park.node_id in w.graph and park.node_inferred
    assert park.claims["access_point"].evidence_type == "osm_area_boundary_snap"
    assert park.claims["access_point"].status == "reported"
    ctx = tools.Ctx(world=w, vrs=VerificationStore(str(tmp_path / "vr.db")))
    r = tools.plan_route(ctx, "park-b", URBAN_PARK, "default")
    assert r.data["status"] in ("confirmed", "partly_unverified") and r.data["routes"]
    assert (
        "Route ends at the nearest mapped path to Elmina Urban Park; its entrance is not mapped."
        in r.warnings
    )
