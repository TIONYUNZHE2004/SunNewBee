from datetime import date

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


# --- Task 31: major roads need sidewalk data before a walking route can rely on them ---------

WALKING = ("default", "stroller", "wheelchair", "older_adult_rest")
STRICT = ("stroller", "wheelchair", "older_adult_rest")


def _major(world, sidewalk=None, status="reported", **kw):
    """seg-ab (verified flat, 1.5 m) retyped as a major road, with an optional sidewalk claim."""
    from townshiplens_spatial.models import Claim

    e = world.edges["seg-ab"].model_copy(deep=True, update={"type": "major_road"})
    if sidewalk is not None:
        e.claims["sidewalk"] = Claim(
            value=sidewalk, status=status, evidence_type="osm_import", **kw
        )
    return e


def test_major_road_without_sidewalk_claim_is_unknown_for_every_walking_profile(world):
    e = _major(world)
    for pid in WALKING:
        r, why = evaluate_edge(e, world.profiles[pid])
        assert r == "UNKNOWN", pid
        assert [w["attribute"] for w in why] == ["sidewalk"], pid
        assert why[0]["reason"] == "unknown" and why[0]["element_id"] == "seg-ab"


def test_major_road_sidewalk_none_fails_strict_profiles_unknown_for_default(world):
    e = _major(world, "none")
    for pid in STRICT:
        r, why = evaluate_edge(e, world.profiles[pid])
        assert r == "FAIL" and why[0]["attribute"] == "sidewalk", pid
    r, why = evaluate_edge(e, world.profiles["default"])
    assert r == "UNKNOWN" and why[0]["attribute"] == "sidewalk"


def test_major_road_reported_sidewalk_is_unknown_for_strict_profiles(world):
    # Review I-1: an imported/reported "sidewalk present" is never treated as verified for a
    # hard constraint (world-model-schema 3); a reported barrier (none) is enough to FAIL.
    for value in ("both", "one_side", "separate"):
        e = _major(world, value)  # reported
        for pid in STRICT:
            r, why = evaluate_edge(e, world.profiles[pid])
            assert r == "UNKNOWN", (value, pid)
            assert [(w["attribute"], w["reason"]) for w in why] == [("sidewalk", "unknown")]
            assert "only reported" in why[0]["why"]
        # The default profile has no hard constraints: a reported sidewalk is enough.
        assert evaluate_edge(e, world.profiles["default"]) == ("PASS", []), value


def test_major_road_verified_sidewalk_follows_normal_rules(world):
    for value in ("both", "one_side", "separate"):
        e = _major(world, value, "verified", verified_at="2026-10-15")
        for pid in WALKING:
            assert evaluate_edge(e, world.profiles[pid], today=date(2026, 10, 16)) == (
                "PASS",
                [],
            ), (value, pid)
        # Other attributes still decide: an unverified width stays UNKNOWN for the stroller.
        e.claims["width_m"].status = "reported"
        r, why = evaluate_edge(e, world.profiles["stroller"], today=date(2026, 10, 16))
        assert r == "UNKNOWN" and [w["attribute"] for w in why] == ["width_m"]


def test_reported_both_unknown_but_verified_both_passes_for_stroller(world):
    stroller = world.profiles["stroller"]
    assert evaluate_edge(_major(world, "both"), stroller)[0] == "UNKNOWN"
    verified = _major(world, "both", "verified", verified_at="2026-10-15")
    assert evaluate_edge(verified, stroller, today=date(2026, 10, 16)) == ("PASS", [])


def test_major_road_sidewalk_none_fail_has_no_unknown_reason(world):
    _, why = evaluate_edge(_major(world, "none"), world.profiles["stroller"])
    assert "reason" not in why[0]  # the value is known: like a hard-limit FAIL


def test_major_road_untrusted_sidewalk_claim_is_unknown(world):
    from datetime import date

    for st in ("unknown", "contested"):
        for pid in WALKING:
            assert evaluate_edge(_major(world, "both", st), world.profiles[pid])[0] == "UNKNOWN"
    assert evaluate_edge(_major(world, None), world.profiles["stroller"])[0] == "UNKNOWN"
    # A "none" that is only contested does not FAIL: it is not trusted either way.
    assert evaluate_edge(_major(world, "none", "contested"), world.profiles["stroller"])[0] == (
        "UNKNOWN"
    )
    stale = _major(world, "both", "verified", verified_at="2025-01-01", ttl_days=30)
    r, why = evaluate_edge(stale, world.profiles["stroller"], today=date(2026, 10, 15))
    assert r == "UNKNOWN" and why[0]["attribute"] == "sidewalk" and why[0]["reason"] == "stale"


def test_major_road_hard_limits_and_flood_still_apply(world):
    e = _major(world)
    e.claims["incline_pct"].value = 12
    assert evaluate_edge(e, world.profiles["stroller"])[0] == "FAIL"
    flooded = evaluate_edge(_major(world, "both"), world.profiles["stroller"], "likely_flooded")
    assert flooded[0] == "FAIL"


def test_drive_allows_major_road_without_sidewalk(world):
    assert "major_road" in world.profiles["drive"].allowed_types
    assert evaluate_edge(_major(world), world.profiles["drive"]) == ("PASS", [])
    assert evaluate_edge(_major(world, "none"), world.profiles["drive"]) == ("PASS", [])


def test_sidewalk_rule_only_for_major_roads(world):
    assert evaluate_edge(world.edges["seg-ab"], world.profiles["default"]) == ("PASS", [])


def test_relevant_attributes_and_claim_gap(world):
    from townshiplens_spatial.evaluate import claim_gap, relevant_attributes
    from townshiplens_spatial.models import Claim

    e = world.edges["seg-ab"]
    assert relevant_attributes(e, world.profiles["stroller"]) == [
        "step_count",
        "incline_pct",
        "width_m",
    ]
    assert relevant_attributes(e, world.profiles["default"]) == []
    assert relevant_attributes(e, world.profiles["drive"]) == []
    today = date(2026, 10, 15)
    assert claim_gap(None, "width_m", today) == (True, False, False)
    assert claim_gap(
        Claim(value=1, status="verified", verified_at="2026-10-01"), "width_m", today
    ) == (
        False,
        False,
        False,
    )
    assert claim_gap(Claim(value=1, status="reported"), "width_m", today) == (True, False, True)
    assert claim_gap(Claim(value=1, status="contested"), "width_m", today) == (True, False, False)
    assert claim_gap(Claim(value=1, status="stale"), "width_m", today) == (True, True, False)
    old = Claim(value=1, status="verified", verified_at="2024-01-01")
    assert claim_gap(old, "width_m", today) == (True, True, False)


PROFILES = ("default", "stroller", "wheelchair", "older_adult_rest", "drive")


def _agrees(edge, profile):
    from townshiplens_spatial.evaluate import edge_gaps

    today = date(2026, 10, 15)
    result, _ = evaluate_edge(edge, profile, today=today)
    gaps = edge_gaps(edge, profile, today)
    # "no gaps" <=> evaluation is PASS, or FAIL for a known barrier with nothing else unknown.
    if result == "PASS":
        assert gaps == [], (edge.id, profile.id)
    if result == "UNKNOWN":
        assert gaps, (edge.id, profile.id)
    if not gaps:
        assert result != "UNKNOWN", (edge.id, profile.id)


def test_no_gaps_iff_evaluation_is_not_unknown_on_the_fixture(world):
    for e in world.edges.values():
        for pid in PROFILES:
            _agrees(e, world.profiles[pid])


def test_gaps_agree_with_evaluation_for_every_claim_state(world):
    from townshiplens_spatial.models import Claim

    states = [
        None,
        Claim(value=None, status="unknown"),
        Claim(value=0, status="reported"),
        Claim(value=0, status="contested"),
        Claim(value=0, status="stale"),
        Claim(value=0, status="verified", verified_at="2020-01-01"),
        Claim(value=0, status="verified", verified_at="2026-10-01"),
    ]
    for edge in world.edges.values():
        for st in states:
            for attr in ("step_count", "incline_pct", "width_m", "sidewalk"):
                e = edge.model_copy(deep=True)
                if st is None:
                    e.claims.pop(attr, None)
                else:
                    e.claims[attr] = st.model_copy()
                for pid in PROFILES:
                    _agrees(e, world.profiles[pid])


def test_major_road_sidewalk_gap_follows_strictness(world):
    from townshiplens_spatial.evaluate import edge_gaps
    from townshiplens_spatial.models import Claim

    e = world.edges["seg-ab"].model_copy(deep=True)
    e.type = "major_road"
    today = date(2026, 10, 15)
    e.claims["sidewalk"] = Claim(value="both", status="reported")
    strict = edge_gaps(e, world.profiles["wheelchair"], today)
    assert [g["attribute"] for g in strict] == ["sidewalk"] and strict[0]["reported"]
    for pid in PROFILES:
        _agrees(e, world.profiles[pid])


def test_demo_values_pass_but_are_gaps(world):
    """Task 55 (R33): evaluate_edge keeps its PASS; the gap map counts demo values as unsurveyed."""
    from townshiplens_spatial.evaluate import edge_demo_gaps, edge_gaps

    e = world.edges["seg-ab"]  # all three claims verified on team_survey_placeholder
    prof = world.profiles["stroller"]
    assert evaluate_edge(e, prof)[0] == "PASS"
    assert edge_gaps(e, prof) == []
    demo = edge_demo_gaps(e, prof)
    assert [g["attribute"] for g in demo] == ["step_count", "incline_pct", "width_m"]
    assert all(g["demo"] for g in demo)
    real = e.model_copy(
        update={
            "claims": {
                a: c.model_copy(update={"evidence_type": "field_survey"})
                for a, c in e.claims.items()
            }
        }
    )
    assert edge_demo_gaps(real, prof) == []
