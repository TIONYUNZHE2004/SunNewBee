"""Verify-next planner and the belief over unchecked facts (Cycle 2)."""

import itertools
import json

import pytest
from townshiplens_spatial import belief, planner, twm
from townshiplens_spatial.models import Claim


def test_belief_is_the_prior_when_nothing_real_is_verified(world):
    b = belief.build(world, prior={})
    q = b.q("footway", "incline_pct")
    assert q == pytest.approx(0.5)  # Beta(1, 1): no information
    assert b.sources["staff_verified"] == 0


def test_belief_learns_from_real_verifications_only(world):
    w = world
    e = w.edges["seg-cf"]
    # a real staff verification that passes the wheelchair incline limit
    e.claims = {**e.claims, "incline_pct": Claim(value=3, status="verified", evidence_type="staff")}
    b = belief.build(w, prior={})
    assert b.q("ramp", "incline_pct") > 0.5 and b.sources["staff_verified"] >= 1
    # demo values and what-if claims never count
    e.claims = {
        **e.claims,
        "incline_pct": Claim(value=3, status="verified", evidence_type="team_survey_placeholder"),
    }
    assert belief.build(w, prior={}).q("ramp", "incline_pct") == pytest.approx(0.5)
    im = twm.apply(w, [twm.VerifyFact(element_id="seg-cf", attribute="incline_pct")])
    assert belief.build(im.world, prior={}).sources["staff_verified"] == 0


def test_belief_uses_regional_prior_counts(world, tmp_path):
    prior = {"counts": {"incline_pct": {"footway": {"pass": 30, "fail": 10}}}}
    b = belief.build(world, prior=prior)
    assert b.q("footway", "incline_pct") == pytest.approx(31 / 42)
    assert b.sources["osm_prior_obs"] == 40
    p = tmp_path / "belief_prior.json"
    p.write_text(json.dumps(prior))
    assert belief.load_prior(p) == prior


def test_plan_confirms_the_wheelchair_journeys_that_need_one_fact(world):
    plan = planner.plan_verifications(world, profile="wheelchair", scope="suite", budget=1)
    assert [(f.element_id, f.attribute) for f in plan.facts] == [("seg-cf", "incline_pct")]
    f = plan.facts[0]
    assert "seg-" not in f.label and f.journeys_relying >= 1
    # engine-verified: simulating the facts as passing confirms these journeys
    assert plan.summary["confirmed_after"] > plan.summary["confirmed_before"]
    again = twm.compare(
        world,
        [twm.VerifyFact(element_id=x.element_id, attribute=x.attribute) for x in plan.facts],
        twm.suite_journeys(world, "wheelchair"),
    )
    assert again.summary["confirmed_after"] == plan.summary["confirmed_after"]
    assert 0 <= plan.expected_confirmed <= plan.summary["confirmed_after"]
    assert "if they pass" in plan.disclaimer and "not a forecast" not in plan.disclaimer


def test_greedy_matches_brute_force_on_the_tiny_world(world):
    journeys = twm.suite_journeys(world, "wheelchair")
    for budget in (1, 2, 3):
        plan = planner.plan_verifications(world, "wheelchair", "suite", budget=budget)
        cands = sorted(
            {(u.element_id, u.attribute) for u in planner.candidate_facts(world, journeys)}
        )
        best = 0
        for k in range(1, min(budget, len(cands)) + 1):
            for combo in itertools.combinations(cands, k):
                acts = [twm.VerifyFact(element_id=e, attribute=a) for e, a in combo]
                best = max(best, twm.compare(world, acts, journeys).summary["confirmed_after"])
        assert plan.summary["confirmed_after"] == best or not cands, budget


def test_plan_never_mutates_world_and_respects_budget(world):
    before = {k: dict(e.claims) for k, e in world.edges.items()}
    plan = planner.plan_verifications(world, "stroller", "suite", budget=2)
    assert len(plan.facts) <= 2
    assert {k: dict(e.claims) for k, e in world.edges.items()} == before


def test_plan_links_open_tickets(world):
    plan = planner.plan_verifications(
        world, "wheelchair", "suite", budget=1, open_tickets={("seg-cf", "incline_pct"): "vr-0007"}
    )
    assert plan.facts[0].ticket_id == "vr-0007"


def test_plan_verifications_tool(world, tmp_path):
    from townshiplens_spatial import tools
    from townshiplens_spatial.vr_store import VerificationStore

    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    r = tools.plan_verifications(ctx, profile="wheelchair", scope="suite", budget=2)
    assert r.ok and r.evidence[0].id.startswith("ev-plan-")
    assert r.data["places"] == len({f["element_id"] for f in r.data["facts"]})
    assert "if they pass" in r.warnings[0]
    assert not tools.plan_verifications(ctx, profile="nope").ok
