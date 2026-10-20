"""Development Simulation plan (spec 2026-10-21 §3, §5.1; AC-H1, H2, H4, H5, H6).

The Elmina tests need the seed and are skipped without it; the tiny-fixture test runs everywhere.
"""

import json
import math
import re
from functools import cache
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from shapely.geometry import Polygon, shape
from townshiplens_spatial import devsim, routing, twm
from townshiplens_spatial.devsim_models import DevelopmentPlan, DevsimUnavailable
from townshiplens_spatial.world import load_world

ROOT = Path(__file__).resolve().parents[3]
SEED = ROOT / "data" / "seed" / "elmina"
TINY = Path(__file__).parent / "fixtures" / "tiny"
HAS_SEED = (SEED / "site.json").exists()
seed_only = pytest.mark.skipif(not HAS_SEED, reason="Elmina seed not built")
BASELINE = ["Pak Cik Halim", "Farid", "Mei Ling", "Mak Cik Zainab", "Arjun"]


@cache
def _world():
    return load_world(SEED)


@cache
def _plan() -> DevelopmentPlan:
    return devsim.build_development_plan(_world())


def _local(world):
    lc = json.loads((SEED / "base/landcover.geojson").read_text(encoding="utf-8"))["features"]

    def get(osm):
        return next(shape(f["geometry"]) for f in lc if f["properties"].get("osm") == osm)

    parcel = get(devsim.PARCEL_OSM)
    lat0 = parcel.centroid.y
    kx = 111_320 * math.cos(math.radians(lat0))

    def poly(coords):
        return Polygon([(c[0] * kx, c[1] * 110_574) for c in coords])

    return poly(parcel.exterior.coords), poly(get(devsim.KANOPI_OSM).exterior.coords), poly


# ---- BE1 ---------------------------------------------------------------------------------------
def test_tiny_fixture_has_no_development_simulation():  # AC-H6
    with pytest.raises(DevsimUnavailable):
        devsim.place_tower(load_world(TINY))
    with pytest.raises(DevsimUnavailable):
        devsim.build_development_plan(load_world(TINY))


@seed_only
def test_tower_sits_inside_the_parcel_and_clear_of_kanopi():  # AC-H5
    site = _plan().site
    parcel, kanopi, poly = _local(_world())
    tower = poly(site.footprint)
    assert site.parcel_id == "way/1564861412"
    assert parcel.contains(tower)
    assert tower.distance(kanopi) >= 200
    assert site.kanopi_clearance_m >= 200
    assert abs(tower.distance(kanopi) - site.kanopi_clearance_m) < 1
    assert len(site.footprint) == 4 and 900 < tower.area < 1100  # the prototype's 38 x 26 m
    # the door is on the podium face and the entrance path ends on a walk node
    assert site.entrance.path[0] == site.entrance.door
    end = site.entrance.path[-1]
    assert any(c[:2] == end for c in _world().node_coords.values())
    assert 0 <= site.entrance.facing_deg < 360
    assert site.storeys == 30 and site.homes == 500


# ---- BE2 ---------------------------------------------------------------------------------------
@seed_only
def test_facts_equal_a_direct_route_recomputation(capsys):  # AC-H1
    world, plan = _world(), _plan()
    facts, site = plan.facts, plan.site
    with capsys.disabled():
        print("\nDEVSIM FACTS:", json.dumps(_facts_summary(plan)))
    assert facts.profile == "default" and facts.provenance == "routing engine, default profile"
    tw = devsim.tower_world(world, site)
    for walk, name in ((facts.park, "Elmina Urban Park"), (facts.mall, "Elmina Lakeside Mall")):
        pid = next(p.id for p in world.places.values() if p.name == name)
        r = routing.plan_route(tw, devsim.TOWER_PLACE, pid, "default").routes[0]
        assert walk.m == round(r.distance_m)
        assert walk.min == max(1, math.floor(r.est_minutes + 0.5))
        assert walk.path[0] == [round(v, 7) for v in r.geometry["coordinates"][0][:2]]
    d = facts.detour
    assert d is not None, "a >= 2 min detour exists on the seed"
    assert d.edge_id in devsim.frontage_edges(world, site)
    node = devsim.detour_home_node(world, site, d.home_id)
    home = devsim._temp_place("t-home", "home", world, node)
    target = next(p.id for p in world.places.values() if p.name == "Lakeside Mall Car Park B")
    w0 = devsim._with_places(world, [home])
    before = routing.plan_route(w0, "t-home", target, "default").routes[0]
    closed = twm.apply(world, [twm.ClosePath(element_id=d.edge_id)]).world
    after = routing.plan_route(devsim._with_places(closed, [home]), "t-home", target, "default")
    after = after.routes[0]
    assert d.edge_id in {s.edge_id for s in before.segments}
    assert d.edge_id not in {s.edge_id for s in after.segments}
    assert (d.before_m, d.after_m) == (round(before.distance_m), round(after.distance_m))
    assert d.detour_min == math.floor(after.est_minutes - before.est_minutes + 0.5)
    assert d.detour_min >= 2
    assert len(d.before_path) == len(before.geometry["coordinates"])  # full, not clipped
    assert len(d.after_path) == len(after.geometry["coordinates"])


def _facts_summary(plan):
    f = plan.facts
    return {
        "detour": f.detour and f.detour.model_dump(exclude={"before_path", "after_path"}),
        "park": f.park.model_dump(exclude={"path"}),
        "mall": f.mall.model_dump(exclude={"path"}),
        "households": plan.households,
        "kanopi_clearance_m": plan.site.kanopi_clearance_m,
    }


@seed_only
def test_the_detour_moves_to_the_far_side_sidewalk():
    """Bubble 1 says "walk the other side": the detour must really cross to the far sidewalk."""
    d = _plan().facts.detour
    assert d is not None and d.detour_side_switch
    assert _plan().bubbles[0].text == devsim.BUBBLE1_SIDE


@seed_only
def test_facts_are_deterministic():
    world = _world()
    site = devsim.place_tower(world)
    assert site == _plan().site
    assert devsim.compute_facts(world, site) == _plan().facts


# ---- BE3 ---------------------------------------------------------------------------------------
@seed_only
def test_cast_and_households():
    world, plan = _world(), _plan()
    households, cast = devsim.build_cast(world, plan.site)
    assert 450 <= households <= 550
    assert [c.name for c in cast] == BASELINE
    assert {c.id: c.home for c in cast} == {
        "halim": "existing",
        "farid": "existing",
        "meiling": "tower",
        "zainab": "tower",
        "arjun": "tower",
    }
    assert "child" in next(c for c in cast if c.id == "meiling").persona
    assert devsim.build_cast(world, plan.site) == (households, cast)
    assert all(re.fullmatch(r"#[0-9a-f]{6}", c.colour) for c in cast)
    assert not any(re.search(r"\d", c.persona) for c in cast)


# ---- BE4 ---------------------------------------------------------------------------------------
@seed_only
def test_the_plan_matches_the_baseline_and_passes_its_check():
    plan = _plan()
    assert devsim.check_plan(plan) == []
    assert plan.world == "elmina" and plan.provisional is False and plan.total_s == 66
    assert [(a.name, a.t0, a.t1) for a in plan.acts] == [
        ("Brief", 0, 4),
        ("Construction", 4, 32),
        ("Handover", 32, 44),
        ("Daily Life", 44, 63),
        ("Summary", 63, 66),
    ]
    f = plan.facts
    d = f.detour
    assert [(b.n, b.who, b.t0, b.t1, b.tone) for b in plan.bubbles] == [
        (1, "halim", 18.4, 21.4, "neg"),
        (2, "farid", 23.4, 26.2, "neg"),
        (3, "meiling", 35.4, 38.2, "pos"),
        (4, "halim", 40.2, 43.2, "pos"),
        (5, "meiling", 47.6, 50.4, "neg"),
        (6, "zainab", 53.2, 56.2, "pos"),
        (7, "arjun", 58.6, 61.6, "pos"),
    ]
    b = plan.bubbles
    assert b[0].tag == f"ROUTE ENGINE · +{d.detour_min} min walk · {d.before_m:,} → {d.after_m:,} m"
    assert b[5].text == f"Park in {f.park.min} min, love it"
    assert b[5].tag == f"ROUTE ENGINE · {f.park.m:,} m · {f.park.min} min walk"
    assert b[6].tag == f"ROUTE ENGINE · {f.mall.m:,} m · {f.mall.min} min walk"
    assert [x.tag for x in b[1:5]] == [None] * 4
    card = plan.end_card
    assert card.title == "What residents raised"
    assert card.subtitle == "Simulated reactions · Hypothetical development · not an SDP project"
    assert [i.badges for i in card.items] == [
        ["ROUTE ENGINE"],
        ["SIMULATED"],
        ["ROUTE ENGINE", "SIMULATED"],
    ]
    assert f"{d.before_m:,} m → {d.after_m:,} m" in card.items[0].text
    assert f"Urban Park {f.park.min} min" in card.items[2].text
    assert f"the mall {f.mall.min} min" in card.items[2].text
    assert all(len(x.text.split()) <= 8 for x in b[1:])
    assert len(b[0].text.split()) <= 9
    a = plan.anchors
    assert len(a.halim_path) > 10
    assert a.park == f.park.path[-1]
    assert DevelopmentPlan.model_validate_json(plan.model_dump_json()) == plan


@pytest.mark.parametrize(
    ("mins", "text"),
    [
        (4, "Mall's right downstairs!"),
        (5, "Mall's right downstairs!"),
        (6, "Mall's a 6 min walk, not bad!"),
        (12, "Mall's a 12 min walk, not bad!"),
        (13, "Mall's a 13 min walk from here"),
    ],
)
def test_bubble_seven_copy_rule(mins, text):
    assert devsim._mall_line(mins)[0] == text


@seed_only
def test_no_detour_drops_the_tag_and_the_end_card_item():  # spec §13
    plan = _plan()
    facts = plan.facts.model_copy(update={"detour": None})
    _, bubbles, card, anchors = devsim.build_beats(_world(), plan.site, facts)
    assert bubbles[0].tag is None and not re.search(r"\d", bubbles[0].text)
    assert len(card.items) == 2 and card.items[0].badges == ["SIMULATED"]
    alt = plan.model_copy(
        update={"facts": facts, "bubbles": bubbles, "end_card": card, "anchors": anchors}
    )
    assert devsim.check_plan(alt) == []


def _numbered_slots(plan):
    """(kind, index) of every bubble text, tag and end-card item that quotes a number."""
    out = []
    for i, b in enumerate(plan.bubbles):
        if re.search(r"\d", b.text):
            out.append(("text", i))
        if b.tag and re.search(r"\d", b.tag):
            out.append(("tag", i))
    for i, it in enumerate(plan.end_card.items):
        if re.search(r"\d", it.text):
            out.append(("item", i))
    return out


def _with_text(plan, slot, fn):
    kind, i = slot
    p = plan.model_copy(deep=True)
    if kind == "item":
        p.end_card.items[i].text = fn(p.end_card.items[i].text)
    elif kind == "tag":
        p.bubbles[i].tag = fn(p.bubbles[i].tag)
    else:
        p.bubbles[i].text = fn(p.bubbles[i].text)
    return p


@seed_only
@settings(max_examples=60, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(data=st.data())
def test_a_mutated_number_fails_the_check(data):  # AC-H2
    plan = _plan()
    assert devsim.check_plan(plan) == []
    allowed = devsim.fact_numbers(plan.facts)
    slots = _numbered_slots(plan)
    slot = data.draw(st.sampled_from(slots))
    new = data.draw(st.integers(0, 99_999).filter(lambda v: v not in allowed))
    comma = data.draw(st.booleans())
    kind, i = slot
    text = (
        plan.end_card.items[i].text
        if kind == "item"
        else plan.bubbles[i].tag
        if kind == "tag"
        else plan.bubbles[i].text
    )
    runs = list(re.finditer(r"\d(?:[\d,]*\d)?", text))
    k = data.draw(st.integers(0, len(runs) - 1))
    m = runs[k]
    rep = f"{new:,}" if comma else str(new)
    bad = _with_text(plan, slot, lambda t: t[: m.start()] + rep + t[m.end() :])
    assert devsim.check_plan(bad), (slot, rep)


@seed_only
@given(n=st.integers(2, 5), digit=st.integers(0, 9), at=st.integers(0, 40))
@settings(max_examples=30, deadline=None)
def test_a_digit_in_bubbles_two_to_five_fails_the_check(n, digit, at):  # AC-H2
    plan = _plan()
    allowed_digit = next(iter(sorted(devsim.fact_numbers(plan.facts))))
    for value in (digit, allowed_digit):  # even a fact value may not appear in these bubbles
        bad = plan.model_copy(deep=True)
        t = bad.bubbles[n - 1].text
        bad.bubbles[n - 1].text = t[: min(at, len(t))] + f" {value} " + t[min(at, len(t)) :]
        assert any(f"bubble {n}" in e for e in devsim.check_plan(bad))


@seed_only
@pytest.mark.parametrize(
    "word", ["safe", "Safe", "SELAMAT", "安全", "depth", "flood", "Flooded", "safely"]
)
def test_banned_words_fail_the_check(word):  # AC-H4
    bad = _plan().model_copy(deep=True)
    bad.bubbles[2].text = f"We got our keys {word}"
    assert any("banned word" in e for e in devsim.check_plan(bad))


def test_floodlights_are_not_a_banned_word():
    assert not devsim.BANNED.search("Floodlights on the crane at night")
    assert devsim.BANNED.search("a flood here")


@seed_only
def test_no_banned_words_anywhere_in_the_plan():  # AC-H4
    text = _plan().model_dump_json()
    assert not devsim.BANNED.search(text)
    assert not re.search(r"\bSDP project\b", text.replace("not an SDP project", ""))


@seed_only
@pytest.mark.parametrize(
    "rel",
    [
        "apps/web/src/features/devsim/fixtures/plan.elmina.json",
        "apps/web/e2e/fixtures/devsim-plan.json",
    ],
)
def test_committed_web_fixtures_equal_the_built_plan(rel):
    """Regenerate with `python -m townshiplens_spatial.devsim --dump <path>` + biome format."""
    got = DevelopmentPlan.model_validate_json((ROOT / rel).read_text(encoding="utf-8"))
    assert got == _plan()
