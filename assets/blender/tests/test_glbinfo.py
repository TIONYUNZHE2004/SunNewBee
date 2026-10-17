import json
import struct

import pytest
from tl_assets.glbinfo import read_attribute, read_glb


def make_glb(path, gltf: dict, binary: bytes = b"") -> None:
    js = json.dumps(gltf).encode()
    js += b" " * (-len(js) % 4)
    binary += b"\0" * (-len(binary) % 4)
    chunks = struct.pack("<I4s", len(js), b"JSON") + js
    if binary:
        chunks += struct.pack("<I4s", len(binary), b"BIN\0") + binary
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, 12 + len(chunks)) + chunks)


def one_triangle(**node) -> tuple[dict, bytes]:
    pos = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0)
    gltf = {
        "asset": {"version": "2.0"},
        "nodes": [{"name": "tri", "mesh": 0, **node}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": 3,
                "type": "VEC3",
                "min": [0, 0, 0],
                "max": [1, 1, 0],
            }
        ],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(pos)}],
        "buffers": [{"byteLength": len(pos)}],
    }
    return gltf, pos


def test_unquantised_triangle_with_translation(tmp_path):
    gltf, pos = one_triangle(translation=[10, 0, 0])
    make_glb(tmp_path / "a.glb", gltf, pos)
    info = read_glb(tmp_path / "a.glb")
    node = info.nodes["tri"]
    assert node.tris == 1
    assert node.primitives == 1
    assert node.bounds[0] == pytest.approx((10, 0, 0))
    assert node.bounds[1] == pytest.approx((11, 1, 0))
    assert node.attributes == frozenset({"POSITION"})
    assert info.bytes == (tmp_path / "a.glb").stat().st_size


def test_parent_transform_is_applied(tmp_path):
    gltf, pos = one_triangle()
    gltf["nodes"].append({"name": "root", "children": [0], "translation": [0, 5, 0]})
    make_glb(tmp_path / "a.glb", gltf, pos)
    node = read_glb(tmp_path / "a.glb").nodes["tri"]
    assert node.bounds[0] == pytest.approx((0, 5, 0))


def test_int16_normalised_position_with_scale(tmp_path):
    gltf, _ = one_triangle(scale=[2, 2, 2])
    acc = gltf["accessors"][0]
    acc.update(componentType=5122, normalized=True, min=[-32767, 0, 0], max=[32767, 16384, 0])
    gltf["extensionsUsed"] = ["KHR_mesh_quantization"]
    make_glb(tmp_path / "q.glb", gltf, b"\0" * 24)
    node = read_glb(tmp_path / "q.glb").nodes["tri"]
    assert node.bounds[0] == pytest.approx((-2, 0, 0))
    assert node.bounds[1] == pytest.approx((2, 2 * 16384 / 32767, 0))


def test_two_primitives_and_indices(tmp_path):
    gltf, pos = one_triangle()
    idx = struct.pack("<6H", 0, 1, 2, 0, 2, 1)
    gltf["accessors"].append({"bufferView": 1, "componentType": 5123, "count": 6, "type": "SCALAR"})
    gltf["bufferViews"].append({"buffer": 0, "byteOffset": len(pos), "byteLength": len(idx)})
    gltf["meshes"][0]["primitives"] = [
        {"attributes": {"POSITION": 0}},
        {"attributes": {"POSITION": 0}, "indices": 1},
        {"attributes": {"POSITION": 0}, "mode": 1},  # lines never count
    ]
    make_glb(tmp_path / "p.glb", gltf, pos + idx)
    node = read_glb(tmp_path / "p.glb").nodes["tri"]
    assert node.primitives == 3
    assert node.tris == 1 + 2


def test_images_materials_and_extensions(tmp_path):
    gltf, pos = one_triangle()
    gltf.update(
        images=[{"uri": "x.png"}],
        materials=[{"name": "tl_role"}],
        extensionsUsed=["EXT_meshopt_compression"],
    )
    make_glb(tmp_path / "m.glb", gltf, pos)
    info = read_glb(tmp_path / "m.glb")
    assert info.images == 1
    assert info.materials == ["tl_role"]
    assert info.extensions_used == ["EXT_meshopt_compression"]


def test_read_attribute_decodes_floats_and_normalised_shorts(tmp_path):
    gltf, pos = one_triangle()
    col = struct.pack("<12H", *([65535, 0, 32768, 65535] * 3))
    gltf["accessors"].append(
        {"bufferView": 1, "componentType": 5123, "normalized": True, "count": 3, "type": "VEC4"}
    )
    gltf["bufferViews"].append({"buffer": 0, "byteOffset": len(pos), "byteLength": len(col)})
    gltf["meshes"][0]["primitives"][0]["attributes"]["COLOR_0"] = 1
    make_glb(tmp_path / "c.glb", gltf, pos + col)
    assert read_attribute(tmp_path / "c.glb", "tri", "POSITION")[1] == pytest.approx((1, 0, 0))
    c = read_attribute(tmp_path / "c.glb", "tri", "COLOR_0")
    assert len(c) == 3
    assert c[0] == pytest.approx((1, 0, 32768 / 65535, 1))


def test_not_a_glb_raises(tmp_path):
    p = tmp_path / "x.glb"
    p.write_bytes(b"not a glb file at all")
    with pytest.raises(ValueError):
        read_glb(p)
