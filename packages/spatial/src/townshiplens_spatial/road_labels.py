"""Named mapped road labels clipped to the display township boundary (T-028)."""

from __future__ import annotations

import json
import math

from pydantic import BaseModel
from shapely.geometry import LineString, box, shape
from shapely.ops import unary_union

from .geo import haversine_m


class RoadLabel(BaseModel):
    name: str
    road_class: str
    length_m: float
    anchor: list[float]
    bearing_deg: float


def _boundary(world):
    ref = world.site.boundary
    if ref and world.data_dir:
        path = world.data_dir / ref.file
        # A configured but unreadable boundary is a data error, not permission to
        # label outside the township. Callers translate it to a service error.
        data = json.loads(path.read_text(encoding="utf-8"))
        if data["type"] == "FeatureCollection":
            return unary_union([shape(f["geometry"]) for f in data["features"]])
        return shape(data["geometry"] if data["type"] == "Feature" else data)
    return box(*world.site.bbox)


def _parts(geom):
    if geom.geom_type == "LineString":
        return [geom] if not geom.is_empty else []
    return [line for part in getattr(geom, "geoms", []) for line in _parts(part)]


def _length(line):
    return sum(haversine_m(a, b) for a, b in zip(line.coords, list(line.coords)[1:], strict=False))


def road_labels(world) -> list[RoadLabel]:
    boundary = _boundary(world)
    roads = {}
    for edge in sorted(world.edges.values(), key=lambda e: e.id):
        if not edge.name:
            continue
        for i, part in enumerate(_parts(LineString(edge.coords).intersection(boundary))):
            length = _length(part)
            if length > 0:
                roads.setdefault(edge.name, []).append((length, edge.id, i, part, edge))
    rows = []
    for name, parts in sorted(roads.items()):
        _, _, _, longest, edge = min(parts, key=lambda p: (-p[0], p[1], p[2]))
        mid = longest.interpolate(0.5, normalized=True)
        a, b = (longest.interpolate(t, normalized=True) for t in (0.49, 0.51))
        bearing = (
            math.degrees(math.atan2((b.x - a.x) * math.cos(math.radians(mid.y)), b.y - a.y)) % 360
        )
        rows.append(
            RoadLabel(
                name=name,
                road_class=edge.osm_tags.get("highway", edge.type),
                length_m=round(sum(p[0] for p in parts), 1),
                anchor=[mid.x, mid.y],
                bearing_deg=round(bearing, 1),
            )
        )
    return rows
