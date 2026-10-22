"""T-029: indicative enclosed terrain depressions from the existing Copernicus DEM.

Run: uv run python data/scripts/build_lowlying.py [--data-dir data/seed/elmina]
This needs the same cached DEM as build_flood.py, else its read_window fetches it.
No rainfall, drainage capacity or inundation model; output class is possible only.
"""

from __future__ import annotations

import argparse
import heapq
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import yaml
from rasterio.features import rasterize, shapes
from scipy import ndimage
from shapely.geometry import LineString, Point, mapping, shape
from shapely.ops import unary_union

# Support both `python data/scripts/build_lowlying.py` and module imports in tests.
try:
    from . import build_flood
except ImportError:
    import build_flood

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "config/flood/lowlying.yaml"
LABEL = "Low-lying areas that may collect water (indicative)"
DISCLAIMER = (
    "Indicative terrain screening from Copernicus GLO-30, not a forecast. The 30 m surface "
    "model includes buildings and trees. Drains and culverts are not modelled; rainfall "
    "amounts are not modelled. Marked areas are possible collection areas, not predicted "
    "inundation or water depth. Mapped water and forest or scrub are not screened. Unmarked "
    "areas are not proof of absence. Follow official MBSA / JPS / NADMA guidance."
)


@dataclass(frozen=True)
class Config:
    min_fill_m: float
    min_cells: int
    boundary_cells: int
    connectivity: int
    exclude_mapped_water: bool
    # land-cover classes (base/landcover.geojson) left unscreened: water, canopy
    exclude_landcover: tuple[str, ...] = ()


def load_config(path=CONFIG):
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    cfg = Config(**{**raw, "exclude_landcover": tuple(raw.get("exclude_landcover") or ())})
    if (
        not np.isfinite(cfg.min_fill_m)
        or cfg.min_fill_m <= 0
        or cfg.min_cells < 1
        or cfg.boundary_cells < 0
        or cfg.connectivity != 8
    ):
        raise ValueError(
            "positive fill contrast/cell count, nonnegative border and 8-connectivity required"
        )
    return cfg


def priority_fill(dem):
    """Minimum 8-connected spill elevation. Borders AND NoData neighbours are outlets.

    Treating missing cells as outlets prevents an unknown raster gap making a false dam.
    Never alter the input. Internal fill contrast is terrain geometry, not water depth.
    """
    dem = np.asarray(dem, dtype=float)
    if dem.ndim != 2 or min(dem.shape) < 1:
        raise ValueError("DEM must be a nonempty 2D array")
    valid = np.isfinite(dem)
    filled = np.where(valid, dem, np.nan)
    interior = ndimage.binary_erosion(valid, structure=np.ones((3, 3)), border_value=0)
    outlets = valid & ~interior
    seen = ~valid | outlets
    heap = [(float(dem[r, c]), int(r), int(c)) for r, c in np.argwhere(outlets)]
    heapq.heapify(heap)
    rows, cols = dem.shape
    while heap:
        level, r, c = heapq.heappop(heap)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                rr, cc = r + dr, c + dc
                if 0 <= rr < rows and 0 <= cc < cols and not seen[rr, cc]:
                    seen[rr, cc] = True
                    filled[rr, cc] = max(level, dem[rr, cc])
                    heapq.heappush(heap, (float(filled[rr, cc]), rr, cc))
    return filled


def lowlying_mask(dem, cfg, excluded=None):
    dem = np.asarray(dem, dtype=float)
    fill = priority_fill(dem)
    mask = np.isfinite(dem) & ((fill - dem) >= cfg.min_fill_m)
    n = cfg.boundary_cells
    if n:
        mask[:n, :] = mask[-n:, :] = False
        mask[:, :n] = mask[:, -n:] = False
    if excluded is not None:
        mask &= ~np.asarray(excluded, dtype=bool)
    labels, count = ndimage.label(mask, structure=np.ones((3, 3)))
    sizes = np.bincount(labels.ravel(), minlength=count + 1)
    keep = sizes >= cfg.min_cells
    keep[0] = False
    return keep[labels]


def _polygons(mask, transform):
    return [
        shape(g)
        for g, _ in shapes(mask.astype("uint8"), mask=mask, transform=transform, connectivity=8)
    ]


def features(mask, transform):
    # Shapely normalisation repairs corner-connected raster rings into valid polygons.
    out = []
    for geom in _polygons(mask, transform):
        for part in getattr(geom.buffer(0), "geoms", [geom.buffer(0)]):
            if part.is_empty:
                continue
            out.append(
                {
                    "type": "Feature",
                    "geometry": build_flood._round(mapping(part), 7),
                    "properties": {
                        "scenario_id": "lowlying",
                        "class": "possible",
                        "area_m2": round(build_flood._area_km2(part) * 1e6, 1),
                        "label": LABEL,
                        "method": "priority_flood_terrain_screen",
                    },
                }
            )
    return out


def _water(data_dir, shape_, transform):
    path = data_dir / "base/hydrology.geojson"
    if not path.exists():
        return np.zeros(shape_, dtype=bool)
    geometries = [
        f["geometry"]
        for f in json.loads(path.read_text())["features"]
        if f["geometry"]["type"] in ("Polygon", "MultiPolygon")
    ]
    return (
        rasterize(
            [(g, 1) for g in geometries],
            out_shape=shape_,
            transform=transform,
            fill=0,
            dtype="uint8",
        ).astype(bool)
        if geometries
        else np.zeros(shape_, dtype=bool)
    )


def _landcover(data_dir, shape_, transform, classes):
    """Cells under the given land-cover classes (base/landcover.geojson), not screened."""
    path = data_dir / "base/landcover.geojson"
    if not classes or not path.exists():
        return np.zeros(shape_, dtype=bool)
    geometries = [
        f["geometry"]
        for f in json.loads(path.read_text())["features"]
        if f["properties"].get("class") in classes
        and f["geometry"]["type"] in ("Polygon", "MultiPolygon")
    ]
    if not geometries:
        return np.zeros(shape_, dtype=bool)
    return rasterize(
        [(g, 1) for g in geometries], out_shape=shape_, transform=transform, fill=0, dtype="uint8"
    ).astype(bool)


def classify_world(world, polygons, coverage):
    """Intersect real segment/point geometries; never infer an entrance or a water level."""
    low = unary_union([shape(f["geometry"]) for f in polygons])
    edge_classes, place_classes, gaps = {}, {}, {}
    for items, out, geom in (
        (world.edges, edge_classes, lambda e: LineString(e.coords)),
        (world.places, place_classes, lambda p: Point(p.coord)),
    ):
        for eid, element in items.items():
            geometry = geom(element)
            if low.intersects(geometry):
                out[eid] = "possible"
            if not coverage.covers(geometry):
                gaps[eid] = "partial" if coverage.intersects(geometry) else "uncovered"
    return edge_classes, place_classes, gaps


def write_outputs(data_dir, dem, transform, cfg=None):
    from townshiplens_spatial.world import load_world

    cfg = cfg or load_config()
    dem = np.asarray(dem, dtype=float)
    if not np.isfinite(dem).any():
        raise ValueError("DEM has no finite cells; no low-lying scenario was written")
    world = load_world(data_dir)
    water = (
        _water(data_dir, dem.shape, transform)
        if cfg.exclude_mapped_water
        else np.zeros(dem.shape, dtype=bool)
    )
    cover = _landcover(data_dir, dem.shape, transform, set(cfg.exclude_landcover))
    excluded = water | cover
    mask = lowlying_mask(dem, cfg, excluded)
    polygons = features(mask, transform)
    # Coverage is what was screened: unscreened cells (mapped water, forest, scrub) are a gap,
    # so paths and places over them read UNKNOWN ("not screened"), never as checked and clear.
    valid = unary_union(_polygons(np.isfinite(dem) & ~excluded, transform))
    edges, places, gaps = classify_world(world, polygons, valid)
    source_path = data_dir / "flood/scenarios.json"
    bundle = json.loads(source_path.read_text(encoding="utf-8"))
    bundle["scenarios"] = [
        s for s in bundle["scenarios"] if s["id"] != "lowlying" and s.get("kind") != "combined"
    ]
    bundle["scenarios"].append(
        {
            "id": "lowlying",
            "label": LABEL,
            "stage_m": 0,
            "kind": "lowlying",
            "components": ["lowlying"],
            "method": "priority_flood_terrain_screen",
            "dem": "Copernicus GLO-30",
            "disclaimer": DISCLAIMER,
            "created": datetime.now(UTC).date().isoformat(),
            "links": [
                {
                    "label": "Copernicus DEM product",
                    "url": "https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model",
                }
            ],
        }
    )
    bundle.setdefault("edge_classes", {})["lowlying"] = edges
    bundle.setdefault("place_classes", {})["lowlying"] = places
    bundle.setdefault("scenario_coverage", {})["lowlying"] = gaps
    report = {
        "method": "priority_flood_terrain_screen",
        "config": {**cfg.__dict__, "exclude_landcover": list(cfg.exclude_landcover)},
        "not_screened_cells": int(excluded.sum()),
        "dem_shape": list(dem.shape),
        "finite_cells": int(np.isfinite(dem).sum()),
        "lowlying_cells": int(mask.sum()),
        "polygon_count": len(polygons),
        "area_m2": round(sum(f["properties"]["area_m2"] for f in polygons), 1),
        "possible_edges": len(edges),
        "possible_places": len(places),
        "coverage_gaps": len(gaps),
        "disclaimer": DISCLAIMER,
    }
    outputs = {
        data_dir / "flood/lowlying.geojson": {
            "type": "FeatureCollection",
            "features": polygons,
            "disclaimer": DISCLAIMER,
        },
        data_dir / "flood/lowlying-audit.json": report,
        source_path: bundle,
    }
    for path, value in outputs.items():
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_text(json.dumps(value, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        temp.replace(path)
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-dir", type=Path, default=build_flood.DEFAULT_DATA_DIR)
    ap.add_argument("--config", type=Path, default=CONFIG)
    args = ap.parse_args(argv)
    dem, transform = build_flood.read_window(build_flood.DEM_URL, build_flood.AREA, "glo30_dem")
    report = write_outputs(args.data_dir.resolve(), dem, transform, load_config(args.config))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
