import copy

import pytest
from townshiplens_spatial import flood, lowlying, rollout
from townshiplens_spatial.models import FloodBundle, Scenario
from townshiplens_spatial.routing import _evaluate

DISCLAIMER = "Indicative 30 m surface model; drains, culverts and rainfall not modelled."


def add_low(world):
    world.flood.scenarios.append(
        Scenario(
            id="lowlying",
            label="Low-lying areas that may collect water (indicative)",
            stage_m=0,
            kind="lowlying",
            components=["lowlying"],
            method="priority_flood_terrain_screen",
            disclaimer=DISCLAIMER,
        )
    )
    world.flood.edge_classes["lowlying"] = {"seg-ab": "possible", "seg-cd": "possible"}
    world.flood.place_classes["lowlying"] = {"playground": "possible"}
    world.flood.scenario_coverage["lowlying"] = {"seg-gh": "uncovered"}
    world.water["lowlying"] = {"type": "FeatureCollection", "features": []}
    lowlying.add_combinations(world)


def test_combination_never_demotes_river_fail_or_mutates_original_data(world):
    original = copy.deepcopy(world.flood.edge_classes)
    add_low(world)
    for sid, classes in original.items():
        assert world.flood.edge_classes[sid] == classes
        if sid == "baseline":
            continue
        combined = world.flood.edge_classes[f"{sid}+lowlying"]
        for eid, cls in classes.items():
            if cls == "likely_flooded":
                assert combined[eid] == cls
    assert world.flood.edge_classes["stage_p1m+lowlying"]["seg-ab"] == "possible"
    assert lowlying.terrain_only(world, "lowlying", "seg-ab")
    assert not lowlying.terrain_only(world, "stage_p3m+lowlying", "playground", place=True)
    assert {s.id for s in rollout.stages(world)} == {
        s.id for s in world.flood.scenarios if s.kind == "river_stage"
    }


def test_terrain_marks_are_unknown_for_walking_and_cannot_upgrade_existing_barriers(world):
    add_low(world)
    assert _evaluate(world, world.profiles["default"], "lowlying", "seg-ab")[0] == "UNKNOWN"
    before = {p.id for p in flood.cut_off_places(world, "default")}
    after = {p.id for p in flood.cut_off_places(world, "default", "lowlying")}
    assert after == before
    affected = flood.affected(world, "lowlying")
    assert affected.likely_total == 0 and affected.possible_total == 3
    assert affected.isolated_total == 0
    assert world.flood.coverage_for("lowlying", "seg-gh") == "uncovered"


def test_terrain_bundle_rejects_stronger_or_optimistic_classes():
    scenario = Scenario(id="lowlying", label="x", stage_m=0, kind="lowlying", disclaimer=DISCLAIMER)
    for cls in ("likely_flooded", "unlikely"):
        with pytest.raises(ValueError, match="possible only"):
            FloodBundle(scenarios=[scenario], edge_classes={"lowlying": {"edge": cls}})


def test_no_generated_layer_is_a_gap_not_an_empty_scenario(world):
    world.flood.scenarios.append(
        Scenario(id="lowlying", label="x", stage_m=0, kind="lowlying", disclaimer=DISCLAIMER)
    )
    with pytest.raises(ValueError, match="missing flood/lowlying.geojson"):
        lowlying.add_combinations(world)
