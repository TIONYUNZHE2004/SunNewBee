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


def test_steps_edge_with_unknown_step_claim_fails(world):
    from townshiplens_spatial.models import Claim

    e = world.edges["seg-be"].model_copy(deep=True)
    e.claims["step_count"] = Claim()
    r, why = evaluate_edge(e, world.profiles["stroller"])
    assert r == "FAIL" and why[0]["attribute"] == "step_count"


def test_stale_claim_carries_stale_reason(world):
    from datetime import date

    e = world.edges["seg-ab"].model_copy(deep=True)
    e.claims["step_count"].ttl_days = 1
    r, why = evaluate_edge(e, world.profiles["stroller"], today=date(2027, 1, 1))
    assert r == "UNKNOWN" and why[0]["reason"] == "stale"
    assert (
        evaluate_edge(world.edges["seg-cf"], world.profiles["stroller"])[1][0]["reason"]
        == "unknown"
    )


def test_zero_ttl_is_honoured(world):
    from datetime import date

    e = world.edges["seg-ab"].model_copy(deep=True)
    e.claims["step_count"].ttl_days = 0
    assert evaluate_edge(e, world.profiles["stroller"], today=date(2026, 10, 19))[0] == "UNKNOWN"


def test_steps_edge_with_contested_or_stale_claim_fails(world):
    from townshiplens_spatial.models import Claim

    for st in ("contested", "stale", "unknown"):
        e = world.edges["seg-be"].model_copy(deep=True)
        e.claims["step_count"] = Claim(value=0, status=st)
        assert evaluate_edge(e, world.profiles["stroller"])[0] == "FAIL"
    e = world.edges["seg-be"].model_copy(deep=True)
    e.claims["step_count"] = Claim(value=0, status="verified", verified_at="2026-10-18")
    assert evaluate_edge(e, world.profiles["stroller"])[0] == "UNKNOWN"
