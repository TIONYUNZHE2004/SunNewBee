"""Budgets and the vertex contract, checked on the committed glbs in apps/web/public/city/."""

import json
from pathlib import Path

import pytest
from tl_assets import specs
from tl_assets.geo import outline_ring, ring_centroid
from tl_assets.glbinfo import read_glb

ROOT = Path(__file__).resolve().parents[3]
CITY = ROOT / "apps" / "web" / "public" / "city"
MANIFEST = CITY / "manifest.json"
LANDMARKS = ROOT / "data" / "seed" / "elmina" / "base" / "landmarks.geojson"
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
    assert total <= P4_TOTAL_BYTES, total


P4_TOTAL_BYTES = 4_000_000  # P4 Task 7: the detail pass keeps the whole city folder under 4 MB


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
        assert specs.bounds_errors(v, info.nodes[f"{asset_id}__{v.id}__LOD0"].bounds) == []


def _ranged_kit_variants() -> list[tuple[str, str]]:
    m = _manifest()
    if m is None:
        return []
    return [
        (s.id, v.id)
        for s in specs.ASSETS.values()
        if s.group == "kit" and s.id in m["assets"]
        for v in s.variants
        if v.x_range or v.y_range or v.z_range
    ]


@pytest.mark.parametrize(("asset_id", "variant_id"), _ranged_kit_variants())
def test_jittered_kit_stays_inside_true_scale(asset_id: str, variant_id: str):
    """Review Focus 5: LOD0 x (1 -+ jitter scale) stays inside every ranged axis."""
    spec = specs.ASSETS[asset_id]
    v = next(v for v in spec.variants if v.id == variant_id)
    j = spec.jitter.get("scale", 0.0)
    lo, hi = read_glb(CITY / spec.file).nodes[f"{asset_id}__{variant_id}__LOD0"].bounds
    measures = (
        ("x extent", hi[0] - lo[0], v.x_range),
        ("y max", hi[1], v.y_range),
        ("z extent", hi[2] - lo[2], v.z_range),
    )
    for label, value, rng in measures:
        if rng is None:
            continue
        for k in (1 - j, 1 + j):
            assert rng[0] <= value * k <= rng[1], (variant_id, label, round(value * k, 3), rng)


def test_committed_mall_anchor_matches_the_seed():
    """The committed lakeside_mall anchor is the current seed ring centroid (no stale pack)."""
    m = _manifest()
    if m is None or "lakeside_mall" not in m.get("landmarks", {}):
        pytest.skip("no lakeside_mall anchor committed")
    ring = outline_ring(json.loads(LANDMARKS.read_text(encoding="utf-8")), "lakeside_mall")
    assert ring is not None, "seed landmarks.geojson has no lakeside_mall feature"
    lon, lat = ring_centroid(ring)
    assert m["landmarks"]["lakeside_mall"]["anchor"] == pytest.approx([lon, lat], abs=1e-7)
