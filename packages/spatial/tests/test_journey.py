"""Journey plans (spec 2026-10-19-resident-journey-simulation-design.md §2, §6.1; AC-D1..D3).

Tiny-fixture tests run in CI; the §2 table and the hypothesis properties need the Elmina seed and
are skipped when it is missing.
"""

import math
import re
from functools import cache
from pathlib import Path

import pytest
from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st
from rest_support import add_rest, detour_spur
from townshiplens_spatial import journey as journey_mod
from townshiplens_spatial import routing
from townshiplens_spatial.geo import haversine_m
from townshiplens_spatial.journey import (
    HOLD_S,
    MAX_EVENTS,
    JourneyEvidenceError,
    _thin_rests,
    build_journey,
)
from townshiplens_spatial.models import Claim, Edge, JourneyEvent, JourneyPlan, Place
from townshiplens_spatial.routing import plan_route
from townshiplens_spatial.world import load_world

ROOT = Path(__file__).resolve().parents[3]
SEED = ROOT / "data" / "seed" / "elmina"
PROFILES = ROOT / "config" / "profiles"
HAS_SEED = (SEED / "site.json").exists()
FORBIDDEN = re.compile(r"\b(safe|safely|selamat|unsafe|blocked|checked path)\b|安全", re.I)
DEPTH = re.compile(r"\d+(\.\d+)?\s*(cm|mm|m)\s+(deep|of water)|water depth", re.I)


def _plan(world, a, b, profile, start="15:20"):
    rr = plan_route(world, a, b, profile)
    assert rr.routes, rr.warnings
    route = rr.routes[0]
    return route, build_journey(world, route, profile, start)


def _offset(coord, east_m, north_m=0.0):
    lat = coord[1]
    return [
        coord[0] + east_m / (111_320 * math.cos(math.radians(lat))),
        coord[1] + north_m / 110_574,
    ]


def _add(world, eid, typ, a, b, east_m, name=None, claims=None):
    world.node_coords.setdefault(b, _offset(world.node_coords[a], east_m))
    coords = [world.node_coords[a], world.node_coords[b]]
    world.edges[eid] = Edge(
        id=eid,
        type=typ,
        from_node=a,
        to_node=b,
        coords=coords,
        length_m=round(haversine_m(*coords), 2),
        name=name,
        claims=claims or {},
    )
    world.graph.add_edge(a, b, key=eid, edge_id=eid)


def street_spur(world):
    """Tiny + a spur east of the playground (n-d) to a shop: a covered street, a main road, a
    two-edge named street and two adjacent ramps with an unknown slope.

    n-d -Jalan Satu (covered, reported)- s1 -Persiaran Besar (major_road)- s2
        -Jalan Dua- s3 -Jalan Dua- s4 -ramp- s5 -ramp (drawn s6 -> s5)- s6 = shop
    """
    covered = {"covered": Claim(value="yes", status="reported", evidence_type="osm_import")}
    ramp = {"incline_pct": Claim(value=None, status="unknown", evidence_type="osm_import")}
    _add(world, "st-1", "street", "n-d", "n-s1", 30, "Jalan Satu", covered)
    _add(world, "mr-1", "major_road", "n-s1", "n-s2", 25, "Persiaran Besar")
    _add(world, "st-2", "street", "n-s2", "n-s3", 60, "Jalan Dua")
    _add(world, "st-3", "street", "n-s3", "n-s4", 70, "Jalan Dua")
    _add(world, "rp-1", "ramp", "n-s4", "n-s5", 4, claims=dict(ramp))
    world.node_coords["n-s6"] = _offset(world.node_coords["n-s5"], 4)
    # Drawn against travel direction: the plan must still orient and chain it.
    _add(
        world,
        "rp-2",
        "ramp",
        "n-s6",
        "n-s5",
        -4,
        claims={k: v.model_copy() for k, v in ramp.items()},
    )
    world.places["shop"] = Place(
        id="shop",
        type="facility",
        name="Corner Shop",
        coord=world.node_coords["n-s6"],
        node_id="n-s6",
    )
    world._place_by_node.setdefault("n-s6", []).append("shop")


def kinds(plan):
    return [(e.kind, e.title) for e in plan.events]


# ---------------------------------------------------------------- tiny fixture (CI)


@pytest.mark.parametrize(
    ("a", "b", "profile"),
    [
        ("park-b", "kiosk", "stroller"),
        ("kiosk", "park-b", "stroller"),
        ("playground", "park-b", "older_adult_rest"),
        ("park-b", "kiosk", "older_adult_rest"),
    ],
)
def test_polyline_is_oriented_and_chained_like_the_route(world, a, b, profile):
    route, plan = _plan(world, a, b, profile)
    assert plan.polyline == route.geometry["coordinates"]
    assert plan.route_id == route.id and plan.profile == profile
    assert len(plan.spans) == len(route.segments)
    assert plan.spans[0][0] == 0
    for (f0, t0, _), (f1, _t1, _) in zip(plan.spans, plan.spans[1:], strict=False):
        assert t0 == pytest.approx(f1) and t0 > f0
    assert [s[2] for s in plan.spans] == [s.eval for s in route.segments]
    # One edge type per span, for the player's display only (walkers keep to a road's verge).
    assert plan.span_types == [world.edges[s.edge_id].type for s in route.segments]
    # Local-metre lengths stay within 1% of the route's own distance.
    assert plan.spans[-1][1] == pytest.approx(route.distance_m, rel=0.01)


def test_out_and_back_spur_is_chained_through_repeated_edges(world):
    detour_spur(world)
    route, plan = _plan(world, "park-b", "playground", "older_adult_rest")
    ids = [s.edge_id for s in route.segments]
    assert ids.count("seg-mr") == 2  # out and back
    assert plan.polyline == route.geometry["coordinates"]
    rests = [e for e in plan.events if e.kind == "rest"]
    assert [e.element_id for e in rests] == ["bench-b", "bench-1", "rest-r"]


def test_stroller_ramp_route_events(world):
    _, plan = _plan(world, "park-b", "kiosk", "stroller")
    assert kinds(plan) == [
        ("verified", "Step-free path"),
        ("unknown", "Ramp"),
        ("arrive", "Park kiosk"),
    ]
    verified, ramp, arrive = plan.events
    assert verified.at_m == 0 and verified.element_id == "seg-ab" and verified.demo is True
    assert verified.status == "verified" and "step_count" in verified.attributes
    assert ramp.element_id == "seg-cf" and ramp.attributes == ["incline_pct"]
    assert ramp.status == "unknown" and "Not checked yet" in ramp.body and ramp.demo is False
    assert ramp.at_m == pytest.approx(111.2, abs=1)
    assert arrive.element_id == "kiosk" and arrive.source == "route.to_place"
    assert arrive.at_m == pytest.approx(plan.spans[-1][1])
    # Profiles without a rest rule do not stop at benches.
    assert not [e for e in plan.events if e.kind in ("rest", "gap")]


def test_rest_profile_events_rest_and_gap(world):
    _, plan = _plan(world, "park-b", "kiosk", "older_adult_rest")
    assert [e.kind for e in plan.events] == ["verified", "gap", "unknown", "rest", "arrive"]
    gap, rest = plan.events[1], plan.events[3]
    assert rest.element_id == "bench-1" and rest.title == "Bench by the path"
    assert rest.status == "verified" and rest.demo is True
    assert rest.at_m == pytest.approx(111.2, abs=1)
    # The fallback takes the ramp route with the smaller worst gap. The first stretch
    # exceeds 100 m before the bench; the ramp still carries its own uncertainty event.
    assert gap.title == "No mapped rest stop ahead" and gap.element_id is None
    assert gap.source == "route.max_gap_between_rest_m" and gap.status == "route"
    assert gap.at_m == pytest.approx(100, abs=0.5)
    assert "100 m" in gap.body and "next mapped rest stop" in gap.body


def test_street_spur_rules_and_unknown_collapsing(world):
    street_spur(world)
    route, plan = _plan(world, "park-b", "shop", "stroller")
    assert route.status == "partly_unverified"
    assert kinds(plan) == [
        ("verified", "Step-free path"),
        ("covered", "Covered walkway"),
        ("unknown", "Crossing Persiaran Besar"),
        ("unknown", "Jalan Dua"),
        ("unknown", "Ramp"),
        ("arrive", "Corner Shop"),
    ]
    _, covered, crossing, street, ramp, _ = plan.events
    assert covered.element_id == "st-1" and covered.status == "reported"
    assert "Not checked yet" in covered.body and covered.demo is False
    assert crossing.element_id == "mr-1" and "No mapped crossing or sidewalk here" in crossing.body
    assert street.element_id == "st-2" and "About 130 m" in street.body
    # Two adjacent ramps (one drawn backwards) collapse into one stop.
    assert ramp.element_id == "rp-1"
    assert plan.polyline == route.geometry["coordinates"]
    at = {s.edge_id: plan.spans[i][0] for i, s in enumerate(route.segments)}
    for e in plan.events[1:-1]:
        assert e.at_m == pytest.approx(at[e.element_id])


def test_hold_times_pace_and_conditions(world):
    street_spur(world)
    _, plan = _plan(world, "park-b", "shop", "older_adult_rest", start="08:05")
    assert HOLD_S == {"rest": 60, "unknown": 8, "covered": 3, "gap": 3, "verified": 3, "arrive": 3}
    assert all(e.hold_s == HOLD_S[e.kind] for e in plan.events)
    pace = routing._pace_m_per_min(world.profiles["older_adult_rest"]) / 60
    assert plan.pace_m_per_s == pytest.approx(pace)
    assert plan.start_time == "08:05" and plan.conditions == []


def test_every_event_cites_route_evidence_and_demo_matches_it(world):
    street_spur(world)
    for profile in ("stroller", "older_adult_rest", "wheelchair", "default"):
        route, plan = _plan(world, "park-b", "shop", profile)
        check_plan(world, route, plan)


def test_verified_needs_verified_claims_not_osm_passability(world):
    for c in world.edges["seg-ab"].claims.values():
        c.status = "reported"
    route, plan = _plan(world, "park-b", "lakeside-mall", "default")
    assert route.segments[0].eval == "PASS"  # default profile passes a reported footway
    assert [e.kind for e in plan.events] == ["arrive"]


def test_too_many_rests_are_thinned_to_a_readable_count(world):
    # A 1.2 km footway chain east of the playground with a verified bench on every node.
    prev = "n-d"
    for i in range(24):
        node = f"n-q{i}"
        _add(world, f"q-{i}", "footway", prev, node, 50)
        world.edges[f"q-{i}"].claims = {
            k: v.model_copy() for k, v in world.edges["seg-cd"].claims.items()
        }
        add_rest(world, f"bench-q{i}", node)
        prev = node
    world.places["far"] = Place(
        id="far", type="facility", name="Far End", coord=world.node_coords[prev], node_id=prev
    )
    world._place_by_node.setdefault(prev, []).append("far")
    route, plan = _plan(world, "park-b", "far", "older_adult_rest")
    assert len(route.rest_points) > MAX_EVENTS
    assert len(plan.events) <= MAX_EVENTS == 12
    rests = [e for e in plan.events if e.kind == "rest"]
    assert len(rests) == MAX_EVENTS - (len(plan.events) - len(rests))
    check_plan(world, route, plan)


def test_profile_must_match_route_and_start_time_is_hh_mm(world):
    route = plan_route(world, "park-b", "kiosk", "stroller").routes[0]
    with pytest.raises(ValueError):
        build_journey(world, route, "wheelchair", "15:20")
    with pytest.raises(ValueError):
        build_journey(world, route, "stroller", "3pm")
    plan = build_journey(world, route, world.profiles["stroller"], "15:20")
    assert JourneyPlan.model_validate_json(plan.model_dump_json()) == plan


def test_journey_is_deterministic(world):
    street_spur(world)
    a = _plan(world, "park-b", "shop", "older_adult_rest")[1].model_dump_json()
    b = _plan(world, "park-b", "shop", "older_adult_rest")[1].model_dump_json()
    assert a == b


@pytest.mark.parametrize(
    ("status", "words"),
    [("stale", "out of date"), ("contested", "disagree"), ("reported", "reported a roof")],
)
def test_covered_body_is_worded_by_claim_status(world, status, words):  # review minor #4
    street_spur(world)
    world.edges["st-1"].claims["covered"].status = status
    _, plan = _plan(world, "park-b", "shop", "stroller")
    covered = next(e for e in plan.events if e.kind == "covered")
    assert covered.status == status
    assert words in covered.body and "Not checked yet" in covered.body
    if status != "reported":
        assert "reported a roof" not in covered.body


def test_gap_body_drops_the_distance_when_the_rest_stop_is_right_ahead(world):  # minor #5
    route = plan_route(world, "park-b", "kiosk", "older_adult_rest").routes[0]
    near = route.model_copy(update={"rest_limit_m": route.max_gap_between_rest_m - 3})
    plan = build_journey(world, near, "older_adult_rest", "15:20")
    gap = next(e for e in plan.events if e.kind == "gap")
    assert not re.search(r"about \d+ m", gap.body), gap.body
    assert "rest stop" in gap.body


def test_rests_are_thinned_by_distance_not_list_order():  # review minor #6
    def ev(kind, at):
        return JourneyEvent(
            kind=kind,
            at_m=at,
            element_id=f"p{at}",
            status="verified",
            evidence_id="e",
            title="t",
            body="b",
            hold_s=HOLD_S[kind],
        )

    ats = [70.0, 10.0, 120.0, 30.0, 0.5, 90.0, 50.0, 130.0, 20.0, 110.0, 60.0, 80.0, 40.0, 100.0]
    found = [("rest", ev("rest", a)) for a in ats] + [("arrive", ev("arrive", 140.0))]
    kept = [e.at_m for rule, e in _thin_rests(found) if rule == "rest"]
    room = MAX_EVENTS - 1
    in_order = sorted(ats)
    want = {in_order[math.floor((k + 0.5) * len(ats) / room)] for k in range(room)}
    assert sorted(kept) == sorted(want)


def test_missing_route_evidence_raises_a_named_error(world, monkeypatch):  # review minor #7
    route = plan_route(world, "park-b", "kiosk", "stroller").routes[0]
    monkeypatch.setattr(journey_mod.routing, "evidence_for_route", lambda w, r: [])
    with pytest.raises(JourneyEvidenceError) as err:
        build_journey(world, route, "stroller", "15:20")
    # With no route evidence nothing is cited as verified; the ramp is the first event built.
    assert err.value.kind == "unknown" and err.value.element_id == "seg-cf"
    assert "unknown" in str(err.value) and "seg-cf" in str(err.value)


def test_every_rule_is_built_once_in_the_tie_break_order():  # review minor #4 (round 1)
    names = tuple(journey_mod._RULES)
    assert names == journey_mod._RULE_ORDER
    assert names == ("covered", "major_road", "gap", "street", "verified", "ramp", "rest", "arrive")


def test_rest_body_is_neutral(world):  # review minor #8
    _, plan = _plan(world, "park-b", "kiosk", "older_adult_rest")
    rest = next(e for e in plan.events if e.kind == "rest")
    assert rest.body.startswith("Rest stop")
    assert not re.search(r"\b(she|he|her|his)\b", rest.body, re.I), rest.body


# ---------------------------------------------------------------- shared property checks


def check_plan(world, route: "routing.Route", plan: JourneyPlan):
    evidence = {ev.id: ev for ev in routing.evidence_for_route(world, route)}
    evals = {s.edge_id: s.eval for s in route.segments}
    ats = [e.at_m for e in plan.events]
    assert ats == sorted(ats)
    assert plan.events and plan.events[-1].kind == "arrive"
    assert len(plan.events) <= MAX_EVENTS
    for e in plan.events:
        assert e.element_id or e.source, e
        assert e.evidence_id in evidence, (e, sorted(evidence))
        ev = evidence[e.evidence_id]
        assert e.demo is (ev.source_type == routing.PLACEHOLDER_SOURCE), e
        if e.kind == "verified":
            assert evals[e.element_id] == "PASS"
            assert ev.status == "verified"
        if e.kind == "unknown":
            assert evals[e.element_id] == "UNKNOWN"
        assert e.hold_s == HOLD_S[e.kind]
        for text in (e.title, e.body):
            assert not FORBIDDEN.search(text), text
            assert not DEPTH.search(text), text
        if "Verified" in e.title or "verified" in e.body.lower():
            assert ev.status == "verified" and not e.demo, e
        if e.demo and e.kind in ("verified", "covered"):
            assert "Demo value · not surveyed" in e.body, e
        if e.kind in ("verified", "covered"):
            # Grounded in the world, not in the cited evidence (review minor #2): when any claim
            # the event rests on is a placeholder, the event is demo, and only then.
            edge = world.edges[e.element_id]
            placeholder = any(
                edge.claims[a].evidence_type == routing.PLACEHOLDER_SOURCE for a in e.attributes
            )
            assert e.demo is placeholder, e
        assert 0 <= e.at_m <= plan.spans[-1][1] + 1e-6 if plan.spans else e.at_m == 0


# ---------------------------------------------------------------- Elmina seed


@cache
def seed_world():
    return load_world(SEED, PROFILES)


DEMO_TABLE = [  # spec §2: (at_m, kind, title)
    (0, "covered", "Covered walkway"),
    (44, "unknown", "Crossing Persiaran Elmina"),
    (100, "gap", "No mapped rest stop ahead"),
    (193, "unknown", "Persiaran Tamarind"),
    (573, "verified", "Step-free path"),
    (638, "rest", "Urban Park bench 3"),
    (836, "unknown", "Ramp"),
    (836, "rest", "Urban Park bench 2"),
    (888, "rest", "Urban Park bench 1"),
    (963, "arrive", "Lakeside Mall Car Park B"),
]


@pytest.mark.skipif(not HAS_SEED, reason="Elmina seed not built")
def test_demo_route_yields_the_spec_table():  # AC-D1, AC-D3 (exact count)
    w = seed_world()
    route, plan = _plan(w, "osm-way-909868201", "park-b", "older_adult_rest")
    got = [(round(e.at_m), e.kind, e.title) for e in plan.events]
    assert len(got) == len(DEMO_TABLE), got
    for (at, kind, title), (want_at, want_kind, want_title) in zip(got, DEMO_TABLE, strict=True):
        assert (kind, title) == (want_kind, want_title), got
        assert abs(at - want_at) <= 2, got
    check_plan(w, route, plan)
    by_title = {e.title: e for e in plan.events}
    assert by_title["Covered walkway"].status == "reported"
    assert by_title["Covered walkway"].evidence_id.endswith(".covered")
    assert w.edges[by_title["Crossing Persiaran Elmina"].element_id].type == "major_road"
    assert "About 230 m" in by_title["Persiaran Tamarind"].body
    assert by_title["Step-free path"].demo is True
    assert w.edges[by_title["Ramp"].element_id].type == "ramp"
    assert all(e.demo for e in plan.events if e.kind == "rest")
    assert "540 m" in by_title["No mapped rest stop ahead"].body


@cache
def seed_pairs():
    w = seed_world()
    ps = sorted((p for p in w.places.values() if p.node_id), key=lambda p: p.id)
    return [
        (a.id, b.id)
        for a in ps
        for b in ps
        if a.id != b.id and haversine_m(a.coord, b.coord) < 1500
    ]


@pytest.mark.skipif(not HAS_SEED, reason="Elmina seed not built")
@settings(
    max_examples=200,
    deadline=None,
    database=None,
    suppress_health_check=[HealthCheck.filter_too_much, HealthCheck.too_slow],
)
@given(
    pair=st.integers(min_value=0, max_value=10**9),
    profile=st.sampled_from(["older_adult_rest", "stroller", "wheelchair", "default"]),
)
def test_seed_journey_properties(pair, profile):  # AC-D2, AC-D3
    w = seed_world()
    pairs = seed_pairs()
    a, b = pairs[pair % len(pairs)]
    rr = plan_route(w, a, b, profile)
    assume(rr.routes and rr.routes[0].distance_m <= 2000)
    route = rr.routes[0]
    plan = build_journey(w, route, profile, "09:00")
    # Zero-edge routes repeat a point to form a GeoJSON LineString; a journey is stationary.
    coords = route.geometry["coordinates"]
    assert plan.polyline == (coords if route.segments else coords[:1])
    check_plan(w, route, plan)
