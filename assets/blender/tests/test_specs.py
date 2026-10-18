import json
import logging
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
    assert _within(_variant("vehicles", "hatchback").z_range, 3.7, 4.0)
    assert _within(_variant("trees", "rain_tree").x_range, 15, 25)


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


def test_test_assets_are_separate():
    assert "calib" in specs.TEST_ASSETS
    assert specs.TEST_ASSETS.keys().isdisjoint(specs.ASSETS)


def _bounds(w: float, h: float, d: float):
    return ((-w / 2, 0.0, -d / 2), (w / 2, h, d / 2))


def test_bounds_errors_ranges_replace_the_size_check_exactly():
    hatch = _variant("vehicles", "hatchback")
    assert specs.bounds_errors(hatch, _bounds(1.7, 1.5, 3.85)) == []
    errs = specs.bounds_errors(hatch, _bounds(1.7, 1.5, 5.2))
    assert len(errs) == 1 and "z extent" in errs[0]
    # no slack on a range: 4.1 m is outside (3.7, 4.0) even though size + 1.2 would allow it
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
    assert v.y_range == (8.0, 12.0)
