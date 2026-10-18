"""Read a .glb's JSON chunk: per-node triangles, primitives, world bounds and attributes.

Stdlib only. Works on meshopt-compressed and quantised files, because it reads accessor
counts and min/max (never the compressed buffers). `read_attribute` decodes one attribute of
an uncompressed file (the raw Blender export), for tests.
"""

import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path

Vec3 = tuple[float, float, float]
Mat4 = list[float]  # column-major, like glTF

_MAGIC = b"glTF"
_JSON = 0x4E4F534A
_BIN = 0x004E4942
_NORM = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}
_FMT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
_SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


@dataclass
class NodeInfo:
    tris: int
    primitives: int
    bounds: tuple[Vec3, Vec3]
    attributes: frozenset[str]


@dataclass
class GlbInfo:
    nodes: dict[str, NodeInfo]
    materials: list[str]
    images: int
    extensions_used: list[str]
    bytes: int


def _chunks(path: Path) -> tuple[dict, bytes]:
    data = Path(path).read_bytes()
    if len(data) < 20 or data[:4] != _MAGIC:
        raise ValueError(f"{path} is not a glb")
    version, length = struct.unpack_from("<II", data, 4)
    if version != 2 or length > len(data):
        raise ValueError(f"{path}: unsupported glb (version {version}, length {length})")
    gltf, binary, off = None, b"", 12
    while off + 8 <= length:
        clen, ctype = struct.unpack_from("<II", data, off)
        body = data[off + 8 : off + 8 + clen]
        if ctype == _JSON and gltf is None:
            gltf = json.loads(body.decode("utf-8"))
        elif ctype == _BIN and not binary:
            binary = body
        off += 8 + clen
    if gltf is None:
        raise ValueError(f"{path}: glb has no JSON chunk")
    return gltf, binary


def _mul(a: Mat4, b: Mat4) -> Mat4:
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def _local(node: dict) -> Mat4:
    if "matrix" in node:
        return [float(v) for v in node["matrix"]]
    tx, ty, tz = node.get("translation", (0.0, 0.0, 0.0))
    x, y, z, w = node.get("rotation", (0.0, 0.0, 0.0, 1.0))
    sx, sy, sz = node.get("scale", (1.0, 1.0, 1.0))
    c0 = (1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w))
    c1 = (2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w))
    c2 = (2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y))
    return [
        *(v * sx for v in c0),
        0.0,
        *(v * sy for v in c1),
        0.0,
        *(v * sz for v in c2),
        0.0,
        float(tx),
        float(ty),
        float(tz),
        1.0,
    ]


def _apply(m: Mat4, p: Vec3) -> Vec3:
    x, y, z = p
    return (
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    )


def _world_matrices(gltf: dict) -> dict[int, Mat4]:
    """World matrix per node: the product of the node TRS from the root down."""
    nodes = gltf.get("nodes", [])
    parent: dict[int, int] = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    out: dict[int, Mat4] = {}
    for i in range(len(nodes)):
        chain, j = [], i
        while j not in out:
            chain.append(j)
            if j not in parent:
                break
            j = parent[j]
        for k in reversed(chain):
            local = _local(nodes[k])
            out[k] = _mul(out[parent[k]], local) if k in parent else local
    return out


def _dequant(acc: dict, v: float) -> float:
    if acc.get("normalized") and acc.get("componentType") in _NORM:
        return max(v / _NORM[acc["componentType"]], -1.0)
    return float(v)


def read_glb(path: Path) -> GlbInfo:
    """Summarise a glb: mesh nodes by name, material names, image count and extensions."""
    gltf, _ = _chunks(path)
    accessors = gltf.get("accessors", [])
    meshes = gltf.get("meshes", [])
    worlds = _world_matrices(gltf)
    nodes: dict[str, NodeInfo] = {}
    for i, node in enumerate(gltf.get("nodes", [])):
        if "mesh" not in node:
            continue
        m = worlds[i]
        prims = meshes[node["mesh"]].get("primitives", [])
        tris, attrs = 0, set()
        lo, hi = [math.inf] * 3, [-math.inf] * 3
        for prim in prims:
            attrs.update(prim.get("attributes", {}))
            pos_i = prim.get("attributes", {}).get("POSITION")
            if prim.get("mode", 4) == 4:  # only triangle lists count
                if "indices" in prim:
                    tris += accessors[prim["indices"]]["count"] // 3
                elif pos_i is not None:
                    tris += accessors[pos_i]["count"] // 3
            if pos_i is None or "min" not in accessors[pos_i]:
                continue
            acc = accessors[pos_i]
            amin = [_dequant(acc, v) for v in acc["min"]]
            amax = [_dequant(acc, v) for v in acc["max"]]
            for cx in (amin[0], amax[0]):
                for cy in (amin[1], amax[1]):
                    for cz in (amin[2], amax[2]):
                        p = _apply(m, (cx, cy, cz))
                        for k in range(3):
                            lo[k] = min(lo[k], p[k])
                            hi[k] = max(hi[k], p[k])
        name = node.get("name") or f"node{i}"
        nodes[name] = NodeInfo(tris, len(prims), (tuple(lo), tuple(hi)), frozenset(attrs))
    return GlbInfo(
        nodes=nodes,
        materials=[mat.get("name", "") for mat in gltf.get("materials", [])],
        images=len(gltf.get("images", [])),
        extensions_used=list(gltf.get("extensionsUsed", [])),
        bytes=Path(path).stat().st_size,
    )


def read_attribute(path: Path, node_name: str, attribute: str) -> list[tuple[float, ...]]:
    """Decode `attribute` of the named node's first primitive (uncompressed glbs only).

    Values are in the accessor's own space (node transforms are not applied); normalised
    integers are mapped to [0, 1] or [-1, 1].
    """
    gltf, binary = _chunks(path)
    node = next((n for n in gltf.get("nodes", []) if n.get("name") == node_name), None)
    if node is None or "mesh" not in node:
        raise KeyError(f"{path}: no mesh node {node_name!r}")
    prim = gltf["meshes"][node["mesh"]]["primitives"][0]
    if attribute not in prim.get("attributes", {}):
        raise KeyError(f"{node_name}: no attribute {attribute}")
    acc = gltf["accessors"][prim["attributes"][attribute]]
    view = gltf["bufferViews"][acc["bufferView"]]
    if "extensions" in view or "sparse" in acc:
        raise ValueError(f"{path}: compressed or sparse accessors are not supported")
    ct, n = acc["componentType"], _NCOMP[acc["type"]]
    stride = view.get("byteStride") or _SIZE[ct] * n
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    fmt = "<" + _FMT[ct] * n
    return [
        tuple(_dequant(acc, v) for v in struct.unpack_from(fmt, binary, base + k * stride))
        for k in range(acc["count"])
    ]
