"""Local tangent plane, the same as apps/web/src/features/scene/three/frame.ts.

x = east, z = -north (glTF / Three.js y-up), metres, using the WGS84 radii of curvature at the
origin. Pure Python.
"""

import math

A = 6378137.0
E2 = 0.00669437999014
RAD = math.pi / 180.0


def to_local(lon: float, lat: float, origin: tuple[float, float]) -> tuple[float, float]:
    """(x east, z = -north) in metres of (lon, lat) relative to `origin` (lon, lat)."""
    phi0 = origin[1] * RAD
    s = 1.0 - E2 * math.sin(phi0) ** 2
    meridional = A * (1.0 - E2) / s**1.5
    east_per_rad = A / math.sqrt(s) * math.cos(phi0)
    x = (lon - origin[0]) * RAD * east_per_rad
    north = (lat - origin[1]) * RAD * meridional
    return x, (-north if north else 0.0)


def ring_centroid(ring: list[list[float]]) -> tuple[float, float]:
    """Area centroid (lon, lat) of a polygon ring; open or closed, either winding."""
    pts = [(float(p[0]), float(p[1])) for p in ring]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if not pts:
        raise ValueError("empty ring")
    lon0, lat0 = pts[0]  # shift for numerical stability
    a2 = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1], strict=True):
        x1, y1, x2, y2 = x1 - lon0, y1 - lat0, x2 - lon0, y2 - lat0
        cross = x1 * y2 - x2 * y1
        a2 += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(a2) < 1e-18:  # degenerate: vertex mean
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    return lon0 + cx / (3.0 * a2), lat0 + cy / (3.0 * a2)


def outline_ring(landmarks_fc: dict, model: str) -> list[list[float]] | None:
    """Outer ring [[lon, lat], ...] of the landmarks.geojson feature whose `model` is `model`
    (the largest polygon of a MultiPolygon), or None. A footprint is never invented."""
    for f in (landmarks_fc or {}).get("features", []):
        if (f.get("properties") or {}).get("model") != model:
            continue
        geom = f.get("geometry") or {}
        if geom.get("type") == "Polygon":
            return geom["coordinates"][0]
        if geom.get("type") == "MultiPolygon":
            return max(geom["coordinates"], key=lambda poly: len(poly[0]))[0]
    return None


def outline_local(ring: list[list[float]]) -> list[tuple[float, float]]:
    """The ring as open (x east, z = -north) metres around its own area centroid."""
    c = ring_centroid(ring)
    pts = [to_local(p[0], p[1], c) for p in ring]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts
