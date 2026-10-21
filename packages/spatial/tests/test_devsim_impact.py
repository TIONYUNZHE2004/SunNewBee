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


# ---- C5: flood exposure and the daily-life matrix ----------------------------------------------
def test_cell_value_rules():  # AC-C6
    assert di.cell_value("confirmed", 700, 70) == 10
    assert di.cell_value("likely_ok", 30, 70) == 1  # never "0 min"
    assert di.cell_value("partly_unverified", 700, 70) == "?"
    assert di.cell_value("no_data", None, 70) == "gap"
    assert di.cell_value("blocked", None, 70) == "blocked"


@seed_only
def test_elmina_flood_exposure():  # AC-C5
    w = _world()
    f = di.flood_exposure(w, _site())
    assert f.scenarios_checked == [
        s for s in di.FLOOD_STAGES if s in {x.id for x in w.flood.scenarios}
    ]
    assert f.route_edges and f.disclaimer == "Indicative scenario, not a forecast."
    if f.cut_from_scenario is None:
        assert f.cut_edges == []
    else:
        i = f.scenarios_checked.index(f.cut_from_scenario)
        for s in f.scenarios_checked[:i]:  # the lowest such scenario
            assert not any(
                w.flood.edge_classes.get(s, {}).get(e) == "likely_flooded" for e in f.route_edges
            )
        classes = w.flood.edge_classes[f.cut_from_scenario]
        assert f.cut_edges and all(classes[e] == "likely_flooded" for e in f.cut_edges)
        assert set(f.cut_edges) <= set(f.route_edges)
    ev = f.evacuation
    assert ev is not None and ev.source in ("official_pps", "osm_candidate")
    assert ev.source == w.centres[ev.centre_id].source and ev.name == w.centres[ev.centre_id].name
    assert ev.min >= 1 and ev.m > 0
    text = f.model_dump_json().lower()
    assert "safe" not in text and "depth" not in text


@seed_only
def test_elmina_daily_life_matrix():  # AC-C6
    w = _world()
    m = di.daily_life_matrix(w, _site())
    assert m.profiles == ["default", "stroller", "wheelchair"]
    assert [r.target.kind for r in m.rows] == ["park", "mall", "clinic", "school"]
    assert [r.target.name for r in m.rows[:2]] == [devsim.PARK_NAME, devsim.MALL_NAME]
    for row in m.rows:
        assert [c.profile for c in row.cells] == m.profiles
        for c in row.cells:
            if c.status == "partly_unverified":
                assert c.value == "?" and c.m is None
            elif c.status == "no_data":
                assert c.value == "gap"
            elif c.status == "blocked":
                assert c.value == "blocked"
            else:
                assert isinstance(c.value, int) and c.value >= 1 and c.m and c.m > 0
    # The default walks to the park (and to the mall place itself) are the plan's existing facts.
    facts = devsim.compute_facts(w, _site())
    cell = {(r.target.kind, c.profile): c for r in m.rows for c in r.cells}
    for kind, walk in (("park", facts.park), ("mall", facts.mall)):
        c = cell[(kind, "default")]
        if (
            isinstance(c.value, int)
            and c.arrival_id == m.rows[0 if kind == "park" else 1].target.id
        ):
            assert c.value == walk.min and c.m == walk.m


@seed_only
def test_mall_is_reached_at_the_nearer_of_mall_and_car_park():  # ruling R18
    w = _world()
    m = di.daily_life_matrix(w, _site())
    tw = devsim.tower_world(w, _site())
    mall = next(r for r in m.rows if r.target.kind == "mall")
    assert set(mall.target.arrive_at) == {"lakeside-mall", "park-b"}
    for c in mall.cells:
        lengths = {
            pid: res.routes[0].distance_m
            for pid in mall.target.arrive_at
            if (res := routing.plan_route(tw, devsim.TOWER_PLACE, pid, c.profile)).routes
        }
        assert c.arrival_id == min(lengths, key=lengths.get)
        want = di.MALL_LABEL if c.arrival_id == "lakeside-mall" else di.CAR_PARK_LABEL
        assert c.label == want
    for row in m.rows:
        if row.target.kind != "mall":
            assert all(
                c.arrival_id == row.target.id and c.label == row.target.name for c in row.cells
            )


@seed_only
def test_hoarding_rows_name_the_arrival():  # ruling R18
    imp = di.hoarding_impact(_world(), _site())
    for h in imp.homes:
        if h.extra_min:
            assert h.extra_target and h.extra_arrival
            t = next(x for x in imp.targets if x.id == h.extra_target)
            assert h.extra_arrival in (t.arrive_at or [t.id])
        else:
            assert h.extra_arrival is None


@seed_only
def test_outlines_come_from_every_base_layer():  # review M9
    w = _world()
    sens = {p.id for p in w.places.values() if p.type in di.SENSITIVE_TYPES}
    found = di._outlines(w, sens)
    assert "osm-way-1309457596" in found  # Elmina Urban Park (parks.geojson)
    # The seed maps schools and kindergartens as points only: no outline in any layer.
    assert not [p for p in found if w.places[p].type in ("school", "kindergarten")]
