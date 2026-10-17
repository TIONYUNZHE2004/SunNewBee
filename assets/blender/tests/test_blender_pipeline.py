"""End-to-end: headless Blender builds `calib`, gltf-transform packs it (opt-in, slow)."""

import statistics
import subprocess
import sys
from pathlib import Path

import pytest
from tl_assets.glbinfo import read_attribute, read_glb

ASSETS_DIR = Path(__file__).resolve().parents[1]
ROOT = ASSETS_DIR.parents[1]
RAW = ASSETS_DIR / "out" / "raw" / "test" / "calib.glb"
NODES = [f"calib__a__LOD{n}" for n in range(3)]

pytestmark = pytest.mark.blender


@pytest.fixture(scope="module")
def built(tmp_path_factory) -> tuple[Path, Path]:
    run = subprocess.run(
        [sys.executable, str(ASSETS_DIR / "run.py"), "--asset", "calib"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert run.returncode == 0, run.stdout[-4000:] + run.stderr[-4000:]
    out = tmp_path_factory.mktemp("packed")
    pack = subprocess.run(
        [sys.executable, str(ASSETS_DIR / "pack.py"), "--only", "calib", "--out", str(out)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert pack.returncode == 0, pack.stdout[-4000:] + pack.stderr[-4000:]
    assert not (out / "manifest.json").exists()
    return RAW, out / "test" / "calib.glb"


def test_raw_nodes_follow_the_vertex_contract(built):
    raw, _ = built
    info = read_glb(raw)
    assert set(NODES) <= set(info.nodes)
    assert info.materials == ["tl_role"]
    assert info.images == 0
    for name in NODES:
        node = info.nodes[name]
        assert node.primitives == 1, name
        assert "COLOR_0" in node.attributes, name
        assert node.tris > 0, name
    caps = (3000, 600, 60)
    assert all(info.nodes[n].tris <= c for n, c in zip(NODES, caps, strict=True))


def test_lod0_bounds_put_the_porch_on_plus_z(built):
    raw, _ = built
    lo, hi = read_glb(raw).nodes["calib__a__LOD0"].bounds
    assert lo[0] == pytest.approx(-5, abs=0.01) and hi[0] == pytest.approx(5, abs=0.01)
    assert lo[1] == pytest.approx(0, abs=0.01) and hi[1] == pytest.approx(10, abs=0.01)
    assert lo[2] == pytest.approx(-5, abs=0.01)
    assert hi[2] == pytest.approx(7, abs=0.01)


def test_packed_bounds_match_raw(built):
    raw, packed = built
    a, b = read_glb(raw), read_glb(packed)
    assert "EXT_meshopt_compression" in b.extensions_used
    assert b.materials == ["tl_role"]
    for name in NODES:
        assert b.nodes[name].primitives == 1
        assert b.nodes[name].tris == a.nodes[name].tris
        for k in range(2):
            assert b.nodes[name].bounds[k] == pytest.approx(a.nodes[name].bounds[k], abs=0.01)


def test_ao_is_baked_into_red(built):
    raw, _ = built
    colors = read_attribute(raw, "calib__a__LOD0", "COLOR_0")
    pos = read_attribute(raw, "calib__a__LOD0", "POSITION")
    assert len(colors) == len(pos)
    reds = [c[0] for c in colors]
    assert 0.5 <= statistics.fmean(reds) <= 1.0
    assert all(c[3] == pytest.approx(1.0, abs=1e-3) for c in colors)
    # under the porch: the +z wall below the slab and the slab's underside
    porch = [c[0] for c, p in zip(colors, pos, strict=True) if p[2] > 4.9 and p[1] < 3.5]
    assert len(porch) > 10
    assert statistics.pstdev(porch) > 0.02
    # role in G: walls primary (0), porch slab secondary (1/7)
    greens = {round(c[1] * 7) for c in colors}
    assert greens == {0, 1}
