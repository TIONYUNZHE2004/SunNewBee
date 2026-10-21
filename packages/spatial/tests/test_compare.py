"""compare(): fastest vs profile route with known-fact reasons (demo polish B1, AC-B2..B8)."""

from __future__ import annotations

import copy

import networkx as nx
import pytest
from conftest import TINY
from hypothesis import given, settings
from hypothesis import strategies as st
from townshiplens_spatial.compare import compare
from townshiplens_spatial.models import (
    Claim,
    CompareResult,
    Edge,
    FloodBundle,
    Place,
)
from townshiplens_spatial.world import World, load_world

LAT0, LON0 = 3.18, 101.5
M_LON = 1 / 111_148.0  # degrees of longitude per metre at 3.18 N
M_LAT = 1 / 110_574.0


def _pt(east_m: float, north_m: float) -> list[float]:
    return [round(LON0 + east_m * M_LON, 8), round(LAT0 + north_m * M_LAT, 8)]


NODES = {
    "A": _pt(0, 0),
    "S1": _pt(50, 0),
    "S2": _pt(60, 0),
    "C": _pt(100, 0),
    "P1": _pt(0, 30),
    "P2": _pt(40, 30),
    "P3": _pt(80, 30),
    "P4": _pt(100, 30),
}


def V(value, ev="team_survey_placeholder"):  # a verified, dated claim
    return Claim(value=value, status="verified", evidence_type=ev, verified_at="2026-10-18")


# Short path A-S1-S2-C (100 m) has 3 steps; the long path A-P1-P2-P3-P4-C (160 m) is step-free
# with one edge (L3) whose incline is not recorded.
EDGES = [
    (
        "S1",
        "footway",
        "A",
        "S1",
        50.0,
        {"step_count": V(0), "incline_pct": V(1), "width_m": V(2.0)},
    ),
    ("S2", "steps", "S1", "S2", 10.0, {"step_count": V(3)}),
    ("S3", "footway", "S2", "C", 40.0, {}),
    (
        "L1",
        "footway",
        "A",
        "P1",
        30.0,
        {
            "step_count": V(0),
            "incline_pct": V(2),
            "width_m": V(1.8),
            "covered": V(False),
            "kerb": V("lowered"),
        },
    ),
    (
        "L2",
        "footway",
        "P1",
        "P2",
        40.0,
        {
            "step_count": V(0, "staff_survey"),
            "incline_pct": V(4, "staff_survey"),
            "width_m": V(1.5, "staff_survey"),
            "covered": V(True, "staff_survey"),
        },
    ),
    (
        "L3",
        "footway",
        "P2",
        "P3",
        40.0,
        {"step_count": V(0), "width_m": V(1.2), "covered": V(True)},
    ),
    (
        "L4",
        "footway",
        "P3",
        "P4",
        20.0,
        {"step_count": V(0), "incline_pct": V(6), "width_m": V(1.0), "covered": V(False)},
    ),
    (
        "L5",
        "footway",
        "P4",
        "C",
        30.0,
        {"step_count": V(0), "incline_pct": V(1), "width_m": V(2.0)},
    ),
]


def _place(pid, typ, name, coord, node=None, claims=None):
    return Place(id=pid, type=typ, name=name, coord=coord, node_id=node, claims=claims or {})


def build(edges=EDGES, extra_places=()) -> World:
    base = load_world(TINY)
    es, g = {}, nx.MultiGraph()
    for eid, typ, a, b, ln, claims in edges:
        es[eid] = Edge(
            id=eid,
            type=typ,
            from_node=a,
            to_node=b,
            coords=[NODES[a], NODES[b]],
            length_m=ln,
            claims=copy.deepcopy(claims),
        )
        g.add_edge(a, b, key=eid, edge_id=eid)
    places = [
        _place("start", "parking", "Start Car Park", NODES["A"], "A"),
        _place("end", "playground", "End Playground", NODES["C"], "C"),
        # verified bench on a route node
        _place("bench-1", "seating", "Bench One", NODES["P2"], "P2", {"seating": V(True)}),
        # verified bench 10 m north of the middle of L4 (no node): within 15 m
        _place("bench-2", "seating", "Bench Two", _pt(90, 40), None, {"seating": V(True)}),
        # verified bench 25 m away: too far
        _place("bench-3", "seating", "Bench Three", _pt(90, 55), None, {"seating": V(True)}),
        # unverified bench on a route node: not a known rest stop
        _place("bench-4", "seating", "Bench Four", NODES["P3"], "P3"),
        *extra_places,
    ]
    by_node: dict[str, list[str]] = {}
    for p in places:
        if p.node_id:
            by_node.setdefault(p.node_id, []).append(p.id)
    return World(
        base.site,
        es,
        {p.id: p for p in places},
        {k: list(v) for k, v in NODES.items()},
        g,
        FloodBundle(scenarios=[]),
        {},
        {},
        {},
        base.profiles,
        0,
        by_node,
    )


@pytest.fixture
def w():
    return build()


def test_fields_are_exactly_the_contract(w):
    r = compare(w, "start", "end", "wheelchair")
    assert isinstance(r, CompareResult)
    d = r.model_dump(mode="json")
    assert set(d) == {
        "status",
        "profile",
        "same_path",
        "fastest",
        "recommended",
        "stop",
        "reasons",
        "extra_minutes",
        "unchecked",
        "pois",
        "vr",
        "confirm_n",
    }
    assert set(d["stop"]) == {"edge_id", "at_m", "attribute", "value", "limit", "evidence_id"}
    assert set(d["reasons"]) == {"fastest", "recommended"}
    for rs in d["reasons"].values():
        assert set(rs) == {
            "steps",
            "max_incline_pct",
            "min_width_m",
            "covered_share",
            "rest_stops",
            "distance_m",
            "minutes",
        }
    assert set(d["unchecked"][0]) == {"edge_id", "attribute", "start_m", "end_m", "length_m"}
    assert set(d["pois"][0]) == {"kind", "at_m", "value", "evidence_ids", "demo"}
    assert d["vr"] is None and d["confirm_n"] is None  # the tool fills these


def test_routes_stop_and_minutes(w):
    r = compare(w, "start", "end", "wheelchair")
    assert [s.edge_id for s in r.fastest.segments] == ["S1", "S2", "S3"]
    assert [s.edge_id for s in r.recommended.segments] == ["L1", "L2", "L3", "L4", "L5"]
    assert r.status == r.recommended.status == "partly_unverified"
    assert r.profile == "wheelchair" and r.same_path is False
    # AC-B5: the first FAIL under wheelchair is the steps edge, 50 m from the start.
    assert r.stop.model_dump() == {
        "edge_id": "S2",
        "at_m": 50.0,
        "attribute": "step_count",
        "value": 3,
        "limit": 0.0,
        "evidence_id": "ev-S2.step_count",
    }
    assert r.fastest.est_minutes == round(100 / 70, 1)
    assert r.recommended.est_minutes == round(160 / 70, 1)
    assert r.extra_minutes == round(r.recommended.est_minutes - r.fastest.est_minutes, 1) == 0.9


def test_reason_values(w):
    r = compare(w, "start", "end", "wheelchair")
    rec = r.reasons.recommended.model_dump()
    # AC-B6: L3's missing incline never counts; covered = (L2 + L3) / 160 = 0.5.
    assert rec == {
        "steps": 0,
        "max_incline_pct": 6,
        "min_width_m": 1.0,
        "covered_share": 0.5,
        "rest_stops": 2,  # bench-1 (on the route) and bench-2 (10 m off); not bench-3/bench-4
        "distance_m": 160.0,
        "minutes": 2.3,
    }
    fast = r.reasons.fastest.model_dump()
    # S3 has no claims at all; covered is unknown everywhere -> None, not 0.
    assert fast == {
        "steps": 3,
        "max_incline_pct": 1,
        "min_width_m": 2.0,
        "covered_share": None,
        "rest_stops": None,
        "distance_m": 100.0,
        "minutes": 1.4,
    }


def test_unchecked_stretch(w):
    r = compare(w, "start", "end", "wheelchair")
    assert [u.model_dump() for u in r.unchecked] == [
        {
            "edge_id": "L3",
            "attribute": "incline_pct",
            "start_m": 70.0,
            "end_m": 110.0,
            "length_m": 40.0,
        }
    ]


def test_unchecked_groups_contiguous_runs():
    edges = [list(e) for e in EDGES]
    l4 = next(e for e in edges if e[0] == "L4")
    l4[5] = {k: v for k, v in l4[5].items() if k != "incline_pct"}  # L3 + L4 now one run
    r = compare(build([tuple(e) for e in edges]), "start", "end", "wheelchair")
    assert [(u.edge_id, u.attribute, u.start_m, u.end_m, u.length_m) for u in r.unchecked] == [
        ("L3", "incline_pct", 70.0, 130.0, 60.0)
    ]


def test_pois(w):
    r = compare(w, "start", "end", "wheelchair")
    got = [(p.kind, p.at_m, p.value, p.evidence_ids, p.demo) for p in r.pois]
    assert got[0] == ("kerb", 0.0, "lowered", ["ev-L1.kerb"], True)
    assert got[1] == ("covered_start", 30.0, True, ["ev-L2.covered"], False)  # staff survey
    assert got[2] == ("seating", 70.0, "Bench One", ["ev-bench-1.seating"], True)
    # no own claim for the gap: it cites the route's mapped-walkway record
    assert got[3] == ("unknown", 70.0, "incline_pct", [f"ev-{r.recommended.id}.walkways"], False)
    assert got[4] == ("incline", 110.0, 6, ["ev-L4.incline_pct"], True)
    kind, at, value, ids, demo = got[5]
    assert (kind, value, ids, demo) == ("seating", "Bench Two", ["ev-bench-2.seating"], True)
    assert at == pytest.approx(120.0, abs=1.0)
    assert got[6] == ("arrival", 160.0, "End Playground", ["ev-place-end"], False)
    assert len(got) == 7
    assert [p.at_m for p in r.pois] == sorted(p.at_m for p in r.pois)


def test_traceability(w):
    """AC-B4: every non-null reason value traces to evidence returned with the result, and no
    reason rests on an edge whose fact is unknown."""
    r = compare(w, "start", "end", "wheelchair")
    ids = {ev.id for ev in r.evidence}
    for rs in (r.reasons.fastest, r.reasons.recommended):
        for field, value in rs.model_dump().items():
            if value is None:
                assert field not in rs.evidence_ids
                continue
            assert rs.evidence_ids[field], field
            assert set(rs.evidence_ids[field]) <= ids, field
        assert "ev-L3.incline_pct" not in rs.evidence_ids.get("max_incline_pct", [])
        assert not any(i.startswith("ev-S3.") for v in rs.evidence_ids.values() for i in v)
    assert r.stop.evidence_id in ids
    for p in r.pois:
        assert p.evidence_ids and set(p.evidence_ids) <= ids


def test_same_path():
    """AC-B7: a step-free short path: one route, no stop, no extra minutes."""
    edges = [e for e in EDGES if not e[0].startswith("S")]
    r = compare(build(edges), "start", "end", "wheelchair")
    assert r.same_path is True
    assert r.fastest == r.recommended
    assert r.stop is None
    assert r.extra_minutes == 0.0
    assert r.reasons.fastest == r.reasons.recommended


def test_default_profile_is_same_path(w):
    r = compare(w, "start", "end", "default")
    assert r.same_path is True and r.stop is None


def test_no_data():
    """AC-B8: different graph components: no_data, no stop, no route, no unchecked."""
    edges = [e for e in EDGES if e[0] not in ("S3", "L5")]
    r = compare(build(edges), "start", "end", "wheelchair")
    assert r.status == "no_data"
    assert r.recommended is None and r.stop is None and r.vr is None
    assert r.unchecked == [] and r.pois == []


def test_blocked():
    """AC-B8: connected, but every wheelchair path is cut by a known FAIL."""
    edges = [e for e in EDGES if not e[0].startswith("L")]
    r = compare(build(edges), "start", "end", "wheelchair")
    assert r.status == "blocked"
    assert r.recommended is None and r.stop is None and r.vr is None and r.unchecked == []
    assert r.fastest is not None  # the default walk still exists


def test_unknown_profile_raises(w):
    with pytest.raises(ValueError):
        compare(w, "start", "end", "hovercraft")


# ---------------------------------------------------------------- AC-B3: unknown neutrality


@settings(max_examples=40, deadline=None)
@given(
    incline=st.floats(min_value=-8.3, max_value=8.3, allow_nan=False),
    s3_incline=st.floats(min_value=-8.3, max_value=8.3, allow_nan=False),
    s3_width=st.floats(min_value=0.9, max_value=5.0, allow_nan=False),
    status=st.sampled_from(["reported", "unknown", "contested", "stale"]),
)
def test_unknown_neutrality_unverified_values(incline, s3_incline, s3_width, status):
    """Any PASS-compatible value that is not verified leaves everything unchanged."""
    base = compare(build(), "start", "end", "wheelchair")
    w = build()
    w.edges["L3"].claims["incline_pct"] = Claim(value=incline, status=status)
    w.edges["S3"].claims.update(
        {
            "step_count": Claim(value=0, status=status),
            "incline_pct": Claim(value=s3_incline, status=status),
            "width_m": Claim(value=s3_width, status=status),
        }
    )
    r = compare(w, "start", "end", "wheelchair")
    assert r.recommended.id == base.recommended.id
    assert r.reasons.model_dump() == base.reasons.model_dump()


@settings(max_examples=40, deadline=None)
@given(
    l3_incline=st.floats(min_value=-6.0, max_value=6.0, allow_nan=False),
    s3_incline=st.floats(min_value=-1.0, max_value=1.0, allow_nan=False),
    s3_width=st.floats(min_value=2.0, max_value=5.0, allow_nan=False),
)
def test_unknown_neutrality_verified_values(l3_incline, s3_incline, s3_width):
    """Verified PASS values on the unknown facts: the recommended route stays the same, and
    every non-null reason keeps its value (values inside the known range, so a reason could
    only move if the unknown edge had already been counted)."""
    base = compare(build(), "start", "end", "wheelchair")
    w = build()
    w.edges["L3"].claims["incline_pct"] = V(l3_incline)
    w.edges["S3"].claims.update(
        {"step_count": V(0), "incline_pct": V(s3_incline), "width_m": V(s3_width)}
    )
    r = compare(w, "start", "end", "wheelchair")
    assert r.recommended.id == base.recommended.id
    for which in ("fastest", "recommended"):
        before = getattr(base.reasons, which).model_dump()
        after = getattr(r.reasons, which).model_dump()
        for field, value in before.items():
            if value is not None:
                assert after[field] == value, (which, field)
