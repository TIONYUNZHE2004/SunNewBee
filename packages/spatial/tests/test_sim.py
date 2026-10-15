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
    violations, advisories = [], []
    sim._check(world, _older(), route, violations, advisories)
    assert [v["invariant"] for v in violations] == ["I7"] and advisories == []
    assert "rest_gap_exceeds_limit" in violations[0]["detail"]


def test_routes_within_rest_limit_raise_nothing(world):
    from test_routing import _rest_detour

    _rest_detour(world)
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
