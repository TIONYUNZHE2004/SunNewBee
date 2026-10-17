"""Sample per-footprint building heights from Google Photorealistic 3D Tiles (display only).

Google data exemption (stylised-city overhaul only): the sampled heights feed the stylised
city's building heights and nothing else. Never use them in routing, evaluation, flood, the
agent, answers or evidence. This script is billable and is NOT part of `pnpm data:city`; its
output base/height_samples.json is committed and read by later builders.

Method: tile points (glb, via gtiles) -> tile world transform -> ECEF -> east-north-up metres
around the bbox centre -> a 1 m max-z grid (DSM). Per OSM footprint: roof = p90 of the DSM
inside the footprint eroded by 1 m; ground = p10 of the 3-15 m ring outside it, excluding other
footprints. Heights are relative (roof - local ground), so geoid and ellipsoid datums never mix.

Usage:
  uv run python data/scripts/sample_heights.py --bbox hero --plan --max-requests 60
  uv run python data/scripts/sample_heights.py --bbox hero --max-requests <approved>

--plan fetches tileset JSON only (no glb) and prints the request counts. The key comes from
GOOGLE_MAPS_API_KEY (environment or the repo-root .env, read like the API settings); it is never
printed. HTTP 401/403 exits 2 with `BLOCKED: ...`; no Referer header is ever sent.
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.scripts import gtiles  # noqa: E402

HERO_BBOX = (101.500, 3.172, 101.520, 3.190)  # w, s, e, n — Elmina City Centre
SOURCE = "Google Photorealistic 3D Tiles (display only)"
SEED = ROOT / "data" / "seed" / "elmina"
OUT = SEED / "base" / "height_samples.json"

ERODE_M = 1.0
RING_M = (3.0, 15.0)
MIN_COVERAGE = 0.5
MIN_GROUND_CELLS = 10
HEIGHT_RANGE = (2.5, 200.0)
# Frame sanity: tile points in ENU around the bbox centre must sit near the bbox at a plausible
# terrain height (the ENU origin is on the ellipsoid; Elmina is a few tens of metres above it).
FRAME_PAD_M = 1000.0
FRAME_Z = (-100.0, 500.0)


# --- DSM and footprints -------------------------------------------------------------


def _cell(extent: tuple[float, float, float, float], shape: tuple[int, int]) -> float:
    return (extent[2] - extent[0]) / shape[1]


def _accumulate(acc: np.ndarray, points: np.ndarray, extent, cell: float) -> None:
    """Raise cells of a C-contiguous -inf-initialised grid to the max z of the points in them."""
    if not len(points):
        return
    col = np.floor((points[:, 0] - extent[0]) / cell).astype(np.int64)
    row = np.floor((points[:, 1] - extent[1]) / cell).astype(np.int64)
    ok = (row >= 0) & (row < acc.shape[0]) & (col >= 0) & (col < acc.shape[1])
    np.maximum.at(acc.reshape(-1), row[ok] * acc.shape[1] + col[ok], points[ok, 2])


def _empty(extent, cell_m: float) -> np.ndarray:
    return np.full(_grid(extent, cell_m), -np.inf, dtype=np.float32)


def _finish(acc: np.ndarray) -> np.ndarray:
    acc[np.isneginf(acc)] = np.nan
    return acc


def _grid(extent, cell_m: float) -> tuple[int, int]:
    return (
        round((extent[3] - extent[1]) / cell_m),
        round((extent[2] - extent[0]) / cell_m),
    )


def build_dsm(
    points_enu: np.ndarray, extent: tuple[float, float, float, float], cell_m: float = 1.0
) -> np.ndarray:
    """Max z per cell (row = north, column = east, origin at extent's min corner), NaN where
    empty. Points outside the extent are dropped."""
    acc = _empty(extent, cell_m)
    _accumulate(acc, np.asarray(points_enu, dtype=np.float64), extent, cell_m)
    return _finish(acc)


def _inside(ring: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Even-odd point-in-polygon for arrays of points."""
    inside = np.zeros(x.shape, dtype=bool)
    pts = np.asarray(ring, dtype=np.float64)[:, :2]
    for (x1, y1), (x2, y2) in zip(pts, np.roll(pts, -1, axis=0), strict=True):
        if y1 == y2:
            continue
        crosses = (y1 > y) != (y2 > y)
        xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
        inside ^= crosses & (x < xi)
    return inside


def _window(ring: np.ndarray, extent, shape, pad_m: float):
    """Row/column slices covering the ring's bbox plus pad_m, and the cell-centre grids."""
    cell = _cell(extent, shape)
    xy = np.asarray(ring, dtype=np.float64)[:, :2]
    c0 = max(int(np.floor((xy[:, 0].min() - pad_m - extent[0]) / cell)), 0)
    c1 = min(int(np.ceil((xy[:, 0].max() + pad_m - extent[0]) / cell)), shape[1])
    r0 = max(int(np.floor((xy[:, 1].min() - pad_m - extent[1]) / cell)), 0)
    r1 = min(int(np.ceil((xy[:, 1].max() + pad_m - extent[1]) / cell)), shape[0])
    xs = extent[0] + (np.arange(c0, max(c1, c0)) + 0.5) * cell
    ys = extent[1] + (np.arange(r0, max(r1, r0)) + 0.5) * cell
    x, y = np.meshgrid(xs, ys)
    return (slice(r0, max(r1, r0)), slice(c0, max(c1, c0))), x, y


def rasterise(ring_enu: np.ndarray, extent, shape: tuple[int, int]) -> np.ndarray:
    """Boolean grid of the cells whose centres fall inside the ring."""
    mask = np.zeros(shape, dtype=bool)
    win, x, y = _window(ring_enu, extent, shape, 0.0)
    mask[win] = _inside(ring_enu, x, y)
    return mask


def footprint_sample(
    ring_enu: np.ndarray, dsm: np.ndarray, extent, others_mask: np.ndarray
) -> dict | None:
    """{"height_m", "roof_p90", "ground_p10", "coverage"} for one footprint, or None.

    roof = p90 of the DSM inside the footprint eroded by 1 m (the whole footprint if erosion
    empties it); coverage = share of those cells with data. ground = p10 of the 3-15 m ring
    outside the footprint, excluding others_mask cells (other footprints). None if coverage
    < 0.5, fewer than 10 ground cells, or a height outside 2.5-200 m.
    """
    cell = _cell(extent, dsm.shape)
    win, x, y = _window(ring_enu, extent, dsm.shape, RING_M[1] + 2 * cell)
    if x.size == 0:
        return None
    inside = _inside(ring_enu, x, y)
    if not inside.any():
        return None
    d = dsm[win].astype(np.float64)
    eroded = inside & (distance_transform_edt(inside) * cell > ERODE_M)
    if not eroded.any():
        eroded = inside
    roof = d[eroded]
    coverage = float(np.isfinite(roof).mean())
    if coverage < MIN_COVERAGE:
        return None
    out_dist = distance_transform_edt(~inside) * cell
    ring = (out_dist >= RING_M[0]) & (out_dist <= RING_M[1]) & ~others_mask[win] & np.isfinite(d)
    if ring.sum() < MIN_GROUND_CELLS:
        return None
    roof_p90 = float(np.percentile(roof[np.isfinite(roof)], 90))
    ground_p10 = float(np.percentile(d[ring], 10))
    height = roof_p90 - ground_p10
    if not HEIGHT_RANGE[0] <= height <= HEIGHT_RANGE[1]:
        return None
    return {
        "height_m": round(height, 2),
        "roof_p90": round(roof_p90, 2),
        "ground_p10": round(ground_p10, 2),
        "coverage": round(coverage, 3),
    }


# --- frames and checks ------------------------------------------------------------


def to_enu(points_tile: np.ndarray, world: np.ndarray, enu: np.ndarray) -> np.ndarray:
    """Tile-frame points -> (tile world transform) ECEF -> east-north-up metres."""
    m = enu @ world
    return points_tile @ m[:3, :3].T + m[:3, 3]


def frame_check(points_enu: np.ndarray, extent) -> str | None:
    """A problem description if the first tile's ENU points are not near the extent at a
    plausible height (a frame bug would otherwise give a confident wrong DSM); else None."""
    if not len(points_enu):
        return "no points in the tile"
    cx, cy = np.median(points_enu[:, 0]), np.median(points_enu[:, 1])
    if not (
        extent[0] - FRAME_PAD_M <= cx <= extent[2] + FRAME_PAD_M
        and extent[1] - FRAME_PAD_M <= cy <= extent[3] + FRAME_PAD_M
    ):
        return f"tile centre ({cx:.0f}, {cy:.0f}) m is outside the bbox extent {extent}"
    z = float(np.median(points_enu[:, 2]))
    if not FRAME_Z[0] <= z <= FRAME_Z[1]:
        return f"median height {z:.1f} m is outside the plausible {FRAME_Z} m"
    return None


# --- inputs and outputs -------------------------------------------------------------


def parse_bbox(arg: str, rings: list) -> tuple[float, float, float, float]:
    """hero | township (bbox of all building footprints) | w,s,e,n."""
    if arg == "hero":
        return HERO_BBOX
    if arg == "township":
        pts = np.array([p[:2] for ring in rings for p in ring], dtype=np.float64)
        w, s = pts.min(axis=0)
        e, n = pts.max(axis=0)
        return (float(w), float(s), float(e), float(n))
    parts = arg.split(",")
    if len(parts) != 4:
        raise SystemExit(f"--bbox must be hero, township or w,s,e,n (got {arg!r})")
    w, s, e, n = (float(v) for v in parts)
    return (w, s, e, n)


def merge(existing: dict | None, samples: dict, as_of: str) -> dict:
    """New samples win per building; earlier samples for other buildings are kept."""
    merged = dict((existing or {}).get("samples", {}))
    merged.update(samples)
    return {"as_of": as_of, "source": SOURCE, "samples": merged}


def load_key() -> str:
    from pydantic_settings import BaseSettings, SettingsConfigDict

    class _Env(BaseSettings):
        model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
        google_maps_api_key: str = ""

    return _Env().google_maps_api_key.strip()


def make_fetcher(key: str, max_requests: int) -> gtiles.Fetcher:
    return gtiles.Fetcher(key, max_requests)


def _footprints(bbox) -> list[tuple[str, list]]:
    fc = json.loads((SEED / "base" / "buildings.geojson").read_text(encoding="utf-8"))
    out = []
    for f in fc["features"]:
        if f["geometry"]["type"] != "Polygon":
            continue
        ring = f["geometry"]["coordinates"][0]
        if all(bbox[0] <= x <= bbox[2] and bbox[1] <= y <= bbox[3] for x, y in ring):
            out.append((f["properties"]["id"], ring))
    return out


def _extent(bbox, enu: np.ndarray) -> tuple[float, float, float, float]:
    corners = np.array(
        [
            to_enu(gtiles.ecef(x, y)[None, :], np.eye(4), enu)[0]
            for x in bbox[::2]
            for y in bbox[1::2]
        ]
    )
    return (
        float(np.floor(corners[:, 0].min())),
        float(np.floor(corners[:, 1].min())),
        float(np.ceil(corners[:, 0].max())),
        float(np.ceil(corners[:, 1].max())),
    )


# --- runs ---------------------------------------------------------------------------


def _plan(bbox, fetcher: gtiles.Fetcher, max_error: float) -> None:
    json_fetches = 0

    def counting(url: str, fresh: bool = False) -> bytes:
        nonlocal json_fetches
        json_fetches += 1
        return fetcher(url, fresh=fresh)

    glb, cached = 0, 0
    complete = "yes"
    try:
        for _, url, _ in gtiles.traverse(bbox, counting, max_error, plan_only=True):
            glb += 1
            cached += (fetcher.cache / f"{gtiles.cache_key(url)}.bin").exists()
    except gtiles.TilesBudgetExceeded:
        complete = f"no (request budget of {fetcher.max_requests} reached; counts are partial)"
    print(f"plan for bbox {bbox} at max geometric error {max_error} m:")
    print(f"  JSON requests made: {fetcher.requests_made}")
    print(f"  tileset JSON read (incl. cache): {json_fetches}")
    print(f"  glb tiles needed: {glb} ({cached} already cached, {glb - cached} to fetch)")
    print(f"  complete: {complete}")
    if complete != "yes":
        raise SystemExit(3)


def _sample(bbox, fetcher: gtiles.Fetcher, max_error: float, cell_m: float) -> None:
    lon0, lat0 = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    enu = gtiles.enu_matrix(lon0, lat0)
    extent = _extent(bbox, enu)
    acc = _empty(extent, cell_m)
    tiles, skipped, checked = 0, 0, False
    try:
        for world, url, glb in gtiles.traverse(bbox, fetcher, max_error):
            try:
                pts = gtiles.glb_positions(glb)
            except gtiles.UnsupportedGlb as exc:
                skipped += 1
                print(f"WARNING: skipped tile {gtiles.cache_key(url)[:10]}: {exc}")
                continue
            pts = to_enu(pts, world, enu)
            if not checked and len(pts):
                problem = frame_check(pts, extent)
                if problem:
                    print(f"FRAME CHECK FAILED on the first tile: {problem}; nothing written")
                    raise SystemExit(4)
                checked = True
            _accumulate(acc, pts, extent, cell_m)
            tiles += 1
            if tiles % 50 == 0:
                print(f"  {tiles} tiles, {fetcher.requests_made} requests")
    except gtiles.TilesBudgetExceeded as exc:
        print(f"STOPPED: {exc}; {tiles} tiles read, nothing written (fetched tiles stay cached)")
        raise SystemExit(3) from None

    dsm = _finish(acc)
    feats = _footprints(bbox)
    rings = {
        fid: to_enu(np.array([gtiles.ecef(x, y) for x, y in ring]), np.eye(4), enu)[:, :2]
        for fid, ring in feats
    }
    footprints = np.zeros(dsm.shape, dtype=bool)
    for ring in rings.values():
        win, x, y = _window(ring, extent, dsm.shape, 0.0)
        footprints[win] |= _inside(ring, x, y)
    samples = {}
    for fid, ring in rings.items():
        s = footprint_sample(ring, dsm, extent, footprints)
        if s is not None:
            samples[fid] = s
    existing = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else None
    doc = merge(existing, samples, date.today().isoformat())
    OUT.write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    share = len(samples) / len(rings) if rings else 0.0
    print(f"tiles: {tiles} (skipped {skipped}); requests made: {fetcher.requests_made}")
    print(
        f"samples: {len(samples)} of {len(rings)} footprints ({share:.0%}); total in file: "
        f"{len(doc['samples'])}"
    )


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--bbox", default="hero", help="hero | township | w,s,e,n")
    ap.add_argument("--max-error", type=float, default=2.0, help="target geometric error (m)")
    ap.add_argument("--max-requests", type=int, default=300, help="hard cap on real requests")
    ap.add_argument("--plan", action="store_true", help="tileset JSON only; count glb tiles")
    ap.add_argument("--cell-m", type=float, default=1.0, help="DSM cell size (m)")
    args = ap.parse_args(argv)

    key = load_key()
    if not key:
        print("BLOCKED: GOOGLE_MAPS_API_KEY is not set (environment or repo-root .env)")
        raise SystemExit(2)
    rings = []
    if args.bbox == "township":
        rings = [ring for _, ring in _footprints((-180, -90, 180, 90))]
    bbox = parse_bbox(args.bbox, rings)
    fetcher = make_fetcher(key, args.max_requests)
    try:
        if args.plan:
            _plan(bbox, fetcher, args.max_error)
        else:
            _sample(bbox, fetcher, args.max_error, args.cell_m)
    except gtiles.TilesFetchError as exc:
        msg = gtiles.redact(str(exc), key)
        if exc.status in (401, 403):
            print(
                f"BLOCKED: {msg}. The key may be restricted (HTTP referrer or API restrictions); "
                "no Referer header is sent. Requests made: "
                f"{fetcher.requests_made}"
            )
            raise SystemExit(2) from None
        print(f"FAILED: {msg}; requests made: {fetcher.requests_made}")
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
