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
    assert exc.value.status == 404
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
    assert [(url.split("?")[0], glb) for _, url, glb, _ in out] == [(HOST + FILES + "b.glb", b"B")]
    transform, url, _, _ = out[0]
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
    assert [glb for _, _, glb, _ in out] == [None]
    assert not [c for c in get.calls if ".glb" in c]


def test_traverse_session_propagates_to_child_without_one(tmp_path):
    routes, _ = _fixture_routes()
    fetch = gtiles.Fetcher("K", max_requests=50, cache=tmp_path, get=FakeGet(routes))
    out = list(gtiles.traverse(BBOX, fetch, max_error=0.5, plan_only=True))
    urls = [u for _, u, _, _ in out]
    assert urls == [HOST + FILES + "c.glb?session=S"]


def _with_root_session(routes, session):
    root = HOST + "/v1/3dtiles/root.json"
    text = routes[root].decode().replace("session=S", f"session={session}")
    return {**routes, root: text.encode()}


def test_traverse_fetches_root_fresh_and_overrides_stale_child_sessions(tmp_path):
    routes, _ = _fixture_routes()
    first = gtiles.Fetcher("K", max_requests=50, cache=tmp_path, get=FakeGet(routes))
    list(gtiles.traverse(BBOX, first, max_error=10, plan_only=True))
    # Later run: the cached near.json still carries the expired session S in its URIs.
    get = FakeGet(_with_root_session(routes, "FRESH"))
    later = gtiles.Fetcher("K", max_requests=50, cache=tmp_path, get=get)
    out = list(gtiles.traverse(BBOX, later, max_error=10, plan_only=True))
    assert [c.split("?")[0] for c in get.calls] == [HOST + "/v1/3dtiles/root.json"]
    assert later.requests_made == 1  # the fresh root counts against the budget
    assert [parse_qs(urlparse(u).query)["session"] for _, u, _, _ in out] == [["FRESH"]]


def test_fetcher_fresh_bypasses_cache_read_and_refreshes_it(tmp_path):
    url = "https://h/root.json"
    (tmp_path / f"{gtiles.cache_key(url)}.bin").write_bytes(b"stale")
    get = FakeGet({url: b"new"})
    f = gtiles.Fetcher("K", max_requests=1, cache=tmp_path, get=get)
    assert f(url, fresh=True) == b"new"
    assert f.requests_made == 1
    assert f(url) == b"new"
    with pytest.raises(gtiles.TilesBudgetExceeded):
        f(url, fresh=True)


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


def _plain_glb(used=None, required=None, gltf_extensions=None):
    blob = TRI.tobytes()
    acc = pygltflib.Accessor(
        bufferView=0, componentType=pygltflib.FLOAT, count=3, type=pygltflib.VEC3
    )
    view = pygltflib.BufferView(buffer=0, byteOffset=0, byteLength=len(blob))
    g = pygltflib.GLTF2.load_from_bytes(_glb({"POSITION": 0}, blob, [view], [acc]))
    if used:
        g.extensionsUsed = used
    if required:
        g.extensionsRequired = required
    if gltf_extensions:
        g.extensions = gltf_extensions
    return b"".join(g.save_to_bytes())


def test_glb_positions_accepts_quantization_and_draco_requirements():
    req = ["KHR_mesh_quantization", "KHR_draco_mesh_compression"]
    assert gtiles.glb_positions(_plain_glb(used=req, required=req)).shape == (3, 3)


def test_glb_positions_refuses_unknown_required_extension():
    with pytest.raises(gtiles.UnsupportedGlb, match="EXT_meshopt_compression"):
        gtiles.glb_positions(
            _plain_glb(used=["EXT_meshopt_compression"], required=["EXT_meshopt_compression"])
        )


def test_glb_positions_refuses_cesium_rtc():
    with pytest.raises(gtiles.UnsupportedGlb, match="CESIUM_RTC"):
        gtiles.glb_positions(
            _plain_glb(used=["CESIUM_RTC"], gltf_extensions={"CESIUM_RTC": {"center": [1, 2, 3]}})
        )


def test_glb_positions_accepts_texture_and_material_only_requirements():
    req = ["KHR_texture_basisu", "EXT_texture_webp", "KHR_materials_unlit", "KHR_texture_transform"]
    assert gtiles.glb_positions(_plain_glb(used=req, required=req)).shape == (3, 3)


# --- bbox rectangle cull ------------------------------------------------------------


def _enu_box(bbox, east, north, half, angle_deg=0.0, half_up=50.0):
    """A world OBB (ECEF) centred at (east, north) metres from the bbox centre, axes rotated
    by angle_deg in the horizontal plane."""
    lon0, lat0 = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    r = gtiles.enu_matrix(lon0, lat0)[:3, :3]  # rows: east, north, up in ECEF
    a = np.radians(angle_deg)
    centre = gtiles.ecef(lon0, lat0) + r.T @ np.array([east, north, 0.0])
    ax1 = r.T @ np.array([np.cos(a), np.sin(a), 0.0]) * half
    ax2 = r.T @ np.array([-np.sin(a), np.cos(a), 0.0]) * half
    ax3 = r.T @ np.array([0.0, 0.0, 1.0]) * half_up
    return [*centre, *ax1, *ax2, *ax3]


def test_bbox_frame_rect_matches_bbox_size():
    _, rect = gtiles.bbox_frame(BBOX)
    assert rect[0] == pytest.approx(-1111, abs=3) and rect[2] == pytest.approx(1111, abs=3)
    assert rect[1] == pytest.approx(-1106, abs=3) and rect[3] == pytest.approx(1106, abs=3)


def test_rect_cull_skips_circle_corner_region_and_keeps_edge_overlap():
    sphere = gtiles.bbox_sphere(BBOX)
    enu, rect = gtiles.bbox_frame(BBOX)
    outside = _enu_box(BBOX, 0.0, 1400.0, 100.0)  # beyond the north edge, inside the circle
    assert gtiles.box_hits_sphere(outside, sphere)
    assert not gtiles.box_hits_rect(outside, enu, rect)
    edge = _enu_box(BBOX, 0.0, 1150.0, 100.0)  # straddles the north edge
    assert gtiles.box_hits_rect(edge, enu, rect)
    inside = _enu_box(BBOX, 0.0, 0.0, 10.0)
    assert gtiles.box_hits_rect(inside, enu, rect)
    huge = _enu_box(BBOX, 0.0, 0.0, 1e6)  # contains the whole rectangle
    assert gtiles.box_hits_rect(huge, enu, rect)


def test_rect_cull_uses_the_box_axes_near_a_corner():
    enu, rect = gtiles.bbox_frame(BBOX)
    x, y = rect[2] + 60.0, rect[3] + 60.0
    # A 45-degree diamond whose axis-aligned bounds overlap the corner but which does not.
    diamond = _enu_box(BBOX, x, y, 50.0, angle_deg=45.0)
    assert not gtiles.box_hits_rect(diamond, enu, rect)
    touching = _enu_box(BBOX, rect[2] + 30.0, rect[3] + 30.0, 50.0, angle_deg=45.0)
    assert gtiles.box_hits_rect(touching, enu, rect)


def _flat_root(children):
    return {
        "root": {
            "boundingVolume": {"box": _enu_box(BBOX, 0.0, 0.0, 5000.0)},
            "geometricError": 100,
            "children": children,
        }
    }


def _child(box, uri, error=1):
    return {"boundingVolume": {"box": box}, "geometricError": error, "content": {"uri": uri}}


def test_traverse_skips_tiles_outside_the_rectangle(tmp_path):
    root = _flat_root(
        [
            _child(_enu_box(BBOX, 0.0, 1400.0, 100.0), f"{FILES}corner.glb?session=S"),
            _child(_enu_box(BBOX, 0.0, 1150.0, 100.0), f"{FILES}edge.glb?session=S"),
        ]
    )
    get = FakeGet({HOST + "/v1/3dtiles/root.json": json.dumps(root).encode()})
    fetch = gtiles.Fetcher("K", max_requests=5, cache=tmp_path, get=get)
    out = list(gtiles.traverse(BBOX, fetch, max_error=2, plan_only=True))
    assert [u.split("?")[0] for _, u, _, _ in out] == [HOST + FILES + "edge.glb"]


def test_traverse_count_leaves_does_not_fetch_leaf_tilesets(tmp_path):
    inner = {"root": _child(_enu_box(BBOX, 0.0, 0.0, 300.0), "x.glb", error=30)}
    inner["root"]["children"] = [
        _child(_enu_box(BBOX, 0.0, 0.0, 30.0), "leaf.json"),  # at max error: counted only
        _child(_enu_box(BBOX, 100.0, 0.0, 30.0), "direct.glb"),
    ]
    root = _flat_root([_child(_enu_box(BBOX, 0.0, 0.0, 300.0), f"{FILES}mid.json?session=S", 50)])
    get = FakeGet(
        {
            HOST + "/v1/3dtiles/root.json": json.dumps(root).encode(),
            HOST + FILES + "mid.json": json.dumps(inner).encode(),
        }
    )
    fetch = gtiles.Fetcher("K", max_requests=5, cache=tmp_path, get=get)
    out = list(gtiles.traverse(BBOX, fetch, max_error=2, plan_only=True, count_leaves=True))
    assert sorted(u.split("?")[0].rsplit("/", 1)[-1] for _, u, _, _ in out) == [
        "direct.glb",
        "leaf.json",
    ]
    assert [c.split("?")[0].rsplit("/", 1)[-1] for c in get.calls] == ["root.json", "mid.json"]
    assert all(glb is None for _, _, glb, _ in out)


# --- round 2: session-proof cache ids, tolerance, breadth-first ---------------------


def _session_routes(token):
    """Same tree every session, but Google-style opaque paths that change with the session."""
    near = _enu_box(BBOX, 0.0, 0.0, 300.0)
    root = _flat_root([_child(near, f"{FILES}{token}-near.json?session={token}", 50)])
    inner = {"root": _child(near, f"{token}-a.glb", error=2)}
    return {
        HOST + "/v1/3dtiles/root.json": json.dumps(root).encode(),
        HOST + FILES + f"{token}-near.json": json.dumps(inner).encode(),
        HOST + FILES + f"{token}-a.glb": b"GLB",
    }


def test_cache_survives_a_new_session_with_new_paths(tmp_path):
    first = gtiles.Fetcher("K", max_requests=10, cache=tmp_path, get=FakeGet(_session_routes("s1")))
    out1 = list(gtiles.traverse(BBOX, first, max_error=2))
    assert [c.glb for c in out1] == [b"GLB"] and first.requests_made == 3
    get = FakeGet(_session_routes("s2"))
    later = gtiles.Fetcher("K", max_requests=10, cache=tmp_path, get=get)
    out2 = list(gtiles.traverse(BBOX, later, max_error=2))
    assert [c.glb for c in out2] == [b"GLB"]
    assert [c.split("?")[0] for c in get.calls] == [HOST + "/v1/3dtiles/root.json"]
    assert out2[0].cache_id == out1[0].cache_id


def test_stale_cached_tileset_is_refreshed_before_a_network_fetch(tmp_path):
    plan = gtiles.Fetcher("K", max_requests=10, cache=tmp_path, get=FakeGet(_session_routes("s1")))
    list(gtiles.traverse(BBOX, plan, max_error=2, plan_only=True))  # caches s1 tilesets only
    get = FakeGet(_session_routes("s2"))
    run = gtiles.Fetcher("K", max_requests=10, cache=tmp_path, get=get)
    out = list(gtiles.traverse(BBOX, run, max_error=2))
    assert [c.glb for c in out] == [b"GLB"]
    # The cached near.json holds s1 paths, so it is re-fetched (fresh) before the glb.
    names = [c.split("?")[0].rsplit("/", 1)[-1] for c in get.calls]
    assert names == ["root.json", "s2-near.json", "s2-a.glb"]
    assert parse_qs(urlparse(get.calls[-1]).query)["session"] == ["s2"]


def test_cache_id_changes_with_the_tile():
    a = gtiles.content_id("p", (0, 1), 0, "glb", {"box": [1.0] * 12})
    assert a == gtiles.content_id("p", (0, 1), 0, "glb", {"box": [1.0] * 12})
    assert a != gtiles.content_id("p", (0, 2), 0, "glb", {"box": [1.0] * 12})
    assert a != gtiles.content_id("p", (0, 1), 0, "glb", {"box": [2.0] * 12})
    assert a != gtiles.content_id("q", (0, 1), 0, "glb", {"box": [1.0] * 12})


def test_max_error_tolerates_googles_level_values(tmp_path):
    # Google's levels are 2.006..., 4.0127...; --max-error 4.0 must stop at the 4 m level and
    # count mode must treat a 2.006 m json leaf as a leaf at --max-error 2.0.
    box = _enu_box(BBOX, 0.0, 0.0, 50.0)
    four = _child(box, f"{FILES}four.glb?session=S", error=4.012737549616256)
    four["children"] = [_child(box, f"{FILES}two.json?session=S", error=2.006368774808128)]
    get = FakeGet({HOST + "/v1/3dtiles/root.json": json.dumps(_flat_root([four])).encode()})
    fetch = gtiles.Fetcher("K", max_requests=5, cache=tmp_path, get=get)
    out = list(gtiles.traverse(BBOX, fetch, max_error=4.0, plan_only=True))
    assert [c.url.split("?")[0].rsplit("/", 1)[-1] for c in out] == ["four.glb"]
    out = list(gtiles.traverse(BBOX, fetch, max_error=2.0, count_leaves=True))
    assert [c.url.split("?")[0].rsplit("/", 1)[-1] for c in out] == ["two.json"]
    assert len(get.calls) == 2  # root.json twice (fresh each run), never two.json


def test_traverse_fetches_tilesets_breadth_first(tmp_path):
    box = _enu_box(BBOX, 0.0, 0.0, 300.0)
    routes = {
        HOST + "/v1/3dtiles/root.json": json.dumps(
            _flat_root([_child(box, f"{FILES}A.json", 50), _child(box, f"{FILES}B.json", 50)])
        ).encode(),
        HOST + FILES + "A.json": json.dumps({"root": _child(box, "A1.json", 40)}).encode(),
        HOST + FILES + "B.json": json.dumps({"root": _child(box, "B1.json", 40)}).encode(),
        HOST + FILES + "A1.json": json.dumps({"root": _child(box, "a.glb", 1)}).encode(),
        HOST + FILES + "B1.json": json.dumps({"root": _child(box, "b.glb", 1)}).encode(),
    }
    get = FakeGet(routes)
    fetch = gtiles.Fetcher("K", max_requests=10, cache=tmp_path, get=get)
    list(gtiles.traverse(BBOX, fetch, max_error=2, plan_only=True))
    names = [c.split("?")[0].rsplit("/", 1)[-1] for c in get.calls]
    assert names == ["root.json", "A.json", "B.json", "A1.json", "B1.json"]
