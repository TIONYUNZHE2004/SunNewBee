"""Budgets and the vertex contract, checked on the committed glbs in apps/web/public/city/."""

import json
from pathlib import Path

import pytest
from tl_assets import specs
from tl_assets.glbinfo import read_glb

ROOT = Path(__file__).resolve().parents[3]
CITY = ROOT / "apps" / "web" / "public" / "city"
MANIFEST = CITY / "manifest.json"
FOLDERS = ("archetypes/", "landmarks/", "kits/")


def _manifest() -> dict | None:
    return json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else None


def test_asset_files_live_in_their_folders():
    for s in specs.ASSETS.values():
        assert s.file.startswith(FOLDERS) and s.file.endswith(".glb"), s.id


def test_manifest_has_no_test_assets():
    m = _manifest()
    if m is None:
        pytest.skip("no manifest committed yet")
    assert m["version"] == 1
    assert list(m["roles"]) == list(specs.ROLES)
    assert not set(m["assets"]) & set(specs.TEST_ASSETS)
    assert set(m["assets"]) <= set(specs.ASSETS)


def test_folder_total_is_within_budget():
    if _manifest() is None:
        pytest.skip("no manifest committed yet")
    total = sum(p.stat().st_size for p in CITY.rglob("*") if p.is_file())
    assert total <= specs.MAX_TOTAL_BYTES


def _check_extent(name: str, extent: float, size: float, rng) -> None:
    if rng is not None:
        assert rng[0] - 0.1 <= extent <= rng[1] + 1.2, (name, extent, rng)
    else:
        assert size - 0.1 <= extent <= size + 1.2, (name, extent, size)


def _committed_assets() -> list[str]:
    m = _manifest()
    return sorted(m["assets"]) if m else []


@pytest.mark.parametrize("asset_id", _committed_assets())
def test_committed_glb(asset_id: str):
    m = _manifest()
    entry = m["assets"][asset_id]
    spec = specs.ASSETS[asset_id]
    path = CITY / spec.file
    assert entry["file"] == spec.file
    assert path.exists(), path
    assert path.stat().st_size <= spec.max_bytes
    info = read_glb(path)
    assert entry["bytes"] == info.bytes
    assert info.materials == ["tl_role"]
    assert info.images <= (1 if spec.group == "landmark" else 0)
    assert "EXT_meshopt_compression" in info.extensions_used
    for v in spec.variants:
        lods = entry["variants"][v.id]["lods"]
        assert len(lods) == len(v.tris)
        for n, cap in enumerate(v.tris):
            name = f"{asset_id}__{v.id}__LOD{n}"
            node = info.nodes[name]
            assert node.primitives == 1, name
            assert node.tris <= cap, (name, node.tris, cap)
            assert "COLOR_0" in node.attributes, name
            assert lods[n]["node"] == name
            assert lods[n]["tris"] == node.tris, name
        lo, hi = info.nodes[f"{asset_id}__{v.id}__LOD0"].bounds
        _check_extent(v.id, hi[0] - lo[0], v.size[0], v.x_range)
        _check_extent(v.id, hi[2] - lo[2], v.size[2], v.z_range)
        if v.y_range is not None:
            assert v.y_range[0] <= hi[1] <= v.y_range[1], (v.id, hi[1], v.y_range)
        else:
            assert abs(hi[1] - v.size[1]) <= 1.0, (v.id, hi[1], v.size[1])
