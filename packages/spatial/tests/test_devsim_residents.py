"""Forty simulated residents for the Development Simulation (demo polish spec §6.1.6; AC-C7)."""

import re
from functools import cache
from pathlib import Path

import pytest
from townshiplens_spatial import devsim, devsim_impact, devsim_residents
from townshiplens_spatial import devsim_lines as L
from townshiplens_spatial.day import spotlight as spot
from townshiplens_spatial.devsim_models import ResidentFacts, ResidentWalk
from townshiplens_spatial.world import load_world

ROOT = Path(__file__).resolve().parents[3]
SEED = ROOT / "data" / "seed" / "elmina"
seed_only = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")
CAST = ["Pak Cik Halim", "Farid", "Mei Ling", "Mak Cik Zainab", "Arjun"]
PLACEHOLDER = re.compile(r"\{(\w+)\}")


# ---- the template library ------------------------------------------------------------------------
def _all_templates():
    for key, opts in L.OPENERS.items():
        yield key, opts
    for key, opts in L.TAILS.items():
        yield key, opts
    for key, opts in L.DAILY.items():
        yield ("daily", key), opts


def test_every_key_has_six_variants():
    for key, opts in _all_templates():
        assert len(opts) >= 6, key
        assert len(set(opts)) == len(opts), key
    for group in L.TOPICS:
        for phase in ("construction",):
            assert (group, phase) in L.TAILS
        for side in ("tower", "neighbour"):
            assert (group, "handover", side) in L.TAILS
        for tone in ("pos", "neg"):
            assert L.WHY[(group, tone)]
    for side in ("tower", "neighbour"):
        for phase in ("construction", "handover"):
            for tone in ("pos", "neg"):
                assert (side, phase, tone) in L.OPENERS


def test_templates_hold_no_numbers_or_banned_words():
    for key, opts in _all_templates():
        for text in opts:
            bare = PLACEHOLDER.sub("", text)
            assert not re.search(r"\d", bare), (key, text)
            assert not spot.BANNED.search(bare), (key, text)
            assert not devsim.BANNED.search(bare), (key, text)
            assert not spot.NUMBER_WORDS.search(bare), (key, text)
            assert set(PLACEHOLDER.findall(text)) <= {"extra", "to", "place", "n", "why", "who"}
    for opts in L.WHY.values():
        for text in opts:
            assert not re.search(r"\d", text) and not spot.BANNED.search(text)


def _w(kind, name, value, label=None):
    return ResidentWalk(kind=kind, name=name, value=value, arrival_id="x", label=label or name)


def _facts(**kw):
    walks = [
        _w("park", "Elmina Urban Park", 9),
        _w("mall", "Elmina Lakeside Mall", "?", "Lakeside Mall (Car Park B)"),
        _w("clinic", "Klinik Siti", "gap"),
        _w("school", "Seven Skies Islamic School", 23),
    ]
    return ResidentFacts(profile="default", home_id="w1", walks=walks, **kw)


def test_check_line_rules():
    f = _facts(extra_walk_min=3, extra_walk_to="Elmina Lakeside Mall")
    ok = devsim_residents.check_line
    assert ok("Urban Park in 9 min, and 3 min more to the mall.", f) == []
    assert ok("Seven Skies Islamic School is 23 min away.", f) == []  # a name is not a number
    assert ok("The mall is 12 min away.", f)  # 12 is not a fact
    assert ok("Urban Park is 9.5 min away.", f)
    assert ok("The path is safe.", f)
    assert ok("Water was knee high.", f)
    assert ok("It took five min.", f)
    assert ok("x" * 221, f)


# ---- Elmina --------------------------------------------------------------------------------------
@cache
def _world():
    return load_world(SEED)


@cache
def _site():
    return devsim.place_tower(_world())


@cache
def _residents():
    return devsim_residents.build_residents(_world(), _site())


@seed_only
def test_forty_residents():  # AC-C7
    rs = _residents().residents
    assert len(rs) == 40
    assert [r.side for r in rs].count("tower") == 20
    assert [r.side for r in rs].count("neighbour") == 20
    names = [r.name for r in rs]
    assert len(set(names)) == 40 and len({r.id for r in rs}) == 40
    for n in CAST:
        assert n in names
    by = {r.id: r for r in rs}
    assert {by[c].side for c in ("meiling", "zainab", "arjun")} == {"tower"}
    assert {by[c].side for c in ("halim", "farid")} == {"neighbour"}
    assert len({r.colour for r in rs}) == 40
    assert _residents().label == "Simulated reactions"
    assert "every number comes from the world model" in _residents().note


@seed_only
def test_a_varied_cast():
    rs = _residents().residents
    tags = [t for r in rs for t in r.tags]
    for want in ("wheelchair", "toddler", "older", "commuter", "children", "teen"):
        assert want in tags, want
    assert len({r.group for r in rs}) == 5
    assert {r.facts.profile for r in rs} == {"default", "stroller", "wheelchair"}


@seed_only
def test_every_line_passes_its_check():  # AC-C7
    for r in _residents().residents:
        lines = r.lines.model_dump()
        assert set(lines) == {"construction", "handover", "daily_life"}
        for phase, text in lines.items():
            assert text and len(text) <= 220, (r.id, phase)
            assert devsim_residents.check_line(text, r.facts) == [], (r.id, phase, text)


@seed_only
def test_no_two_residents_share_all_three_lines():  # AC-C7
    triples = [
        (r.lines.construction, r.lines.handover, r.lines.daily_life) for r in _residents().residents
    ]
    assert len(set(triples)) == len(triples)


@seed_only
def test_same_seed_same_output():  # AC-C7
    a = _residents().model_dump()
    devsim_impact.clear_cache()
    b = devsim_residents.build_residents(_world(), _site()).model_dump()
    assert a == b


@seed_only
def test_facts_come_from_the_world_model():
    w, site = _world(), _site()
    impact = devsim_impact.hoarding_impact(w, site)
    rows = {h.home_id: h for h in impact.homes}
    matrix = devsim_impact.daily_life_matrix(w, site)
    for r in _residents().residents:
        f = r.facts
        assert [x.kind for x in f.walks] == ["park", "mall", "clinic", "school"]
        if r.side == "tower":
            assert f.home_id is None and f.extra_walk_min is None
            i = matrix.profiles.index(f.profile)
            assert [x.value for x in f.walks] == [
                next(row for row in matrix.rows if row.target.kind == k).cells[i].value
                for k in ("park", "mall", "clinic", "school")
            ]
        else:
            assert f.home_id in rows  # a home within 500 m of the tower
            assert f.extra_walk_min == rows[f.home_id].extra_min
        if f.profile == "wheelchair":
            assert "wheelchair" in r.tags or r.id in ("halim", "farid")
        for x in f.walks:
            assert isinstance(x.value, int) or x.value in ("?", "gap", "blocked")


@seed_only
def test_detour_lines_quote_the_hoarding_summary():
    for r in _residents().residents:
        e = r.facts.extra_walk_min
        if r.side == "neighbour" and e is not None and e >= 2:
            assert f"{e} min" in r.lines.construction, r.id
        if r.side == "tower":
            assert not re.search(r"\d", r.lines.construction + r.lines.handover), r.id


@seed_only
def test_daily_line_tells_the_walk_as_the_engine_found_it():
    """Minutes only for a checked walk; "?" is told as not checked, "gap" as a map gap,
    "blocked" as a known barrier, never with minutes."""
    for r in _residents().residents:
        d = r.lines.daily_life
        w = next(x for x in r.facts.walks if devsim_residents._place(x).lower() in d.lower())
        if isinstance(w.value, int):
            assert f"{w.value} min" in d, (r.id, d)
            continue
        assert not re.search(r"\d", d), (r.id, d)
        word = {"?": "check", "gap": "map", "blocked": "barrier"}[w.value]
        assert word in d.lower(), (r.id, d)


@seed_only
def test_halim_lives_in_the_detour_home():
    d = devsim.compute_facts(_world(), _site()).detour
    rs = devsim_residents.build_residents(_world(), _site(), detour_home=d.home_id)
    halim = next(r for r in rs.residents if r.id == "halim")
    assert halim.facts.home_id == d.home_id
    assert halim.facts.extra_walk_min == d.detour_min


@seed_only
def test_at_most_two_neighbours_per_building():  # review M1
    from collections import Counter

    homes = Counter(r.facts.home_id for r in _residents().residents if r.side == "neighbour")
    assert max(homes.values()) <= devsim_residents.MAX_PER_BUILDING
    assert len(homes) >= 10  # spread over many buildings


@seed_only
def test_unknown_detour_home_is_an_error():  # review M4
    with pytest.raises(ValueError, match="not a home within 500 m"):
        devsim_residents.build_residents(_world(), _site(), detour_home="w-not-a-home")


@seed_only
def test_school_run_parents_get_that_role():  # review M5
    roles = {r.role for r in _residents().residents}
    assert "parent doing the school run" in roles


@seed_only
def test_one_mall_walk_one_name():  # ruling R18
    """The mall walk a line quotes is named by where it arrives: the same walk, the same name."""
    for r in _residents().residents:
        f = r.facts
        mall = next(x for x in f.walks if x.kind == "mall")
        assert mall.label in ("Lakeside Mall", "Lakeside Mall (Car Park B)")
        assert mall.label == (
            "Lakeside Mall" if mall.arrival_id == "lakeside-mall" else "Lakeside Mall (Car Park B)"
        )
        if (f.extra_walk_min or 0) >= 2:
            assert f.extra_walk_to in r.lines.construction
            if f.extra_walk_to.startswith("Lakeside Mall"):
                want = (
                    "Lakeside Mall"
                    if f.extra_walk_arrival == "lakeside-mall"
                    else "Lakeside Mall (Car Park B)"
                )
                assert f.extra_walk_to == want
        if "Lakeside Mall" in r.lines.daily_life:
            assert mall.label in r.lines.daily_life
            if isinstance(mall.value, int):
                assert f"{mall.value} min" in r.lines.daily_life
