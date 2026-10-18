"""Rising-river population rollout and tipping points (Cycle 3)."""

import json

from townshiplens_spatial import rollout, twm

RANK = {"confirmed": 0, "partly_unverified": 1, "blocked": 2, "no_data": 3}


def test_rollout_counts_add_up_and_never_improve_as_the_river_rises(world):
    r = rollout.river_rollout(world, profiles=["wheelchair", "stroller"], n=10)
    assert [s.id for s in r.stages][0] == "baseline"
    for prof in ("wheelchair", "stroller"):
        series = [r.counts[prof][s.id] for s in r.stages]
        for c in series:
            assert c["reach"] + c["cut_off"] + c["no_data"] == c["total"]
            assert c["confirmed"] <= c["reach"]
        reach = [c["reach"] for c in series]
        assert reach == sorted(reach, reverse=True), reach  # a higher stage never helps
    assert "not a forecast" in r.disclaimer and "synthetic" in r.disclaimer.lower()


def test_each_resident_has_a_consistent_tipping_stage_and_known_routes(world):
    r = rollout.river_rollout(world, profiles=["wheelchair"], n=10)
    ids = [s.id for s in r.stages]
    for res in r.residents:
        assert len(res.statuses) == len(ids)
        reached = [st in ("confirmed", "partly_unverified") for st in res.statuses]
        if res.tipping_stage is None:
            assert all(reached) or not reached[0]
        else:
            k = ids.index(res.tipping_stage)
            assert reached[:k] == [True] * k and not reached[k]
        for rid in res.route_ids:
            assert rid is None or rid in r.routes
    assert all(g["type"] == "LineString" for g in r.routes.values())


def test_rollout_is_deterministic_and_does_not_touch_the_world(world):
    before = {k: dict(e.claims) for k, e in world.edges.items()}
    a = rollout.river_rollout(world, profiles=["wheelchair"], n=5)
    b = rollout.river_rollout(world, profiles=["wheelchair"], n=5)
    assert a.model_dump() == b.model_dump() and a.evidence_id == b.evidence_id
    assert {k: dict(e.claims) for k, e in world.edges.items()} == before


def test_tipping_point_for_one_journey(world):
    t = rollout.tipping_point(world, "park-b", "default", to_id="playground")
    assert (t.stages[0].stage, t.stages[0].status) == ("baseline", "confirmed")
    # at +3 m the playground itself is likely flooded: a flooded destination is blocked (T-016)
    p3 = t.stages[2]
    assert (p3.stage, p3.status, p3.end_flood) == ("stage_p3m", "blocked", "likely_flooded")
    assert t.reached_at_normal and t.breaks_at == "stage_p3m"
    assert t.labels["stage_p3m"] == "River +3 m"
    assert t.stages[0].demo_evidence  # the confirmed route rests on demo values (review C2)
    near = rollout.tipping_point(world, "park-b", "wheelchair")
    assert near.to_id == twm.NEAREST_CENTRE and len(near.stages) == len(world.flood.scenarios)


def test_a_trip_that_never_works_is_not_reported_as_fine(world):
    """Review C1: no route even at normal level is its own case, never 'keeps a route'."""
    t = rollout.tipping_point(world, "moon-base", "wheelchair")
    assert t.reached_at_normal is False and t.breaks_at is None and t.degrades_at is None


def test_rollout_and_tipping_agree_on_flooded_starts(world):
    """Review I2: one rule for 'no longer reached' in both."""
    r = rollout.river_rollout(world, profiles=["default"], n=10)
    ids = [s.id for s in r.stages]
    for res in r.residents:
        t = rollout.tipping_point(world, res.origin_id, "default")
        assert res.tipping_stage == t.breaks_at, res.origin_id
        for k, st in enumerate(res.statuses):
            if st == rollout.START_FLOODED:
                assert t.stages[k].start_flood == "likely_flooded" and ids[k] != "baseline"


def test_routes_are_deduplicated_by_geometry_and_residents_never_improve(world):
    r = rollout.river_rollout(world, profiles=["wheelchair", "stroller"], n=10)
    geoms = [json.dumps(g["coordinates"]) for g in r.routes.values()]
    assert len(geoms) == len(set(geoms))  # review I1
    for res in r.residents:
        reached = [st in ("confirmed", "partly_unverified") for st in res.statuses]
        assert reached == sorted(reached, reverse=True), res.id  # once lost, never regained
        assert res.origin_coord is not None


def test_profiles_are_normalised():
    assert rollout.normalise_profiles(["wheelchair"] * 20 + ["drive", "stroller"]) == [
        "stroller",
        "wheelchair",
    ]


def test_rollout_and_tipping_tools(world, tmp_path):
    from townshiplens_spatial import tools
    from townshiplens_spatial.vr_store import VerificationStore

    ctx = tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))
    r = tools.rising_river_rollout(ctx, profiles=["wheelchair"], n=5)
    assert r.ok and r.evidence[0].id.startswith("ev-rollout-") and "not a forecast" in r.warnings[0]
    t = tools.river_tipping_point(ctx, from_id="park-b", profile="default", to_id="playground")
    assert t.ok and t.data["breaks_at"] == "stage_p3m" and t.data["target_name"]
    assert not tools.river_tipping_point(ctx, from_id="nope").ok
    assert not tools.rising_river_rollout(ctx, profiles=["drive"]).ok
