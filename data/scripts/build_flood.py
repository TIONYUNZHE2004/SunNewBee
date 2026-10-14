"""Indicative river-stage flood scenarios for the Elmina flood lens (ADR 0010).

Copernicus GLO-30 DEM + ASF GLO-30 HAND (CC0) -> connected-inundation scenarios stage_p1m..p5m.

Two stages (so the raster work can run before the OSM base layers exist):
  (a) raster: fetch + clip the DEM and HAND windows (cached as .npy in data/cache), build the
      scenario water polygons (flood/<scenario_id>.geojson) and flood/scenarios.json;
  (b) vector: per-edge / per-place flood classes (monotonic in stage) and evacuation-centre
      candidates; runs only when base/walk.geojson and base/places.geojson exist.

Indicative only: a 30 m surface model, not a forecast, never a water depth on a path.

Usage:
  uv run --group data python data/scripts/build_flood.py [--data-dir data/seed/elmina]
      [--stage all|raster|vector] [--refresh]
"""

from __future__ import annotations

import argparse
import difflib
import heapq
import json
import math
import sys
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "cache"
DEFAULT_DATA_DIR = ROOT / "data" / "seed" / "elmina"

DEM_URL = "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N03_00_E101_00_DEM/Copernicus_DSM_COG_10_N03_00_E101_00_DEM.tif"
HAND_URL = (
    "https://glo-30-hand.s3.amazonaws.com/v1/2021/Copernicus_DSM_COG_10_N03_00_E101_00_HAND.tif"
)
AREA = (101.460, 3.150, 101.560, 3.240)  # w, s, e, n: Elmina envelope + downstream Sungai Subang
STAGES = [1, 2, 3, 4, 5]
MARGIN = 0.5
DISCLAIMER = (
    "Indicative scenario from a 30 m elevation model (Copernicus GLO-30, HAND), not a forecast. "
    "Follow official MBSA / JPS / NADMA guidance."
)
LINKS = [
    {"label": "Public InfoBanjir (JPS)", "url": "https://publicinfobanjir.water.gov.my"},
    {"label": "MET Malaysia warnings", "url": "https://www.met.gov.my"},
]
ATTRIBUTION = [
    "Copernicus DEM GLO-30 © DLR/Airbus, provided under COPERNICUS by the EU and ESA",
    "HAND: ASF (CC0)",
]

# HAND is 0 on drainage cells by definition; 1 cm absorbs float noise. (The brief's 0.5 m would
# make its own test fail: the 0.4 m isolated hollow would count as a drainage cell.)
DRAINAGE_MAX_M = 0.01
SAMPLE_STEP_M = 10.0
SIMPLIFY_DEG = 0.0002  # ~22 m
# Water surfaces are flat per polygon; one surface for a whole river network would sit below the
# ground upstream. Pieces are cut on this grid (~1.1 km) so each gets a local surface height.
TILE_DEG = 0.01
COORD_DP = 6  # points (same as the OSM import)
WATER_DP = 5  # ~1 m: ample for 30 m cells, keeps flood/*.geojson under ~2 MB
EVAC_TYPES = {"community_centre", "school", "place_of_worship", "townhall"}
# (name in news, news URL, date): official_pps ONLY on an exact OSM name match
OFFICIAL_PPS_REPORTS = [
    (
        "Dewan MBSA Matahari",
        "https://berita.rtm.gov.my/nasional/senarai-berita-nasional/senarai-artikel/banjir-kilat-di-paya-jaras-semakin-pulih-3-pps-masih-beroperasi",
        "2024-10-04",
    ),
]
FUZZY_MIN = 0.6
SITE_CENTRE = (101.5099, 3.1813)  # lon, lat (site.json center / Lakeside Mall)
_RANK = {"unlikely": 0, "possible": 1, "likely_flooded": 2}
_CLASS = {v: k for k, v in _RANK.items()}
_EIGHT = np.ones((3, 3), dtype=bool)


# --- pure helpers ---------------------------------------------------------------------------------


def classify(hand_min: float, stage: float, margin: float) -> str:
    """World-model schema §10.2. NaN (no coverage) is never classified as flooded."""
    if hand_min is None or math.isnan(hand_min):
        return "unlikely"
    if hand_min < stage - margin:
        return "likely_flooded"
    if hand_min < stage + margin:
        return "possible"
    return "unlikely"


def connected_mask(hand: np.ndarray, stage: float) -> np.ndarray:
    """Cells with HAND < stage that are 8-connected (through such cells) to a drainage cell."""
    from scipy import ndimage

    with np.errstate(invalid="ignore"):
        wet = np.nan_to_num(hand, nan=np.inf) < stage
        drain = wet & (np.nan_to_num(hand, nan=np.inf) <= DRAINAGE_MAX_M)
    labels, n = ndimage.label(wet, structure=_EIGHT)
    if n == 0:
        return wet
    keep = np.zeros(n + 1, dtype=bool)
    keep[np.unique(labels[drain])] = True
    keep[0] = False
    return keep[labels]


def effective_hand(hand: np.ndarray) -> np.ndarray:
    """Connected HAND: the lowest stage at which a cell joins the drainage-connected water.

    = min over 8-connected paths from a drainage cell of the max HAND along the path (minimax /
    priority flood). Isolated hollows get the height of their barrier; NaN cells are never wet.
    Invariant (tested): connected_mask(hand, s) == (effective_hand(hand) < s) for every s.
    """
    h = np.nan_to_num(np.asarray(hand, dtype=float), nan=np.inf)
    rows, cols = h.shape
    out = np.full(h.shape, np.inf)
    heap: list[tuple[float, int, int]] = []
    for r, c in zip(*np.nonzero(h <= DRAINAGE_MAX_M), strict=True):
        out[r, c] = h[r, c]
        heap.append((h[r, c], int(r), int(c)))
    heapq.heapify(heap)
    while heap:
        v, r, c = heapq.heappop(heap)
        if v > out[r, c]:
            continue
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                rr, cc = r + dr, c + dc
                if (dr or dc) and 0 <= rr < rows and 0 <= cc < cols:
                    nv = max(v, h[rr, cc])
                    if nv < out[rr, cc]:
                        out[rr, cc] = nv
                        heapq.heappush(heap, (nv, rr, cc))
    return out


def scenario_ids(stages=STAGES) -> list[str]:
    return ["baseline"] + [f"stage_p{s}m" for s in stages]


def stage_classes(values: dict[str, float], stages, margin, classify_fn=classify):
    """{scenario_id: {element_id: class}} with likely/possible only, monotonic in stage."""
    out: dict[str, dict[str, str]] = {}
    best: dict[str, int] = {}
    for s in stages:
        cur: dict[str, str] = {}
        for eid, v in values.items():
            r = max(best.get(eid, 0), _RANK[classify_fn(v, s, margin)])  # never "less flooded"
            best[eid] = r
            if r:
                cur[eid] = _CLASS[r]
        out[f"stage_p{s}m"] = cur
    return out


def _m_per_deg(lat: float) -> tuple[float, float]:
    return 111_320.0 * math.cos(math.radians(lat)), 110_574.0


def sample_line(coords: list[list[float]], step_m: float = SAMPLE_STEP_M) -> list[tuple]:
    pts: list[tuple[float, float]] = [tuple(coords[0][:2])]
    for (x0, y0, *_), (x1, y1, *_) in zip(coords, coords[1:], strict=False):
        mx, my = _m_per_deg((y0 + y1) / 2)
        n = max(1, math.ceil(math.hypot((x1 - x0) * mx, (y1 - y0) * my) / step_m))
        pts += [(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n) for k in range(1, n + 1)]
    return pts


def sample_raster(arr: np.ndarray, transform, pts) -> np.ndarray:
    from rasterio.transform import rowcol

    if not pts:
        return np.array([])
    rows, cols = rowcol(transform, [p[0] for p in pts], [p[1] for p in pts])
    rows, cols = np.asarray(rows), np.asarray(cols)
    ok = (rows >= 0) & (rows < arr.shape[0]) & (cols >= 0) & (cols < arr.shape[1])
    vals = np.full(len(pts), np.nan)
    vals[ok] = arr[rows[ok], cols[ok]]
    return vals


def _nanmin(vals: np.ndarray) -> float:
    vals = vals[~np.isnan(vals)]
    return float(vals.min()) if vals.size else float("nan")


# --- raster stage ---------------------------------------------------------------------------------


def read_window(url: str, area=AREA, name: str | None = None, refresh: bool = False):
    """Windowed read of a public COG over HTTP (GDAL /vsicurl/), cached to data/cache/*.npy."""
    import rasterio
    from affine import Affine
    from rasterio.windows import Window, from_bounds

    name = name or Path(url).stem
    tag = "_".join(f"{v:.3f}" for v in area)
    npy, meta = CACHE / f"{name}_{tag}.npy", CACHE / f"{name}_{tag}.json"
    if npy.exists() and meta.exists() and not refresh:
        return np.load(npy), Affine(*json.loads(meta.read_text())["transform"])
    env = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "GDAL_HTTP_MAX_RETRY": "3"}
    with rasterio.Env(**env), rasterio.open(url) as ds:
        w = from_bounds(*area, transform=ds.transform)
        c0, r0 = math.floor(w.col_off), math.floor(w.row_off)
        win = Window(
            c0, r0, math.ceil(w.col_off + w.width) - c0, math.ceil(w.row_off + w.height) - r0
        )
        arr = ds.read(1, window=win, masked=True).astype("float64").filled(np.nan)
        t = ds.window_transform(win)
        crs = str(ds.crs)
    CACHE.mkdir(parents=True, exist_ok=True)
    np.save(npy, arr)
    meta.write_text(json.dumps({"url": url, "crs": crs, "transform": list(t)[:6]}))
    return arr, t


def _round(o, dp: int = COORD_DP):
    if isinstance(o, dict):
        return {k: _round(v, dp) for k, v in o.items()}
    if isinstance(o, float):
        return round(o, dp)
    if isinstance(o, list | tuple):
        return [_round(v, dp) for v in o]
    return o


def _area_km2(geom) -> float:
    if geom.is_empty:
        return 0.0
    mx, my = _m_per_deg(geom.centroid.y)
    return geom.area * mx * my / 1e6


def water_features(
    hand, dem, transform, stages=STAGES, simplify_deg=SIMPLIFY_DEG, tile_deg=TILE_DEG, area=None
) -> dict[str, list[dict]]:
    """{scenario_id: [GeoJSON Feature]}; each stage's water contains every lower stage's water.

    Pieces smaller than half a raster cell (tile-cut slivers) are dropped; a dropped piece's
    region is either dropped at every lower stage too or covered by a kept piece, so nesting holds
    exactly before the output coordinates are rounded to WATER_DP decimals (~1 m).
    """
    from rasterio.features import geometry_mask, shapes
    from shapely.geometry import box, mapping, shape
    from shapely.ops import unary_union

    out: dict[str, list[dict]] = {"baseline": []}  # normal river level: no scenario water
    min_piece = 0.5 * abs(transform.a * transform.e)
    prev = None
    for s in stages:
        sid = f"stage_p{s}m"
        mask = connected_mask(hand, s)
        polys = [
            shape(g)
            for g, _ in shapes(mask.astype("uint8"), mask=mask, transform=transform, connectivity=8)
        ]
        geom = unary_union(polys)
        if simplify_deg:
            geom = geom.simplify(simplify_deg, preserve_topology=True)
        if prev is not None:
            geom = unary_union([geom, prev])  # exact nesting despite simplification
        geom = geom.buffer(0)
        prev = geom
        if area is not None:
            geom = geom.intersection(box(*area))
        pieces = []
        if not geom.is_empty:
            w, so, e, n = geom.bounds
            for i in range(math.floor(w / tile_deg), math.ceil(e / tile_deg)):
                for j in range(math.floor(so / tile_deg), math.ceil(n / tile_deg)):
                    cell = box(i * tile_deg, j * tile_deg, (i + 1) * tile_deg, (j + 1) * tile_deg)
                    part = geom.intersection(cell)
                    pieces += [
                        p
                        for p in getattr(part, "geoms", [part])
                        if p.geom_type == "Polygon" and p.area >= min_piece
                    ]
        feats = []
        for p in pieces:
            inside = ~geometry_mask([p], out_shape=mask.shape, transform=transform)
            sel = inside & mask
            if not sel.any():
                sel = ~geometry_mask(
                    [p], out_shape=mask.shape, transform=transform, all_touched=True
                )
            vals = dem[sel]
            vals = vals[~np.isnan(vals)]
            if not vals.size:
                continue
            feats.append(
                {
                    "type": "Feature",
                    "geometry": _round(mapping(p), WATER_DP),
                    "properties": {
                        "scenario_id": sid,
                        "surface_height_m": round(float(np.percentile(vals, 5)) + s, 2),
                    },
                }
            )
        out[sid] = feats
    return out


# --- vector stage ---------------------------------------------------------------------------------


def _features(path: Path) -> list[dict]:
    return json.loads(path.read_text())["features"] if path.exists() else []


def _in_area(coord, area=AREA) -> bool:
    w, s, e, n = area
    return w <= coord[0] <= e and s <= coord[1] <= n


def evac_centres(places: list[dict], area=AREA) -> list[dict]:
    from townshiplens_spatial.models import EvacCentre

    cands = [
        f
        for f in places
        if f["properties"].get("type") in EVAC_TYPES
        and f["properties"].get("kind", "place") == "place"
        and _in_area(f["geometry"]["coordinates"], area)
    ]
    centres: dict[str, EvacCentre] = {}
    for f in cands:
        p = f["properties"]
        centres[p["id"]] = EvacCentre(
            id=f"evc-{p['id']}",
            place_id=p["id"],
            name=p["name"],
            coord=f["geometry"]["coordinates"][:2],
            node_id=p.get("node_id"),
            source="osm_candidate",
        )

    def norm(s: str) -> str:
        return " ".join(s.split()).casefold()

    for name, url, day in OFFICIAL_PPS_REPORTS:
        exact = [pid for pid, c in centres.items() if norm(c.name) == norm(name)]
        if exact:
            for pid in exact:
                c = centres[pid]
                centres[pid] = c.model_copy(
                    update={
                        "id": f"pps-{pid}",
                        "source": "official_pps",
                        "evidence_url": url,
                        "notes": f"named as a PPS (relief centre) in news on {day}; "
                        "PPS status is set per event by the district disaster committee",
                    }
                )
            continue
        scored = sorted(
            (
                (difflib.SequenceMatcher(None, norm(name), norm(c.name)).ratio(), pid)
                for pid, c in centres.items()
            ),
            reverse=True,
        )
        if scored and scored[0][0] >= FUZZY_MIN:
            pid = scored[0][1]
            d = date.fromisoformat(day)
            centres[pid] = centres[pid].model_copy(
                update={
                    "notes": f"news reports a PPS named '{name}' on {d.day} {d:%b %Y}; "
                    "match to this hall unverified",
                    "evidence_url": url,
                }
            )
    return [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": _round(c.coord)},
            "properties": c.model_dump(exclude={"coord"}, exclude_none=True),
        }
        for c in sorted(centres.values(), key=lambda c: c.id)
    ]


def vector_stage(data_dir: Path, eff_hand: np.ndarray, transform, stages=STAGES, margin=MARGIN):
    walk_p, places_p = data_dir / "base/walk.geojson", data_dir / "base/places.geojson"
    if not (walk_p.exists() and places_p.exists()):
        print(
            f"[vector] base layers missing; run import_osm.py first ({walk_p.parent}). "
            "Skipping edge/place classes and evacuation centres."
        )
        return None
    walk, places = _features(walk_p), _features(places_p)
    edge_h: dict[str, float] = {}
    for f in walk:
        if f["geometry"]["type"] == "LineString":
            vals = sample_raster(eff_hand, transform, sample_line(f["geometry"]["coordinates"]))
            edge_h[f["properties"]["id"]] = _nanmin(vals)
    place_h = {
        f["properties"]["id"]: _nanmin(
            sample_raster(eff_hand, transform, [tuple(f["geometry"]["coordinates"][:2])])
        )
        for f in places
        if f["geometry"]["type"] == "Point"
    }
    no_cov = sum(1 for v in edge_h.values() if math.isnan(v))
    edge_classes = {"baseline": {}, **stage_classes(edge_h, stages, margin)}
    place_classes = {"baseline": {}, **stage_classes(place_h, stages, margin)}
    return {
        "edge_classes": edge_classes,
        "place_classes": place_classes,
        "centres": evac_centres(places),
        "edge_hand_min": edge_h,
        "place_hand_min": place_h,
        "stats": {"edges": len(edge_h), "edges_no_coverage": no_cov, "places": len(place_h)},
    }


# --- outputs --------------------------------------------------------------------------------------


def _write_fc(path: Path, features: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fc = {"type": "FeatureCollection", "features": features}
    path.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + "\n")


def scenarios(stages=STAGES, created: str | None = None) -> list[dict]:
    created = created or date.today().isoformat()
    base = {
        "method": "HAND",
        "dem": "Copernicus GLO-30",
        "margin_m": MARGIN,
        "created": created,
        "disclaimer": DISCLAIMER,
        "links": LINKS,
    }
    return [{"id": "baseline", "label": "Normal river level", "stage_m": 0, **base}] + [
        {"id": f"stage_p{s}m", "label": f"River +{s} m (indicative)", "stage_m": s, **base}
        for s in stages
    ]


EGM2008_N_AT_0_0 = 17.2  # published EGM2008 geoid height at (0, 0), ~17.2 m: grid sanity check


def geoid_undulation(lon: float, lat: float) -> float | None:
    """EGM2008 geoid height N (m) at a point, via PROJ's EGM2008 grid from the PROJ CDN.

    Ellipsoidal h = orthometric H + N, so the renderer offset is `datum_offset_m = N`.
    Without the grid PROJ silently returns 0, so the result is only trusted when the (0, 0)
    reference value comes out right; otherwise None (do not guess).
    """
    import os

    os.environ.setdefault("PROJ_NETWORK", "ON")
    try:
        from rasterio.crs import CRS
        from rasterio.warp import transform

        src, dst = CRS.from_string("EPSG:4326+3855"), CRS.from_epsg(4979)
        ref = transform(src, dst, [0.0], [0.0], [0.0])[2][0]
        n = transform(src, dst, [lon], [lat], [0.0])[2][0]
    except Exception as exc:  # noqa: BLE001 - network/grid failures mean "unknown"
        print(f"[datum] EGM2008 lookup failed: {exc}")
        return None
    if abs(ref - EGM2008_N_AT_0_0) > 0.5 or n == 0.0:
        print(f"[datum] EGM2008 grid unavailable (check value at 0,0 = {ref:.2f} m); not set")
        return None
    return round(float(n), 2)


def update_site(data_dir: Path, datum_offset_m: float | None = None) -> bool:
    """Append the DEM/HAND credits (and the datum offset, when known) to site.json.

    Never creates site.json: the OSM import (Task 3) owns it.
    """
    site_p = data_dir / "site.json"
    if not site_p.exists():
        print(
            f"[site] {site_p} missing; add when it exists: attribution {ATTRIBUTION}"
            + (f", scene.datum_offset_m={datum_offset_m}" if datum_offset_m is not None else "")
        )
        return False
    site = json.loads(site_p.read_text())
    before = json.dumps(site, sort_keys=True)
    attr = site.setdefault("attribution", [])
    attr.extend(a for a in ATTRIBUTION if a not in attr)
    if datum_offset_m is not None:
        site.setdefault("scene", {})["datum_offset_m"] = datum_offset_m
    if json.dumps(site, sort_keys=True) != before:
        site_p.write_text(json.dumps(site, ensure_ascii=False, indent=1) + "\n")
    return True


def write_outputs(
    data_dir: Path,
    water: dict[str, list[dict]],
    vec: dict | None,
    stages=STAGES,
    created: str | None = None,
    datum_offset_m: float | None = None,
) -> None:
    from townshiplens_spatial.models import FloodBundle

    flood_dir = data_dir / "flood"
    for sid, feats in water.items():
        _write_fc(flood_dir / f"{sid}.geojson", feats)
    bundle = {
        "scenarios": scenarios(stages, created),
        "edge_classes": vec["edge_classes"] if vec else {},
        "place_classes": vec["place_classes"] if vec else {},
    }
    FloodBundle.model_validate(bundle)  # contract check before writing
    (flood_dir / "scenarios.json").write_text(
        json.dumps(bundle, ensure_ascii=False, indent=1) + "\n"
    )
    if vec:
        _write_fc(flood_dir / "evac_centres.geojson", vec["centres"])
    update_site(data_dir, datum_offset_m)


# Research sanity points (flood-disaster-lens.md): high ground vs the documented flood area.
SANITY_POINTS = {
    "Lakeside Mall (high ground, ~45 m)": (101.5099, 3.1813),
    "Kampung Kubu Gajah (Jalan Kubu Gajah, OSM)": (101.5202, 3.1955),
}


def sanity_report(data_dir: Path, eff_hand, transform, vec, scenario_id="stage_p3m", k=5) -> str:
    """HAND at each sanity point and the class of the k nearest walk edges at `scenario_id`."""
    from shapely.geometry import LineString, Point

    walk = _features(data_dir / "base/walk.geojson")
    lines = []
    for label, (lon, lat) in SANITY_POINTS.items():
        mx, my = _m_per_deg(lat)
        pt = Point(lon * mx, lat * my)
        h = _nanmin(sample_raster(eff_hand, transform, [(lon, lat)]))
        lines.append(
            f"{label}: connected HAND at point = {h:.2f} m "
            f"({classify(h, float(scenario_id[7:-1]), MARGIN)} at {scenario_id})"
        )
        near = sorted(
            (
                pt.distance(
                    LineString([(x * mx, y * my) for x, y, *_ in f["geometry"]["coordinates"]])
                ),
                f["properties"]["id"],
            )
            for f in walk
            if f["geometry"]["type"] == "LineString"
        )[:k]
        for d, eid in near:
            cls = vec["edge_classes"][scenario_id].get(eid, "unlikely")
            lines.append(
                f"  {eid:<28} {d:6.0f} m away  hand_min={vec['edge_hand_min'][eid]:6.2f}"
                f"  {scenario_id}={cls}"
            )
    return "\n".join(lines)


def summary(water, vec, stages=STAGES) -> str:
    from shapely.geometry import shape
    from shapely.ops import unary_union

    lines = [
        f"{'scenario':<11}{'polygons':>9}{'area_km2':>10}{'likely_e':>10}{'possible_e':>11}"
        f"{'likely_pl':>10}"
    ]
    for s in stages:
        sid = f"stage_p{s}m"
        geom = unary_union([shape(f["geometry"]) for f in water[sid]])
        if vec:
            ec, pc = vec["edge_classes"][sid], vec["place_classes"][sid]
            le = sum(v == "likely_flooded" for v in ec.values())
            pe = sum(v == "possible" for v in ec.values())
            lp = str(sum(v == "likely_flooded" for v in pc.values()))
            le, pe = str(le), str(pe)
        else:
            le = pe = lp = "-"
        lines.append(
            f"{sid:<11}{len(water[sid]):>9}{_area_km2(geom):>10.3f}{le:>10}{pe:>11}{lp:>10}"
        )
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    ap.add_argument("--stage", choices=["all", "raster", "vector"], default="all")
    ap.add_argument("--refresh", action="store_true", help="re-download the raster windows")
    ap.add_argument(
        "--no-datum",
        action="store_true",
        help="skip the EGM2008 geoid lookup (leaves scene.datum_offset_m unchanged)",
    )
    args = ap.parse_args(argv)
    data_dir = args.data_dir.resolve()

    dem, t_dem = read_window(DEM_URL, AREA, "glo30_dem", args.refresh)
    hand, t_hand = read_window(HAND_URL, AREA, "asf_hand", args.refresh)
    if dem.shape != hand.shape or not t_dem.almost_equals(t_hand):
        raise SystemExit("DEM and HAND windows are not on the same grid")
    print(
        f"[raster] window {hand.shape} cells, HAND nan={int(np.isnan(hand).sum())}, "
        f"drainage cells={int((hand <= DRAINAGE_MAX_M).sum())}"
    )

    water = None
    if args.stage in ("all", "raster"):
        water = water_features(hand, dem, t_hand, area=AREA)
    vec = None
    eff = effective_hand(hand)
    if args.stage in ("all", "vector"):
        vec = vector_stage(data_dir, eff, t_hand)
    if water is None:  # vector-only run: reuse the committed water polygons
        water = {sid: _features(data_dir / f"flood/{sid}.geojson") for sid in scenario_ids()}
    datum = None if args.no_datum else geoid_undulation(*SITE_CENTRE)
    print(f"[datum] EGM2008 geoid height N at {SITE_CENTRE} = {datum} m (datum_offset_m)")
    write_outputs(data_dir, water, vec, datum_offset_m=datum)
    print(summary(water, vec))
    if vec:
        print(sanity_report(data_dir, eff, t_hand, vec))
        print(
            f"[vector] edges={vec['stats']['edges']} (no coverage: "
            f"{vec['stats']['edges_no_coverage']}), centres={len(vec['centres'])}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
