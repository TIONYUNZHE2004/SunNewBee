"""Building frontage azimuth for the stylised city (display only).

Adds `front_deg` and `front_source` to buildings with a non-generic archetype in
base/buildings.geojson, so the Three.js loader can turn a porch or shopfront toward its street.
`front_deg` is the outward normal of one side of the minimum rotated rectangle, in degrees
clockwise from north: the side whose midpoint is nearest a mapped street (walk.geojson `type`
street, major_road or pedestrian; footways are excluded) within 40 m, ties to the longer side.
A building with no street within 40 m gets neither field: the loader treats the front as unknown
and never guesses. Nothing here feeds routing, evaluation, flood or answers. No network access.
"""

import argparse
import json
import math
import sys
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.scripts import build_archetypes as ba  # noqa: E402
from data.scripts import build_buildings as bb  # noqa: E402

OUT = ROOT / "data" / "seed" / "elmina"
M_PER_DEG = bb.M_PER_DEG
STREET_TYPES = {"street", "major_road", "pedestrian"}
MAX_STREET_M = 40.0
TIE_M = 0.25  # sides this close to the nearest distance count as tied
REF_LAT = 3.18  # one fixed projection latitude for the whole site (Elmina is ~3.2 N)
_KX = M_PER_DEG * math.cos(math.radians(REF_LAT))

Side = tuple[tuple[float, float], tuple[float, float]]


def _proj(lon: float, lat: float) -> tuple[float, float]:
    return lon * _KX, lat * M_PER_DEG


def project_line(line: LineString) -> LineString:
    return LineString([_proj(x, y) for x, y in line.coords])


def street_geoms(features: list[dict]) -> list[LineString]:
    """Street centrelines in metres (footways, paths, steps and crossings are dropped)."""
    out = []
    for f in features:
        g = f.get("geometry") or {}
        if (f.get("properties") or {}).get("type") not in STREET_TYPES:
            continue
        if g.get("type") == "LineString" and len(g["coordinates"]) >= 2:
            out.append(LineString([_proj(p[0], p[1]) for p in g["coordinates"]]))
    return out


def obb_sides(ring_xy: list[tuple[float, float]]) -> list[Side]:
    """(midpoint, outward unit normal) of the four sides of the minimum rotated rectangle."""
    pts = list(Polygon(ring_xy).minimum_rotated_rectangle.exterior.coords)[:4]
    cx = sum(p[0] for p in pts) / 4
    cy = sum(p[1] for p in pts) / 4
    sides: list[Side] = []
    for i in range(4):
        (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % 4]
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        dx, dy = x2 - x1, y2 - y1
        ln = math.hypot(dx, dy) or 1.0
        nx, ny = dy / ln, -dx / ln
        if (mx - cx) * nx + (my - cy) * ny < 0:
            nx, ny = -nx, -ny
        sides.append(((mx, my), (nx, ny)))
    return sides


def _side_length(sides: list[Side], k: int) -> float:
    """Length of side k: the distance between the midpoints of its two neighbouring sides."""
    (ax, ay), (bx, by) = sides[(k - 1) % 4][0], sides[(k + 1) % 4][0]
    return math.hypot(bx - ax, by - ay)


def front_of(
    ring_lonlat: list[list[float]], streets: STRtree, geoms: list[LineString]
) -> tuple[float, str] | None:
    """(azimuth deg clockwise from north of the chosen side's outward normal, "street") or None.

    `geoms` are metre-frame street lines (see `street_geoms`) and `streets` their STRtree."""
    if not geoms:
        return None
    pts = [_proj(p[0], p[1]) for p in ba._open_ring(ring_lonlat)]
    if len(pts) < 3:
        return None
    sides = obb_sides(pts)
    dists = []
    for (mx, my), _ in sides:
        mid = Point(mx, my)
        dists.append(geoms[int(streets.nearest(mid))].distance(mid))
    best = min(dists)
    if best > MAX_STREET_M:
        return None
    tied = [k for k, d in enumerate(dists) if d <= best + TIE_M]
    k = min(tied, key=lambda i: (-_side_length(sides, i), i))
    nx, ny = sides[k][1]
    return round(math.degrees(math.atan2(nx, ny)), 1) % 360.0, "street"


def transform(features: list[dict], streets: STRtree, geoms: list[LineString]) -> list[dict]:
    """Copies of the features with `front_deg` / `front_source` on non-generic buildings that
    have a street within 40 m; stale values are removed first, so reruns are identical."""
    out = []
    for f in features:
        p = dict(f["properties"])
        p.pop("front_deg", None)
        p.pop("front_source", None)
        if p.get("archetype") not in (None, "generic"):
            hit = front_of(f["geometry"]["coordinates"][0], streets, geoms)
            if hit is not None:
                p["front_deg"], p["front_source"] = hit
        out.append({**f, "properties": p})
    return out


def coverage(features: list[dict]) -> list[tuple[str | None, int, int]]:
    """(precinct, non-generic count, with frontage) per precinct; the last row is ("*", total)."""
    groups: dict[str | None, list[int]] = {}
    for f in features:
        p = f["properties"]
        if p.get("archetype") in (None, "generic"):
            continue
        g = groups.setdefault(p.get("precinct"), [0, 0])
        g[0] += 1
        g[1] += "front_deg" in p
    rows = [(k, *groups[k]) for k in sorted(k for k in groups if k is not None)]
    if None in groups:
        rows.append((None, *groups[None]))
    rows.append(("*", sum(r[1] for r in rows), sum(r[2] for r in rows)))
    return rows


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="compute and print, write nothing")
    args = ap.parse_args(argv)

    base = OUT / "base"
    buildings = json.loads((base / "buildings.geojson").read_text(encoding="utf-8"))["features"]
    walk = json.loads((base / "walk.geojson").read_text(encoding="utf-8"))["features"]
    geoms = street_geoms(walk)
    tree = STRtree(geoms)
    ids = [f["properties"]["id"] for f in buildings]
    out = transform(buildings, tree, geoms)
    if [f["properties"]["id"] for f in out] != ids:
        print("building ids changed during the transform; nothing written")
        raise SystemExit(3)
    print(f"street lines: {len(geoms)}")
    for name, n, k in coverage(out):
        label = "TOTAL" if name == "*" else (name or "(no precinct)")
        share = f"{k / n:.1%}" if n else "n/a"
        print(f"  {label}: {k}/{n} non-generic buildings with a frontage ({share})")
    if args.dry_run:
        print("dry run: nothing written")
        return
    text = bb._dump(out)
    if len(text.encode("utf-8")) > bb.MAX_BYTES:
        print(f"buildings.geojson would exceed {bb.MAX_BYTES} bytes; nothing written")
        raise SystemExit(3)
    (base / "buildings.geojson").write_text(text, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
