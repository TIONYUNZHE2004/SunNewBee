"""Fix-it planner: beam search over sets of changes on the world model (Cycle 4)."""

import itertools

from townshiplens_spatial import fixit, twm


def _exhaustive(world, cands, journeys, stage, budget):
    best = -1
    for k in range(0, budget + 1):
        for combo in itertools.combinations(cands, k):
            acts = [a for c in combo for a in c.actions]
            if stage:
                acts = [twm.SetRiverStage(scenario_id=stage), *acts]
            s = twm.compare(world, acts, journeys, max_actions=64).summary
            best = max(best, s["confirmed_after"] * 1000 + s["reach_after"])
    return best


def test_full_width_beam_equals_exhaustive_and_default_beam_never_overclaims(world):
    for stage in (None, "stage_p3m"):
        journeys = fixit._journeys(world, "wheelchair", "suite")
        full = fixit.find_fixes(world, "wheelchair", "suite", stage=stage, budget=2, beam=99)
        best = _exhaustive(world, full.candidates, journeys, stage, 2)
        assert full.best.score == best, stage
        narrow = fixit.find_fixes(world, "wheelchair", "suite", stage=stage, budget=2, beam=1)
        assert narrow.best.score <= best


def test_best_set_is_engine_verified_and_never_closes_paths(world):
    res = fixit.find_fixes(world, "wheelchair", "suite", budget=2)
    assert res.best.actions and all(
        a.kind in ("build_ramp", "verify_fact") for a in res.best.actions
    )
    again = twm.compare(
        world, res.best.actions, fixit._journeys(world, "wheelchair", "suite"), max_actions=64
    )
    assert again.summary["confirmed_after"] == res.best.summary["confirmed_after"]
    assert res.best.summary["confirmed_after"] > res.best.summary["confirmed_before"]
    assert res.conclusive and res.evidence_id.startswith("ev-fixit-")
    assert all("seg-" not in lab for lab in res.best.labels)
    sm = res.best.summary
    nothing = sm["confirmed_before"] * 1000 + sm["reach_before"]
    assert all(r.score > nothing for r in res.runners_up)  # runners-up must beat doing nothing


def test_path_bundles_are_candidates(world):
    """Strict profiles need every unknown on a path checked: one change can be several facts."""
    res = fixit.find_fixes(world, "wheelchair", "suite", budget=1)
    assert any(c.label.startswith("Staff check ") for c in res.candidates)


def test_a_search_that_runs_out_of_time_is_inconclusive(world):
    res = fixit.find_fixes(world, "wheelchair", "suite", budget=2, max_seconds=0)
    assert res.stopped_early and not res.best.actions and res.conclusive is False


def test_llm_proposals_are_gated_reserved_and_deduplicated(world):
    res = fixit.find_fixes(
        world,
        "wheelchair",
        "suite",
        budget=1,
        extra_actions=[
            {"kind": "build_ramp", "element_id": "seg-be"},  # also an engine candidate
            {"kind": "build_ramp", "element_id": "seg-zz"},  # invented id
            {"kind": "close_path", "element_id": "seg-ab"},  # a disruption, not a fix
            {
                "kind": "verify_fact",
                "element_id": "seg-cf",
                "attribute": "incline_pct",
                "outcome": "fail",
            },  # not a fix
        ],
    )
    joined = " | ".join(res.rejected)
    assert "seg-zz" in joined and "close_path" in joined and "verify_fact" in joined
    assert res.candidates[0].source == "assistant"  # proposals are searched first
    labels = [c.label for c in res.candidates]
    assert len(labels) == len(set(labels))
    many = fixit.find_fixes(
        world,
        "wheelchair",
        "suite",
        budget=1,
        extra_actions=[
            {"kind": "verify_fact", "element_id": e, "attribute": "incline_pct"}
            for e in ("seg-ab", "seg-bc", "seg-cd", "seg-cf")
        ],
    )
    assert any("at most 3 proposals" in r for r in many.rejected)
