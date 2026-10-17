"""Ticket impact (Cycle 7): value of information on one verification ticket."""

from townshiplens_spatial import impact, twm
from townshiplens_spatial.models import Claim


def test_open_ticket_shows_what_pass_and_fail_would_do(world):
    r = impact.fact_impact(
        world, "seg-cf", "incline_pct", "stroller route Car Park B -> Park kiosk"
    )
    assert r.mode == "would" and r.profile == "stroller" and r.sampled >= 1
    assert r.own and r.own.statuses["now"] == "partly_unverified"
    assert r.own.statuses["pass"] == "confirmed"  # the ticket's own question would be answered
    assert r.became_confirmed >= 1 and 0.0 < r.belief_q < 1.0
    assert r.own_other_checks == 0  # nothing else left to check on the kiosk route


def test_resolved_ticket_shows_what_the_check_changed(world):
    e = world.edges["seg-cf"]
    e.claims = {**e.claims, "incline_pct": Claim(value=3, status="verified", evidence_type="staff")}
    r = impact.fact_impact(
        world, "seg-cf", "incline_pct", "stroller route Car Park B -> Park kiosk"
    )
    assert r.mode == "did" and r.changed >= 1 and r.became_confirmed >= 1
    assert r.own.statuses == {"before": "partly_unverified", "now": "confirmed"}
    assert r.belief_q > r.belief_q_before  # the model learned from the verification


def test_not_a_path_fact_has_no_impact_and_world_is_untouched(world):
    before = {k: dict(e.claims) for k, e in world.edges.items()}
    assert impact.fact_impact(world, "unknown_place", "existence").mode == "none"
    impact.fact_impact(world, "seg-cf", "incline_pct")
    assert {k: dict(e.claims) for k, e in world.edges.items()} == before


def test_forget_fact_is_not_offered_to_the_model():
    from typing import get_args

    kinds = {t.model_fields["kind"].default for t in get_args(get_args(twm.Action)[0])}
    assert "forget_fact" not in kinds


def test_own_journey_is_reported_separately_from_the_sample(world):
    r = impact.fact_impact(
        world, "seg-cf", "incline_pct", "stroller route Car Park B -> Park kiosk"
    )
    plain = impact.fact_impact(world, "seg-cf", "incline_pct", None)
    # the own journey is not part of `sampled` nor of the sample counts
    assert r.sampled == len(
        [
            j
            for j in twm.suite_journeys(world, "stroller")[:20]
            if (j.from_id, j.to_id) != ("park-b", "kiosk")
        ]
    )
    assert r.became_confirmed <= r.sampled
    assert plain.own is None


def test_unparsed_summary_assumes_a_profile_that_uses_the_fact_and_says_so(world):
    r = impact.fact_impact(world, "seg-cf", "incline_pct", "chat: unknown incline on a path")
    assert r.own is None and r.profile_assumed is True
    assert r.profile == "wheelchair"  # wheelchair rules check the incline
    named = impact.fact_impact(world, "seg-cf", "incline_pct", "stroller route X -> Y")
    assert named.profile == "stroller" and named.profile_assumed is False and named.own is None


def test_ambiguous_names_and_centres(world):
    world.places["toilet-1"].name = "Car Park B"  # now two places share the name
    r = impact.fact_impact(
        world, "seg-cf", "incline_pct", "stroller route Car Park B -> Park kiosk"
    )
    assert r.own is None  # never guess which place the ticket meant
    world.places["toilet-1"].name = "Park toilet"
    centre = next(iter(world.centres.values()))
    r = impact.fact_impact(
        world, "seg-cf", "incline_pct", f"wheelchair route Car Park B -> {centre.name}"
    )
    assert r.own is not None and r.own.to_name == centre.name


def test_resolved_ticket_without_a_counted_verification_counts_nothing(world):
    e = world.edges["seg-cf"]
    for status, ev in (("contested", "staff"), ("verified", "team_survey_placeholder")):
        e.claims = {**e.claims, "incline_pct": Claim(value=3, status=status, evidence_type=ev)}
        r = impact.fact_impact(
            world,
            "seg-cf",
            "incline_pct",
            "stroller route Car Park B -> Park kiosk",
            ticket_status="resolved",
        )
        assert r.mode == "none" and r.sampled == 0 and "not count" in r.note


def test_verified_fail_reports_the_routes_it_cut(world):
    e = world.edges["seg-cf"]
    e.claims = {
        **e.claims,
        "incline_pct": Claim(value=30, status="verified", evidence_type="staff"),
    }
    r = impact.fact_impact(
        world,
        "seg-cf",
        "incline_pct",
        "stroller route Car Park B -> Park kiosk",
        ticket_status="resolved",
    )
    assert r.mode == "did"
    assert r.own.statuses["before"] == "partly_unverified"
    assert r.own.statuses["now"] != "confirmed"
    assert r.became_confirmed == 0
