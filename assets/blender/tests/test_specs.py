import json
import logging
import math
import re
from pathlib import Path

import pytest
from tl_assets import specs
from tl_assets.geo import ring_centroid, to_local
from tl_assets.glbinfo import GlbInfo, NodeInfo
from tl_assets.manifest import build_manifest

from data.scripts import build_archetypes as ba

HEX = re.compile(r"^#[0-9a-f]{6}$")
ADULTS = {
    "office_man",
    "office_woman",
    "tudung_baju_kurung",
    "older_adult",
    "jogger",
    "cyclist",
    "parent_stroller",
}
CHILDREN = {"school_boy", "school_girl", "child"}


def _within(rng, lo, hi) -> bool:
    return rng is not None and lo <= rng[0] <= rng[1] <= hi


def _variant(asset_id: str, variant_id: str) -> specs.Variant:
    return next(v for v in specs.ASSETS[asset_id].variants if v.id == variant_id)


def test_archetypes_mirror_the_data_module():
    assert specs.ARCHETYPES == ba.ARCHETYPES
    assert specs.STOREY_HEIGHT_M == ba.STOREY_HEIGHT_M
    for a in specs.ARCHETYPES:
        assert specs.ASSETS[a].group == "archetype"


def test_archetype_first_variant_height_is_the_storey_height():
    for a, h in ba.STOREY_HEIGHT_M.items():
        assert specs.ASSETS[a].variants[0].size[1] == h, a


def test_variants_have_decreasing_lods():
    for spec in [*specs.ASSETS.values(), *specs.TEST_ASSETS.values()]:
        assert spec.variants, spec.id
        assert len({v.id for v in spec.variants}) == len(spec.variants), spec.id
        for v in spec.variants:
            assert len(v.tris) == len(v.max_m), (spec.id, v.id)
            assert all(a > b for a, b in zip(v.tris, v.tris[1:], strict=False)), (spec.id, v.id)
            finite = [m for m in v.max_m if m is not None]
            assert finite == sorted(finite), (spec.id, v.id)
            assert None not in v.max_m[:-1], (spec.id, v.id)


# P3 triangle caps of the buildings (specs.py at dfc0e92). The P4 detail pass may raise a cap by
# at most 25 % and never lowers the LOD2 cap (LOD2 geometry is unchanged).
P3_BUILDING_CAPS = {
    "link_intermediate": (6000, 700, 40),
    "link_long": (6500, 750, 40),
    "superlink": (7000, 800, 40),
    "semi_d": (7000, 800, 40),
    "bungalow": (6000, 700, 40),
    "townhouse": (4000, 500, 30),
    "shop_office": (8000, 900, 40),
    "highrise": (25000, 3000, 120),
    "school": (12000, 1500, 60),
    "mosque": (20000, 2500, 150),
    "factory": (4000, 600, 40),
    "mall": (15000, 2000, 80),
    "generic": (3000, 400, 24),
    "lakeside_mall": (80000, 10000, 1500),
    "kanopi": (50000, 8000, 600),
    "masjid_denai_alam": (40000, 5000, 400),
}


def test_building_caps_rise_at_most_a_quarter():
    for aid, p3 in P3_BUILDING_CAPS.items():
        for v in specs.ASSETS[aid].variants:
            assert len(v.tris) == len(p3), (aid, v.id)
            for lod, (cap, old) in enumerate(zip(v.tris, p3, strict=True)):
                assert old <= cap <= old * 1.25, (aid, v.id, lod, cap, old)
            assert v.tris[2] == p3[2], (aid, v.id, "LOD2 is unchanged")


def test_every_kit_has_six_to_ten_variants():
    kits = [s for s in specs.ASSETS.values() if s.group == "kit"]
    assert {s.id for s in kits} == {"people", "vehicles", "trees", "furniture", "construction"}
    for s in kits:
        assert 6 <= len(s.variants) <= 10, s.id
        assert s.decorative, s.id


def test_buildings_use_the_building_lod_distances():
    for s in specs.ASSETS.values():
        if s.group in ("archetype", "landmark"):
            for v in s.variants:
                assert v.max_m == specs.LOD_MAX_M, (s.id, v.id)


def test_people_are_true_scale():
    people = specs.ASSETS["people"]
    assert {v.id for v in people.variants} == ADULTS | CHILDREN
    for v in people.variants:
        assert _within(v.y_range, 1.2, 1.85), v.id
        if v.id in ADULTS:
            assert _within(v.y_range, 1.6, 1.8), v.id
        else:
            assert _within(v.y_range, 1.2, 1.45), v.id


def test_hatchback_and_rain_tree_ranges():
    assert _within(_variant("vehicles", "compact_hatch").z_range, 3.7, 4.0)
    assert _within(_variant("trees", "rain_tree").x_range, 15, 25)


# Spec A4 (demo polish): generic local-street shapes, (length range m, width, height).
VEHICLES_A4 = {
    "compact_hatch": ((3.8, 4.0), 1.7, 1.5),
    "micro_hatch": ((3.6, 3.8), 1.6, 1.5),
    "small_sedan": ((4.2, 4.4), 1.7, 1.5),
    "mpv": ((4.3, 4.5), 1.7, 1.7),
    "pickup": ((5.15, 5.45), 1.85, 1.8),
    "kapchai": ((1.75, 2.0), 0.75, 1.6),
    "delivery_moto": ((1.85, 2.15), 0.75, 1.6),
    "bicycle": ((1.6, 1.8), 0.6, 1.7),
    "bus": ((11.5, 12.5), 2.5, 3.2),
    "lorry": ((6.6, 7.4), 2.2, 3.0),
}
TWO_WHEELERS = {"kapchai", "delivery_moto", "bicycle"}


def test_vehicles_are_the_a4_kit():
    vs = specs.ASSETS["vehicles"].variants
    assert [v.id for v in vs] == list(VEHICLES_A4)
    for v in vs:
        rng, w, h = VEHICLES_A4[v.id]
        assert v.z_range == rng and v.size[0] == w and v.size[1] == h, v.id
    assert specs.ASSETS["vehicles"].variant_by_group == {"default": "compact_hatch"}


def test_every_two_wheeler_has_a_rider():
    """AC-L5 (spec side): the two-wheelers carry a seated rider; no other vehicle does."""
    for v in specs.ASSETS["vehicles"].variants:
        assert v.rider is (v.id in TWO_WHEELERS), v.id
    for s in specs.ASSETS.values():
        if s.id != "vehicles":
            assert not any(v.rider for v in s.variants), s.id


def test_vehicle_caps_hold_the_budgets():
    """AC-L9: cars and two-wheelers <= 3000 / 400, bus and lorry <= 5000 / 600."""
    for v in specs.ASSETS["vehicles"].variants:
        caps = (5000, 600) if v.id in ("bus", "lorry") else (3000, 400)
        assert v.tris == caps, v.id


def test_vehicle_paint_is_mostly_white_silver_grey():
    """Spec A4: the web picks a palette entry uniformly, so ~60 % neutral paint."""
    pal = specs.palette_for("vehicles")["default"]
    neutral = sum(p[0] in specs.PAINT_NEUTRAL for p in pal)
    assert len(pal) == 10 and neutral == 6
    assert len({p[0] for p in pal}) == len(pal)


def test_sizes_sit_inside_their_ranges():
    for s in [*specs.ASSETS.values(), *specs.TEST_ASSETS.values()]:
        for v in s.variants:
            for axis, rng in ((0, v.x_range), (1, v.y_range), (2, v.z_range)):
                if rng is not None:
                    assert rng[0] <= v.size[axis] <= rng[1], (s.id, v.id, axis)


def test_precinct_group():
    assert specs.precinct_group("Elmina Valley 2") == "valley"
    assert specs.precinct_group("Elmina Green 3") == "green"
    assert specs.precinct_group(None) == "default"
    assert specs.precinct_group("Unknown") == "default"


def test_palettes_are_hex_triples():
    assert specs.PALETTES
    for key, groups in specs.PALETTES.items():
        assert "default" in groups, key
        for group, entries in groups.items():
            assert entries, (key, group)
            for entry in entries:
                assert len(entry) == 3, (key, group)
                assert all(HEX.match(c) for c in entry), (key, group, entry)


def test_variant_by_group_names_existing_variants():
    groups = {g for g, _ in specs.PRECINCT_GROUPS} | {"default"}
    for s in specs.ASSETS.values():
        ids = {v.id for v in s.variants}
        for group, v in s.variant_by_group.items():
            assert group in groups, (s.id, group)
            assert v in ids, (s.id, v)
    assert specs.ASSETS["link_intermediate"].variant_by_group["valley"] == "modern"
    assert specs.ASSETS["semi_d"].variant_by_group["default"] == "gable"


def test_files_and_budgets():
    folders = {"archetype": "archetypes/", "landmark": "landmarks/", "kit": "kits/"}
    for s in specs.ASSETS.values():
        assert s.file == f"{folders[s.group]}{s.id}.glb", s.id
        assert s.max_bytes == (400_000 if s.group == "archetype" else 1_500_000), s.id
    assert specs.MAX_TOTAL_BYTES == 12_000_000


def test_landmark_placements():
    assert specs.ASSETS["lakeside_mall"].placement == "anchor"
    # kanopi stands on its traced outline (data/seed/elmina/sources/landmark_outlines.geojson);
    # the masjid has no public drawing and stays deferred until P4.
    assert specs.ASSETS["kanopi"].placement == "obb"
    assert specs.ASSETS["masjid_denai_alam"].placement == "deferred"


def test_kanopi_is_a_slab_on_its_traced_outline_obb():
    """88.88 x 27.79 m is the OBB of the traced polygon (landmark_outlines.geojson, kanopi); the
    web fit scales the model by obb / size, so the spec size must sit within 5 % of it."""
    spec = specs.ASSETS["kanopi"]
    v = spec.variants[0]
    assert spec.frontage == "long", "the 89 m side is the frontage, so sx = 88.9 / w"
    assert spec.placement == "obb"
    assert v.size[0] == pytest.approx(specs.KANOPI_OBB[0], rel=0.05)
    assert v.size[2] == pytest.approx(specs.KANOPI_OBB[1], rel=0.05)
    assert v.size[0] / v.size[2] > 3.0  # a slab, not the old 40 x 30 block
    for rng, ref in ((v.x_range, specs.KANOPI_OBB[0]), (v.z_range, specs.KANOPI_OBB[1])):
        assert rng is not None and rng[0] >= ref * 0.95 and rng[1] <= ref * 1.05
        assert rng[0] <= ref <= rng[1]
    # 36 storeys x 3.2 m = 115.2 m of tower on an 8.7 m podium, plus a thin crown
    assert spec.design_storeys == 36
    assert "36 storeys" in spec.height_basis and "Sime Darby Property" in spec.height_basis
    assert v.y_range is not None and v.y_range[0] > 8.7 + 36 * 3.2 and v.y_range[1] < 135.0
    assert v.tris[0] >= 40000 and v.tris[1] < v.tris[0] and v.tris[2] <= 600


def test_kanopi_manifest_records_the_design_height():
    m = build_manifest({"kanopi": _info("kanopi")}, "2026-10-18", {})
    k = m["assets"]["kanopi"]
    assert k["frontage"] == "long"
    assert k["designStoreys"] == 36
    assert "design height" in k["heightBasis"]
    m2 = build_manifest({"lakeside_mall": _info("lakeside_mall")}, "2026-10-18", {})
    assert "designStoreys" not in m2["assets"]["lakeside_mall"]


def test_kanopi_obb_matches_the_traced_outline_when_the_data_is_present():
    from tl_assets.geo import outline_local, outline_ring

    ring = outline_ring(_seed(), "kanopi")
    if ring is None:
        pytest.skip("landmarks.geojson has no traced kanopi yet (lane/data not merged)")
    pts = outline_local(ring)
    best = min(
        (
            (max(u) - min(u)) * (max(w) - min(w)),
            max(u) - min(u),
            max(w) - min(w),
        )
        for a in (math.radians(k / 10) for k in range(1800))
        for u, w in (
            (
                [p[0] * math.cos(a) + p[1] * math.sin(a) for p in pts],
                [-p[0] * math.sin(a) + p[1] * math.cos(a) for p in pts],
            ),
        )
    )
    assert best[1] == pytest.approx(specs.KANOPI_OBB[0], abs=0.1)
    assert best[2] == pytest.approx(specs.KANOPI_OBB[1], abs=0.1)


def test_test_assets_are_separate():
    assert "calib" in specs.TEST_ASSETS
    assert specs.TEST_ASSETS.keys().isdisjoint(specs.ASSETS)


def _bounds(w: float, h: float, d: float):
    return ((-w / 2, 0.0, -d / 2), (w / 2, h, d / 2))


def test_bounds_errors_ranges_replace_the_size_check_exactly():
    hatch = _variant("vehicles", "compact_hatch")
    assert specs.bounds_errors(hatch, _bounds(1.7, 1.5, 3.9)) == []
    errs = specs.bounds_errors(hatch, _bounds(1.7, 1.5, 5.2))
    assert len(errs) == 1 and "z extent" in errs[0]
    # no slack on a range: 4.1 m is outside (3.8, 4.0) even though size + 1.2 would allow it
    assert specs.bounds_errors(hatch, _bounds(1.7, 1.5, 4.1))


def test_bounds_errors_size_check_keeps_the_eave_slack():
    link = specs.ASSETS["link_intermediate"].variants[0]  # 6.4 x 8.5 x 15.5
    assert specs.bounds_errors(link, _bounds(6.4 + 1.2, 8.5, 15.5 - 0.1)) == []
    assert specs.bounds_errors(link, _bounds(6.4 + 1.3, 8.5, 15.5))
    assert specs.bounds_errors(link, _bounds(6.4, 10.0, 15.5))  # h outside +-1
    mosque = specs.ASSETS["mosque"].variants[0]  # y_range (14, 32)
    assert specs.bounds_errors(mosque, _bounds(30, 30, 30)) == []
    assert specs.bounds_errors(mosque, _bounds(30, 33, 30))


SEED = (
    Path(__file__).resolve().parents[3] / "data" / "seed" / "elmina" / "base" / "landmarks.geojson"
)


def _seed() -> dict:
    return json.loads(SEED.read_text(encoding="utf-8"))


def _info(asset_id: str) -> GlbInfo:
    spec = specs.get_spec(asset_id)
    nodes = {
        f"{asset_id}__{v.id}__LOD{n}": NodeInfo(
            cap - 1, 1, ((0, 0, 0), (1, 1, 1)), frozenset({"POSITION", "COLOR_0"})
        )
        for v in spec.variants
        for n, cap in enumerate(v.tris)
    }
    return GlbInfo(nodes, ["tl_role"], 0, ["EXT_meshopt_compression"], 1000)


def test_landmark_anchor_from_seed(caplog):
    fc = _seed()
    feat = next(f for f in fc["features"] if f["properties"]["model"] == "lakeside_mall")
    lon, lat = ring_centroid(feat["geometry"]["coordinates"][0])
    infos = {a: _info(a) for a in ("lakeside_mall", "kanopi", "masjid_denai_alam")}
    m = build_manifest(infos, "2026-10-17", fc)
    assert m["landmarks"]["lakeside_mall"]["anchor"] == pytest.approx([lon, lat], abs=1e-7)
    assert set(m["landmarks"]) == {"lakeside_mall"}  # obb and deferred landmarks get no anchor
    assert m["assets"]["kanopi"]["placement"] == "obb"
    assert m["assets"]["masjid_denai_alam"]["placement"] == "deferred"
    # no lakeside_mall feature (or no file at all): no anchor, and the gap is logged
    empty = {"type": "FeatureCollection", "features": []}
    for fc2 in (empty, {}):
        caplog.clear()
        with caplog.at_level(logging.WARNING):
            m2 = build_manifest({"lakeside_mall": _info("lakeside_mall")}, "2026-10-17", fc2)
        assert m2["landmarks"] == {}
        assert "lakeside_mall" in caplog.text and "unplaced" in caplog.text


def test_lakeside_mall_ranges_are_pinned_to_the_seed_outline():
    """specs hard-codes the outline's local bbox (no file read in specs); this pins it."""
    feat = next(f for f in _seed()["features"] if f["properties"]["model"] == "lakeside_mall")
    ring = feat["geometry"]["coordinates"][0]
    c = ring_centroid(ring)
    pts = [to_local(x, y, c) for x, y in ring]
    bw = max(p[0] for p in pts) - min(p[0] for p in pts)
    bd = max(p[1] for p in pts) - min(p[1] for p in pts)
    v = specs.ASSETS["lakeside_mall"].variants[0]
    assert v.size[0] == pytest.approx(bw, abs=0.05) and v.size[2] == pytest.approx(bd, abs=0.05)
    # canopy overhang 1.5 m per side: extent within [bbox - 0.1, bbox + 3.0 + 0.1]
    assert v.x_range == pytest.approx((bw - 0.1, bw + 3.1), abs=0.05)
    assert v.z_range == pytest.approx((bd - 0.1, bd + 3.1), abs=0.05)
    # the model's top is its manifest height, the seed's display_height_m (B-T2 fidelity)
    assert v.y_range == (8.95, 9.05)
    assert v.y_range[0] <= v.size[1] <= v.y_range[1]
