import pytest
from tl_assets import specs
from tl_assets.glbinfo import GlbInfo, NodeInfo
from tl_assets.manifest import build_manifest

RING = [[101.50, 3.18], [101.52, 3.18], [101.52, 3.19], [101.50, 3.19], [101.50, 3.18]]
FC = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"model": "lakeside_mall"},
            "geometry": {"type": "Polygon", "coordinates": [RING]},
        }
    ],
}


def _info(asset_id: str, nbytes: int = 1234) -> GlbInfo:
    spec = specs.get_spec(asset_id)
    nodes = {
        f"{asset_id}__{v.id}__LOD{n}": NodeInfo(
            cap - 1, 1, ((0, 0, 0), (1, 1, 1)), frozenset({"POSITION", "COLOR_0"})
        )
        for v in spec.variants
        for n, cap in enumerate(v.tris)
    }
    return GlbInfo(nodes, ["tl_role"], 0, ["EXT_meshopt_compression"], nbytes)


def test_manifest_lists_only_built_assets_and_never_calib():
    infos = {a: _info(a) for a in ("lakeside_mall", "link_intermediate", "calib")}
    m = build_manifest(infos, "2026-10-17", FC)
    assert list(m) == ["version", "as_of", "roles", "precinctGroups", "assets", "landmarks"]
    assert m["version"] == 1
    assert m["roles"] == list(specs.ROLES)
    assert m["precinctGroups"][2] == ["valley", "valley"]
    assert list(m["assets"]) == ["link_intermediate", "lakeside_mall"]  # ASSETS order
    link = m["assets"]["link_intermediate"]
    assert link["file"] == "archetypes/link_intermediate.glb"
    assert link["bytes"] == 1234
    assert link["repeat"] == "frontage"
    assert link["fit"] == {"xz": [0.75, 1.35], "y": [0.6, 1.6]}
    assert link["variantByGroup"]["default"] == "gable"
    assert link["palettes"]["valley"][0] == ["#e6e7e8", "#74787e", "#c06a50"]
    lods = link["variants"]["gable"]["lods"]
    assert lods[0] == {"node": "link_intermediate__gable__LOD0", "tris": 5999, "maxM": 300.0}
    assert lods[2]["maxM"] is None
    assert link["variants"]["gable"]["size"] == [6.4, 8.5, 15.5]
    # the drawn LOD0 top, from the glb bounds (the web fit scales height by it)
    assert link["variants"]["gable"]["top"] == 1.0


def test_anchor_is_the_ring_centroid_for_anchor_landmarks_only():
    m = build_manifest({"lakeside_mall": _info("lakeside_mall")}, "2026-10-17", FC)
    assert m["landmarks"]["lakeside_mall"]["anchor"] == pytest.approx([101.51, 3.185])
    assert build_manifest({}, "2026-10-17", FC)["landmarks"] == {}


def test_missing_lod_node_is_an_error():
    info = _info("generic")
    del info.nodes["generic__box__LOD1"]
    with pytest.raises(ValueError, match="generic__box__LOD1"):
        build_manifest({"generic": info}, "2026-10-17", FC)
