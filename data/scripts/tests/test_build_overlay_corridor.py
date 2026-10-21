"""Demo corridor (demo polish B5): AC-B13 on the committed Elmina seed, AC-B14 reproducibility.

Skipped when the Elmina seed is absent (world: elmina)."""

import shutil
from pathlib import Path

import pytest
from townshiplens_spatial.compare import _known, compare
from townshiplens_spatial.world import load_world

from data.scripts import build_overlay as bo

SEED = Path(__file__).resolve().parents[2] / "seed" / "elmina"

pytestmark = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")

C = bo.DEMO_CORRIDOR


@pytest.fixture(scope="module")
def world():
    return load_world(SEED)


@pytest.fixture(scope="module")
def result(world):
    return compare(world, C["from"], C["to"], C["profile"])


def test_fastest_stops_at_a_real_osm_steps_edge(world, result):
    assert result.same_path is False
    assert result.stop.edge_id in bo.STEPS_EDGES
    assert world.edges[result.stop.edge_id].osm_tags.get("highway") == "steps"
    assert (result.stop.attribute, result.stop.value, result.stop.limit) == ("step_count", 3, 0)
    assert result.stop.edge_id in [s.edge_id for s in result.fastest.segments]


def test_recommended_adds_one_to_four_minutes_and_is_mostly_footway(world, result):
    fast, rec = result.fastest, result.recommended
    assert fast.distance_m < rec.distance_m and fast.est_minutes < rec.est_minutes
    assert 1.0 <= result.extra_minutes <= 4.0
    edges = [world.edges[s.edge_id] for s in rec.segments]
    foot = sum(e.length_m for e in edges if e.type in bo.FOOT_TYPES) / rec.distance_m
    assert foot >= 0.6
    assert result.reasons.recommended.steps == 0
    assert result.reasons.fastest.steps == 3


def test_exactly_one_unchecked_incline_stretch_of_30_to_60_m(world, result):
    assert len(result.unchecked) == 1
    u = result.unchecked[0]
    assert u.attribute == "incline_pct"
    assert 30.0 <= u.length_m <= 60.0
    run = {u.edge_id}
    prof = world.profiles[C["profile"]]
    ev = {e.id: e for e in result.evidence}
    for s in result.recommended.segments:
        e = world.edges[s.edge_id]
        for attr in ("step_count", "incline_pct", "width_m"):
            known = _known(e, attr, prof, bo.EVAL_DATE, ev) is not None
            assert known == (not (e.id in run and attr == "incline_pct")), (e.id, attr)


def test_every_corridor_claim_is_a_placeholder(world, result):
    ids = {s.edge_id for r in (result.fastest, result.recommended) for s in r.segments}
    for eid in ids:
        for attr in ("step_count", "incline_pct", "width_m", "covered"):
            c = world.edges[eid].claims.get(attr)
            if c is None:
                # no incline on a flight of steps; no carriageway width on a major road (Task 31)
                assert (world.edges[eid].type, attr) in {
                    ("steps", "incline_pct"),
                    ("major_road", "width_m"),
                }, (eid, attr)
                continue
            assert c.evidence_type == bo.PLACEHOLDER, (eid, attr)
    pois = {p.kind for p in result.pois}
    assert {"covered_start", "incline", "kerb", "unknown", "arrival"} <= pois
    assert all(p.demo for p in result.pois if p.kind != "arrival")


def test_rebuild_reproduces_the_overlay_byte_for_byte(tmp_path, monkeypatch):
    """AC-B14: build_overlay.main() on a copy of the seed rewrites identical files."""
    seed = tmp_path / "elmina"
    for rel in ("site.json", "base/walk.geojson", "base/places.geojson"):
        (seed / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SEED / rel, seed / rel)
    for rel in ("access", "flood", "waste"):
        if (SEED / rel).exists():
            shutil.copytree(SEED / rel, seed / rel)
    monkeypatch.setattr(bo, "SEED", seed)
    bo.main()
    for rel in ("access/overlay.geojson", "base/places.geojson", "access/README.md"):
        assert (seed / rel).read_bytes() == (SEED / rel).read_bytes(), rel


def test_streets_carry_a_walking_width_never_the_carriageway(world, result):
    """Review fix round 1: a street's width_m claim is the walker's width (footway range)."""
    for s in result.recommended.segments:
        e = world.edges[s.edge_id]
        if e.type == "street":
            assert 1.2 <= e.claims["width_m"].value <= 2.0, e.id


def test_unchecked_stretch_is_a_candidate_with_the_most_confirmations(world, result):
    """Ruling R30: no other candidate stretch would confirm more sampled wheelchair trips; on
    the seed none is confirmable at all, so the tie keeps the stretch nearest the beat."""
    runs = bo.unchecked_runs(world, result.recommended)
    assert [result.unchecked[0].edge_id] in [r["edge_ids"] for r in runs]
    assert not bo._any_confirmable(world)
    best = min(runs, key=bo._beat_key)
    assert result.unchecked[0].edge_id == best["edge_ids"][0]
