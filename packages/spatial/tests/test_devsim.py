"""Development Simulation plan (spec 2026-10-21 §3, §5.1; demo polish §6; AC-H1, H2, H4, H5, H6,
AC-C8).

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
    names = {"park": ["Elmina Urban Park"], "mall": ["Elmina Lakeside Mall", devsim.TARGET_NAME]}
    for walk, kind in ((facts.park, "park"), (facts.mall, "mall")):
        pids = [p.id for p in world.places.values() if p.name in names[kind]]
        routes = [routing.plan_route(tw, devsim.TOWER_PLACE, pid, "default") for pid in pids]
        r = min((x.routes[0] for x in routes if x.routes), key=lambda r: r.distance_m)
        assert walk.m == round(r.distance_m)
        assert walk.min == max(1, math.floor(r.distance_m / _pace(world) + 0.5))
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
    # from distances at the profile pace, never from the 0.1-rounded est_minutes
    real = (after.distance_m - before.distance_m) / _pace(world)
    assert d.detour_min == math.floor(real + 0.5)
    assert d.detour_min >= 2
    assert len(d.before_path) == len(before.geometry["coordinates"])  # full, not clipped
    assert len(d.after_path) == len(after.geometry["coordinates"])


def _pace(world) -> float:
    """Metres per minute of the default profile (independent of devsim.walk_minutes)."""
    kmh = world.profiles["default"].speed_kmh
    return kmh * 1000 / 60 if kmh else 70.0


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
    assert [c.name for c in cast if c.id != "worker"] == BASELINE
    assert {c.id: c.home for c in cast} == {
        "halim": "existing",
        "farid": "existing",
        "worker": "site",
        "meiling": "tower",
        "zainab": "tower",
        "arjun": "tower",
    }
    assert "child" in next(c for c in cast if c.id == "meiling").persona
    assert devsim.build_cast(world, plan.site) == (households, cast)
    assert all(re.fullmatch(r"#[0-9a-f]{6}", c.colour) for c in cast)
    assert not any(re.search(r"\d", c.persona) for c in cast)


# ---- BE4 / C7: the 45 s plan ------------------------------------------------------------------
@seed_only
def test_the_plan_matches_the_45s_timeline_and_passes_its_check():  # AC-C8
    plan = _plan()
    assert devsim.check_plan(plan) == []
    assert plan.world == "elmina" and plan.provisional is False and plan.total_s == 45
    assert [(a.name, a.t0, a.t1) for a in plan.acts] == [
        ("Brief", 0, 3),
        ("Construction", 3, 27),
        ("Handover", 27, 33),
        ("Daily Life", 33, 45),
    ]
    f = plan.facts
    d = f.detour
    # Spec §6.3 windows; the school-run bubble (and its envelope beat) is gone.
    assert [(b.n, b.who, b.t0, b.t1, b.tone) for b in plan.bubbles] == [
        (1, "halim", 5.5, 9.0, "neg"),
        (2, "farid", 14.0, 16.5, "neg"),
        (3, "worker", 19.5, 22.5, "neg"),
        (4, "meiling", 28.5, 31.5, "pos"),
        (5, "halim", 31.0, 33.0, "pos"),
        (6, "zainab", 34.0, 37.0, "pos"),
        (7, "arjun", 36.5, 39.0, "pos"),
    ]
    b = plan.bubbles
    assert not any("school" in x.text.lower() for x in b)
    assert b[2].text == "Hujan lagi, crane stop."
    assert b[0].tag == f"ROUTE ENGINE · +{d.detour_min} min walk · {d.before_m:,} → {d.after_m:,} m"
    assert b[5].text == f"Park in {f.park.min} min, love it"
    assert b[5].tag == f"ROUTE ENGINE · {f.park.m:,} m · {f.park.min} min walk"
    assert b[6].tag == f"ROUTE ENGINE · {f.mall.m:,} m · {f.mall.min} min walk to {f.mall.label}"
    assert [x.tag for x in b[1:5]] == [None] * 4
    assert all(len(x.text.split()) <= 8 for x in b[1:])
    assert len(b[0].text.split()) <= 9
    assert {c.id for c in plan.cast} >= {x.who for x in b}
    assert [(t.kind, t.t0, t.t1) for t in plan.tags] == [
        ("detour", 4.0, 9.5),
        ("lorry", 8.5, 12.5),
    ]
    assert [(x.kind, x.t0, x.t1) for x in plan.banners] == [
        ("raya", 11.0, 13.0),
        ("monsoon", 18.5, 23.0),
        ("handover", 27.0, 30.5),
    ]
    assert plan.labels.hypothetical == (
        "Hypothetical tower · not an SDP project · 30 storeys · ~500 homes"
    )
    a = plan.anchors
    assert len(a.halim_path) > 10
    assert a.park == f.park.path[-1]
    assert DevelopmentPlan.model_validate_json(plan.model_dump_json()) == plan
    assert "end_card" not in plan.model_dump()


@seed_only
def test_the_plan_carries_the_impact_modules_unchanged():  # AC-C8 (C1, C2, C4, C5, C6 outputs)
    from townshiplens_spatial import devsim_impact as di
    from townshiplens_spatial import devsim_schedule as ds
    from townshiplens_spatial.devsim_residents import build_residents

    world, plan = _world(), _plan()
    site = plan.site
    assert plan.impact == di.hoarding_impact(world, site)
    assert plan.lorry_route == di.lorry_route(world, site)
    assert plan.flood == di.flood_exposure(world, site)
    assert plan.access_matrix == di.daily_life_matrix(world, site)
    assert plan.schedule == ds.schedule(site.storeys, site.homes)
    assert plan.residents == build_residents(world, site, detour_home=plan.facts.detour.home_id)
    assert [s.id for s in plan.estimate_sources] == plan.schedule.source_ids
    by_id = {s.id: s for s in ds.SOURCES}
    for s in plan.estimate_sources:
        src = by_id[s.id]
        assert (s.value, s.unit, s.kind, s.label) == (src.value, src.unit, src.kind, src.label)
    rs = plan.residents.residents
    assert len(rs) == 40 and plan.residents.label == "Simulated reactions"
    halim = next(r for r in rs if r.id == "halim")
    assert halim.facts.extra_walk_min == plan.facts.detour.detour_min


@seed_only
def test_one_mall_arrival_for_facts_matrix_and_arjun():  # ruling R18
    plan = _plan()
    f = plan.facts
    mall = next(r for r in plan.access_matrix.rows if r.target.kind == "mall")
    cell = mall.cells[plan.access_matrix.profiles.index("default")]
    assert (f.mall.min, f.mall.m, f.mall.arrival_id, f.mall.label) == (
        cell.value,
        cell.m,
        cell.arrival_id,
        cell.label,
    )
    assert f.mall.label in ("Lakeside Mall", "Lakeside Mall (Car Park B)")
    assert (f.mall.label == "Lakeside Mall (Car Park B)") == (f.mall.arrival_id == "park-b")
    arjun = plan.bubbles[6]
    assert f"{f.mall.min} min" in arjun.text and f.mall.label in arjun.tag


@seed_only
def test_month_keys_follow_the_spec_windows():  # ruling R25, spec §6.3
    plan = _plan()
    s = plan.schedule
    keys = dict(plan.month_keys)
    assert plan.month_keys_mode == "baseline"
    raya = devsim._month_of(s.start, s.raya_set_piece.date)
    h = devsim._month_of(s.start, s.handover)
    mon0 = s.monsoon_set_piece.months[0].month_index
    assert plan.month_keys[0] == (0.0, 0.0) and keys[3.0] == 0
    assert keys[11.0] == keys[13.0] == round(raya, 4)
    assert keys[18.5] == mon0
    # the slow stretch ends at least a month before handover, so 23-27 s still advances
    assert keys[23.0] == round(min(s.monsoon_set_piece.months[-1].month_index + 1, h - 1), 4)
    assert keys[23.0] <= keys[27.0] - 1
    assert keys[27.0] == keys[45.0] == round(h, 4)
    assert int(keys[27.0]) == s.months_total - 1  # the handover month
    assert [t for t, _ in plan.month_keys] == sorted(t for t, _ in plan.month_keys)


def test_month_keys_fall_back_to_data_order_when_raya_is_inside_the_monsoon():
    from townshiplens_spatial import devsim_schedule as ds

    s = ds.schedule()
    inside = next(b for b in s.monsoon_bands if b.start_index <= s.raya_set_piece.month_index)
    months = [
        m.model_copy(update={"month_index": i, "month": s.months[i]})
        for i, m in zip(
            range(inside.start_index, inside.end_index + 1),
            s.monsoon_set_piece.months,
            strict=False,
        )
    ]
    alt = s.model_copy(
        update={"monsoon_set_piece": s.monsoon_set_piece.model_copy(update={"months": months})}
    )
    keys, mode = devsim.month_keys(alt)
    assert mode == "data-order"
    assert keys[0] == (0.0, 0.0) and keys[1] == (3.0, 0.0) and keys[-1][0] == 45.0
    assert all(b[0] >= a[0] and b[1] >= a[1] for a, b in zip(keys, keys[1:], strict=False))
    holds = [(a, b) for a, b in zip(keys, keys[1:], strict=False) if a[1] == b[1] and b[0] > a[0]]
    assert any(abs(b[0] - a[0] - 2) < 1e-6 for a, b in holds)  # the 2 s Raya hold
    assert dict(keys)[45.0] == round(devsim._month_of(s.start, s.handover), 4)


@seed_only
def test_brief_sections_and_copy():  # spec §6.2 Impact Brief, rulings R16, R17
    plan = _plan()
    br = plan.brief
    assert [s.key for s in br.sections] == ["construction", "handover", "daily_life"]
    assert [s.title for s in br.sections] == [
        "During construction",
        "At handover",
        "Daily life (walk minutes)",
    ]
    rows = {r.key: r for s in br.sections for r in s.rows}
    im, sch, fl, lr = plan.impact, plan.schedule, plan.flood, plan.lorry_route
    assert rows["homes_2min_plus"].value == (
        f"{im.homes_2min_plus} of {im.homes_considered} · up to +{im.max_extra_min} min"
    )
    assert rows["wheelchair_links_cut"].value == f"{im.wheelchair_links_cut} homes"
    if len(im.options) == 1:  # fix round 1: one side is "Hoarded side", not a comparison
        assert (rows["best_side"].label, rows["best_side"].value) == ("Hoarded side", im.best_side)
    assert rows["duration"].badges == ["ESTIMATE"] and rows["cost"].badges == ["ESTIMATE"]
    assert rows["cost"].value == f"RM {round(sch.cost_total_rm / 1e6)} M"
    assert rows["days_lost"].value == (
        f"{sch.holiday_days_lost} · {sch.raya_shutdown_days} · {sch.rain_days_lost}"
    )
    # R16: the lorry row and tag name the first sensitive place and its kind, never a school
    # that is not there.
    first = lr.sensitive[0]
    assert rows["lorry"].label == f"Lorry route passes a {first.type}"
    assert first.name in rows["lorry"].value
    lorry_tag = next(t for t in plan.tags if t.kind == "lorry")
    assert lorry_tag.text == f"Passes a {first.type}: {first.name}"
    if first.type not in ("school", "kindergarten"):
        assert "school" not in (lorry_tag.text + rows["lorry"].label).lower()
    # R17 / AC-C5: the cut scenario, or the highest scenario actually checked.
    if fl.cut_from_scenario:
        assert rows["flood_cut"].value == f"+{fl.cut_from_scenario[7]} m scenario"
    else:
        assert rows["flood_cut"].value == f"Not cut up to +{fl.scenarios_checked[-1][7]} m"
    assert rows["flood_cut"].badges == ["FLOOD"]
    ev = fl.evacuation
    assert rows["evacuation"].value == f"{ev.name} · {ev.min} min walk"
    assert ("official" in rows["evacuation"].label.replace("not official", "")) == (
        ev.source == "official_pps"
    )
    hand = br.sections[1]
    assert hand.notes[0].startswith("Indicative scenario, not a forecast.")
    daily = br.sections[2]
    assert daily.rows == []
    cells = {c.value for r in plan.access_matrix.rows for c in r.cells}
    assert ("?" in cells) == any(n.startswith("? =") for n in daily.notes)


@seed_only
def test_monsoon_and_raya_banners_quote_the_schedule():  # spec §6.2 set pieces
    plan = _plan()
    s = plan.schedule
    raya, mon, hand = plan.banners
    assert raya.title == f"Hari Raya Aidilfitri · site closed ~{s.raya_set_piece.days} days"
    wet = sorted({m.wet_days for m in s.monsoon_set_piece.months})
    assert f"{wet[0]}–{wet[-1]} wet days a month" in mon.text
    assert all(m.days_lost == 0 for m in s.monsoon_set_piece.months)  # a fit-out band
    # Ruling R36: a band outside structure work says it adds no schedule days now.
    assert mon.text == (
        f"{wet[0]}–{wet[-1]} wet days a month (typical) · fit-out stage: rain adds no schedule"
        f" days now · structure work lost ~{s.rain_days_lost} days to rain"
    )
    assert hand.title == f"Handover · keys to ~{plan.site.homes} homes"
    assert all(b.badges == ["CALENDAR", "ESTIMATE"] for b in (raya, mon))


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
def test_no_detour_drops_the_tag():  # spec §13
    plan = _plan()
    facts = plan.facts.model_copy(update={"detour": None})
    _, bubbles, anchors = devsim.build_beats(_world(), plan.site, facts)
    assert bubbles[0].tag is None and not re.search(r"\d", bubbles[0].text)
    tags = devsim._tags(_world(), plan.impact, plan.lorry_route, facts)
    alt = plan.model_copy(
        update={"facts": facts, "bubbles": bubbles, "anchors": anchors, "tags": tags}
    )
    assert devsim.check_plan(alt) == []


# Every copy slot as (where, getter, setter), for the mutation tests.
def _slots(plan):
    out = []
    for i, b in enumerate(plan.bubbles):
        out.append((f"bubble {b.n}", ("bubbles", i, "text")))
        if b.tag:
            out.append((f"bubble {b.n} tag", ("bubbles", i, "tag")))
    for i, t in enumerate(plan.tags):
        out.append((f"tag {t.kind}", ("tags", i, "text")))
    for i, b in enumerate(plan.banners):
        out += [(f"banner {b.kind}", ("banners", i, "title"))]
        out += [(f"banner {b.kind}", ("banners", i, "text"))]
    for si, s in enumerate(plan.brief.sections):
        for ri, r in enumerate(s.rows):
            out += [(f"brief {r.key}", ("brief", si, ri, "label"))]
            out += [(f"brief {r.key}", ("brief", si, ri, "value"))]
    return out


def _get(plan, path):
    if path[0] == "brief":
        _, si, ri, field = path
        return getattr(plan.brief.sections[si].rows[ri], field)
    kind, i, field = path
    return getattr(getattr(plan, kind)[i], field)


def _set(plan, path, value):
    p = plan.model_copy(deep=True)
    if path[0] == "brief":
        _, si, ri, field = path
        setattr(p.brief.sections[si].rows[ri], field, value)
    else:
        kind, i, field = path
        setattr(getattr(p, kind)[i], field, value)
    return p


def _numbered_slots(plan):
    return [s for s in _slots(plan) if re.search(r"\d", _get(plan, s[1]))]


def test_numbered_slots_cover_every_brief_tag_and_banner_number():
    """Every digit-bearing copy string of the new fields is a mutation target."""
    if not HAS_SEED:
        pytest.skip("Elmina seed not built")
    plan = _plan()
    where = {w for w, _ in _numbered_slots(plan)}
    assert {"tag detour", "banner raya", "banner monsoon", "banner handover"} <= where
    assert {"brief homes_2min_plus", "brief duration", "brief days_lost", "brief cost"} <= where
    assert {"brief flood_cut", "brief evacuation", "brief wheelchair_links_cut"} <= where


@seed_only
@settings(max_examples=120, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(data=st.data())
def test_a_mutated_number_fails_the_check(data):  # AC-H2, AC-C8
    plan = _plan()
    slot = data.draw(st.sampled_from(_numbered_slots(plan)))
    text = _get(plan, slot[1])
    runs = list(re.finditer(r"\d(?:[\d,]*\d)?", text))
    m = runs[data.draw(st.integers(0, len(runs) - 1))]
    old = int(m.group(0).replace(",", ""))
    new = data.draw(st.integers(0, 99_999).filter(lambda v: v != old))
    rep = f"{new:,}" if data.draw(st.booleans()) else str(new)
    bad = _set(plan, slot[1], text[: m.start()] + rep + text[m.end() :])
    assert devsim.check_plan(bad), (slot, rep)


@seed_only
@given(n=st.integers(1, 5), digit=st.integers(0, 9), at=st.integers(0, 40))
@settings(max_examples=30, deadline=None)
def test_a_digit_in_bubbles_one_to_five_fails_the_check(n, digit, at):  # AC-H2
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
    bad.bubbles[3].text = f"We got our keys {word}"
    assert any("banned word" in e for e in devsim.check_plan(bad))
    bad = _plan().model_copy(deep=True)
    bad.brief.sections[1].rows[0].value = f"+1 m scenario, {word}"
    assert any("banned word" in e for e in devsim.check_plan(bad))


def test_floodlights_are_not_a_banned_word():
    assert not devsim.BANNED.search("Floodlights on the crane at night")
    assert devsim.BANNED.search("a flood here")


@seed_only
def test_no_banned_words_anywhere_in_the_plan():  # AC-H4
    """The whole plan JSON, apart from the flood-exposure data's own field name and the FLOOD
    badge, says no banned word (no "safe", no depth, no flood wording in any copy)."""
    plan = _plan()
    text = plan.model_dump_json(exclude={"flood"}).replace('"FLOOD"', "")
    text = text.replace('"flood_cut"', "")
    assert not devsim.BANNED.search(text)
    assert not devsim.BANNED.search(plan.flood.disclaimer)
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


@seed_only
@settings(max_examples=60, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(data=st.data())
def test_a_swapped_fact_value_fails_the_check(data):  # AC-H2: per-slot facts
    """Another value of the same slot or of another slot in its place must fail."""
    plan = _plan()
    slots = _numbered_slots(plan)
    values = sorted(
        {int(v.replace(",", "")) for _, p in slots for v in re.findall(r"\d[\d,]*", _get(plan, p))}
    )
    slot = data.draw(st.sampled_from(slots))
    text = _get(plan, slot[1])
    runs = list(re.finditer(r"\d(?:[\d,]*\d)?", text))
    m = runs[data.draw(st.integers(0, len(runs) - 1))]
    old = int(m.group(0).replace(",", ""))
    new = data.draw(st.sampled_from([v for v in values if v != old]))
    rep = data.draw(st.sampled_from([f"{new:,}", str(new)]))
    bad = _set(plan, slot[1], text[: m.start()] + rep + text[m.end() :])
    assert devsim.check_plan(bad), (slot, rep)


@seed_only
def test_bubble_one_text_may_not_quote_a_fact():
    plan = _plan()
    bad = plan.model_copy(deep=True)
    bad.bubbles[0].text = f"Footpath closed lah, {plan.facts.park.m} m more"
    assert any("bubble 1" in e for e in devsim.check_plan(bad))
    bad = plan.model_copy(deep=True)
    bad.bubbles[5].text = f"Park in {plan.facts.mall.min} min, love it"
    assert plan.facts.mall.min != plan.facts.park.min
    assert any("bubble 6" in e for e in devsim.check_plan(bad))


# ---- C7: the data behind the copy must agree with itself ---------------------------------------
def _mutations():
    def impact_count(p):
        p.impact.homes_2min_plus += 1

    def impact_max(p):
        p.impact.max_extra_min += 1

    def wheelchair(p):
        p.impact.wheelchair_links_cut += 1

    def cost(p):
        p.schedule.cost_by_month[-1] += 1

    def floors(p):
        p.schedule.floors_by_month[-1] -= 1

    def lost(p):
        p.schedule.days_lost_by_month[-1] += 5

    def keys(p):
        p.month_keys[3] = (p.month_keys[3][0], p.month_keys[3][1] + 1)

    def matrix(p):
        p.access_matrix.rows[0].cells[0].value = "?"

    def mall(p):
        p.facts.mall.arrival_id = "lakeside-mall-elsewhere"

    def flood(p):
        p.flood.cut_from_scenario = "stage_p9m"

    def resident_line(p):
        r = p.residents.residents[0]
        r.lines.daily_life = r.lines.daily_life + " 987 min"

    def resident_walk(p):
        r = p.residents.residents[0]
        w = r.facts.walks[0]
        w.value = 99 if w.value != 99 else 98

    def neighbour(p):
        r = next(x for x in p.residents.residents if x.facts.extra_walk_min is not None)
        r.facts.extra_walk_min += 7

    def sources(p):
        p.estimate_sources = p.estimate_sources[1:]

    def playground(p):
        p.playground.walk_min += 9

    def best_side(p):
        worse = p.impact.options[0].model_copy(
            update={"side": "south-west", "homes_2min_plus": p.impact.homes_2min_plus + 5}
        )
        p.impact.options.append(worse)
        p.impact.best_side = "south-west"

    return [
        impact_count,
        impact_max,
        wheelchair,
        cost,
        floors,
        lost,
        keys,
        matrix,
        mall,
        flood,
        resident_line,
        resident_walk,
        neighbour,
        sources,
        best_side,
        playground,
    ]


@seed_only
@pytest.mark.parametrize("mutate", _mutations(), ids=lambda f: f.__name__)
def test_inconsistent_data_fails_the_check(mutate):  # AC-C8: check_plan covers every number
    bad = _plan().model_copy(deep=True)
    mutate(bad)
    assert devsim.check_plan(bad), mutate.__name__


@seed_only
def test_the_plan_names_the_nearest_playground():  # spec §6.2 move-in, AC-W5
    world, plan = _world(), _plan()
    pg = plan.playground
    assert pg is not None
    tw = devsim.tower_world(world, plan.site)
    walks = {}
    for p in world.places.values():
        if p.type == "playground" and p.node_id:
            r = routing.plan_route(tw, devsim.TOWER_PLACE, p.id, "default")
            if r.routes:
                walks[p.id] = r.routes[0].distance_m
    nearest = min(walks, key=lambda k: (walks[k], k))
    place = world.places[nearest]
    assert (pg.id, pg.name, pg.node_id) == (place.id, place.name, place.node_id)
    assert [pg.lon, pg.lat] == [round(v, 7) for v in place.coord[:2]]
    assert pg.m == round(walks[nearest])
    assert pg.walk_min == max(1, math.floor(walks[nearest] / _pace(world) + 0.5))
