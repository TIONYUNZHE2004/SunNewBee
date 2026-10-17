"""Cached, budgeted client for Google Photorealistic 3D Tiles, used only to sample building heights.

Google data exemption (stylised-city overhaul only): these tiles are a building-height source for
the display layer. Never use them in routing, evaluation, flood, the agent, answers or evidence.

- Fetcher: cache first (data/cache/gtiles/<cache_key>.bin, key and session stripped from the
  cache key), appends the API key, hard request budget. The key is never printed or logged:
  error messages pass through redact(). fresh=True skips the cache read (used for root.json).
- traverse: 3D Tiles 1.1 traversal limited to a lon/lat bbox (sphere pre-filter, then an exact
  OBB test against the bbox rectangle in ENU) and a target geometric error;
  composes tile transforms, follows external tilesets (.json) and yields .glb content.
  root.json is always fetched fresh and its current `session` replaces the session in every
  child URL, so tileset JSON cached by an earlier run (with an expired session) stays usable.
- glb_positions: vertex positions of a glb (Draco via DracoPy), node transforms applied,
  glTF y-up converted to 3D Tiles z-up. Raises UnsupportedGlb for content it cannot decode
  correctly (unknown required extensions, CESIUM_RTC) instead of returning wrong points.
"""

import hashlib
import json
from collections.abc import Callable, Iterator
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse

import DracoPy
import numpy as np
import pygltflib
import requests

ROOT = Path(__file__).resolve().parents[2]

ROOT_URL = "https://tile.googleapis.com/v1/3dtiles/root.json"
CACHE = ROOT / "data" / "cache" / "gtiles"

_WGS84_A = 6378137.0
_WGS84_E2 = 6.69437999014e-3
_DRACO = "KHR_draco_mesh_compression"
# Required extensions glb_positions handles, plus texture/material-only ones that cannot change
# vertex positions. Anything else raises UnsupportedGlb.
_SUPPORTED_REQUIRED = {
    _DRACO,
    "KHR_mesh_quantization",
    "KHR_texture_basisu",
    "EXT_texture_webp",
    "KHR_materials_unlit",
    "KHR_texture_transform",
}
_RECT_PAD_M = 1.0
_STRIP_PARAMS = {"key", "session"}
# glTF is y-up; 3D Tiles is z-up: (x, y, z) -> (x, -z, y).
_Y_UP_TO_Z_UP = np.array(
    [[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], dtype=np.float64
)


class TilesBudgetExceeded(RuntimeError):
    """Raised instead of making a tile request that would exceed the request budget."""


class TilesFetchError(RuntimeError):
    """A tile request failed (HTTP status or connection error). Message is key-redacted."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class UnsupportedGlb(ValueError):
    """The glb uses something glb_positions cannot decode correctly; its points would be wrong."""


# --- geometry -----------------------------------------------------------------


def ecef(lon: float, lat: float, h: float = 0.0) -> np.ndarray:
    """WGS84 geodetic (degrees, metres) -> ECEF metres."""
    lam, phi = np.radians(lon), np.radians(lat)
    n = _WGS84_A / np.sqrt(1 - _WGS84_E2 * np.sin(phi) ** 2)
    return np.array(
        [
            (n + h) * np.cos(phi) * np.cos(lam),
            (n + h) * np.cos(phi) * np.sin(lam),
            (n * (1 - _WGS84_E2) + h) * np.sin(phi),
        ]
    )


def enu_matrix(lon0: float, lat0: float) -> np.ndarray:
    """4x4 matrix taking homogeneous ECEF points to east-north-up metres around (lon0, lat0, 0)."""
    lam, phi = np.radians(lon0), np.radians(lat0)
    r = np.array(
        [
            [-np.sin(lam), np.cos(lam), 0.0],
            [-np.sin(phi) * np.cos(lam), -np.sin(phi) * np.sin(lam), np.cos(phi)],
            [np.cos(phi) * np.cos(lam), np.cos(phi) * np.sin(lam), np.sin(phi)],
        ]
    )
    m = np.eye(4)
    m[:3, :3] = r
    m[:3, 3] = -r @ ecef(lon0, lat0)
    return m


def bbox_sphere(bbox: tuple[float, float, float, float]) -> tuple[np.ndarray, float]:
    """(w, s, e, n) degrees -> ECEF centre on the ellipsoid and a radius covering the corners."""
    w, s, e, n = bbox
    centre = ecef((w + e) / 2, (s + n) / 2)
    corners = [ecef(lon, lat) for lon in (w, e) for lat in (s, n)]
    return centre, float(max(np.linalg.norm(c - centre) for c in corners))


def box_hits_sphere(box: list[float], sphere: tuple[np.ndarray, float]) -> bool:
    """3D Tiles oriented box (centre + three half-axis vectors) intersects the sphere."""
    centre, radius = sphere
    b = np.asarray(box, dtype=np.float64)
    d = np.asarray(centre, dtype=np.float64) - b[:3]
    closest_sq = 0.0
    off = d.copy()
    for axis in (b[3:6], b[6:9], b[9:12]):
        length = float(np.linalg.norm(axis))
        if length == 0.0:
            continue
        u = axis / length
        t = float(d @ u)
        off -= t * u  # the part of d along this axis is handled here, not as a residual
        excess = abs(t) - length
        if excess > 0:
            closest_sq += excess**2
    # Any component of d outside the span of the (possibly degenerate) axes is a pure distance.
    closest_sq += float(off @ off)
    return closest_sq <= radius**2


def bbox_frame(
    bbox: tuple[float, float, float, float],
) -> tuple[np.ndarray, tuple[float, float, float, float]]:
    """ENU matrix at the bbox centre and the bbox as an ENU rectangle (xmin, ymin, xmax, ymax),
    from its corners and edge midpoints, padded by 1 m so the cull stays conservative."""
    w, s, e, n = bbox
    enu = enu_matrix((w + e) / 2, (s + n) / 2)
    lons, lats = (w, (w + e) / 2, e), (s, (s + n) / 2, n)
    pts = np.array([(enu @ np.append(ecef(x, y), 1.0))[:2] for x in lons for y in lats])
    lo, hi = pts.min(axis=0) - _RECT_PAD_M, pts.max(axis=0) + _RECT_PAD_M
    return enu, (float(lo[0]), float(lo[1]), float(hi[0]), float(hi[1]))


def box_hits_rect(
    box: list[float], enu: np.ndarray, rect: tuple[float, float, float, float]
) -> bool:
    """World OBB (ECEF) intersects the vertical prism over an ENU rectangle.

    Exact separating-axis test in the horizontal plane: the box's footprint is the zonotope of
    its three half-axes projected to (east, north), so the candidate axes are east, north and
    the normals of the projected half-axes. A box that touches the prism is never dropped.
    """
    b = np.asarray(box, dtype=np.float64)
    r = enu[:3, :3]
    c = (r @ b[:3] + enu[:3, 3])[:2]
    axes = [(r @ b[i : i + 3])[:2] for i in (3, 6, 9)]
    rc = np.array([(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2])
    half = np.array([(rect[2] - rect[0]) / 2, (rect[3] - rect[1]) / 2])
    candidates = [np.array([1.0, 0.0]), np.array([0.0, 1.0])]
    for a in axes:
        length = float(np.linalg.norm(a))
        if length > 0.0:
            candidates.append(np.array([-a[1], a[0]]) / length)
    for u in candidates:
        box_r = sum(abs(float(a @ u)) for a in axes)
        rect_r = float(half @ np.abs(u))
        if abs(float((c - rc) @ u)) > box_r + rect_r:
            return False
    return True


def _world_box(box: list[float], world: np.ndarray) -> list[float]:
    b = np.asarray(box, dtype=np.float64)
    c = world[:3, :3] @ b[:3] + world[:3, 3]
    axes = [world[:3, :3] @ b[i : i + 3] for i in (3, 6, 9)]
    return [*c, *axes[0], *axes[1], *axes[2]]


def _hits(volume: dict, world: np.ndarray, sphere: tuple[np.ndarray, float], frame) -> bool:
    """Bounding volume vs the bbox: a box must pass the cheap sphere pre-filter and then the
    ENU rectangle test (frame = bbox_frame(bbox)); a sphere volume uses the sphere test."""
    if "box" in volume:
        box = _world_box(volume["box"], world)
        return box_hits_sphere(box, sphere) and box_hits_rect(box, *frame)
    if "sphere" in volume:
        cx, cy, cz, r = volume["sphere"]
        c = world[:3, :3] @ np.array([cx, cy, cz]) + world[:3, 3]
        scale = float(np.linalg.norm(world[:3, :3], axis=0).max())
        return float(np.linalg.norm(c - sphere[0])) <= r * scale + sphere[1]
    return True  # region or unknown volume: keep it (conservative)


# --- cache and fetcher --------------------------------------------------------


def _strip(url: str) -> str:
    p = urlparse(url)
    q = sorted((k, v) for k, v in parse_qsl(p.query) if k not in _STRIP_PARAMS)
    return p._replace(query=urlencode(q)).geturl()


def cache_key(url: str) -> str:
    """sha1 of the URL with `key` and `session` removed (remaining params sorted)."""
    return hashlib.sha1(_strip(url).encode()).hexdigest()


def redact(text: str, key: str) -> str:
    return text.replace(key, "***") if key else text


def _with_params(url: str, **params: str) -> str:
    p = urlparse(url)
    q = [(k, v) for k, v in parse_qsl(p.query) if k not in params]
    q += list(params.items())
    return p._replace(query=urlencode(q)).geturl()


class Fetcher:
    """fetch(url) -> bytes. Cache hits are free; real requests count against max_requests."""

    def __init__(self, key: str, max_requests: int, cache: Path = CACHE, get=requests.get):
        self._key = key
        self.max_requests = max_requests
        self.cache = Path(cache)
        self._get = get
        self.requests_made = 0

    def __call__(self, url: str, fresh: bool = False) -> bytes:
        path = self.cache / f"{cache_key(url)}.bin"
        if path.exists() and not fresh:
            return path.read_bytes()
        shown = redact(_strip(url), self._key)
        if self.requests_made >= self.max_requests:
            raise TilesBudgetExceeded(
                f"3D Tiles request budget of {self.max_requests} used up (next: {shown})"
            )
        self.requests_made += 1
        try:
            r = self._get(_with_params(url, key=self._key), timeout=60)
        except Exception as exc:  # re-raised with the key redacted
            raise TilesFetchError(redact(f"request failed for {shown}: {exc}", self._key)) from None
        if r.status_code != 200:
            body = redact(bytes(r.content[:300]).decode("utf-8", "replace"), self._key)
            raise TilesFetchError(
                f"HTTP {r.status_code} for {shown}: {' '.join(body.split())}", status=r.status_code
            )
        self.cache.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(r.content)
        tmp.replace(path)
        return r.content


# --- traversal ----------------------------------------------------------------


def _session(url: str) -> str | None:
    return dict(parse_qsl(urlparse(url).query)).get("session")


def _resolve(base: str, uri: str, session: str | None = None) -> str:
    """Resolve a content URI against its tileset URL. `session` (the fresh one from root.json)
    replaces any session in the URI; without it, a missing session is inherited from base."""
    url = urljoin(base, uri)
    session = session or _session(base)
    if session and (session != _session(url)):
        url = _with_params(url, session=session)
    return url


def _root_session(tileset: dict) -> str | None:
    """The first `session` found in a content URI of a (root) tileset."""
    stack = [tileset.get("root") or {}]
    while stack:
        tile = stack.pop()
        for uri in _contents(tile):
            if s := _session(urljoin(ROOT_URL, uri)):
                return s
        stack.extend(tile.get("children") or [])
    return None


def _contents(tile: dict) -> list[str]:
    if "content" in tile:
        return [tile["content"]["uri"]]
    return [c["uri"] for c in tile.get("contents", [])]


def _transform(tile: dict) -> np.ndarray:
    t = tile.get("transform")
    return np.eye(4) if t is None else np.array(t, dtype=np.float64).reshape(4, 4, order="F")


def traverse(
    bbox: tuple[float, float, float, float],
    fetch: Callable[[str], bytes],
    max_error: float,
    plan_only: bool = False,
    count_leaves: bool = False,
) -> Iterator[tuple[np.ndarray, str, bytes | None]]:
    """Yield (tile world transform 4x4, content url, glb or None when plan_only) for the tiles
    covering bbox (w, s, e, n) at geometricError <= max_error (or the finest available).

    Tiles whose bounding volume misses the bbox (sphere pre-filter, then the ENU rectangle) are
    skipped. A tile with error above
    max_error and children is refined (REPLACE: its own content is skipped; ADD: kept).
    External tilesets (.json content) are fetched and traversed in place.

    count_leaves (implies plan_only): an external tileset on a tile already at or below
    max_error is not fetched; its URL is yielded instead (glb None), so a caller can count the
    leaf tilesets a full run would still need.
    """
    plan_only = plan_only or count_leaves
    sphere = bbox_sphere(bbox)
    frame = bbox_frame(bbox)
    root = json.loads(fetch(ROOT_URL, fresh=True))
    session = _root_session(root)

    def walk_tileset(url: str, parent: np.ndarray, refine: str, tileset: dict | None = None):
        tileset = tileset if tileset is not None else json.loads(fetch(url))
        if "root" in tileset:
            yield from walk_tile(tileset["root"], url, parent, refine)

    def walk_tile(tile: dict, base: str, parent: np.ndarray, refine: str):
        world = parent @ _transform(tile)
        if not _hits(tile.get("boundingVolume", {}), world, sphere, frame):
            return
        refine = tile.get("refine", refine).upper()
        children = tile.get("children") or []
        error = float(tile.get("geometricError", 0.0))
        refining = bool(children) and error > max_error
        if not refining or refine == "ADD":
            for uri in _contents(tile):
                url = _resolve(base, uri, session)
                if urlparse(url).path.endswith(".json"):
                    if count_leaves and error <= max_error:
                        yield world, url, None
                    else:
                        yield from walk_tileset(url, world, refine)
                else:
                    yield world, url, None if plan_only else fetch(url)
        if refining:
            for child in children:
                yield from walk_tile(child, base, world, refine)

    yield from walk_tileset(ROOT_URL, np.eye(4), "REPLACE", root)


# --- glb ----------------------------------------------------------------------

_COMPONENTS = {
    pygltflib.BYTE: np.int8,
    pygltflib.UNSIGNED_BYTE: np.uint8,
    pygltflib.SHORT: np.int16,
    pygltflib.UNSIGNED_SHORT: np.uint16,
    pygltflib.UNSIGNED_INT: np.uint32,
    pygltflib.FLOAT: np.float32,
}
_NORMALISE = {np.int8: 127.0, np.uint8: 255.0, np.int16: 32767.0, np.uint16: 65535.0}


def _node_matrix(node: pygltflib.Node) -> np.ndarray:
    if node.matrix:
        return np.array(node.matrix, dtype=np.float64).reshape(4, 4, order="F")
    t = np.eye(4)
    if node.translation:
        t[:3, 3] = node.translation
    r = np.eye(4)
    if node.rotation:
        x, y, z, w = node.rotation
        r[:3, :3] = [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    s = np.diag([*(node.scale or [1, 1, 1]), 1.0])
    return t @ r @ s


def _view_bytes(gltf: pygltflib.GLTF2, blob: bytes, index: int) -> bytes:
    view = gltf.bufferViews[index]
    start = view.byteOffset or 0
    return blob[start : start + view.byteLength]


def _accessor_positions(gltf: pygltflib.GLTF2, blob: bytes, index: int) -> np.ndarray:
    acc = gltf.accessors[index]
    if acc.bufferView is None:
        return np.zeros((acc.count, 3))
    view = gltf.bufferViews[acc.bufferView]
    dtype = np.dtype(_COMPONENTS[acc.componentType])
    stride = view.byteStride or 3 * dtype.itemsize
    start = (view.byteOffset or 0) + (acc.byteOffset or 0)
    raw = np.frombuffer(
        blob, dtype=np.uint8, count=stride * (acc.count - 1) + 3 * dtype.itemsize, offset=start
    )
    rows = np.lib.stride_tricks.as_strided(
        raw, shape=(acc.count, 3 * dtype.itemsize), strides=(stride, 1)
    )
    pts = np.ascontiguousarray(rows).view(dtype).reshape(acc.count, 3).astype(np.float64)
    if acc.normalized and dtype.type in _NORMALISE:
        pts = np.maximum(pts / _NORMALISE[dtype.type], -1.0)
    return pts


def _primitive_positions(gltf: pygltflib.GLTF2, blob: bytes, prim: pygltflib.Primitive):
    draco = (prim.extensions or {}).get(_DRACO)
    if draco is not None:
        mesh = DracoPy.decode(_view_bytes(gltf, blob, draco["bufferView"]))
        return np.asarray(mesh.points, dtype=np.float64).reshape(-1, 3)
    if prim.attributes.POSITION is None:
        return np.zeros((0, 3))
    return _accessor_positions(gltf, blob, prim.attributes.POSITION)


def glb_positions(glb: bytes) -> np.ndarray:
    """(n, 3) vertex positions in the tile's frame: node transforms applied, glTF y-up -> z-up."""
    gltf = pygltflib.GLTF2.load_from_bytes(glb)
    unsupported = sorted(set(gltf.extensionsRequired or []) - _SUPPORTED_REQUIRED)
    if unsupported:
        raise UnsupportedGlb(f"glb requires unsupported extension(s): {', '.join(unsupported)}")
    if "CESIUM_RTC" in (gltf.extensionsUsed or []) or "CESIUM_RTC" in (gltf.extensions or {}):
        raise UnsupportedGlb("glb uses CESIUM_RTC, which glb_positions does not apply")
    blob = gltf.binary_blob() or b""
    scene = gltf.scenes[gltf.scene or 0] if gltf.scenes else None
    roots = scene.nodes if scene else range(len(gltf.nodes))
    out: list[np.ndarray] = []
    stack = [(i, _Y_UP_TO_Z_UP) for i in roots]
    while stack:
        i, parent = stack.pop()
        node = gltf.nodes[i]
        world = parent @ _node_matrix(node)
        if node.mesh is not None:
            for prim in gltf.meshes[node.mesh].primitives:
                pts = _primitive_positions(gltf, blob, prim)
                if len(pts):
                    out.append(pts @ world[:3, :3].T + world[:3, 3])
        stack.extend((c, world) for c in node.children or [])
    return np.concatenate(out) if out else np.zeros((0, 3))
