"""Township World Model core (Cycle 1): actions, the pure transition, rollouts and the diff."""

import copy

import pytest
from townshiplens_spatial import twm
from townshiplens_spatial.evaluate import evaluate_edge
from townshiplens_spatial.routing import plan_route

J_TOILET = twm.Journey(from_id="park-b", to_id="toilet-1", profile="wheelchair")
J_KIOSK = twm.Journey(from_id="park-b", to_id="kiosk", profile="wheelchair")


def _snapshot(world):
    return (
        world.version,
        {k: copy.deepcopy(e.claims) for k, e in world.edges.items()},
        {k: (e.type, list(e.closures)) for k, e in world.edges.items()},
        copy.deepcopy(world.flood.edge_classes),
    )


def test_apply_never_mutates_the_live_world(world):
    before = _snapshot(world)
    acts = [
        twm.BuildRamp(element_id="seg-be"),
        twm.ClosePath(element_id="seg-cf"),
        twm.AssumeFact(element_id="seg-fd", attribute="width_m", value=1.2),
        twm.VerifyFact(element_id="seg-cf", attribute="incline_pct", outcome="pass"),
        twm.SetRiverStage(scenario_id="stage_p3m"),
    ]
    im = twm.apply(world, acts)
    assert im.world is not world and im.scenario_id == "stage_p3m"
    assert _snapshot(world) == before
    assert plan_route(world, "park-b", "toilet-1", "wheelchair").status == "partly_unverified"


def test_build_ramp_turns_steps_into_a_passing_ramp_for_every_profile(world):
    im = twm.apply(world, [twm.BuildRamp(element_id="seg-be")])
    e = im.world.edges["seg-be"]
    assert e.type == "ramp" and e.claims["step_count"].value == 0
    for prof in world.profiles.values():
        if prof.allowed_types is None:  # walking profiles
            assert evaluate_edge(e, prof)[0] == "PASS", prof.id
    assert all(c.evidence_type == "whatif" for c in e.claims.values())


def test_close_path_fails_the_edge_for_every_profile_and_is_labelled_whatif(world):
    im = twm.apply(world, [twm.ClosePath(element_id="seg-ab")])
    e = im.world.edges["seg-ab"]
    for prof in world.profiles.values():
        res, why = evaluate_edge(e, prof)
        assert res == "FAIL" and "what-if" in why[0]["why"]


def test_verify_fact_pass_and_fail(world):
    ok = twm.apply(world, [twm.VerifyFact(element_id="seg-cf", attribute="incline_pct")])
    assert evaluate_edge(ok.world.edges["seg-cf"], world.profiles["wheelchair"])[0] == "PASS"
    bad = twm.apply(
        world, [twm.VerifyFact(element_id="seg-cf", attribute="incline_pct", outcome="fail")]
    )
    assert evaluate_edge(bad.world.edges["seg-cf"], world.profiles["wheelchair"])[0] == "FAIL"


@pytest.mark.parametrize(
    "action, reason",
    [
        (twm.BuildRamp(element_id="seg-nope"), "unknown path"),
        (twm.ClosePath(element_id="nope"), "unknown path"),
        (twm.AssumeFact(element_id="seg-ab", attribute="colour", value=1), "unknown attribute"),
        (twm.AssumeFact(element_id="seg-ab", attribute="incline_pct", value="steep"), "type"),
        (twm.VerifyFact(element_id="seg-ab", attribute="surface"), "not checked"),
        (twm.SetRiverStage(scenario_id="stage_p9m"), "unknown scenario"),
    ],
)
def test_illegal_actions_are_named_not_applied(world, action, reason):
    assert reason in (twm.legal(world, action) or "")
    with pytest.raises(twm.IllegalAction):
        twm.apply(world, [action])


def test_rollout_ramp_flips_wheelchair_toilet_to_would_be_confirmed(world):
    res = twm.compare(world, [twm.BuildRamp(element_id="seg-be")], [J_TOILET, J_KIOSK])
    by = {(c.journey.to_id): c for c in res.changed}
    # One imagined ramp unlocks both: the kiosk is reached via B-E-F instead of the ramp whose
    # incline is unknown.
    assert set(by) == {"toilet-1", "kiosk"}
    ch = by["toilet-1"]
    assert (ch.before.status, ch.after.status) == ("partly_unverified", "confirmed")
    assert ch.after.whatif is True  # rests on an imagined change: "would be confirmed"
    assert ch.before.geometry and ch.after.geometry
    assert res.counts_before["wheelchair"] == {"partly_unverified": 2}
    assert res.counts_after["wheelchair"] == {"confirmed": 2}
    assert res.touched == ["seg-be"]


def test_rollout_without_imagined_change_is_not_whatif(world):
    res = twm.compare(world, [], [J_TOILET])
    assert res.changed == [] and res.journeys[0].after.whatif is False


def test_river_stage_only_adds_fail_or_unknown(world):
    """A stage can never upgrade a journey (honesty invariant), whatever the profile."""
    rank = {"confirmed": 0, "partly_unverified": 1, "blocked": 2, "no_data": 2}
    journeys = [
        twm.Journey(from_id="park-b", to_id=t, profile=p)
        for t in ("kiosk", "playground", "toilet-1", "lakeside-mall")
        for p in ("default", "stroller", "wheelchair")
    ]
    for sid in ("stage_p1m", "stage_p3m", "stage_p5m"):
        res = twm.compare(world, [twm.SetRiverStage(scenario_id=sid)], journeys)
        for j in res.journeys:
            assert rank[j.after.status] >= rank[j.before.status], (sid, j.journey)
            assert j.after.whatif is False  # a stage is a scenario, not an imagined fix


def test_counts_add_up_and_result_carries_evidence_and_disclaimer(world):
    journeys = [J_TOILET, J_KIOSK, twm.Journey(from_id="park-b", to_id="kiosk", profile="stroller")]
    res = twm.compare(
        world,
        [twm.SetRiverStage(scenario_id="stage_p3m"), twm.ClosePath(element_id="seg-cf")],
        journeys,
    )
    for counts in (res.counts_before, res.counts_after):
        assert sum(n for per in counts.values() for n in per.values()) == len(journeys)
    assert res.evidence.id.startswith("ev-whatif-") and res.evidence.status == "indicative"
    assert "not a forecast" in res.disclaimer and "not real" in res.disclaimer
    again = twm.compare(
        world,
        [twm.SetRiverStage(scenario_id="stage_p3m"), twm.ClosePath(element_id="seg-cf")],
        journeys,
    )
    assert again.evidence.id == res.evidence.id  # deterministic


def test_suggested_actions_come_from_the_engine(world):
    sug = twm.suggest_actions(world, profile="wheelchair")
    kinds = {(a.kind, a.element_id) for a in sug}
    assert ("build_ramp", "seg-be") in kinds  # steps that block wheelchair journeys
    assert ("verify_fact", "seg-cf") in kinds  # an unknown on several journeys
    assert all(twm.legal(world, a) is None for a in sug)


def test_evacuation_scope_reaches_the_nearest_centre_and_stage_never_helps(world):
    journeys = twm.evacuation_journeys(world, profile="wheelchair")
    assert journeys and all(j.to_id == twm.NEAREST_CENTRE for j in journeys)
    base = twm.compare(world, [], journeys)
    assert all(o.before.target_name for o in base.journeys if o.before.status != "no_data")
    flood = twm.compare(world, [twm.SetRiverStage(scenario_id="stage_p5m")], journeys)
    rank = {"confirmed": 0, "partly_unverified": 1, "blocked": 2, "no_data": 2}
    for o in flood.journeys:
        assert rank[o.after.status] >= rank[o.before.status]


def test_evacuation_ramp_counts_people_who_would_reach_a_centre(world):
    journeys = twm.evacuation_journeys(world, profile="wheelchair")
    res = twm.compare(
        world,
        [twm.SetRiverStage(scenario_id="stage_p3m"), twm.BuildRamp(element_id="seg-be")],
        journeys,
    )
    reach = lambda c: c.get("confirmed", 0) + c.get("partly_unverified", 0)  # noqa: E731
    assert reach(res.counts_after["wheelchair"]) >= reach(res.counts_before["wheelchair"])
    assert res.summary["reach_before"] == reach(res.counts_before["wheelchair"])
    assert res.summary["total"] == len(journeys)


# ---- tools.simulate_what_if / suggest_interventions ----------------------------------------
from pydantic import TypeAdapter  # noqa: E402
from townshiplens_spatial import tools  # noqa: E402
from townshiplens_spatial.vr_store import VerificationStore  # noqa: E402


@pytest.fixture
def ctx(world, tmp_path):
    return tools.Ctx(world=world, vrs=VerificationStore(str(tmp_path / "vr.db")))


def test_simulate_what_if_tool_ramp_journey(ctx):
    r = tools.simulate_what_if(
        ctx,
        actions=[{"kind": "build_ramp", "element_id": "seg-be"}],
        profile="wheelchair",
        scope="journey",
        from_id="park-b",
        to_id="toilet-1",
    )
    assert r.ok and r.evidence[0].id.startswith("ev-whatif-")
    d = r.data
    assert d["summary"] == {
        "total": 1,
        "reach_before": 1,
        "reach_after": 1,
        "confirmed_before": 0,
        "confirmed_after": 1,
        "changed": 1,
        "confirmed_on_demo_after": 1,  # the imagined route rests on demo values (review I2)
    }
    assert d["changed"][0]["after"]["whatif"] is True
    assert "geometry" not in d["changed"][0]["after"]  # geometry only in diff_geojson
    sides = {f["properties"]["side"] for f in d["diff_geojson"]["features"]}
    assert sides == {"before", "after", "touched"}
    assert all(f["properties"]["whatif"] for f in d["diff_geojson"]["features"])
    assert d["action_labels"] == ["Build a step-free ramp at a set of unnamed steps"]
    assert "not a forecast" in r.warnings[0]


def test_simulate_what_if_tool_rejects_illegal_or_invented_actions(ctx):
    bad = tools.simulate_what_if(ctx, actions=[{"kind": "build_ramp", "element_id": "seg-zz"}])
    assert not bad.ok and "unknown path" in bad.warnings[0]
    weird = tools.simulate_what_if(ctx, actions=[{"kind": "teleport", "element_id": "seg-ab"}])
    assert not weird.ok and "invalid actions" in weird.warnings[0]
    nojourney = tools.simulate_what_if(ctx, actions=[], scope="journey")
    assert not nojourney.ok


def test_simulate_what_if_evacuation_scope_and_live_world_untouched(ctx):
    before = ctx.world.edges["seg-be"].model_copy(deep=True)
    r = tools.simulate_what_if(
        ctx,
        actions=[
            {"kind": "set_river_stage", "scenario_id": "stage_p3m"},
            {"kind": "build_ramp", "element_id": "seg-be"},
        ],
        profile="wheelchair",
        scope="evacuation",
    )
    assert r.ok and r.data["summary"]["total"] == len(twm.evacuation_journeys(ctx.world, "x"))
    assert ctx.world.edges["seg-be"] == before


def test_suggest_interventions_tool_labels_are_readable(ctx):
    r = tools.suggest_interventions(ctx, profile="wheelchair")
    assert r.ok and r.data["candidates"]
    for c in r.data["candidates"]:
        assert "seg-" not in c["label"] and "_" not in c["label"]
        action = TypeAdapter(twm.Action).validate_python(c["action"])
        assert twm.legal(ctx.world, action) is None
    kinds = {c["action"]["kind"] for c in r.data["candidates"]}
    assert {"build_ramp", "verify_fact", "close_path"} <= kinds


# ---- Cycle 1 review fixes ------------------------------------------------------------------
def test_tool_rejects_drive_too_many_actions_and_unknown_stage(ctx):
    drive = tools.simulate_what_if(ctx, actions=[], profile="drive", scope="evacuation")
    assert not drive.ok and "walking profiles" in drive.warnings[0]
    many = [{"kind": "close_path", "element_id": "seg-ab"}] * 9
    assert "at most 8" in tools.simulate_what_if(ctx, actions=many, scope="suite").warnings[0]
    bad = tools.simulate_what_if(ctx, actions=[], scope="suite", scenario_id="stage_p9m")
    assert not bad.ok and "unknown scenario" in bad.warnings[0]
    assert not tools.suggest_interventions(ctx, profile="drive").ok
    assert not tools.plan_verifications(ctx, profile="drive").ok


def test_default_walking_profile_has_a_suite(world):
    assert twm.suite_journeys(world, "default")
    res = twm.compare(world, [], twm.suite_journeys(world, "default"))
    assert res.summary["total"] > 0


def test_build_ramp_only_on_steps(world):
    assert "needs a path with steps" in twm.legal(world, twm.BuildRamp(element_id="seg-ab"))
    assert twm.legal(world, twm.BuildRamp(element_id="seg-be")) is None


def test_demo_evidence_and_before_stage_are_carried(world):
    res = twm.compare(
        world, [twm.BuildRamp(element_id="seg-be")], [J_TOILET], base_scenario_id="stage_p1m"
    )
    assert res.base_scenario_id == "stage_p1m"
    other = twm.compare(world, [twm.BuildRamp(element_id="seg-be")], [J_TOILET])
    assert other.evidence.id != res.evidence.id  # the before-stage is part of the result's id
    assert "confirmed_on_demo_after" in res.summary


def test_repeated_requests_are_served_from_the_cache(ctx):
    a = tools.simulate_what_if(
        ctx,
        actions=[{"kind": "build_ramp", "element_id": "seg-be"}],
        profile="wheelchair",
        scope="suite",
    )
    tools._WM_SLOTS.acquire()
    tools._WM_SLOTS.acquire()  # both slots busy: only a cache hit can answer now
    try:
        b = tools.simulate_what_if(
            ctx,
            actions=[{"kind": "build_ramp", "element_id": "seg-be"}],
            profile="wheelchair",
            scope="suite",
        )
    finally:
        tools._WM_SLOTS.release()
        tools._WM_SLOTS.release()
    assert b.ok and b.data["summary"] == a.data["summary"]


def test_memo_gives_the_same_answers_as_no_memo(world):
    from townshiplens_spatial.routing import eval_memo

    js = twm.suite_journeys(world, "stroller")
    plain = twm.rollout(world, "stage_p3m", js)
    with eval_memo():
        memo = twm.rollout(world, "stage_p3m", js)
    assert plain == memo
