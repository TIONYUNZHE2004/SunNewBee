from townshiplens_spatial.evaluate import evaluate_edge


def test_verified_flat_passes(world):
    r, why = evaluate_edge(world.edges["seg-ab"], world.profiles["stroller"])
    assert r == "PASS" and why == []


def test_reported_steps_fail(world):
    r, why = evaluate_edge(world.edges["seg-be"], world.profiles["stroller"])
    assert r == "FAIL" and why[0]["attribute"] == "step_count"


def test_unknown_incline_is_unknown(world):
    r, why = evaluate_edge(world.edges["seg-cf"], world.profiles["stroller"])
    assert r == "UNKNOWN" and why[0]["attribute"] == "incline_pct"


def test_default_profile_has_no_hard_constraints(world):
    assert evaluate_edge(world.edges["seg-be"], world.profiles["default"])[0] == "PASS"


def test_flood_likely_fails_possible_unknown(world):
    assert (
        evaluate_edge(world.edges["seg-ab"], world.profiles["stroller"], "likely_flooded")[0]
        == "FAIL"
    )
    assert (
        evaluate_edge(world.edges["seg-ab"], world.profiles["stroller"], "possible")[0] == "UNKNOWN"
    )


def test_flood_never_upgrades_unknown(world):
    assert (
        evaluate_edge(world.edges["seg-cf"], world.profiles["stroller"], "unlikely")[0] == "UNKNOWN"
    )


def test_stale_verified_is_unknown(world):
    from datetime import date

    e = world.edges["seg-ab"].model_copy(deep=True)
    e.claims["step_count"].ttl_days = 1
    assert evaluate_edge(e, world.profiles["stroller"], today=date(2027, 1, 1))[0] == "UNKNOWN"
