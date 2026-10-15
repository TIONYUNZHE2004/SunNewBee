import dataclasses

from townshiplens_spatial import sim


def test_default_tasks_deterministic(world):
    a, b = sim.default_tasks(world), sim.default_tasks(world)
    assert (
        a == b and a and {t["profile"] for t in a} <= {"stroller", "wheelchair", "older_adult_rest"}
    )


def test_run_suite_outcomes_and_gap(world):
    tasks = [
        {
            "id": "t1",
            "profile": "stroller",
            "from_id": "park-b",
            "to_id": "kiosk",
            "scenario_id": None,
        },
        {
            "id": "t2",
            "profile": "wheelchair",
            "from_id": "park-b",
            "to_id": "kiosk",
            "scenario_id": None,
        },
    ]
    r = sim.run_suite(world, tasks)
    assert {x["outcome"] for x in r["results"]} == {"success_with_unknowns"}
    g = r["gaps"][0]
    assert (g["element_id"], g["attribute"]) == ("seg-cf", "incline_pct") and g["impact"] == 2
    assert world.edges["seg-cf"].claims["incline_pct"].status == "unknown"  # world untouched


def test_drive_profile_without_roads_no_data(world):
    r = sim.run_suite(
        world,
        [
            {
                "id": "d",
                "profile": "drive",
                "from_id": "park-b",
                "to_id": "playground",
                "scenario_id": None,
            }
        ],
    )
    assert (
        r["results"][0]["outcome"] == "no_data"
    )  # no road within the snap cap on the road-less fixture


def test_scenario_counts(world):
    r = sim.run_suite(world, sim.default_tasks(world), scenario_id="stage_p3m")
    assert r["scenario_id"] == "stage_p3m"
    assert not [v for v in r["invariant_violations"] if v["invariant"] in ("I1", "I2")]
    assert sum(sum(v.values()) for v in r["counts"].values()) == len(r["results"])


def _older(to_id="kiosk"):
    return {
        "id": "o",
        "profile": "older_adult_rest",
        "from_id": "park-b",
        "to_id": to_id,
        "scenario_id": None,
    }


def test_route_over_rest_limit_without_alternative_is_advisory_not_i7(world):
    # Tiny: park-b -> kiosk; every route runs over 100 m before or after the only bench (n-c).
    r = sim.run_suite(world, [_older()])
    assert r["invariant_violations"] == []
    assert len(r["rest_advisories"]) == 1
    a = r["rest_advisories"][0]
    assert a["task_id"] == "o" and a["kind"] == "rest_limit_no_alternative"
    assert "235.5 m > limit 100 m" in a["detail"]  # strict route a-b-c-d-f: c->d->f
    assert r["results"][0]["outcome"] == "success_with_unknowns"  # never "success"


def test_i7_fires_when_router_claims_the_rest_limit_but_breaks_it(world):
    from townshiplens_spatial.routing import plan_route

    route = plan_route(world, "park-b", "kiosk", "older_adult_rest").routes[0]
    route.rest_limit_met = True  # a router bug: claims the limit while the gap is 111.2 m
    violations = []
    sim._check(world, _older(), route, violations)
    assert [v["invariant"] for v in violations] == ["I7"]
    assert "rest_gap_exceeds_limit" in violations[0]["detail"]


def test_routes_within_rest_limit_raise_nothing(world):
    from rest_support import rest_detour

    rest_detour(world)
    r = sim.run_suite(world, [_older("playground")])
    assert r["invariant_violations"] == [] and r["rest_advisories"] == []
    assert r["results"][0]["outcome"] == "success"


def test_profiles_filter_before_cap(world):
    ts = sim.default_tasks(world, ["wheelchair"])
    assert ts and {t["profile"] for t in ts} == {"wheelchair"}


def test_gap_budget_truncates(world, monkeypatch):
    monkeypatch.setattr(sim, "MAX_RERUNS", 0)
    r = sim.run_suite(world, sim.default_tasks(world), scenario_id="stage_p3m")
    assert r["gaps_truncated"] is True
    assert sim.run_suite(world, [])["gaps_truncated"] is False


def test_report_shape(world):
    r = sim.run_suite(world, [])
    assert r["world_version"] == world.version and len(r["run_id"]) == 4 + 32
    assert r["rest_advisories"] == []


def test_major_road_sidewalk_is_ranked_as_a_gap(world):
    world.edges["seg-ab"] = world.edges["seg-ab"].model_copy(
        deep=True, update={"type": "major_road"}
    )
    task = {
        "id": "t",
        "profile": "stroller",
        "from_id": "park-b",
        "to_id": "lakeside-mall",
        "scenario_id": None,
    }
    r = sim.run_suite(world, [task])
    assert r["results"][0]["outcome"] == "success_with_unknowns"
    g = r["gaps"][0]
    assert (g["element_id"], g["attribute"], g["impact"]) == ("seg-ab", "sidewalk", 1)
    assert "sidewalk" not in world.edges["seg-ab"].claims  # world untouched


def test_sidewalk_flip_only_for_major_roads(world):
    assert sim._flipped(world, "seg-cf", "sidewalk", "stroller") is None


# --- Task 41 fix round 1 ---------------------------------------------------------------------
def test_one_advisory_per_journey_even_with_an_alternative_route(world):
    """Review M-3: the fallback can return two over-limit routes; count the journey once."""
    from rest_support import add_edge
    from townshiplens_spatial.models import Claim

    add_edge(world, "seg-ax", "n-a", "n-x", 120.0)
    add_edge(world, "seg-xd", "n-x", "n-d", 10.0)
    world.edges["seg-xd"].claims["incline_pct"] = Claim()
    r = sim.run_suite(world, [_older("playground")])
    assert len(r["rest_advisories"]) == 1 and r["invariant_violations"] == []


def test_advisory_counts_segments_longer_than_the_limit(world):
    # park-b -> kiosk falls back to a-b-c-d-f: seg-cd 111.2 m and seg-fd 124.3 m are each longer
    # than 100 m, so no rest point at a node can split them.
    r = sim.run_suite(world, [_older()])
    a = r["rest_advisories"][0]
    assert a["long_segments"] == 2 and "2 path segments longer than 100 m" in a["detail"]
    assert r["rest_limit_m"] == 100 and r["rest_long_segments"] == 2


def test_rest_long_segments_counts_distinct_segments_across_the_run(world):
    r = sim.run_suite(world, [_older(), {**_older("playground"), "id": "o2"}])
    assert len(r["rest_advisories"]) == 2
    assert r["rest_long_segments"] == 2  # seg-cd is on both routes, seg-fd on one


def test_truncated_rest_search_is_its_own_advisory(world, monkeypatch):
    """Review M-4: never say "no route within the limit" when the search stopped early."""
    from townshiplens_spatial import routing

    monkeypatch.setattr(routing, "MAX_REST_LABELS", 1)
    r = sim.run_suite(world, [_older()])
    a = r["rest_advisories"][0]
    assert a["kind"] == "rest_search_stopped_early"
    assert "no route within the limit" not in a["detail"] and "may exist" in a["detail"]


def test_report_without_older_adults_has_no_rest_limit(world):
    r = sim.run_suite(world, [{**_older(), "profile": "stroller"}])
    assert r["rest_limit_m"] is None and r["rest_long_segments"] == 0


# ---- Task 47: evacuation journeys (G-07) -------------------------------------------------

EVAC_P5 = {
    "reachable_confirmed": 1,  # island-hut reaches the school
    "reachable_partly_unverified": 2,  # playground, kiosk
    "blocked_by_flood": 2,  # park-b, lakeside-mall
    "no_mapped_connection": 1,  # moon-base has no mapped path
}


def _row(rep, profile, scenario):
    (row,) = [r for r in rep["rows"] if r["profile"] == profile and r["scenario_id"] == scenario]
    return row


def test_evacuation_known_results_on_tiny(world):
    rep = sim.run_evacuation(world, n_per_profile=50)
    assert rep["origins_available"] == 6 and rep["origins_sampled"] == 6
    assert {r["profile"] for r in rep["rows"]} == set(sim.EVAC_PROFILES)
    assert {r["scenario_id"] for r in rep["rows"]} == set(sim.EVAC_SCENARIOS)
    row = _row(rep, "stroller", "stage_p5m")
    assert {k: v for k, v in row["counts"].items() if v} == EVAC_P5
    assert row["total"] == 6
    assert _row(rep, "wheelchair", "stage_p5m")["counts"] == row["counts"]
    base = _row(rep, "stroller", "baseline")["counts"]
    assert base["reachable_confirmed"] == 4 and base["reachable_partly_unverified"] == 1
    assert base["blocked_by_flood"] == 0 and base["no_mapped_connection"] == 1
    assert rep["violations"] == []  # monotone and baseline == no-scenario on the fixture
    assert all(set(r["counts"]) == set(sim.EVAC_RESULTS) for r in rep["rows"])


def test_evacuation_sample_is_seeded_and_capped(world):
    a = sim.run_evacuation(world, n_per_profile=3, seed=7)
    b = sim.run_evacuation(world, n_per_profile=3, seed=7)
    assert a["origins_sampled"] == 3 and a["rows"] == b["rows"] and a["origins"] == b["origins"]
    assert sim.evacuation_origins(world, 3, 7) == sim.evacuation_origins(world, 3, 7)
    assert set(a["origins"]) <= {p for p in world.places}


def test_evacuation_no_centre(world):
    w = dataclasses.replace(world, centres={})
    rep = sim.run_evacuation(w, n_per_profile=50)
    assert all(r["counts"]["no_centre"] == r["total"] == 6 for r in rep["rows"])


def test_evacuation_profile_and_scenario_filters(world):
    rep = sim.run_evacuation(world, profiles=["stroller"], scenario_ids=["baseline", "stage_p3m"])
    assert {(r["profile"], r["scenario_id"]) for r in rep["rows"]} == {
        ("stroller", "baseline"),
        ("stroller", "stage_p3m"),
    }


def test_evacuation_flags_non_monotone_and_baseline_drift(world, monkeypatch):
    from townshiplens_spatial import flood

    real = flood.centres_reachability

    def rigged(w, scenario_id, profile, near, top_routes=3):
        res = real(w, scenario_id, profile, near, top_routes)
        if near == "park-b" and profile == "stroller":
            # blocked at +1 m but confirmed again at +3 m; baseline differs from no-scenario
            for r in res:
                if r.centre.id == "evc-hall":
                    r.reachable = scenario_id != "stage_p1m"
                    r.route_status = "blocked" if scenario_id == "stage_p1m" else "confirmed"
        if scenario_id == "baseline" and near == "kiosk" and profile == "default":
            for r in res:
                r.reachable, r.route_status = False, "blocked"
        return res

    monkeypatch.setattr(flood, "centres_reachability", rigged)
    rep = sim.run_evacuation(world, n_per_profile=50)
    kinds = {(v["invariant"], v["profile"], v["origin_id"]) for v in rep["violations"]}
    assert ("E1", "stroller", "park-b") in kinds
    assert ("E2", "default", "kiosk") in kinds
    assert all(v["detail"] for v in rep["violations"])


def test_evacuation_invariants_hold_on_a_seed_sample():
    from pathlib import Path

    import pytest
    from townshiplens_spatial.world import load_world

    seed = Path(__file__).resolve().parents[3] / "data/seed/elmina"
    if not (seed / "site.json").exists():
        pytest.skip("Elmina seed not present")
    w = load_world(seed)
    rep = sim.run_evacuation(w, profiles=["stroller", "older_adult_rest"], n_per_profile=5)
    assert rep["origins_sampled"] == 5 and rep["origins_available"] > 50
    assert rep["violations"] == []  # E1 monotone across stages, E2 baseline == no scenario
    assert all(sum(r["counts"].values()) == 5 for r in rep["rows"])
