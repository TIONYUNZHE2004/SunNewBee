"""T-016: scenario selection, endpoint flood effects and explicit raster coverage gaps."""

import json
from pathlib import Path
from shutil import copytree

import pytest
from townshiplens_spatial import flood, tools
from townshiplens_spatial.models import EvacCentre
from townshiplens_spatial.routing import plan_route
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world


@pytest.fixture
def ctx(world):
    return tools.Ctx(world, VerificationStore(":memory:"))


@pytest.mark.parametrize("endpoint", ["park-b", "playground"])
@pytest.mark.parametrize(
    "classification,expected", [("likely_flooded", "blocked"), ("possible", "partly_unverified")]
)
def test_endpoint_flood_applies_even_when_all_edges_pass(world, endpoint, classification, expected):
    world.flood.edge_classes["stage_p1m"] = {}
    world.flood.place_classes["stage_p1m"][endpoint] = classification
    if endpoint == "park-b":
        expected = "confirmed"  # Origin flood is a caveat, not a barrier to leaving.
    rr = plan_route(world, "park-b", "playground", "stroller", "stage_p1m")
    assert rr.status == expected
    assert any(world.places[endpoint].name in warning for warning in rr.warnings)
    if rr.routes and endpoint == "playground":
        assert any(
            u["element_id"] == endpoint and u["attribute"] == "flood" for u in rr.routes[0].unknowns
        )
    elif not rr.routes:
        assert rr.blocked_reasons[0]["element_id"] == endpoint
    assert plan_route(world, "park-b", "playground", "stroller").status == "confirmed"


def test_flood_does_not_turn_disconnected_data_into_blocked(world):
    world.flood.place_classes["stage_p1m"]["island-hut"] = "likely_flooded"
    assert plan_route(world, "park-b", "island-hut", "default", "stage_p1m").status == "no_data"


@pytest.mark.parametrize("classification", ["likely_flooded", "possible"])
def test_possible_endpoint_is_also_fail_for_drive(world, classification):
    from tests_support import add_roads

    add_roads(world)
    world.flood.place_classes["stage_p1m"]["park-c"] = classification
    assert plan_route(world, "park-b", "park-c", "drive", "stage_p1m").status == "blocked"


@pytest.mark.parametrize("gap", ["uncovered", "partial"])
def test_edge_coverage_gap_caps_status_without_inventing_flood_class(ctx, gap):
    w = ctx.world
    w.flood.edge_classes["stage_p1m"] = {}
    w.flood.coverage["seg-ab"] = gap
    result = tools.plan_route(ctx, "park-b", "playground", "default", "stage_p1m")
    assert result.data["status"] == "partly_unverified"
    assert any(e.attribute == "flood_coverage" and e.value == gap for e in result.evidence)
    assert not any(e.attribute == "flood" for e in result.evidence)
    assert ctx.vrs.list("all") == []
    r = result.data["routes"][0]
    assert any(u["attribute"] == "flood_coverage" for u in r["unknowns"])
    assert set(r["evidence_ids"]) <= {e.id for e in result.evidence}
    assert plan_route(w, "park-b", "playground", "default", "baseline").status == "confirmed"
    w.flood.edge_classes["stage_p1m"]["seg-ab"] = "likely_flooded"
    assert plan_route(w, "park-b", "playground", "default", "stage_p1m").status == "blocked"


def test_uncovered_endpoint_including_zero_length_route_is_unverified(ctx):
    w = ctx.world
    w.flood.coverage["park-b"] = "uncovered"
    r = tools.plan_route(ctx, "park-b", "park-b", "default", "stage_p1m")
    assert r.data["status"] == "partly_unverified"
    assert r.data["routes"][0]["distance_m"] == 0
    assert len([e for e in r.evidence if e.attribute == "flood_coverage"]) == 1
    assert ctx.vrs.list("all") == []


def test_flooded_origin_can_leave_with_named_warning_and_evidence(ctx):
    w = ctx.world
    w.flood.edge_classes["stage_p3m"] = {}
    w.flood.place_classes["stage_p3m"]["playground"] = "likely_flooded"
    route = tools.plan_route(ctx, "playground", "park-b", "default", "stage_p3m")
    centres = tools.list_evacuation_centres(ctx, "stage_p3m", "default", "playground")
    assert route.data["status"] == "confirmed" and route.data["routes"]
    assert any(row["reachable"] for row in centres.data)
    for result in (route, centres):
        assert any(
            "Urban Park playground" in warning and "likely flooded" in warning
            for warning in result.warnings
        )
        assert any(
            ev.element_id == "playground" and ev.value == "likely_flooded" for ev in result.evidence
        )


@pytest.mark.parametrize(
    "gap,expected",
    [
        ("likely_flooded", "blocked"),
        ("possible", "partly_unverified"),
        ("uncovered", "partly_unverified"),
    ],
)
@pytest.mark.parametrize("at_origin", [True, False])
def test_every_centre_row_checks_endpoints_not_just_top_three(world, gap, expected, at_origin):
    w = world
    w.flood.edge_classes["stage_p1m"] = {}
    for i in range(5):
        w.centres[f"extra-{i}"] = EvacCentre(
            id=f"extra-{i}",
            name=f"Candidate {i}",
            coord=w.places["playground"].coord,
            place_id="playground",
            node_id=w.places["playground"].node_id,
            source="osm_candidate",
        )
    pid = "park-b" if at_origin else "playground"
    if gap == "uncovered":
        w.flood.coverage[pid] = gap
    else:
        w.flood.place_classes["stage_p1m"][pid] = gap
    if at_origin and gap != "uncovered":
        expected = "confirmed"
    rows = flood.centres_reachability(w, "stage_p1m", "default", "park-b", top_routes=0)
    rows = [r for r in rows if r.centre.id.startswith("extra-")]
    assert len(rows) == 5
    assert {r.route_status for r in rows} == {expected}
    assert all(r.reachable == (expected != "blocked") for r in rows)


def test_coverage_file_is_loaded_without_changing_scenario_classes(tmp_path):
    source = Path(__file__).parent / "fixtures/tiny"
    copytree(source, tmp_path / "world")
    (tmp_path / "world/flood/coverage.json").write_text(
        json.dumps(
            {
                "partial_edges": ["seg-ab"],
                "uncovered_edges": ["seg-bc"],
                "uncovered_places": ["park-b"],
            }
        )
    )
    w = load_world(tmp_path / "world")
    assert w.flood.coverage == {"seg-ab": "partial", "seg-bc": "uncovered", "park-b": "uncovered"}
    assert w.flood.edge_classes["stage_p1m"] == {"seg-cd": "possible"}


@pytest.mark.parametrize(
    "profile,scenario", [("default", "not-a-scenario"), ("bogus", "baseline"), ("default", "")]
)
def test_bad_selection_never_creates_facts_evidence_or_vrs(ctx, profile, scenario):
    rr = plan_route(ctx.world, "park-b", "playground", profile, scenario)
    assert rr.status == "no_data" and not rr.routes and rr.warnings
    for r in [
        tools.plan_route(ctx, "park-b", "playground", profile, scenario),
        tools.list_evacuation_centres(ctx, scenario, profile, "park-b"),
        tools.get_place_details(ctx, "playground", scenario, profile),
    ]:
        assert not r.ok and r.data is None and r.evidence == [] and r.warnings
    assert ctx.vrs.list("all") == []


def test_real_seed_endpoint_and_coverage_reproductions():
    seed = Path(__file__).resolve().parents[3] / "data/seed/elmina"
    if not (seed / "site.json").exists():
        pytest.skip("Elmina seed not built")
    w = load_world(seed)
    rr = plan_route(w, "osm-way-875071785", "osm-way-866543392", "default", "stage_p1m")
    assert rr.status == "blocked" and not rr.routes
    pid = "osm-node-11492967197"
    assert plan_route(w, pid, pid, "default", "stage_p3m").status == "blocked"
    row = next(
        r
        for r in flood.centres_reachability(w, "stage_p3m", "default", pid, top_routes=0)
        if r.centre.place_id == pid
    )
    assert not row.reachable and row.route_status == "blocked"
    assert (
        plan_route(w, "osm-way-377999794", "osm-way-377999794", "default", "stage_p5m").status
        == "partly_unverified"
    )
