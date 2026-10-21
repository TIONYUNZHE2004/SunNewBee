"""Development Simulation impact facts (demo polish spec 2026-10-21 §6.1; AC-C1, C2, C5, C6).

The synthetic tests build a small walk network with a known answer; the Elmina tests need the seed
and are skipped without it.
"""

import json
import shutil
import time
from functools import cache
from pathlib import Path

import pytest
from townshiplens_spatial import devsim, routing
from townshiplens_spatial import devsim_impact as di
from townshiplens_spatial.devsim_models import ImpactTarget
from townshiplens_spatial.world import load_world

ROOT = Path(__file__).resolve().parents[3]
SEED = ROOT / "data" / "seed" / "elmina"
TINY = Path(__file__).parent / "fixtures" / "tiny"
HAS_SEED = (SEED / "site.json").exists()
seed_only = pytest.mark.skipif(not HAS_SEED, reason="Elmina seed not built")

# ---- a synthetic network with a known answer -----------------------------------------------------
#   H2 --e5-- X --e2-- T          e1 H1-X 100 m, e2 X-T 100 m, e3 H1-Y 200 m, e4 Y-T 200 m,
#            / \                  e5 H2-X 50 m, e6 H3-Y 50 m, e7 H4-X 50 m,
#          e1   e7                e8 H4-Y 50 m of steps (3 steps, verified: wheelchair FAIL).
#          /     \
#        H1      H4               Sides: "north" hoards e1, "south" hoards e4.
#          \     /                Both: H1 +200 m (3 min, over the steps); the wheelchair
#          e3   e8                links of H1 and H3 are cut (only the steps remain).
#                                 North only: H1 +200 m.  South only: nobody 2+ min longer.
#            \ /
#     H3 --e6-- Y --e4-- T        (both T are the one target node)
NODES = {
    "n-T": [101.5020, 3.1800],
    "n-X": [101.5010, 3.1805],
    "n-Y": [101.5010, 3.1795],
    "n-H1": [101.5000, 3.1800],
    "n-H2": [101.5005, 3.1808],
    "n-H3": [101.5005, 3.1792],
    "n-H4": [101.5012, 3.1800],
}
EDGES = [
    ("e1", "n-H1", "n-X", 100, "footway"),
    ("e2", "n-X", "n-T", 100, "footway"),
    ("e3", "n-H1", "n-Y", 200, "footway"),
    ("e4", "n-Y", "n-T", 200, "footway"),
    ("e5", "n-H2", "n-X", 50, "footway"),
    ("e6", "n-H3", "n-Y", 50, "footway"),
    ("e7", "n-H4", "n-X", 50, "footway"),
    ("e8", "n-H4", "n-Y", 50, "steps"),
]
HOMES = [("h1", "n-H1"), ("h2", "n-H2"), ("h3", "n-H3"), ("h4", "n-H4")]
TARGETS = [ImpactTarget(id="target", name="Target", kind="mall")]
SIDES = {"north": ["e1"], "south": ["e4"]}


def _fc(features):
    return {"type": "FeatureCollection", "features": features}


def _grid_world(tmp: Path):
    shutil.copy(TINY / "site.json", tmp / "site.json")
    (tmp / "base").mkdir()
    steps = {"step_count": {"value": 3, "status": "verified", "verified_at": "2026-10-18"}}
    walk = [
        {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [NODES[a], NODES[b]]},
            "properties": {
                "id": eid,
                "kind": "segment",
                "type": typ,
                "from": a,
                "to": b,
                "length_m": ln,
                "claims": steps if typ == "steps" else {},
            },
        }
        for eid, a, b, ln, typ in EDGES
    ]
    place = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": NODES["n-T"]},
        "properties": {"id": "target", "type": "mall", "name": "Target", "node_id": "n-T"},
    }
    (tmp / "base" / "walk.geojson").write_text(json.dumps(_fc(walk)), encoding="utf-8")
    (tmp / "base" / "places.geojson").write_text(json.dumps(_fc([place])), encoding="utf-8")
    return load_world(tmp)


@pytest.fixture
def grid(tmp_path):
    return _grid_world(tmp_path)


def test_walk_tree_matches_plan_route(grid):
    """One search from the target gives each home the same metres as plan_route home -> target."""
    for allow_unknown in (False, True):
        tree = di.walk_tree(grid, "default", ["n-T"], allow_unknown)
        for hid, node in HOMES:
            w = devsim._with_places(grid, [devsim._temp_place(hid, "Home", grid, node)])
            r = routing.plan_route(w, hid, "target", "default")
            assert tree[node] == pytest.approx(r.routes[0].distance_m, abs=0.05)


def test_hoarding_impact_known_answer(grid):  # AC-C1
    imp = di.impact_core(grid, HOMES, TARGETS, SIDES)
    assert imp.homes_considered == 4
    assert imp.closed_edges == ["e1", "e4"]
    assert imp.homes_2min_plus == 1  # h1: 200 m -> 400 m
    assert imp.max_extra_min == 3  # 200 m at 70 m/min = 2.86 min
    assert imp.wheelchair_links_cut == 2  # h1, h3: only the steps remain
    rows = {h.home_id: h for h in imp.homes}
    assert rows["h1"].extra_min == 3 and rows["h1"].wheelchair_cut
    assert rows["h3"].wheelchair_cut and rows["h3"].extra_min == 0
    assert rows["h2"].extra_min == 0 and rows["h4"].extra_min == 0
    opts = {o.side: o for o in imp.options}
    assert (opts["north"].homes_2min_plus, opts["north"].max_extra_min) == (1, 3)
    assert opts["north"].wheelchair_links_cut == 0
    assert (opts["south"].homes_2min_plus, opts["south"].max_extra_min) == (0, 0)
    assert opts["south"].wheelchair_links_cut == 0
    assert imp.best_side == "south"


def test_best_side_is_the_one_fewest_homes_feel(grid):
    # e3 is on nobody's route to the target; hoarding e6 cuts h3 off (counted as 2+ min).
    imp = di.impact_core(grid, HOMES, TARGETS, {"x": ["e3"], "y": ["e6"]})
    opts = {o.side: o for o in imp.options}
    assert opts["x"].homes_2min_plus == 0
    assert opts["y"].homes_2min_plus == 1
    assert {h.home_id for h in imp.homes if h.cut_off} == {"h3"}
    assert imp.best_side == "x"


def test_no_hoarding_no_impact(grid):
    imp = di.impact_core(grid, HOMES, TARGETS, {})
    assert (imp.homes_2min_plus, imp.max_extra_min, imp.wheelchair_links_cut) == (0, 0, 0)
    assert imp.options == [] and imp.best_side is None


# ---- Elmina ------------------------------------------------------------------------------------
@cache
def _world():
    return load_world(SEED)


@cache
def _site():
    return devsim.place_tower(_world())


@seed_only
def test_elmina_hoarding_impact_smoke():  # AC-C1
    di.clear_cache()
    t0 = time.perf_counter()
    imp = di.hoarding_impact(_world(), _site())
    took = time.perf_counter() - t0
    # Budget 5 s (about 1.5 s measured alone); the guard leaves room for a loaded CI machine.
    assert took < 10.0, f"hoarding impact took {took:.1f} s"
    assert imp.radius_m == 500
    assert imp.homes_considered > 0 and imp.homes_2min_plus > 0 and imp.max_extra_min >= 2
    assert imp.homes_2min_plus <= imp.homes_considered == len(imp.homes)
    assert imp.wheelchair_links_cut >= 0
    assert [t.kind for t in imp.targets] == ["mall", "park", "school", "clinic"]
    names = [t.name for t in imp.targets]
    assert names[:2] == [devsim.MALL_NAME, devsim.PARK_NAME]
    assert _world().places[imp.targets[2].id].type == "school"
    assert _world().places[imp.targets[3].id].type == "clinic"
    assert imp.options and imp.best_side in {o.side for o in imp.options}
    assert set(imp.closed_edges) == {e for o in imp.options for e in o.edge_ids}
    assert set(imp.closed_edges) == set(devsim.frontage_edges(_world(), _site()))
    # Cached per world version and site.
    assert di.hoarding_impact(_world(), _site()) is imp


@seed_only
def test_elmina_hoarding_agrees_with_halims_detour():
    """Halim's bubble (+N min to the mall) and the summary measure the same walk."""
    imp = di.hoarding_impact(_world(), _site())
    d = devsim.compute_facts(_world(), _site()).detour
    assert d is not None
    row = next(h for h in imp.homes if h.home_id == d.home_id)
    assert row.extra_min == d.detour_min
    assert imp.max_extra_min >= d.detour_min


# ---- C2: lorry route ---------------------------------------------------------------------------
@seed_only
def test_elmina_lorry_route():  # AC-C2
    w = _world()
    r = di.lorry_route(w, _site())
    assert r.profile == "drive" and r.status != "confirmed"
    assert len(r.path) >= 2 and r.distance_m > 0 and r.minutes >= 1
    roads = {
        n for e in w.edges.values() if e.type == "major_road" for n in (e.from_node, e.to_node)
    }
    assert r.from_node in roads
    allowed = set(w.profiles["drive"].allowed_types)
    drive = {n for e in w.edges.values() if e.type in allowed for n in (e.from_node, e.to_node)}
    assert r.gate_node in drive
    assert r.school_run_note == "School run assumed 7–8 am (typical); not from data"
    assert r.sensitive, "Elmina's lorry route passes Urban Park"
    for s in r.sensitive:
        assert w.places[s.place_id].name == s.name
        assert s.type in di.SENSITIVE_TYPES and w.places[s.place_id].type == s.type
        assert 0 <= s.distance_m <= di.SENSITIVE_M
    along = [s.along_m for s in r.sensitive]
    assert along == sorted(along)
    # The gate is the road node nearest the entrance; the route starts on the main road.
    assert r.path[0] == pytest.approx(w.node_coords[r.from_node][:2], abs=1e-6)
    assert r.path[-1] == pytest.approx(w.node_coords[r.gate_node][:2], abs=1e-6)
