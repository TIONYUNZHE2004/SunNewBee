"""Indicative river-stage flood scenarios for the Elmina flood lens (ADR 0010).

Default method `rem` (coordinator ruling, 15 Oct 2026): a Relative Elevation Model over the
Copernicus GLO-30 DEM, with drainage = OSM waterway=river|stream|canal lines + natural=water /
water=* polygons (not ASF HAND's dense channel network). REM = DEM - DEM at the nearest drainage
cell (median-smoothed along the channel). `--method hand` keeps ASF GLO-30 HAND (CC0) as a
comparison. Both feed the same connected-inundation rule, margin, monotonic classes, water tiling
and surface heights -> scenarios stage_p1m..p5m.

Two stages (so the raster work can run before the OSM base layers exist):
  (a) raster: fetch + clip the DEM (and HAND) windows (cached as .npy in data/cache), the OSM
      drainage (one Overpass query, cached), the scenario water polygons
      (flood/<scenario_id>.geojson) and flood/scenarios.json;
  (b) vector: per-edge / per-place flood classes (monotonic in stage) and evacuation-centre
      candidates; runs only when base/walk.geojson and base/places.geojson exist.

Indicative only: a 30 m surface model, not a forecast, never a water depth on a path.

Usage:
  uv run --group data python data/scripts/build_flood.py [--data-dir data/seed/elmina]
      [--stage all|raster|vector] [--method rem|hand] [--osm-water FILE ...] [--refresh]
      [--no-datum]
"""

from __future__ import annotations

import argparse
import difflib
import heapq
import json
import math
import re
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
DISCLAIMERS = {
    "rem": (
        "Indicative scenario from a 30 m elevation model (Copernicus GLO-30, height above mapped "
        "rivers and lakes), not a forecast. Follow official MBSA / JPS / NADMA guidance. "
        f"Only the area {AREA[0]:.2f}\u2013{AREA[2]:.2f} E, {AREA[1]:.2f}\u2013{AREA[3]:.2f} N "
        "is assessed; paths outside it are not."
    ),
    "hand": (
        "Indicative scenario from a 30 m elevation model (Copernicus GLO-30, HAND), not a "
        "forecast. Follow official MBSA / JPS / NADMA guidance."
    ),
}
DISCLAIMER = DISCLAIMERS["rem"]
LINKS = [
    {"label": "Public InfoBanjir (JPS)", "url": "https://publicinfobanjir.water.gov.my"},
    {"label": "MET Malaysia warnings", "url": "https://www.met.gov.my"},
]
COPERNICUS_CREDIT = (
    "Copernicus DEM GLO-30 © DLR/Airbus, provided under COPERNICUS by the EU and ESA"
)
ATTRIBUTIONS = {
    "rem": [
        COPERNICUS_CREDIT,
        "Flood scenarios: relative elevation above mapped OSM drainage (indicative)",
        "© OpenStreetMap contributors (ODbL)",
    ],
    "hand": [COPERNICUS_CREDIT, "HAND: ASF (CC0)"],
}
ATTRIBUTION = ATTRIBUTIONS["rem"]

REM_SMOOTH_CELLS = 5  # median window (cells) along the channel for drainage elevations
REM_FLOOR_CELLS = 3  # valley-floor window (cells): OSM lines sit <= 1 cell off the DEM valley
OSM_WATER_QL = """[out:json][timeout:180];
(
  way["waterway"~"^(river|stream|canal)$"]({s},{w},{n},{e});
  way["natural"="water"]({s},{w},{n},{e});
  relation["natural"="water"]({s},{w},{n},{e});
  way["water"]({s},{w},{n},{e});
  relation["water"]({s},{w},{n},{e});
);
out geom;"""
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
OVERPASS_MAX_REQUESTS = 3
METHODS = {"rem": "REM", "hand": "HAND"}  # Scenario.method
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
DEDUPE_RADIUS_M = 100.0
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


def _drain_mask(rel: np.ndarray, drain: np.ndarray | None) -> np.ndarray:
    """Seed cells: the explicit drainage mask (REM), or HAND <= 1 cm (HAND's own drainage)."""
    if drain is not None:
        return np.asarray(drain, dtype=bool) & ~np.isnan(rel)
    return np.nan_to_num(rel, nan=np.inf) <= DRAINAGE_MAX_M


def connected_mask(hand: np.ndarray, stage: float, drain: np.ndarray | None = None) -> np.ndarray:
    """Cells with relative height < stage, 8-connected (through such cells) to a drainage cell.

    `hand` is any relative-height raster (ASF HAND or the OSM-drainage REM); `drain` is the
    explicit drainage mask (default: HAND <= 1 cm).
    """
    from scipy import ndimage

    wet = np.nan_to_num(hand, nan=np.inf) < stage
    seeds = wet & _drain_mask(hand, drain)
    labels, n = ndimage.label(wet, structure=_EIGHT)
    if n == 0:
        return wet
    keep = np.zeros(n + 1, dtype=bool)
    keep[np.unique(labels[seeds])] = True
    keep[0] = False
    return keep[labels]


def effective_hand(hand: np.ndarray, drain: np.ndarray | None = None) -> np.ndarray:
    """Connected relative height: the lowest stage at which a cell joins drainage-connected water.

    = min over 8-connected paths from a drainage cell of the max relative height along the path
    (minimax / priority flood). Isolated hollows get the height of their barrier; NaN cells are
    never wet. Invariant (tested): connected_mask(h, s, d) == (effective_hand(h, d) < s).
    """
    h = np.nan_to_num(np.asarray(hand, dtype=float), nan=np.inf)
    rows, cols = h.shape
    out = np.full(h.shape, np.inf)
    heap: list[tuple[float, int, int]] = []
    for r, c in zip(*np.nonzero(_drain_mask(hand, drain)), strict=True):
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


def relative_elevation(
    dem: np.ndarray,
    drain: np.ndarray,
    smooth: int = REM_SMOOTH_CELLS,
    floor: int = REM_FLOOR_CELLS,
):
    """REM = DEM - channel elevation at the nearest drainage cell; 0 on the drainage itself.

    Channel elevation per drainage cell = the lowest DEM within a `floor` x `floor` window (the
    valley floor: OSM lines sit up to a cell off the DEM's valley, and the surface model reads
    tree canopy / bridge decks over a narrow river), then the median of that over drainage cells
    in a `smooth` x `smooth` window (damps remaining spikes along the channel).
    Cells with no drainage in the window at all -> NaN.
    """
    from numpy.lib.stride_tricks import sliding_window_view
    from scipy import ndimage

    drain = np.asarray(drain, dtype=bool) & ~np.isnan(dem)
    if not drain.any():
        return np.full(dem.shape, np.nan)
    z = np.where(drain, dem, np.nan)
    if floor > 1:
        k = floor // 2
        win = sliding_window_view(np.pad(dem, k, mode="edge"), (floor, floor))
        z[drain] = np.nanmin(win[drain], axis=(1, 2))
    if smooth > 1:
        k = smooth // 2
        win = sliding_window_view(np.pad(z, k, constant_values=np.nan), (smooth, smooth))
        z_d = z.copy()
        z_d[drain] = np.nanmedian(win[drain], axis=(1, 2))
    else:
        z_d = z
    _, (ri, ci) = ndimage.distance_transform_edt(~drain, return_indices=True)
    rem = dem - z_d[ri, ci]
    rem[drain] = 0.0
    return rem


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


def _cell_tiles(shape, transform, tile_deg: float) -> tuple[np.ndarray, np.ndarray]:
    """Tile indices (i, j) = floor(centre / tile_deg) of every cell centre."""
    rows, cols = np.indices(shape)
    xs = transform.c + (cols + 0.5) * transform.a + rows * transform.b
    ys = transform.f + (rows + 0.5) * transform.e + cols * transform.d
    return np.floor(xs / tile_deg).astype(int), np.floor(ys / tile_deg).astype(int)


def tile_references(rel, dem, transform, top_mask, tile_deg=TILE_DEG) -> dict[tuple, float]:
    """Stage-independent water reference per tile: the median channel elevation (DEM - REM, or
    DEM - HAND = drainage elevation) over the tile's cells that are wet at the top stage.
    The drawn water surface of every stage in the tile is reference + stage (1 m per stage)."""
    ti, tj = _cell_tiles(dem.shape, transform, tile_deg)
    base = np.asarray(dem, dtype=float) - np.asarray(rel, dtype=float)
    sel = np.asarray(top_mask, dtype=bool) & ~np.isnan(base)
    refs: dict[tuple, float] = {}
    for i, j in set(zip(ti[sel].tolist(), tj[sel].tolist(), strict=True)):
        refs[(i, j)] = float(np.median(base[sel & (ti == i) & (tj == j)]))
    return refs


def ground_above_surface_share(
    rel, dem, transform, stage, drain=None, stages=STAGES, tile_deg=TILE_DEG
) -> float:
    """Share of the cells wet at `stage` whose ground (DEM) is above the drawn water surface
    (tile reference + stage): water that the 3D view would hide under the terrain."""
    refs = tile_references(rel, dem, transform, connected_mask(rel, max(stages), drain), tile_deg)
    wet = connected_mask(rel, stage, drain)
    if not wet.any():
        return 0.0
    ti, tj = _cell_tiles(dem.shape, transform, tile_deg)
    surf = np.array([refs.get((i, j), np.nan) for i, j in zip(ti[wet], tj[wet], strict=True)])
    return float(np.mean(dem[wet] > surf + stage))


def water_features(
    hand,
    dem,
    transform,
    stages=STAGES,
    simplify_deg=SIMPLIFY_DEG,
    tile_deg=TILE_DEG,
    area=None,
    drain=None,
) -> dict[str, list[dict]]:
    """{scenario_id: [GeoJSON Feature]}; each stage's water contains every lower stage's water.

    Pieces smaller than half a raster cell (tile-cut slivers) are dropped; a dropped piece's
    region is either dropped at every lower stage too or covered by a kept piece, so nesting holds
    exactly before the output coordinates are rounded to WATER_DP decimals (~1 m).
    `surface_height_m` = the tile's stage-independent reference (see tile_references) + stage, so
    at any point the drawn surface rises exactly 1 m per stage.
    """
    from rasterio.features import shapes
    from shapely.geometry import box, mapping, shape
    from shapely.ops import unary_union

    out: dict[str, list[dict]] = {"baseline": []}  # normal river level: no scenario water
    min_piece = 0.5 * abs(transform.a * transform.e)
    refs = tile_references(hand, dem, transform, connected_mask(hand, max(stages), drain), tile_deg)
    prev = None
    for s in stages:
        sid = f"stage_p{s}m"
        mask = connected_mask(hand, s, drain)
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
        feats = []
        if not geom.is_empty:
            w, so, e, n = geom.bounds
            for i in range(math.floor(w / tile_deg), math.ceil(e / tile_deg)):
                for j in range(math.floor(so / tile_deg), math.ceil(n / tile_deg)):
                    ref = refs.get((i, j))
                    if ref is None:  # no top-stage cell centre here (boundary slivers only)
                        if not refs:
                            continue
                        ref = refs[min(refs, key=lambda k: max(abs(k[0] - i), abs(k[1] - j)))]
                    cell = box(i * tile_deg, j * tile_deg, (i + 1) * tile_deg, (j + 1) * tile_deg)
                    part = geom.intersection(cell)
                    feats += [
                        {
                            "type": "Feature",
                            "geometry": _round(mapping(p), WATER_DP),
                            "properties": {
                                "scenario_id": sid,
                                "surface_height_m": round(ref + s, 2),
                            },
                        }
                        for p in getattr(part, "geoms", [part])
                        if p.geom_type == "Polygon" and p.area >= min_piece
                    ]
        out[sid] = feats
    return out


def fetch_osm_water(area=AREA, refresh: bool = False) -> list[dict]:
    """OSM rivers/streams/canals + water bodies over `area` (one Overpass query, cached)."""
    import hashlib
    import time

    import requests

    w, s, e, n = area
    ql = OSM_WATER_QL.format(s=s, w=w, n=n, e=e)
    path = CACHE / f"osm_water_{hashlib.sha1(ql.encode()).hexdigest()[:12]}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())["elements"]
    for attempt in range(OVERPASS_MAX_REQUESTS):
        url = OVERPASS_MIRRORS[attempt % len(OVERPASS_MIRRORS)]
        try:
            r = requests.post(
                url,
                data={"data": ql},
                timeout=200,
                headers={"User-Agent": "TownshipLens student hackathon (flood data build)"},
            )
            if r.status_code == 200:
                CACHE.mkdir(parents=True, exist_ok=True)
                path.write_text(r.text)
                return r.json()["elements"]
            print(f"[osm] {url} -> HTTP {r.status_code}")
        except requests.RequestException as exc:
            print(f"[osm] {url} -> {exc}")
        time.sleep(10 * (attempt + 1))
    raise SystemExit(f"Overpass failed after {OVERPASS_MAX_REQUESTS} requests")


def load_osm_water(paths: list[Path]) -> list[dict]:
    """Overpass JSON files (merged, de-duplicated) or GeoJSON FeatureCollections with OSM tags
    as properties (top level or under "tags") -> Overpass-style elements."""
    from shapely.geometry import shape

    els: dict[tuple, dict] = {}
    for path in paths:
        d = json.loads(Path(path).read_text())
        for el in d.get("elements", []):
            els[(el["type"], el["id"])] = el
        for i, f in enumerate(d.get("features", [])):
            props = f.get("properties") or {}
            tags = {**props, **(props.get("tags") or {})}
            g = shape(f["geometry"])
            for j, part in enumerate(getattr(g, "geoms", [g])):
                ring = part.exterior.coords if part.geom_type == "Polygon" else part.coords
                geom = [{"lon": x, "lat": y} for x, y, *_ in ring]
                els[("geojson", f"{path}:{i}:{j}")] = {
                    "type": "way",
                    "tags": tags,
                    "geometry": geom,
                }
    return list(els.values())


def osm_water_elements(args, data_dir: Path) -> list[dict]:
    """--osm-water files, else the cached/fetched Overpass query over AREA, else (Overpass down)
    the OSM import's base/hydrology.geojson (covers the envelope only, not the east strip)."""
    if args.osm_water:
        return load_osm_water(args.osm_water)
    try:
        return fetch_osm_water(AREA, args.refresh)
    except SystemExit:
        hydro = data_dir / "base/hydrology.geojson"
        if not hydro.exists():
            raise
        print(f"[osm] Overpass unavailable; falling back to {hydro}")
        return load_osm_water([hydro])


def osm_drainage_geoms(elements: list[dict]):
    """(channel lines, water polygons) in lon/lat. Culverted/tunnelled waterways are skipped:
    the surface model there is the road or ground above, not the channel."""
    from shapely.geometry import LineString, Polygon
    from shapely.ops import polygonize, unary_union

    def coords(geom):
        return [(g["lon"], g["lat"]) for g in geom or [] if g]

    lines, polys = [], []
    for el in elements:
        tags = el.get("tags", {})
        if el["type"] == "way":
            c = coords(el.get("geometry"))
            if len(c) < 2:
                continue
            is_water = tags.get("natural") == "water" or "water" in tags
            if is_water and len(c) >= 4 and c[0] == c[-1]:
                polys.append(Polygon(c).buffer(0))
            elif tags.get("waterway") in ("river", "stream", "canal") and "tunnel" not in tags:
                lines.append(LineString(c))
        elif el["type"] == "relation":
            rings = {"outer": [], "inner": []}
            for m in el.get("members", []):
                c = coords(m.get("geometry"))
                if m.get("type") == "way" and len(c) >= 2:
                    rings["inner" if m.get("role") == "inner" else "outer"].append(LineString(c))
            outer = (
                unary_union(list(polygonize(unary_union(rings["outer"]))))
                if rings["outer"]
                else None
            )
            if outer is None or outer.is_empty:
                continue
            if rings["inner"]:
                outer = outer.difference(unary_union(list(polygonize(unary_union(rings["inner"])))))
            polys.append(outer.buffer(0))
    return lines, [p for p in polys if not p.is_empty]


def drainage_mask(lines, polys, shape, transform, connected_only: bool = True) -> np.ndarray:
    """Rasterise channels (all touched cells) and water bodies onto the DEM grid.

    With `connected_only`, a lake/pond counts only when it touches the channel network (on-line
    lakes such as the Central Park lakes on Sungai Subang). Perched / off-line ponds keep their
    own level when the river rises, and as nearest-drainage references they would make large
    fans of lower ground around them look "below the river".
    """
    from rasterio.features import rasterize
    from scipy import ndimage

    def burn(geoms):
        if not geoms:
            return np.zeros(shape, dtype=bool)
        return rasterize(
            [(g, 1) for g in geoms], out_shape=shape, transform=transform, all_touched=True
        ).astype(bool)

    chan, water = burn(lines), burn(polys)
    if not connected_only or not chan.any():
        return chan | water
    labels, _ = ndimage.label(chan | water, structure=_EIGHT)
    keep = np.unique(labels[chan])
    return chan | (water & np.isin(labels, keep[keep > 0]))


# --- vector stage ---------------------------------------------------------------------------------


def _features(path: Path) -> list[dict]:
    return json.loads(path.read_text())["features"] if path.exists() else []


def _in_area(coord, area=AREA) -> bool:
    w, s, e, n = area
    return w <= coord[0] <= e and s <= coord[1] <= n


UNNAMED_MARK = "(unnamed, OSM)"


def _norm_name(s: str) -> str:
    return " ".join(s.split()).casefold()


def dedupe_places(cands: list[dict], radius_m: float = DEDUPE_RADIUS_M):
    """Drop repeats of the same hall: same normalised name within `radius_m` (OSM often maps a
    building as a node and a way). Keeps the one snapped to a walk node, then the lowest id.
    Returns (kept, [(dropped_id, kept_id)])."""
    order = sorted(
        cands, key=lambda f: (f["properties"].get("node_id") is None, f["properties"]["id"])
    )
    kept: list[dict] = []
    dropped: list[tuple[str, str]] = []
    for f in order:
        if UNNAMED_MARK in f["properties"]["name"]:  # placeholders are not the same hall
            kept.append(f)
            continue
        x, y = f["geometry"]["coordinates"][:2]
        mx, my = _m_per_deg(y)
        twin = next(
            (
                k
                for k in kept
                if UNNAMED_MARK not in k["properties"]["name"]
                and _norm_name(k["properties"]["name"]) == _norm_name(f["properties"]["name"])
                and math.hypot(
                    (k["geometry"]["coordinates"][0] - x) * mx,
                    (k["geometry"]["coordinates"][1] - y) * my,
                )
                <= radius_m
            ),
            None,
        )
        if twin is None:
            kept.append(f)
        else:
            dropped.append((f["properties"]["id"], twin["properties"]["id"]))
    return kept, dropped


def evac_centres(places: list[dict], area=AREA, dropped: list | None = None) -> list[dict]:
    from townshiplens_spatial.models import EvacCentre

    cands = [
        f
        for f in places
        if f["properties"].get("type") in EVAC_TYPES
        and f["properties"].get("kind", "place") == "place"
        and _in_area(f["geometry"]["coordinates"], area)
    ]
    cands, dups = dedupe_places(cands)
    if dropped is not None:
        dropped.extend(dups)
    centres: dict[str, EvacCentre] = {}
    for f in cands:
        p = f["properties"]
        centres[p["id"]] = EvacCentre(
            id=f"evc-{p['id']}",
            place_id=p["id"],
            name=p["name"],
            coord=f["geometry"]["coordinates"][:2],
            node_id=p.get("node_id"),
            node_inferred=bool(p.get("node_inferred", False)),
            source="osm_candidate",
        )

    norm = _norm_name
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
                update={  # unverified: the article URL stays in the note, never in evidence_url
                    "notes": f"news reports a PPS named '{name}' on {d.day} {d:%b %Y} ({url}); "
                    "match to this hall unverified",
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
    # the access overlay replaces / adds edges and places in load_world(): classify those too
    overlay = _features(data_dir / "access/overlay.geojson")
    edges = {f["properties"]["id"]: f for f in walk}
    edges.update(
        {f["properties"]["id"]: f for f in overlay if f["geometry"]["type"] == "LineString"}
    )
    pts = {f["properties"]["id"]: f for f in places}
    pts.update({f["properties"]["id"]: f for f in overlay if f["geometry"]["type"] == "Point"})
    edge_h: dict[str, float] = {}
    uncovered, partial = [], []
    for eid, f in edges.items():
        if f["geometry"]["type"] != "LineString":
            continue
        vals = sample_raster(eff_hand, transform, sample_line(f["geometry"]["coordinates"]))
        edge_h[eid] = _nanmin(vals)
        if np.isnan(vals).all():
            uncovered.append(eid)
        elif np.isnan(vals).any():
            partial.append(eid)
    place_h = {
        pid: _nanmin(sample_raster(eff_hand, transform, [tuple(f["geometry"]["coordinates"][:2])]))
        for pid, f in pts.items()
        if f["geometry"]["type"] == "Point"
    }
    dropped: list[tuple[str, str]] = []
    centres = evac_centres(places, dropped=dropped)
    edge_classes = {"baseline": {}, **stage_classes(edge_h, stages, margin)}
    place_classes = {"baseline": {}, **stage_classes(place_h, stages, margin)}
    return {
        "edge_classes": edge_classes,
        "place_classes": place_classes,
        "centres": centres,
        "edge_hand_min": edge_h,
        "place_hand_min": place_h,
        "uncovered_edges": sorted(uncovered),
        "partial_edges": sorted(partial),
        "uncovered_places": sorted(k for k, v in place_h.items() if math.isnan(v)),
        # Task 43: places (base + overlay) with no walk node; routing to them is no_data.
        "places_without_node": sorted(
            pid for pid, f in pts.items() if not f["properties"].get("node_id")
        ),
        # Review I1/I3 (R28): area places snapped by a fallback, or left unsnapped, and why.
        "places_snap_warnings": [
            {"id": pid, "warning": pts[pid]["properties"]["snap_warning"]}
            for pid in sorted(pts)
            if pts[pid]["properties"].get("snap_warning")
        ],
        "dropped_duplicate_centres": dropped,
        "stats": {
            "edges": len(edge_h),
            "edges_no_coverage": len(uncovered),
            "edges_partial_coverage": len(partial),
            "places": len(place_h),
        },
    }


# --- outputs --------------------------------------------------------------------------------------


def _write_fc(path: Path, features: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fc = {"type": "FeatureCollection", "features": features}
    path.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + "\n")


def scenarios(stages=STAGES, created: str | None = None, method: str = "rem") -> list[dict]:
    created = created or date.today().isoformat()
    base = {
        "method": METHODS[method],
        "dem": "Copernicus GLO-30",
        "margin_m": MARGIN,
        "created": created,
        "disclaimer": DISCLAIMERS[method],
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


def update_site(
    data_dir: Path, datum_offset_m: float | None = None, attribution=ATTRIBUTION
) -> bool:
    """Append the method's data credits (and the datum offset, when known) to site.json.

    Never creates site.json: the OSM import (Task 3) owns it.
    """
    site_p = data_dir / "site.json"
    if not site_p.exists():
        print(
            f"[site] {site_p} missing; add when it exists: attribution {attribution}"
            + (f", scene.datum_offset_m={datum_offset_m}" if datum_offset_m is not None else "")
        )
        return False
    site = json.loads(site_p.read_text())
    before = json.dumps(site, sort_keys=True)
    attr = site.setdefault("attribution", [])
    attr.extend(a for a in attribution if a not in attr)
    if datum_offset_m is not None:
        site.setdefault("scene", {})["datum_offset_m"] = datum_offset_m
    if json.dumps(site, sort_keys=True) != before:
        site_p.write_text(json.dumps(site, ensure_ascii=False, indent=2) + "\n")
    return True


def rewrite_disclaimers(data_dir: Path) -> int:
    """Set every REM scenario's `disclaimer` in flood/scenarios.json to DISCLAIMERS["rem"],
    editing only those string values in place (no DEM rebuild, formatting untouched).
    Returns the number of scenarios rewritten."""
    p = data_dir / "flood" / "scenarios.json"
    text = p.read_text()
    methods = [s["method"] for s in json.loads(text)["scenarios"]]
    new = json.dumps(DISCLAIMERS["rem"], ensure_ascii=False)
    pat = re.compile(r'("disclaimer": )"(?:[^"\\]|\\.)*"')
    found = len(pat.findall(text))
    if found != len(methods):
        # The n-th hit is paired with the n-th scenario: a second (e.g. nested) key would shift
        # the pairing and overwrite a HAND scenario's text, so refuse to touch the file.
        raise ValueError(
            f"scenarios.json has {found} disclaimer keys for {len(methods)} scenarios; "
            "not rewriting"
        )
    it = iter(methods)
    count = 0

    def sub(m):
        nonlocal count
        if next(it).lower() != "rem":
            return m.group(0)
        count += 1
        return m.group(1) + new

    p.write_text(pat.sub(sub, text))
    return count


def write_outputs(
    data_dir: Path,
    water: dict[str, list[dict]],
    vec: dict | None,
    stages=STAGES,
    created: str | None = None,
    datum_offset_m: float | None = None,
    method: str = "rem",
) -> None:
    from townshiplens_spatial.models import FloodBundle

    flood_dir = data_dir / "flood"
    for sid, feats in water.items():
        _write_fc(flood_dir / f"{sid}.geojson", feats)
    bundle = {
        "scenarios": scenarios(stages, created, method),
        "edge_classes": vec["edge_classes"] if vec else {},
        "place_classes": vec["place_classes"] if vec else {},
    }
    FloodBundle.model_validate(bundle)  # contract check before writing
    (flood_dir / "scenarios.json").write_text(
        json.dumps(bundle, ensure_ascii=False, indent=1) + "\n"
    )
    if vec:
        _write_fc(flood_dir / "evac_centres.geojson", vec["centres"])
        coverage = {
            "note": "Walk edges / places outside the flood raster window get no flood class "
            "(they read as 'unlikely'); partial edges are classified on their covered samples.",
            "area_wsen": list(AREA),
            "uncovered_edges": vec["uncovered_edges"],
            "partial_edges": vec["partial_edges"],
            "uncovered_places": vec["uncovered_places"],
            "places_without_node": vec.get("places_without_node", []),
            "places_snap_warnings": vec.get("places_snap_warnings", []),
            "dropped_duplicate_centres": [list(p) for p in vec["dropped_duplicate_centres"]],
        }
        (flood_dir / "coverage.json").write_text(json.dumps(coverage, indent=1) + "\n")
    update_site(data_dir, datum_offset_m, ATTRIBUTIONS[method])


# Research sanity points (flood-disaster-lens.md): high ground vs the documented flood area.
SANITY_POINTS = {
    "Lakeside Mall (high ground, ~45 m)": (101.5099, 3.1813),
    "Kampung Kubu Gajah (Jalan Kubu Gajah, OSM)": (101.5202, 3.1955),
}


def sanity_report(
    data_dir: Path, eff, transform, vec, scenario_ids=("stage_p1m", "stage_p3m"), k=5
) -> str:
    """Connected relative height at each sanity point + classes of the k nearest walk edges."""
    from shapely.geometry import LineString, Point

    walk = _features(data_dir / "base/walk.geojson")
    lines = []
    for label, (lon, lat) in SANITY_POINTS.items():
        mx, my = _m_per_deg(lat)
        pt = Point(lon * mx, lat * my)
        h = _nanmin(sample_raster(eff, transform, [(lon, lat)]))
        cls = ", ".join(f"{sid}={classify(h, float(sid[7:-1]), MARGIN)}" for sid in scenario_ids)
        lines.append(f"{label}: connected relative height at point = {h:.2f} m ({cls})")
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
            cls = "  ".join(
                f"{sid}={vec['edge_classes'][sid].get(eid, 'unlikely')}" for sid in scenario_ids
            )
            lines.append(
                f"  {eid:<28} {d:6.0f} m away  min={vec['edge_hand_min'][eid]:6.2f}  {cls}"
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
    ap.add_argument(
        "--method",
        choices=["rem", "hand"],
        default="rem",
        help="rem: height above OSM rivers/lakes (default); hand: ASF HAND (comparison only)",
    )
    ap.add_argument(
        "--osm-water",
        type=Path,
        nargs="+",
        help="use these Overpass JSON / GeoJSON files for drainage instead of querying Overpass",
    )
    ap.add_argument("--refresh", action="store_true", help="re-download the raster windows")
    ap.add_argument(
        "--rewrite-disclaimers",
        action="store_true",
        help="only rewrite the REM disclaimer text in flood/scenarios.json, then exit",
    )
    ap.add_argument(
        "--datum-offset",
        type=float,
        help="set scene.datum_offset_m to this EGM2008 geoid height (skips the network lookup)",
    )
    ap.add_argument(
        "--no-datum",
        action="store_true",
        help="skip the EGM2008 geoid lookup (leaves scene.datum_offset_m unchanged)",
    )
    args = ap.parse_args(argv)
    data_dir = args.data_dir.resolve()
    if args.rewrite_disclaimers:
        print(f"[disclaimers] rewrote {rewrite_disclaimers(data_dir)} REM scenarios")
        return 0

    dem, t = read_window(DEM_URL, AREA, "glo30_dem", args.refresh)
    if args.method == "hand":
        rel, t_hand = read_window(HAND_URL, AREA, "asf_hand", args.refresh)
        if dem.shape != rel.shape or not t.almost_equals(t_hand):
            raise SystemExit("DEM and HAND windows are not on the same grid")
        drain = None
        n_drain = int((rel <= DRAINAGE_MAX_M).sum())
    else:
        lines, polys = osm_drainage_geoms(osm_water_elements(args, data_dir))
        if not lines:
            raise SystemExit("no OSM river/stream/canal lines found; cannot build the REM")
        drain = drainage_mask(lines, polys, dem.shape, t)
        rel = relative_elevation(dem, drain)
        n_drain = int(drain.sum())
        print(f"[osm] drainage: {len(lines)} channel lines, {len(polys)} water polygons")
    print(
        f"[raster] method={args.method} window {dem.shape} cells, "
        f"drainage cells={n_drain} ({n_drain / dem.size:.1%})"
    )

    water = None
    if args.stage in ("all", "raster"):
        water = water_features(rel, dem, t, area=AREA, drain=drain)
    vec = None
    eff = effective_hand(rel, drain)
    if args.stage in ("all", "vector"):
        vec = vector_stage(data_dir, eff, t)
    if water is None:  # vector-only run: reuse the committed water polygons
        water = {sid: _features(data_dir / f"flood/{sid}.geojson") for sid in scenario_ids()}
    if args.datum_offset is not None:
        datum = args.datum_offset
    else:
        datum = None if args.no_datum else geoid_undulation(*SITE_CENTRE)
    print(f"[datum] EGM2008 geoid height N at {SITE_CENTRE} = {datum} m (datum_offset_m)")
    write_outputs(data_dir, water, vec, datum_offset_m=datum, method=args.method)
    print(summary(water, vec))
    shares = ", ".join(
        f"+{s} m {ground_above_surface_share(rel, dem, t, s, drain):.1%}" for s in STAGES
    )
    print(f"[surface] wet cells whose ground is above the drawn surface: {shares}")
    if vec:
        print(sanity_report(data_dir, eff, t, vec))
        st = vec["stats"]
        print(
            f"[vector] edges={st['edges']} (no coverage: {st['edges_no_coverage']}, partial: "
            f"{st['edges_partial_coverage']}), places={st['places']} (no coverage: "
            f"{len(vec['uncovered_places'])}), centres={len(vec['centres'])} "
            f"(duplicates dropped: {vec['dropped_duplicate_centres']})"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
