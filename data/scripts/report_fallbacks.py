"""Fallback report for the Three.js stylised city (analysis only, no data is written).

Mirrors rules 1-3 of apps/web/src/features/scene/three/assets/fit.ts (`fitArchetype`) and the
gating in three/assets/plan.ts (`planCity`):
  1. fill: OBB fill < 0.75 (generic: 0.85) -> fallback ("fill")
  2. row: `frontage` assets repeat n = max(1, round(F / w)) units along the frontage
  3. scale bands: sx = F / (n*w), sz = D / d, sy = h / H must sit in the spec's fit bands
It reads the bands and sizes from assets/blender/tl_assets/specs.py (ASSETS). It does not
mirror the yaw/palette part of fit.ts. Reasons: fit | fill | sx | sz | sy | no_asset | no_archetype.

    uv run python -m data.scripts.report_fallbacks --radius-m 1200 --center 101.5095,3.1805
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

from shapely.geometry import Polygon
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "assets" / "blender"))

from tl_assets import specs  # noqa: E402

HERO_CENTRE = (101.5095, 3.1805)  # bookmarks.ts HERO_CENTRE
BUILDINGS = ROOT / "data" / "seed" / "elmina" / "base" / "buildings.geojson"
GENERIC_MIN_FILL = 0.85
MIN_FILL = 0.75
LINK = ("link_intermediate", "link_long")

_A = 6378137.0
_E2 = 0.00669437999014


def metres_per_degree(origin):
    """(metres per degree east, metres per degree north) at origin; same maths as frame.ts."""
    phi = math.radians(origin[1])
    s = 1 - _E2 * math.sin(phi) ** 2
    north = _A * (1 - _E2) / s**1.5 * math.pi / 180
    east = _A / math.sqrt(s) * math.cos(phi) * math.pi / 180
    return east, north


def spec_by_id():
    return dict(specs.ASSETS)


def to_local(ring, origin=HERO_CENTRE):
    kx, ky = metres_per_degree(origin)
    return [((lon - origin[0]) * kx, (lat - origin[1]) * ky) for lon, lat in ring]


@dataclass
class Obb:
    w: float
    l: float  # noqa: E741
    angle: float  # direction of the long axis, radians (x east, y north)
    fill: float


def footprint_obb(pts):
    """Min-area rectangle (w <= l) of a footprint; fill = area / rectangle area."""
    poly = Polygon(pts)
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.is_empty or poly.area < 1e-9:
        return None
    rect = poly.minimum_rotated_rectangle
    if rect.geom_type != "Polygon":
        return None
    c = list(rect.exterior.coords)
    e1 = (c[1][0] - c[0][0], c[1][1] - c[0][1])
    e2 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
    a, b = math.hypot(*e1), math.hypot(*e2)
    long_e = e1 if a >= b else e2
    area = a * b
    if area < 1e-9:
        return None
    angle = math.atan2(long_e[1], long_e[0]) % math.pi
    return Obb(min(a, b), max(a, b), angle, min(1.0, poly.area / area))


def _variant(spec, height):
    vs = spec.variants
    if len(vs) > 1 and len({v.size[1] for v in vs}) > 1:
        return min(vs, key=lambda v: abs(v.size[1] - height))
    return vs[0]


def _within(v, band):
    return band[0] <= v <= band[1]


def _fit(obb, spec, height, front_deg):
    sw, sh, sd = _variant(spec, height).size
    ux, uy = math.cos(obb.angle), math.sin(obb.angle)  # long axis
    if front_deg is not None:
        a = math.radians(front_deg)
        dx, dy = math.sin(a), math.cos(a)  # compass azimuth -> (east, north)
        front_long = abs(dx * ux + dy * uy) <= abs(dx * -uy + dy * ux)
    elif spec.repeat == "frontage" and obb.l >= 1.8 * sw and obb.w >= 0.75 * sd:
        front_long = True
    else:
        front_long = spec.frontage == "long"
    f_len = obb.l if front_long else obb.w
    d_len = obb.w if front_long else obb.l
    n = max(1, round(f_len / sw)) if spec.repeat == "frontage" else 1
    sx, sz, sy = f_len / (n * sw), d_len / sd, height / sh
    if not _within(sx, spec.fit_xz):
        return "sx"
    if not _within(sz, spec.fit_xz):
        return "sz"
    if not _within(sy, spec.fit_y):
        return "sy"
    return "fit"


def _height(props):
    h = props.get("display_height_m")
    return h if h is not None else props.get("height_m", 0.0)


def _obb_of(feature, origin):
    return footprint_obb(to_local(feature["geometry"]["coordinates"][0], origin))


def classify(feature, spec, origin=HERO_CENTRE):
    props = feature.get("properties", {})
    if not props.get("archetype"):
        return "no_archetype"
    if spec is None:
        return "no_asset"
    obb = _obb_of(feature, origin)
    if obb is None:
        return "fill"
    min_fill = GENERIC_MIN_FILL if props["archetype"] == "generic" else MIN_FILL
    if obb.fill < min_fill:
        return "fill"
    front = props.get("front_deg")
    front = front if isinstance(front, int | float) else None
    return _fit(obb, spec, _height(props), front)


@dataclass
class Row:
    id: str
    archetype: str | None
    reason: str
    obb_w: float | None
    row_end: bool = False


def analyse(features, spec_map, origin=HERO_CENTRE):
    rows = []
    polys = {}
    for f in features:
        p = f["properties"]
        arch = p.get("archetype") or None
        reason = classify(f, spec_map.get(arch) if arch else None, origin)
        obb = _obb_of(f, origin)
        rows.append(Row(str(p.get("id")), arch, reason, obb.w if obb else None))
        if arch in LINK:
            ring = to_local(f["geometry"]["coordinates"][0], origin)
            polys[len(rows) - 1] = Polygon(ring).buffer(0.3)
    # A row end is a link unit touching exactly one other link unit.
    idx = list(polys)
    tree = STRtree([polys[i] for i in idx])
    for k, i in enumerate(idx):
        nb = [j for j in tree.query(polys[i]) if j != k and polys[i].intersects(polys[idx[j]])]
        rows[i].row_end = len(nb) == 1
    return rows


def end_width_histogram(rows, bin_m=1.0):
    """Histogram (bin start -> count) of OBB w for link row-end units failing on sx."""
    h = collections.Counter()
    for r in rows:
        if r.archetype in LINK and r.reason == "sx" and r.row_end and r.obb_w is not None:
            h[math.floor(r.obb_w / bin_m) * bin_m] += 1
    return dict(sorted(h.items()))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--radius-m", type=float, default=1200.0)
    ap.add_argument("--center", default="101.5095,3.1805")
    ap.add_argument("--buildings", default=str(BUILDINGS))
    a = ap.parse_args(argv)
    origin = tuple(float(x) for x in a.center.split(","))
    kx, ky = metres_per_degree(origin)
    feats = []
    for f in json.loads(Path(a.buildings).read_text(encoding="utf-8"))["features"]:
        ring = f["geometry"]["coordinates"][0]
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        if math.hypot((cx - origin[0]) * kx, (cy - origin[1]) * ky) <= a.radius_m:
            feats.append(f)
    rows = analyse(feats, spec_by_id(), origin)
    table = collections.Counter((r.archetype or "(none)", r.reason) for r in rows)
    print(f"buildings within {a.radius_m:.0f} m of {origin}: {len(rows)}")
    print(f"{'archetype':20s} {'reason':13s} {'count':>6s}")
    for (arch, reason), n in sorted(table.items()):
        print(f"{arch:20s} {reason:13s} {n:6d}")
    link_fb = [r for r in rows if r.archetype in LINK and r.reason != "fit"]
    sx = [r for r in link_fb if r.reason == "sx"]
    band = [r for r in sx if r.obb_w is not None and 7.5 <= r.obb_w <= 10.0]
    band_end = [r for r in band if r.row_end]
    print(f"\nlink_* fallbacks: {len(link_fb)}; failing sx: {len(sx)}")
    print(f"  sx with OBB w 7.5-10 m: {len(band)}; of those row-end: {len(band_end)}")
    share = len(band_end) / len(link_fb) if link_fb else 0.0
    share_all = len(band) / len(link_fb) if link_fb else 0.0
    print(f"  share row-end (strict): {share:.1%}; regardless of row position: {share_all:.1%}")
    print("\nOBB w histogram (1 m bins) of link sx failures: all / row-end")
    allh = collections.Counter(math.floor(r.obb_w) for r in sx if r.obb_w is not None)
    endh = end_width_histogram(rows)
    for b in sorted(allh):
        end = int(endh.get(float(b), 0))
        print(f"{b:4d}-{b + 1:<3d} m {allh[b]:5d} {end:5d} " + "#" * min(60, allh[b]))
    verdict = "FIRES" if share >= 0.2 else "does not fire"
    print(f"\nDecision rule (>=20%, strict row-end share): {verdict}")


if __name__ == "__main__":
    main()
