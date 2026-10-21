"""Compose generated terrain screening with river stages without weakening a class."""

from __future__ import annotations

import copy

from .models import Scenario


def add_combinations(world):
    """Only advertise combinations when a generated low-lying scenario/layer exists."""
    low = next(
        (s for s in world.flood.scenarios if s.id == "lowlying" and s.kind == "lowlying"), None
    )
    if low is None:
        return
    if low.id not in world.water:
        raise ValueError("lowlying scenario is missing flood/lowlying.geojson")
    river_stages = [s for s in world.flood.scenarios if s.kind == "river_stage" and s.stage_m > 0]
    existing = {s.id for s in world.flood.scenarios}
    for river in river_stages:
        sid = f"{river.id}+lowlying"
        if sid in existing:
            raise ValueError(f"combined scenario {sid} must be derived, not predeclared")
        world.flood.scenarios.append(
            Scenario(
                id=sid,
                label=f"{river.label} + low-lying areas (indicative)",
                stage_m=river.stage_m,
                kind="combined",
                components=[river.id, low.id],
                method=f"{river.method}+priority_flood_terrain_screen",
                dem=low.dem,
                created=low.created,
                disclaimer=f"{river.disclaimer} {low.disclaimer}",
                links=river.links + [link for link in low.links if link not in river.links],
            )
        )
        for mapping in (world.flood.edge_classes, world.flood.place_classes):
            combined = dict(mapping.get(river.id, {}))
            for eid in mapping.get(low.id, {}):
                if combined.get(eid) != "likely_flooded":
                    combined[eid] = "possible"
            mapping[sid] = combined
        gaps = dict(world.flood.coverage)
        for eid, gap in world.flood.scenario_coverage.get(low.id, {}).items():
            gaps[eid] = "uncovered" if "uncovered" in (gaps.get(eid), gap) else "partial"
        world.flood.scenario_coverage[sid] = gaps
        world.water[sid] = {
            "type": "FeatureCollection",
            "features": [
                *copy.deepcopy(world.water.get(river.id, {}).get("features", [])),
                *copy.deepcopy(world.water[low.id].get("features", [])),
            ],
            "disclaimer": world.flood.scenarios[-1].disclaimer,
        }


def terrain_only(world, scenario_id, element_id, *, place=False):
    """Whether this possible class came only from terrain, not a river-stage class."""
    sc = next((s for s in world.flood.scenarios if s.id == scenario_id), None)
    if sc is None or sc.kind == "river_stage":
        return False
    mapping = world.flood.place_classes if place else world.flood.edge_classes
    if mapping.get(scenario_id, {}).get(element_id) != "possible":
        return False
    if sc.kind == "lowlying":
        return True
    river_ids = [sid for sid in sc.components if sid != "lowlying"]
    return all(
        mapping.get(sid, {}).get(element_id) not in ("possible", "likely_flooded")
        for sid in river_ids
    )
