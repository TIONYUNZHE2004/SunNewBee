import re

from tl_assets import specs

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
    assert specs.ASSETS["kanopi"].placement == "deferred"
    assert specs.ASSETS["masjid_denai_alam"].placement == "deferred"


def test_test_assets_are_separate():
    assert "calib" in specs.TEST_ASSETS
    assert specs.TEST_ASSETS.keys().isdisjoint(specs.ASSETS)
