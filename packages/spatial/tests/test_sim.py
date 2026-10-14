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


def test_stub_profile_no_data(world):
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
    assert r["results"][0]["outcome"] == "no_data"


def test_scenario_counts(world):
    r = sim.run_suite(world, sim.default_tasks(world), scenario_id="stage_p3m")
    assert r["scenario_id"] == "stage_p3m" and not r["invariant_violations"]
    assert sum(sum(v.values()) for v in r["counts"].values()) == len(r["results"])
