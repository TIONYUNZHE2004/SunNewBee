"""Google 3D Tiles client: geometry helpers, cache, budget, traversal and glb decoding.

No network: a fake `get`, a hand-built tileset and tiny glbs built with pygltflib.
"""

import json
from urllib.parse import parse_qs, urlparse

import DracoPy
import numpy as np
import pygltflib
import pytest

from data.scripts import gtiles

LON, LAT = 101.5, 3.18
BBOX = (101.49, 3.17, 101.51, 3.19)  # (w, s, e, n)


# --- geometry -----------------------------------------------------------------


def test_enu_matrix_origin_and_north_offset():
    m = gtiles.enu_matrix(LON, LAT)
    origin = m @ np.append(gtiles.ecef(LON, LAT), 1.0)
    assert np.allclose(origin[:3], [0, 0, 0], atol=1e-6)
    north = m @ np.append(gtiles.ecef(LON, LAT + 0.001), 1.0)
    assert north[:3] == pytest.approx([0, 110.6, 0], abs=0.5)


def _box_at(lon, lat, half=500.0):
    c = gtiles.ecef(lon, lat)
    return [*c, half, 0, 0, 0, half, 0, 0, 0, half]


def test_box_hits_sphere():
    sphere = gtiles.bbox_sphere(BBOX)
    assert gtiles.box_hits_sphere(_box_at(LON, LAT), sphere)
    # ~50 km east of the bbox centre
    assert not gtiles.box_hits_sphere(_box_at(LON + 0.45, LAT), sphere)


# --- cache and fetcher --------------------------------------------------------


def test_cache_key_ignores_key_and_session():
    base = "https://tile.googleapis.com/v1/3dtiles/datasets/D/files/x.glb"
    assert gtiles.cache_key(f"{base}?key=A&session=S") == gtiles.cache_key(
        f"{base}?session=T&key=B"
    )
    assert gtiles.cache_key(f"{base}?key=A") != gtiles.cache_key(base.replace("x.glb", "y.glb"))


def test_redact():
    assert gtiles.redact("url?key=SECRET&x=1", "SECRET") == "url?key=***&x=1"
    assert gtiles.redact("nothing", "") == "nothing"


class FakeResponse:
    def __init__(self, content: bytes, status_code: int = 200):
        self.content = content
        self.status_code = status_code


class FakeGet:
    def __init__(self, routes: dict[str, bytes]):
        self.routes = routes  # path (no query) -> body
        self.calls: list[str] = []

    def __call__(self, url, timeout=None):
        self.calls.append(url)
        path = urlparse(url)._replace(query="").geturl()
        if path not in self.routes:
            return FakeResponse(b"not found", 404)
        return FakeResponse(self.routes[path])


def test_fetcher_appends_key_keeps_session_and_caches(tmp_path):
    url = "https://tile.googleapis.com/v1/3dtiles/datasets/D/files/x.glb?session=S"
    get = FakeGet({url.split("?")[0]: b"glb-bytes"})
    f = gtiles.Fetcher("SECRET", max_requests=5, cache=tmp_path, get=get)
    assert f(url) == b"glb-bytes"
    q = parse_qs(urlparse(get.calls[0]).query)
    assert q["key"] == ["SECRET"] and q["session"] == ["S"]
    assert f.requests_made == 1
    assert (tmp_path / f"{gtiles.cache_key(url)}.bin").read_bytes() == b"glb-bytes"


def test_fetcher_serves_cache_without_get(tmp_path):
    url = "https://tile.googleapis.com/v1/3dtiles/datasets/D/files/x.glb?session=S"
    (tmp_path / f"{gtiles.cache_key(url)}.bin").write_bytes(b"cached")

    def boom(*_a, **_k):
        raise AssertionError("get must not be called for a cached URL")

    f = gtiles.Fetcher("SECRET", max_requests=0, cache=tmp_path, get=boom)
    assert f(url + "&key=OTHER") == b"cached"
    assert f.requests_made == 0


def test_fetcher_budget_exceeded_message_is_redacted(tmp_path):
    get = FakeGet({f"https://h/{i}.glb": b"x" for i in range(3)})
    f = gtiles.Fetcher("SECRET", max_requests=2, cache=tmp_path, get=get)
    f("https://h/0.glb")
    f("https://h/1.glb")
    with pytest.raises(gtiles.TilesBudgetExceeded) as exc:
        f("https://h/2.glb?key=SECRET")
    msg = str(exc.value)
    assert "SECRET" not in msg
    assert gtiles.redact(msg, "SECRET") == msg
    assert len(get.calls) == 2


def test_fetcher_http_error_is_redacted(tmp_path):
    f = gtiles.Fetcher("SECRET", max_requests=5, cache=tmp_path, get=FakeGet({}))
    with pytest.raises(gtiles.TilesFetchError) as exc:
        f("https://h/missing.glb")
    assert "SECRET" not in str(exc.value) and "404" in str(exc.value)
    assert not list(tmp_path.iterdir())


# --- traversal ----------------------------------------------------------------

HOST = "https://tile.googleapis.com"
FILES = "/v1/3dtiles/datasets/D/files/"


def _tile(box, error, uri=None, children=(), transform=None):
    t = {"boundingVolume": {"box": box}, "geometricError": error, "children": list(children)}
    if uri:
        t["content"] = {"uri": uri}
    if transform is not None:
        t["transform"] = transform
    return t


def _fixture_routes():
    near = _box_at(LON, LAT, 2000.0)
    far = _box_at(LON + 0.45, LAT, 2000.0)
    root = {
        "asset": {"version": "1.0"},
        "geometricError": 1e7,
        "root": _tile(
            _box_at(LON, LAT, 1e5),
            1e5,
            children=[
                _tile(near, 300, uri=f"{FILES}near.json?session=S"),
                _tile(far, 300, uri=f"{FILES}far.json?session=S"),
            ],
        ),
    }
    # Child tiles of near.json are expressed in a local frame: an identity rotation plus a
    # translation to the ECEF centre (column-major), so their boxes are centred at 0.
    cx, cy, cz = gtiles.ecef(LON, LAT)
    transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, cx, cy, cz, 1]
    local = [0, 0, 0, 1000, 0, 0, 0, 1000, 0, 0, 0, 1000]
    near_ts = {
        "asset": {"version": "1.0"},
        "geometricError": 300,
        "root": _tile(
            local,
            20,
            uri="a.glb?session=S",
            transform=transform,
            children=[
                _tile(local, 5, uri="b.glb?session=S", children=[_tile(local, 1, uri="c.glb")]),
            ],
        ),
    }
    return {
        HOST + "/v1/3dtiles/root.json": json.dumps(root).encode(),
        HOST + FILES + "near.json": json.dumps(near_ts).encode(),
        HOST + FILES + "far.json": b"{}",
        HOST + FILES + "a.glb": b"A",
        HOST + FILES + "b.glb": b"B",
        HOST + FILES + "c.glb": b"C",
    }, (cx, cy, cz)


def test_traverse_skips_far_stops_at_max_error_and_resolves_uris(tmp_path):
    routes, centre = _fixture_routes()
    get = FakeGet(routes)
    fetch = gtiles.Fetcher("K", max_requests=50, cache=tmp_path, get=get)
    out = list(gtiles.traverse(BBOX, fetch, max_error=10))
    assert [(url.split("?")[0], glb) for _, url, glb in out] == [(HOST + FILES + "b.glb", b"B")]
    transform, url, _ = out[0]
    assert parse_qs(urlparse(url).query)["session"] == ["S"]
    assert np.allclose(transform[:3, 3], centre)
    fetched = [c.split("?")[0] for c in get.calls]
    assert HOST + FILES + "far.json" not in fetched
    assert HOST + FILES + "c.glb" not in fetched
    assert HOST + FILES + "a.glb" not in fetched  # replaced by its child


def test_traverse_plan_only_fetches_no_glb(tmp_path):
    routes, _ = _fixture_routes()
    get = FakeGet(routes)
    fetch = gtiles.Fetcher("K", max_requests=50, cache=tmp_path, get=get)
    out = list(gtiles.traverse(BBOX, fetch, max_error=10, plan_only=True))
    assert [glb for _, _, glb in out] == [None]
    assert not [c for c in get.calls if ".glb" in c]


def test_traverse_session_propagates_to_child_without_one(tmp_path):
    routes, _ = _fixture_routes()
    fetch = gtiles.Fetcher("K", max_requests=50, cache=tmp_path, get=FakeGet(routes))
    out = list(gtiles.traverse(BBOX, fetch, max_error=0.5, plan_only=True))
    urls = [u for _, u, _ in out]
    assert urls == [HOST + FILES + "c.glb?session=S"]


# --- glb ----------------------------------------------------------------------


def _glb(primitive_attrs, blob, buffer_views, accessors, extensions=None, used=None):
    prim = pygltflib.Primitive(attributes=pygltflib.Attributes(**primitive_attrs))
    if extensions:
        prim.extensions = extensions
    g = pygltflib.GLTF2(
        scene=0,
        scenes=[pygltflib.Scene(nodes=[0])],
        nodes=[pygltflib.Node(children=[1], translation=[10, 0, 0]), pygltflib.Node(mesh=0)],
        meshes=[pygltflib.Mesh(primitives=[prim])],
        accessors=accessors,
        bufferViews=buffer_views,
        buffers=[pygltflib.Buffer(byteLength=len(blob))],
    )
    if used:
        g.extensionsUsed = used
        g.extensionsRequired = used
    g.set_binary_blob(blob)
    return b"".join(g.save_to_bytes())


TRI = np.array([[0, 1, 0], [1, 0, 0], [0, 0, 1]], dtype=np.float32)


def test_glb_positions_plain_accessor_node_transform_and_z_up():
    blob = TRI.tobytes()
    glb = _glb(
        {"POSITION": 0},
        blob,
        [pygltflib.BufferView(buffer=0, byteOffset=0, byteLength=len(blob))],
        [
            pygltflib.Accessor(
                bufferView=0,
                componentType=pygltflib.FLOAT,
                count=3,
                type=pygltflib.VEC3,
                min=[0, 0, 0],
                max=[1, 1, 1],
            )
        ],
    )
    pts = gtiles.glb_positions(glb)
    assert pts.shape == (3, 3)
    assert np.allclose(pts, [[10, 0, 1], [11, 0, 0], [10, -1, 0]])


def test_glb_positions_draco():
    draco = DracoPy.encode(TRI, faces=np.array([[0, 1, 2]], dtype=np.uint32))
    pad = (-len(draco)) % 4
    blob = draco + b"\0" * pad
    glb = _glb(
        {"POSITION": 0},
        blob,
        [pygltflib.BufferView(buffer=0, byteOffset=0, byteLength=len(draco))],
        [pygltflib.Accessor(componentType=pygltflib.FLOAT, count=3, type=pygltflib.VEC3)],
        extensions={"KHR_draco_mesh_compression": {"bufferView": 0, "attributes": {"POSITION": 0}}},
        used=["KHR_draco_mesh_compression"],
    )
    pts = gtiles.glb_positions(glb)
    assert pts.shape == (3, 3)
    expected = {(10, 0, 1), (11, 0, 0), (10, -1, 0)}
    got = {tuple(int(round(v)) for v in p) for p in pts}
    assert got == expected
    assert np.abs(pts - np.round(pts)).max() < 1e-3
