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
    assert "not snapped" in p["snap_warning"]


def test_area_place_picks_candidate_nearest_the_centre():
    p = _area_place(200.0)
    segs = [
        _seg("s1", "n-edge", "n-x", _pt(190, 0), _pt(230, 0)),
        _seg("s2", "n-mid", "n-y", _pt(0, 60), _pt(0, 120)),
    ]
    assign_nodes([p], segs)
    assert p["node_id"] == "n-mid"


def test_area_place_keeps_old_centre_snap_as_inferred_when_none_within_40_m():
    # R26: a small 20 m lot whose centre is 55 m from a node (45 m beyond its boundary) keeps
    # today's 60 m centre snap instead of losing its node, and is marked inferred.
    p = _area_place(10.0)
    segs = [_seg("s1", "n-a", "n-b", _pt(55, 0), _pt(55, 50))]
    assign_nodes([p], segs)
    assert p["node_id"] == "n-a" and p["node_inferred"] is True
    c = p["claims"]["access_point"]
    assert c["evidence_type"] == "osm_area_centre_snap" and c["status"] == "reported"
    assert c["method"] == "no_node_within_40m"
    assert "no walk node within 40 m" in c["notes"] and "55 m from the area centre" in c["notes"]
    assert "no walk node within 40 m" in p["snap_warning"]


def test_point_place_keeps_the_60_m_rule_and_is_not_inferred():
    el = {"type": "node", "id": 1, "lon": _pt(0, 0)[0], "lat": _pt(0, 0)[1],
          "tags": {"amenity": "bench"}}  # fmt: skip
    (p,) = build_places([el], {})
    segs = [_seg("s1", "n-a", "n-b", _pt(50, 0), _pt(200, 0))]
    assign_nodes([p], segs)
    assert p["node_id"] == "n-a"
    assert "node_inferred" not in p and "access_point" not in p["claims"]


def test_way_place_with_missing_outline_is_an_inferred_centre_snap_with_warning():
    # Review I1 / R28: a way place is an area even when its outline did not come back.
    el = {"type": "way", "id": 9, "center": {"lon": _pt(0, 0)[0], "lat": _pt(0, 0)[1]},
          "tags": {"amenity": "school"}}  # fmt: skip
    (p,) = build_places([el], {})
    segs = [_seg("s1", "n-a", "n-b", _pt(50, 0), _pt(200, 0))]
    assign_nodes([p], segs)
    assert p["node_id"] == "n-a" and p["node_inferred"] is True
    c = p["claims"]["access_point"]
    assert c["evidence_type"] == "osm_area_centre_snap" and c["method"] == "outline_missing"
    assert "outline not returned" in p["snap_warning"]
    assert "snap_warning" in place_feature(p)["properties"]  # listed in coverage later


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
    raises=AssertionError,
    reason="Task 43 BLOCKED: area geometry not fetched (Overpass HTTP 500, budget used); "
    "remove this mark after the seed rebuild",
)
def test_seed_elmina_urban_park_has_inferred_node_and_warned_route(tmp_path):
    from pathlib import Path

    from townshiplens_spatial import tools
    from townshiplens_spatial.vr_store import VerificationStore
    from townshiplens_spatial.world import load_world

    w = load_world(Path(__file__).resolve().parents[2] / "seed" / "elmina")
    assert URBAN_PARK in w.places  # a KeyError here is a real failure, not the expected xfail
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


# --- review I3 / R28: candidates must be in the main walk network ---------------------------


def _main_network(n: int = 4) -> list[dict]:
    """A chain of n segments far east of the test park (the network's largest component)."""
    return [
        _seg(f"m{i}", f"n-m{i}", f"n-m{i + 1}", _pt(1000 + 10 * i, 0), _pt(1010 + 10 * i, 0))
        for i in range(n)
    ]


def test_area_candidates_prefer_the_largest_component():
    p = _area_place(200.0)
    main = _main_network()
    # A tiny fragment right at the centre, and a main-network spur reaching into the park.
    frag = [_seg("f1", "n-f1", "n-f2", _pt(0, 5), _pt(0, 15))]
    spur = [_seg("sp", "n-m0", "n-spur", _pt(1000, 0), _pt(180, 0))]
    assign_nodes([p], main + frag + spur)
    assert p["node_id"] == "n-spur"
    assert p["claims"]["access_point"]["evidence_type"] == "osm_area_boundary_snap"


def test_area_with_only_tiny_fragment_candidates_falls_back_with_warning():
    p = _area_place(200.0)
    frag = [_seg("f1", "n-f1", "n-f2", _pt(0, 5), _pt(0, 15))]
    assign_nodes([p], _main_network() + frag)
    # The fragment is the only thing near the park; it is not snapped to, and no main-network
    # node is within 60 m of the centre, so the place stays without a node, with a warning.
    assert p["node_id"] is None and not p.get("node_inferred")
    assert "small disconnected" in p["snap_warning"] and "not snapped" in p["snap_warning"]


def test_main_network_node_near_the_outline_beats_a_fragment_inside():
    p = _area_place(20.0)
    frag = [_seg("f1", "n-f1", "n-f2", _pt(0, 5), _pt(0, 15))]
    # A main-network street runs 30 m east of the 40 m-wide lot (within 40 m of its outline),
    # so it is a boundary candidate and wins over the fragment inside the lot.
    main = [_seg("m", "n-a", "n-b", _pt(50, -30), _pt(50, 30)), *_main_network()]
    main.append(_seg("j", "n-b", "n-m0", _pt(50, 30), _pt(1000, 0)))
    assign_nodes([p], frag + main)
    assert p["node_id"] in {"n-a", "n-b"}
    assert p["claims"]["access_point"]["evidence_type"] == "osm_area_boundary_snap"


def test_invalid_bowtie_outline_keeps_both_lobes():
    # Review minor 3: buffer(0) dropped a lobe; make_valid keeps both.
    el = {"type": "way", "id": 11, "center": {"lon": _pt(0, 0)[0], "lat": _pt(0, 0)[1]},
          "tags": {"leisure": "park"}}  # fmt: skip
    ring = [(-100, -100), (100, 100), (100, -100), (-100, 100), (-100, -100)]
    outline = [{"lon": _pt(x, y)[0], "lat": _pt(x, y)[1]} for x, y in ring]
    (p,) = build_places([el], {11: outline})
    # Node deep inside the lobe that buffer(0) used to drop (x < 0 lobe) and > 60 m from centre.
    for lobe_x in (-90, 90):
        q = {**p, "claims": {}, "node_id": None}
        assign_nodes([q], [_seg("s", "n-l", "n-r", _pt(lobe_x, 0), _pt(lobe_x, 5))])
        assert q["node_id"] == "n-l", lobe_x
        assert "inside" in q["claims"]["access_point"]["notes"]


def test_fetch_area_geometry_warns_about_missing_ids(monkeypatch, capsys):
    tiles = list(overpass.tiles(import_osm.ENVELOPE, 2))
    tile_results = [(tiles[0], [{"type": "way", "id": 3}, {"type": "way", "id": 5}])]
    monkeypatch.setattr(
        overpass,
        "query",
        lambda ql: {"elements": [{"type": "way", "id": 3, "geometry": [{"lon": 1, "lat": 2}]}]},
    )
    geoms = import_osm.fetch_area_geometry(tile_results)
    assert sorted(geoms) == [3]
    assert "outline not returned for 1 way place(s): 5" in capsys.readouterr().out
