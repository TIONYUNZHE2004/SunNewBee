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


def test_drive_profile_without_roads_is_not_no_data(world):
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
    assert r["results"][0]["outcome"] != "no_data"  # drive is a real profile now (blocked here)


def test_scenario_counts(world):
    r = sim.run_suite(world, sim.default_tasks(world), scenario_id="stage_p3m")
    assert r["scenario_id"] == "stage_p3m"
    assert not [v for v in r["invariant_violations"] if v["invariant"] in ("I1", "I2")]
    assert sum(sum(v.values()) for v in r["counts"].values()) == len(r["results"])


def test_i7_fires_on_baseline_older_adult(world):
    # honest: the router does not enforce max_rest_free_run_m yet
    r = sim.run_suite(
        world,
        [
            {
                "id": "o",
                "profile": "older_adult_rest",
                "from_id": "park-b",
                "to_id": "kiosk",
                "scenario_id": None,
            }
        ],
    )
    assert [v["invariant"] for v in r["invariant_violations"]] == ["I7"]
    assert "rest_gap_exceeds_limit" in r["invariant_violations"][0]["detail"]


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
