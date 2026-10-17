import copy
import json
import math

import pytest

from data.scripts import build_archetypes as ba

LAT0 = 3.18
LON0 = 101.5
KX = ba.M_PER_DEG * math.cos(math.radians(LAT0))


def rect(w_m: float, l_m: float, lon=LON0, lat=LAT0, angle_deg: float = 0.0) -> list[list[float]]:
    """Closed lon/lat ring of a w x l metre rectangle (w along x before rotation)."""
    a = math.radians(angle_deg)
    pts = []
    for x, y in ((0, 0), (w_m, 0), (w_m, l_m), (0, l_m)):
        rx, ry = x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)
        pts.append([lon + rx / KX, lat + ry / ba.M_PER_DEG])
    return [*pts, pts[0]]


def metrics(w: float, l: float, fill: float = 1.0) -> dict:  # noqa: E741
    return {"width_m": w, "length_m": l, "area_m2": w * l * fill, "fill": fill}


def props(kind="residential", name=None, **osm) -> dict:
    p = {"id": "w1", "kind": kind, "height_m": 8.0, "height_source": "default", "osm": osm}
    if name:
        p["name"] = name
    return p


# --- shape --------------------------------------------------------------------------


def test_shape_metrics_of_a_rectangle():
    m = ba.shape_metrics(rect(6.1, 21.3))
    assert m["width_m"] == pytest.approx(6.1, abs=0.05)
    assert m["length_m"] == pytest.approx(21.3, abs=0.05)
    assert m["area_m2"] == pytest.approx(6.1 * 21.3, rel=0.01)
    assert m["fill"] == pytest.approx(1.0, abs=0.01)


def test_shape_metrics_rotated_and_l_shaped():
    m = ba.shape_metrics(rect(6.1, 21.3, angle_deg=33))
    assert m["width_m"] == pytest.approx(6.1, abs=0.05)
    assert m["fill"] == pytest.approx(1.0, abs=0.01)
    # L shape: 20x20 square minus a 10x10 corner -> fill 0.75
    pts = [(0, 0), (20, 0), (20, 10), (10, 10), (10, 20), (0, 20)]
    ring = [[LON0 + x / KX, LAT0 + y / ba.M_PER_DEG] for x, y in pts]
    m = ba.shape_metrics([*ring, ring[0]])
    assert m["fill"] == pytest.approx(0.75, abs=0.01)


# --- assign rules -------------------------------------------------------------------


def test_rule1_override_wins():
    over = {"w1": {"archetype": "mall", "note": "checked"}}
    assert ba.assign(
        props(building="mosque"), metrics(6, 20), None, None, None, overrides=over
    ) == (
        "mall",
        "override",
    )


def test_rule1_override_with_unknown_archetype_is_rejected():
    with pytest.raises(ValueError):
        ba.assign(props(), metrics(6, 20), None, None, None, overrides={"w1": "castle"})


def test_rule2_mosque():
    assert ba.assign(props(building="mosque"), metrics(30, 30), None, None, None) == (
        "mosque",
        "osm_tag",
    )
    p = props(kind="civic", name="Masjid Elmina", amenity="place_of_worship", religion="muslim")
    assert ba.assign(p, metrics(30, 30), None, None, None) == ("mosque", "osm_tag")


def test_rule2_surau_stays_generic():
    p = props(kind="civic", name="Surau Al Falah", amenity="place_of_worship", religion="muslim")
    assert ba.assign(p, metrics(12, 15), None, None, None) == ("generic", "generic")


def test_rule3_school():
    school = props(kind="civic", building="school")
    assert ba.assign(school, metrics(20, 60), None, None, None) == ("school", "osm_tag")
    assert ba.assign(
        props(kind="civic", amenity="kindergarten"), metrics(9, 9), None, None, None
    ) == (
        "school",
        "osm_tag",
    )
    named = props(kind="other", name="SK Elmina")
    assert ba.assign(named, metrics(20, 60), None, None, None) == ("school", "osm_tag")
    sky = props(name="SKY Residence")
    assert ba.assign(sky, metrics(20, 60), None, None, None) == ("generic", "generic")


def test_rule4_factory():
    assert ba.assign(props(kind="industrial"), metrics(40, 60), None, None, None) == (
        "factory",
        "osm_tag",
    )
    assert ba.assign(props(kind="other"), metrics(40, 60), None, "industrial", None) == (
        "factory",
        "landuse",
    )


def test_rule5_highrise():
    assert ba.assign(props(kind="other"), metrics(30, 30), None, None, 31.0) == (
        "highrise",
        "height",
    )
    apt = props(building="apartments")
    assert ba.assign(apt, metrics(30, 30), None, None, 21.0) == ("highrise", "height")
    assert ba.assign(props(kind="other"), metrics(30, 30), None, None, 21.0) == (
        "generic",
        "generic",
    )


def test_rule6_mall_and_shop_office():
    assert ba.assign(props(kind="commercial"), metrics(60, 80), None, None, None) == (
        "mall",
        "osm_tag+size",
    )
    assert ba.assign(props(kind="other"), metrics(20, 60), None, "commercial", None) == (
        "shop_office",
        "shape",
    )
    # commercial but not a row and small: falls through to generic
    assert ba.assign(props(kind="commercial"), metrics(20, 30), None, None, None) == (
        "generic",
        "generic",
    )


def test_rule7_bungalow_and_townhouse():
    assert ba.assign(props(building="detached"), metrics(15, 20), None, None, None) == (
        "bungalow",
        "osm_tag",
    )
    # too big for a bungalow
    big = props(building="house")
    assert ba.assign(big, metrics(30, 30), None, None, None) == ("generic", "generic")
    assert ba.assign(props(building="townhouse"), metrics(8, 20), None, None, None) == (
        "townhouse",
        "osm_tag",
    )


@pytest.mark.parametrize(
    ("w", "l", "precinct", "expected"),
    [
        (6.1, 21.3, None, ("link_intermediate", "shape")),
        (6.5, 24.4, None, ("link_long", "shape")),
        (11.0, 21.0, "Elmina Ridge", ("superlink", "shape+precinct")),
        (12.2, 24.4, None, ("semi_d", "shape")),
        (20.0, 120.0, None, ("link_intermediate", "shape")),  # row, depth 20
        (24.0, 120.0, None, ("link_long", "shape")),  # row, depth 24
    ],
)
def test_rule8_residential_shapes(w, l, precinct, expected):  # noqa: E741
    assert ba.assign(props(), metrics(w, l), precinct, "residential", None) == expected


def test_rule8_needs_residential_landuse_and_fill():
    # 6.1 x 21.3 outside residential landuse: prefer generic over a guess
    assert ba.assign(props(), metrics(6.1, 21.3), None, None, None) == ("generic", "generic")
    assert ba.assign(props(), metrics(6.1, 21.3), None, "commercial", None) == (
        "generic",
        "generic",
    )
    assert ba.assign(props(), metrics(6.1, 21.3, fill=0.7), None, "residential", None) == (
        "generic",
        "generic",
    )
    assert ba.assign(props(kind="civic"), metrics(6.1, 21.3), None, "residential", None) == (
        "generic",
        "generic",
    )


def test_superlink_size_outside_a_ridge_precinct_is_generic():
    assert ba.assign(props(), metrics(11.0, 21.0), "Elmina Green 3", "residential", None) == (
        "generic",
        "generic",
    )


# --- heights ------------------------------------------------------------------------


def test_final_height_precedence():
    sample = {"height_m": 9.4, "coverage": 0.9}
    tagged = {**props(), "height_m": 12.8, "height_source": "osm_levels"}
    tagged["osm"]["building:levels"] = "4"
    assert ba.final_height(tagged, "link_intermediate", sample) == (9.4, "google_3dtiles")
    assert ba.final_height(tagged, "link_intermediate", None) == (12.8, "osm_levels")
    tall = {**props(), "height_m": 15.0, "height_source": "osm_height"}
    assert ba.final_height(tall, "semi_d", None) == (15.0, "osm_height")
    assert ba.final_height(props(), "link_intermediate", None) == (8.5, "archetype_storeys")
    default = {**props(), "height_m": 7.93}
    assert ba.final_height(default, "generic", None) == (7.93, "default")
    assert ba.final_height(default, "highrise", None) == (7.93, "default")


def test_final_height_rejects_low_rise_outliers():
    assert ba.final_height(props(), "link_intermediate", {"height_m": 40.0}) == (
        8.5,
        "archetype_storeys",
    )
    # not low rise: a tall sample is kept
    assert ba.final_height(props(), "mosque", {"height_m": 40.0}) == (40.0, "google_3dtiles")
    assert ba.final_height(props(), "generic", {"height_m": 40.0}) == (40.0, "google_3dtiles")


def test_low_rise_set():
    assert {"school", "mosque", "mall", "factory", "highrise", "generic"}.isdisjoint(ba.LOW_RISE)
    assert "link_intermediate" in ba.LOW_RISE and "shop_office" in ba.LOW_RISE


# --- precincts ----------------------------------------------------------------------


def test_precincts_query_asks_for_places_and_named_residential():
    q = ba.precincts_query((3.15, 101.46, 3.2, 101.53))
    assert 'node["place"~"^(suburb|neighbourhood|quarter)$"]' in q
    assert 'way["landuse"="residential"]["name"]' in q
    assert "out geom tags" in q


def _poly_way(i, ring, **tags):
    return {
        "type": "way",
        "id": i,
        "tags": tags,
        "geometry": [{"lon": x, "lat": y} for x, y in ring],
    }


def test_build_precincts_and_precinct_of():
    big = rect(1000, 1000)
    inner = rect(200, 200, lon=LON0 + 100 / KX, lat=LAT0 + 100 / ba.M_PER_DEG)
    els = [
        _poly_way(1, big, landuse="residential", name="Elmina Green 3"),
        _poly_way(2, inner, landuse="residential", name="Elmina Ridge"),
        _poly_way(2, inner, landuse="residential", name="Elmina Ridge"),  # repeated by tiles
        _poly_way(3, big, landuse="residential"),  # unnamed: skipped
        {
            "type": "node",
            "id": 7,
            "lon": LON0 + 3000 / KX,
            "lat": LAT0,
            "tags": {"place": "neighbourhood", "name": "Elmina East"},
        },
        {"type": "node", "id": 8, "lon": LON0, "lat": LAT0, "tags": {"place": "suburb"}},
    ]
    pre = ba.build_precincts(els)
    names = sorted(p["properties"]["name"] for p in pre)
    assert names == ["Elmina East", "Elmina Green 3", "Elmina Ridge"]
    # nested: smallest containing polygon wins
    assert ba.precinct_of(LON0 + 150 / KX, LAT0 + 150 / ba.M_PER_DEG, pre) == "Elmina Ridge"
    assert ba.precinct_of(LON0 + 800 / KX, LAT0 + 800 / ba.M_PER_DEG, pre) == "Elmina Green 3"
    # outside polygons: nearest place node within 1500 m
    assert ba.precinct_of(LON0 + 2000 / KX, LAT0, pre) == "Elmina East"
    assert ba.precinct_of(LON0 + 6000 / KX, LAT0 + 3000 / ba.M_PER_DEG, pre) is None


# --- transform, idempotence, ids ----------------------------------------------------


def _feature(fid, ring, **p):
    return {
        "type": "Feature",
        "properties": {
            "id": fid,
            "height_m": 7.5,
            "min_height_m": 0.0,
            "kind": "residential",
            "height_source": "default",
            "osm": {"building": "house"},
            **p,
        },
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


def _inputs():
    feats = [
        _feature("w1", rect(6.1, 21.3)),
        _feature("w2", rect(6.1, 21.3, lon=LON0 + 50 / KX)),
        _feature("w3", rect(40, 60, lon=LON0 + 3000 / KX), kind="industrial"),
        _feature(
            "w4",
            rect(11, 21, lon=LON0 + 100 / KX),
            height_source="osm_height",
            height_m=6.0,
            osm={"building": "residential"},  # building=house at 231 m2 would be a bungalow
        ),
    ]
    landuse = [
        {
            "type": "Feature",
            "properties": {"class": "residential", "source": "osm", "osm": "way/9"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [rect(500, 500, lon=LON0 - 10 / KX, lat=LAT0 - 10 / ba.M_PER_DEG)],
            },
        }
    ]
    precincts = ba.build_precincts(
        [
            _poly_way(
                5,
                rect(500, 500, lon=LON0 - 10 / KX, lat=LAT0 - 10 / ba.M_PER_DEG),
                landuse="residential",
                name="Elmina Ridge",
            )
        ]
    )
    samples = {"w2": {"height_m": 28.0, "coverage": 0.9}, "w4": {"height_m": 9.1, "coverage": 0.8}}
    return feats, precincts, landuse, samples


def test_transform_assigns_records_and_keeps_ids():
    feats, precincts, landuse, samples = _inputs()
    before = [f["properties"]["id"] for f in feats]
    out = ba.transform(copy.deepcopy(feats), precincts, landuse, samples, {})
    assert [f["properties"]["id"] for f in out] == before
    p = {f["properties"]["id"]: f["properties"] for f in out}
    assert p["w1"]["archetype"] == "link_intermediate" and p["w1"]["archetype_method"] == "shape"
    assert p["w1"]["precinct"] == "Elmina Ridge"
    assert p["w1"]["height_m"] == 8.5 and p["w1"]["height_source"] == "archetype_storeys"
    # outlier sample rejected
    assert p["w2"]["height_m"] == 8.5 and p["w2"]["height_source"] == "archetype_storeys"
    assert p["w3"]["archetype"] == "factory" and "precinct" not in p["w3"]
    assert p["w4"]["archetype"] == "superlink" and p["w4"]["archetype_method"] == "shape+precinct"
    assert p["w4"]["height_m"] == 9.1 and p["w4"]["height_source"] == "google_3dtiles"
    for q in p.values():
        assert q["archetype"] in ba.ARCHETYPES


def test_transform_is_idempotent():
    feats, precincts, landuse, samples = _inputs()
    once = ba.transform(copy.deepcopy(feats), precincts, landuse, samples, {})
    twice = ba.transform(copy.deepcopy(once), precincts, landuse, samples, {})
    assert json.dumps(once, sort_keys=True) == json.dumps(twice, sort_keys=True)
    again = ba.transform(copy.deepcopy(feats), precincts, landuse, samples, {})
    assert json.dumps(once, sort_keys=True) == json.dumps(again, sort_keys=True)


def test_transform_keeps_osm_height_after_a_sample_goes_away():
    feats, precincts, landuse, samples = _inputs()
    once = ba.transform(copy.deepcopy(feats), precincts, landuse, samples, {})
    w4 = next(f for f in once if f["properties"]["id"] == "w4")["properties"]
    assert w4["height_source"] == "google_3dtiles"
    later = ba.transform(copy.deepcopy(once), precincts, landuse, {}, {})
    w4 = next(f for f in later if f["properties"]["id"] == "w4")["properties"]
    assert (w4["height_m"], w4["height_source"]) == (6.0, "osm_height")


def test_coverage_counts_per_precinct():
    feats, precincts, landuse, samples = _inputs()
    out = ba.transform(copy.deepcopy(feats), precincts, landuse, samples, {})
    cov = ba.coverage(out)
    rows = {r["precinct"]: r for r in cov["precincts"]}
    assert set(rows) == {"Elmina Ridge", None}
    assert rows[None]["archetypes"] == {"factory": 1} and rows[None]["generic_share"] == 0.0
    assert rows["Elmina Ridge"]["count"] == 3
    assert rows["Elmina Ridge"]["methods"]["shape"] == 2
    assert cov["total"]["count"] == 4


# --- main ---------------------------------------------------------------------------


def _seed(tmp_path, with_samples: bool):
    feats, _pre, landuse, samples = _inputs()
    base = tmp_path / "base"
    base.mkdir()
    (tmp_path / "site.json").write_text(
        json.dumps(
            {
                "scene": {"home": {"lon": LON0, "lat": LAT0}},
                "buildings": {"file": "base/buildings.geojson", "radius_m": 3500},
            }
        )
    )
    (base / "buildings.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": feats})
    )
    (base / "landcover.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": landuse})
    )
    (base / "archetype_overrides.json").write_text("{}")
    if with_samples:
        (base / "height_samples.json").write_text(
            json.dumps({"as_of": "2026-10-17", "source": "x", "samples": samples})
        )


def _fake_precinct_fetch(monkeypatch):
    els = [
        _poly_way(
            5,
            rect(500, 500, lon=LON0 - 10 / KX, lat=LAT0 - 10 / ba.M_PER_DEG),
            landuse="residential",
            name="Elmina Ridge",
        )
    ]
    monkeypatch.setattr(ba, "fetch_precincts", lambda *a, **k: els)


def test_main_writes_outputs_without_height_samples(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(ba, "OUT", tmp_path)
    _seed(tmp_path, with_samples=False)
    _fake_precinct_fetch(monkeypatch)
    ba.main(["--max-requests", "1"])
    base = tmp_path / "base"
    feats = json.loads((base / "buildings.geojson").read_text())["features"]
    assert all("archetype" in f["properties"] for f in feats)
    assert not any(f["properties"]["height_source"] == "google_3dtiles" for f in feats)
    assert (base / "precincts.geojson").exists()
    cov = json.loads((base / "archetype_coverage.json").read_text())
    assert cov["total"]["count"] == 4
    site = json.loads((tmp_path / "site.json").read_text())
    assert site["buildings"]["archetypes_as_of"]
    assert "generic" in capsys.readouterr().out


def test_main_dry_run_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(ba, "OUT", tmp_path)
    _seed(tmp_path, with_samples=True)
    _fake_precinct_fetch(monkeypatch)
    before = (tmp_path / "base" / "buildings.geojson").read_text()
    site_before = (tmp_path / "site.json").read_text()
    ba.main(["--dry-run"])
    assert (tmp_path / "base" / "buildings.geojson").read_text() == before
    assert (tmp_path / "site.json").read_text() == site_before
    assert not (tmp_path / "base" / "precincts.geojson").exists()
    assert not (tmp_path / "base" / "archetype_coverage.json").exists()


def test_main_blocked_exit_code_2(tmp_path, monkeypatch):
    monkeypatch.setattr(ba, "OUT", tmp_path)
    _seed(tmp_path, with_samples=False)

    def fail(*a, **k):
        raise ba.overpass.BudgetExceeded("cap")

    monkeypatch.setattr(ba, "fetch_precincts", fail)
    with pytest.raises(SystemExit) as e:
        ba.main(["--max-requests", "0"])
    assert e.value.code == 2
    assert not (tmp_path / "base" / "archetype_coverage.json").exists()


# --- fix round 1 rulings ------------------------------------------------------------


@pytest.mark.parametrize(
    ("l", "expected"),
    [
        (12.9, "generic"),
        (13.0, "link_intermediate"),
        (15.5, "link_intermediate"),  # Elmina Valley built depth
        (22.99, "link_intermediate"),
        (23.0, "link_long"),  # bands are half-open: no double match at 23 m
        (26.5, "link_long"),
        (26.6, "generic"),
    ],
)
def test_ruling1_link_bands(l, expected):  # noqa: E741
    assert ba.assign(props(), metrics(6.1, l), None, "residential", None)[0] == expected


def test_ruling1_superlink_beats_semi_d_where_bands_overlap():
    m = metrics(11.6, 22.5)  # inside both the superlink and the semi_d band
    assert ba.assign(props(), m, "Elmina Ridge", "residential", None) == (
        "superlink",
        "shape+precinct",
    )
    assert ba.assign(props(), m, "Elmina Green 3", "residential", None) == ("semi_d", "shape")


def test_ruling2_apartments_and_tall_tag_heights_stay_generic_in_rule8():
    apt = props(building="apartments")
    assert ba.assign(apt, metrics(20, 60), None, "residential", None) == ("generic", "generic")
    assert ba.assign(apt, metrics(6.1, 15), None, "residential", None) == ("generic", "generic")
    # 27 m > 3 x 8.5 m: not a link house, and below the 30 m highrise gate
    assert ba.assign(props(), metrics(6.1, 15), None, "residential", 27.0) == (
        "generic",
        "generic",
    )
    assert ba.assign(props(), metrics(6.1, 15), None, "residential", 9.6) == (
        "link_intermediate",
        "shape",
    )


def test_ruling3_highrise_from_a_google_sample():
    m = metrics(6.1, 15)
    good = {"height_m": 35.0, "coverage": 0.6}
    assert ba.assign(props(), m, None, "residential", None, sample=good) == ("highrise", "height")
    thin = {"height_m": 35.0, "coverage": 0.4}
    assert ba.assign(props(), m, None, "residential", None, sample=thin) == (
        "link_intermediate",
        "shape",
    )
    low = {"height_m": 29.0, "coverage": 0.9}
    assert ba.assign(props(), m, None, "residential", None, sample=low)[0] == "link_intermediate"


def test_ruling3_transform_uses_the_sample_for_highrise_but_heights_unchanged():
    feats, precincts, landuse, _ = _inputs()
    samples = {"w1": {"height_m": 42.0, "coverage": 0.9}}
    out = ba.transform(copy.deepcopy(feats), precincts, landuse, samples, {})
    w1 = out[0]["properties"]
    assert (w1["archetype"], w1["archetype_method"]) == ("highrise", "height")
    assert (w1["height_m"], w1["height_source"]) == (42.0, "google_3dtiles")


def test_ruling4_house_tries_rule8_shapes_before_bungalow():
    house = props(building="house")
    assert ba.assign(house, metrics(11.6, 24.4), None, "residential", None) == ("semi_d", "shape")
    assert ba.assign(house, metrics(15, 20), None, "residential", None) == ("bungalow", "osm_tag")
    assert ba.assign(house, metrics(15, 20), None, None, None) == ("bungalow", "osm_tag")
    assert ba.assign(house, metrics(15, 20, fill=0.5), None, None, None) == ("generic", "generic")
    # detached / villa / bungalow tags still win before the shapes
    for tag in ("detached", "villa", "bungalow"):
        p = props(building=tag)
        assert ba.assign(p, metrics(11.6, 24.4), None, "residential", None) == (
            "bungalow",
            "osm_tag",
        )


def test_ruling5_unnamed_muslim_place_of_worship_is_generic():
    p = props(kind="civic", amenity="place_of_worship", religion="muslim")
    assert ba.assign(p, metrics(30, 30), None, None, None) == ("generic", "generic")
    assert ba.assign(props(kind="civic", building="mosque"), metrics(30, 30), None, None, None) == (
        "mosque",
        "osm_tag",
    )


def test_main_duplicate_ids_exit_3(tmp_path, monkeypatch):
    monkeypatch.setattr(ba, "OUT", tmp_path)
    _seed(tmp_path, with_samples=False)
    _fake_precinct_fetch(monkeypatch)
    path = tmp_path / "base" / "buildings.geojson"
    fc = json.loads(path.read_text())
    fc["features"].append(copy.deepcopy(fc["features"][0]))
    path.write_text(json.dumps(fc))
    with pytest.raises(SystemExit) as e:
        ba.main([])
    assert e.value.code == 3
    assert not (tmp_path / "base" / "archetype_coverage.json").exists()


def test_main_warns_about_overrides_for_unknown_ids(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(ba, "OUT", tmp_path)
    _seed(tmp_path, with_samples=False)
    _fake_precinct_fetch(monkeypatch)
    (tmp_path / "base" / "archetype_overrides.json").write_text(
        json.dumps({"w999": {"archetype": "mosque", "note": "x"}})
    )
    ba.main(["--dry-run"])
    assert "WARNING: overrides for unknown building ids: ['w999']" in capsys.readouterr().out
