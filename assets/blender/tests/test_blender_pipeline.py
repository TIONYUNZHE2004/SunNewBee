"""End-to-end: headless Blender builds `calib`, gltf-transform packs it (opt-in, slow)."""

import statistics
import subprocess
import sys
from pathlib import Path

import pytest
from tl_assets import specs
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


# --- Task 2: link houses ---------------------------------------------------------------

LINK_IDS = ("link_intermediate", "link_long")


@pytest.fixture(scope="module")
def link_built(tmp_path_factory) -> dict[str, tuple[Path, Path]]:
    """Build both link houses through run.py and pack them into a tmp folder (no manifest)."""
    cmd = [sys.executable, str(ASSETS_DIR / "run.py")]
    for a in LINK_IDS:
        cmd += ["--asset", a]
    run = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=1200)
    assert run.returncode == 0, run.stdout[-4000:] + run.stderr[-4000:]
    out = tmp_path_factory.mktemp("links")
    pack_cmd = [sys.executable, str(ASSETS_DIR / "pack.py"), "--out", str(out)]
    for a in LINK_IDS:
        pack_cmd += ["--only", a]
    pack = subprocess.run(pack_cmd, cwd=ROOT, capture_output=True, text=True, timeout=300)
    assert pack.returncode == 0, pack.stdout[-4000:] + pack.stderr[-4000:]
    assert not (out / "manifest.json").exists()
    raw_dir = ASSETS_DIR / "out" / "raw"
    return {a: (raw_dir / specs.ASSETS[a].file, out / specs.ASSETS[a].file) for a in LINK_IDS}


@pytest.mark.parametrize("asset_id", LINK_IDS)
def test_link_houses(link_built, asset_id):
    raw, packed = link_built[asset_id]
    spec = specs.ASSETS[asset_id]
    a, b = read_glb(raw), read_glb(packed)
    # the committed-asset checks, on the packed file
    assert packed.stat().st_size <= spec.max_bytes
    assert b.materials == ["tl_role"]
    assert b.images == 0
    assert "EXT_meshopt_compression" in b.extensions_used
    assert {v.id for v in spec.variants} == {"gable", "modern"}
    for v in spec.variants:
        for n, cap in enumerate(v.tris):
            name = f"{asset_id}__{v.id}__LOD{n}"
            node = b.nodes[name]
            assert node.primitives == 1, name
            assert "COLOR_0" in node.attributes, name
            assert 0 < node.tris <= cap, (name, node.tris, cap)
            assert node.tris == a.nodes[name].tris, name
        assert b.nodes[f"{asset_id}__{v.id}__LOD2"].tris <= 40
        lod0 = f"{asset_id}__{v.id}__LOD0"
        for n in range(3):  # every LOD fits the size table, not just LOD0
            node = b.nodes[f"{asset_id}__{v.id}__LOD{n}"]
            assert specs.bounds_errors(v, node.bounds) == [], n
        # LOD1 is simpler than LOD0, LOD2 simpler than LOD1
        tris = [a.nodes[f"{asset_id}__{v.id}__LOD{n}"].tris for n in range(3)]
        assert tris[0] > tris[1] > tris[2], tris
        # vertex contract on the raw LOD0
        colors = read_attribute(raw, lod0, "COLOR_0")
        reds = [c[0] for c in colors]
        assert statistics.pstdev(reds) > 0.05, lod0  # AO varies
        assert 0.3 <= statistics.fmean(reds) <= 1.0, lod0
        pos = read_attribute(raw, lod0, "POSITION")
        assert min(p[1] for p in pos) > -0.01, "nothing below the ground"
        upper_walls = [c[0] for c, p in zip(colors, pos, strict=True) if p[1] > 5 and c[1] < 0.05]
        assert statistics.fmean(upper_walls) > 0.5, "upper walls are open (normals outwards)"
        glass_ao = [c[0] for c in colors if round(c[1] * 7) == specs.ROLES.index("glass")]
        assert statistics.fmean(glass_ao) > 0.3, "glass is not baked black"
        roles = {round(c[1] * 7) for c in colors}
        assert len(roles) >= 4, (lod0, roles)
        assert {specs.ROLES.index("glass"), specs.ROLES.index("dark")} <= roles, roles
        glass = [c[2] for c in colors if round(c[1] * 7) == specs.ROLES.index("glass")]
        assert glass and all(0.0 < g < 1.0 for g in glass), lod0
        assert len({round(g, 4) for g in glass}) > 1, "window seeds vary per window"
        if v.id == "modern":
            assert specs.ROLES.index("accent") in roles  # brick accent panel
        # LOD1 keeps glass (inset faces) but drops the dark frames and AC fans
        lod1 = f"{asset_id}__{v.id}__LOD1"
        roles1 = {round(c[1] * 7) for c in read_attribute(raw, lod1, "COLOR_0")}
        assert specs.ROLES.index("glass") in roles1
        assert specs.ROLES.index("metal") not in roles1  # gate, fence and AC are LOD0 only
        assert specs.ROLES.index("dark") not in roles1
