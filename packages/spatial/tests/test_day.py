"""Elmina Day (Cycle 10): synthetic residents living a day on the world model."""

from pathlib import Path

import pytest
from townshiplens_spatial import routing, twm
from townshiplens_spatial.day import population as P
from townshiplens_spatial.day import summary as S
from townshiplens_spatial.day.engine import Day, Scenario
from townshiplens_spatial.day.router import Graph, Router
from townshiplens_spatial.day.scenarios import scenarios
from townshiplens_spatial.world import load_world

SEED = Path(__file__).resolve().parents[3] / "data" / "seed" / "elmina"


def _lenient_len(world, src, dst, profile, stage):
    nodes, keys, _ = routing._search(world, [src], [dst], world.profiles[profile], stage, True)
    return None if nodes is None else sum(world.edges[k].length_m for k in keys)


@pytest.mark.parametrize("profile", ["default", "wheelchair", "stroller"])
@pytest.mark.parametrize("stage", [None, "stage_p3m"])
def test_fast_router_agrees_with_plan_routes_lenient_search(world, profile, stage):
    """Same rules as plan_route: the scipy field and routing._search find equally long paths."""
    g = Graph(world)
    r = Router(world, g, profile, stage)
    nodes = ["n-a", "n-b", "n-c", "n-d", "n-e", "n-f", "n-h"]
    for a in nodes:
        for b in nodes:
            if a == b:
                continue
            leg = r.leg(g.index[a], (g.index[b],))
            want = _lenient_len(world, a, b, profile, stage)
            assert (leg is None) == (want is None), (a, b)
            if leg:
                assert leg.length_m == pytest.approx(want), (a, b)


def test_fast_router_never_uses_a_failing_edge(world):
    g = Graph(world)
    r = Router(world, g, "wheelchair", "stage_p3m")
    leg = r.leg(g.index["n-a"], (g.index["n-d"],))
    assert leg and "seg-be" not in leg.edge_ids and "seg-cd" not in leg.edge_ids  # steps, flood


def _tiny_day(world, **kw):
    sc = Scenario(
        id="t",
        label="test",
        summary="",
        stages=[(0, None), (400, "stage_p3m"), (460, None)],
        actions=[twm.ClosePath(element_id="seg-fd")],
        **kw,
    )
    return Day(world, sc, n_residents=20)


def test_no_way_open_an_essential_trip_waits_for_the_water_then_arrives(world):
    d = _tiny_day(world)
    i = d.graph.index
    st, arrive, segs, rerouted, waited, *_ = d.travel(
        "wheelchair", i["n-a"], (i["n-d"],), 410.0, essential=True
    )
    assert st == "arrived" and waited == pytest.approx(50.0) and arrive > 460
    assert segs[0].wait and segs[0].t1 == 460
    st2, *_ = d.travel("wheelchair", i["n-a"], (i["n-d"],), 410.0, essential=False)
    assert st2 == "cancelled"  # nobody sets out on an optional trip with no way open


def test_caught_on_the_way_the_resident_waits_where_they_are(world):
    d = _tiny_day(world)
    i = d.graph.index
    st, arrive, segs, rerouted, waited, *_ = d.travel(
        "older_adult_rest", i["n-a"], (i["n-d"],), 397.0, essential=False
    )
    walked, wait = segs[0], segs[1]
    assert not walked.wait and walked.nodes[-1] == i["n-c"]  # reached the junction at 400
    assert wait.wait and wait.nodes == [i["n-c"]] and (wait.t0, wait.t1) == (400.0, 460.0)
    assert rerouted and st == "arrived" and arrive > 460


def test_population_matches_the_public_statistics(world):
    pop = P.synthesize(world, 5000, seed=3)
    rs = pop.residents
    n = len(rs)
    assert n == 5000
    assert abs(sum(r.age < 15 for r in rs) / n - 0.212) < 0.03
    assert abs(sum(r.age >= 65 for r in rs) / n - 0.084) < 0.02
    assert abs(n / pop.households - 3.8) < 0.15
    assert abs(len({r.household for r in rs if not r.car}) / pop.households - 0.077) < 0.03
    assert P.synthesize(world, 300, seed=3).to_json() == P.synthesize(world, 300, seed=3).to_json()
    assert all(s["source"] for s in pop.sources)


@pytest.fixture(scope="module")
def seed_world():
    if not (SEED / "site.json").exists():
        pytest.skip("Elmina seed not built")
    return load_world(SEED)


@pytest.fixture(scope="module")
def storm(seed_world):
    return Day(seed_world, scenarios(seed_world)["storm"], n_residents=1500).run()


def test_storm_day_every_step_is_legal_in_the_river_state_at_that_minute(storm):
    d = storm.day
    for t in storm.trips:
        assert t.depart >= t.planned
        if t.arrive is not None:
            assert t.arrive >= t.depart
        if t.delay_min is not None:
            assert t.delay_min >= 0
        for s in t.segments:
            if s.wait or len(s.nodes) < 2:
                continue
            r = d.router(t.mode, d.scenario.stage_at(s.t0))
            for x, y in zip(s.nodes, s.nodes[1:], strict=False):
                assert (min(x, y), max(x, y)) in r.pair_edge, (t.id, s.t0)
            # a segment never spans a change of river level
            nxt = d._next_change(s.t0)
            assert nxt is None or s.t1 <= nxt + 1e-6


def test_storm_is_worse_than_a_normal_day_and_counts_add_up(seed_world, storm):
    normal = Day(seed_world, scenarios(seed_world)["weekday"], n_residents=1500).run()
    h, hn = S.headline(storm), S.headline(normal)
    assert hn["cancelled"] == 0 and hn["late"] == 0 and hn["rerouted"] == 0
    assert h["cancelled"] > 0 and h["late"] > 0
    assert h["on_time"] + h["late"] + h["cancelled"] + h["stranded"] + h["data_gap"] == h["trips"]
    for g in S.groups(storm):
        assert (
            g["on_time"] + g["late"] + g["cancelled"] + g["stranded"] + g["data_gap"]
            == g["residents"]
        )
    sch = S.school(storm)
    assert sch["pupils"] == sum(sch[k] for k in S.SEVERITY)
    rep = S.report(storm)
    assert "not a forecast" in rep["disclaimer"] and rep["population"]["sources"]
    assert rep["tracks"]["shown"] <= 1500 and rep["tracks"]["nodes"]


def test_the_same_day_twice_gives_the_same_result(seed_world):
    sc = scenarios(seed_world)["storm"]
    a = S.headline(Day(seed_world, sc, n_residents=400).run())
    b = S.headline(Day(seed_world, sc, n_residents=400).run())
    assert a == b
