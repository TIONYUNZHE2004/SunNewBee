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
