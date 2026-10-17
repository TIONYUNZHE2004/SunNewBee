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


# --- archetypes (Tasks 2-3) -------------------------------------------------------------

LINK_IDS = ("link_intermediate", "link_long")
# a single-storey roof shades the top of its walls, so its "upper walls" start lower
# (height fraction, min mean AO); default (0.5, 0.5). A school's walls sit behind its deep
# corridor and roof overhang
UPPER_FROM = {"bungalow": (0.15, 0.4), "school": (0.5, 0.3)}
RESIDENTIAL_IDS = ("superlink", "semi_d", "bungalow", "townhouse")
NON_RESIDENTIAL_IDS = ("shop_office", "highrise", "school", "mosque", "factory", "mall", "generic")


def _build_and_pack(ids, tmp_path_factory) -> dict[str, tuple[Path, Path]]:
    """Build the assets through run.py and pack them into a tmp folder (no manifest)."""
    cmd = [sys.executable, str(ASSETS_DIR / "run.py")]
    for a in ids:
        cmd += ["--asset", a]
    run = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=1800)
    assert run.returncode == 0, run.stdout[-4000:] + run.stderr[-4000:]
    out = tmp_path_factory.mktemp("archetypes")
    pack_cmd = [sys.executable, str(ASSETS_DIR / "pack.py"), "--out", str(out)]
    for a in ids:
        pack_cmd += ["--only", a]
    pack = subprocess.run(pack_cmd, cwd=ROOT, capture_output=True, text=True, timeout=600)
    assert pack.returncode == 0, pack.stdout[-4000:] + pack.stderr[-4000:]
    assert not (out / "manifest.json").exists()
    raw_dir = ASSETS_DIR / "out" / "raw"
    return {a: (raw_dir / specs.ASSETS[a].file, out / specs.ASSETS[a].file) for a in ids}


@pytest.fixture(scope="module")
def link_built(tmp_path_factory) -> dict[str, tuple[Path, Path]]:
    return _build_and_pack(LINK_IDS, tmp_path_factory)


@pytest.fixture(scope="module")
def residential_built(tmp_path_factory) -> dict[str, tuple[Path, Path]]:
    return _build_and_pack(RESIDENTIAL_IDS, tmp_path_factory)


@pytest.fixture(scope="module")
def non_residential_built(tmp_path_factory) -> dict[str, tuple[Path, Path]]:
    return _build_and_pack(NON_RESIDENTIAL_IDS, tmp_path_factory)


def _roles(colors) -> set[int]:
    return {round(c[1] * 7) for c in colors}


def check_archetype(raw: Path, packed: Path, asset_id: str) -> dict[str, list]:
    """The shared archetype checks (committed-asset checks on the packed file, the vertex
    contract on the raw LODs). Returns {variant id: raw LOD0 COLOR_0} for asset-specific checks."""
    spec = specs.ASSETS[asset_id]
    a, b = read_glb(raw), read_glb(packed)
    assert packed.stat().st_size <= spec.max_bytes
    assert b.materials == ["tl_role"]
    assert b.images == 0
    assert "EXT_meshopt_compression" in b.extensions_used
    out = {}
    for v in spec.variants:
        for n, cap in enumerate(v.tris):
            name = f"{asset_id}__{v.id}__LOD{n}"
            node = b.nodes[name]
            assert node.primitives == 1, name
            assert "COLOR_0" in node.attributes, name
            assert 0 < node.tris <= cap, (name, node.tris, cap)
            assert node.tris == a.nodes[name].tris, name
        assert b.nodes[f"{asset_id}__{v.id}__LOD2"].tris <= v.tris[2]  # the per-asset LOD2 cap
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
        frac, min_ao = UPPER_FROM.get(asset_id, (0.5, 0.5))
        high = v.size[1] * frac  # upper walls start here
        upper_walls = [
            c[0] for c, p in zip(colors, pos, strict=True) if p[1] > high and c[1] < 0.05
        ]
        assert upper_walls, "no upper walls to check"
        assert statistics.fmean(upper_walls) > min_ao, "upper walls are open (normals outwards)"
        glass_ao = [c[0] for c in colors if round(c[1] * 7) == specs.ROLES.index("glass")]
        assert statistics.fmean(glass_ao) > 0.3, "glass is not baked black"
        roles = _roles(colors)
        assert len(roles) >= 4, (lod0, roles)
        assert {specs.ROLES.index("glass"), specs.ROLES.index("dark")} <= roles, roles
        seeds = [c[2] for c in colors if round(c[1] * 7) == specs.ROLES.index("glass")]
        assert seeds and all(0.0 < g < 1.0 for g in seeds), lod0
        assert len({round(g, 4) for g in seeds}) > 1, "window seeds vary per window"
        # LOD1 keeps glass (inset faces) but drops the dark frames and AC fans
        lod1 = f"{asset_id}__{v.id}__LOD1"
        roles1 = _roles(read_attribute(raw, lod1, "COLOR_0"))
        assert specs.ROLES.index("glass") in roles1
        assert specs.ROLES.index("dark") not in roles1
        out[v.id] = colors
    return out


@pytest.mark.parametrize("asset_id", LINK_IDS)
def test_link_houses(link_built, asset_id):
    raw, packed = link_built[asset_id]
    assert {v.id for v in specs.ASSETS[asset_id].variants} == {"gable", "modern"}
    colors = check_archetype(raw, packed, asset_id)
    assert specs.ROLES.index("accent") in _roles(colors["modern"])  # brick accent panel
    for v in ("gable", "modern"):  # gate, fence and AC are LOD0 only
        lod1 = read_attribute(raw, f"{asset_id}__{v}__LOD1", "COLOR_0")
        assert specs.ROLES.index("metal") not in _roles(lod1)


@pytest.mark.parametrize("asset_id", RESIDENTIAL_IDS)
def test_residential(residential_built, asset_id):
    raw, packed = residential_built[asset_id]
    spec = specs.ASSETS[asset_id]
    expected = {
        "superlink": {"modern"},
        "semi_d": {"gable", "modern"},
        "bungalow": {"hip"},
        "townhouse": {"flat"},
    }[asset_id]
    assert {v.id for v in spec.variants} == expected
    check_archetype(raw, packed, asset_id)
    metal = specs.ROLES.index("metal")
    glass = specs.ROLES.index("glass")
    for v in spec.variants:
        lod0 = f"{asset_id}__{v.id}__LOD0"
        colors = read_attribute(raw, lod0, "COLOR_0")
        normals = read_attribute(raw, lod0, "NORMAL")
        if asset_id == "superlink":  # rooftop solar panels: metal faces looking up
            solar = [n for c, n in zip(colors, normals, strict=True) if round(c[1] * 7) == metal]
            assert any(n[1] > 0.5 for n in solar), "superlink LOD0 has solar panels"
            assert specs.ROLES.index("glass") in _roles(colors)  # skylight and windows
        if asset_id == "semi_d":  # the party wall (-x) has no openings
            facing = [
                n
                for c, n in zip(colors, normals, strict=True)
                if round(c[1] * 7) == glass and n[0] < -0.5
            ]
            assert facing == [], "semi_d party wall has no glass"
            lo = read_glb(raw).nodes[lod0].bounds[0]
            assert lo[0] >= -spec.variants[0].size[0] / 2 - 0.01, "nothing past the party wall"
            plain = {specs.ROLES.index("primary"), specs.ROLES.index("secondary")}
            bad = [
                (c, p)
                for c, n, p in zip(
                    colors, normals, read_attribute(raw, lod0, "POSITION"), strict=True
                )
                if p[0] < -v.size[0] / 2 + 0.01 and n[0] < -0.5 and round(c[1] * 7) not in plain
            ]
            assert bad == [], "only the plain party wall faces -x at the boundary"


@pytest.mark.parametrize("asset_id", NON_RESIDENTIAL_IDS)
def test_non_residential(non_residential_built, asset_id):
    raw, packed = non_residential_built[asset_id]
    spec = specs.ASSETS[asset_id]
    expected = {
        "shop_office": {"row"},
        "highrise": {"mid", "tall"},
        "school": {"block"},
        "mosque": {"hall"},
        "factory": {"shed"},
        "mall": {"box"},
        "generic": {"box"},
    }[asset_id]
    assert {v.id for v in spec.variants} == expected
    check_archetype(raw, packed, asset_id)
    info = read_glb(raw)
    assert info.images == 0  # no text or logo texture
    light = specs.ROLES.index("light")
    for v in spec.variants:
        lod0 = f"{asset_id}__{v.id}__LOD0"
        colors = read_attribute(raw, lod0, "COLOR_0")
        normals = read_attribute(raw, lod0, "NORMAL")
        pos = read_attribute(raw, lod0, "POSITION")
        hi = info.nodes[lod0].bounds[1]
        if asset_id == "shop_office":  # a blank sign band: role light, facing +z, >= 3 m2
            front = [
                p
                for c, n, p in zip(colors, normals, pos, strict=True)
                if round(c[1] * 7) == light and n[2] > 0.9
            ]
            assert front, "sign band faces +z"
            xs, ys = [p[0] for p in front], [p[1] for p in front]
            assert (max(xs) - min(xs)) * (max(ys) - min(ys)) >= 3.0
            five_foot = [p for c, p in zip(colors, pos, strict=True) if p[2] > 10.0 and p[1] < 3.0]
            assert five_foot, "a covered five-foot way along +z"
        if asset_id == "mosque":
            assert 14.0 < hi[1] < 32.0
            accent = specs.ROLES.index("accent")
            ys = [p[1] for c, p in zip(colors, pos, strict=True) if round(c[1] * 7) == accent]
            assert ys and max(ys) > 14.0, "an accent dome"
        if asset_id == "highrise":
            assert abs(hi[1] - v.size[1]) <= 1.0
            assert specs.ROLES.index("foliage") in _roles(colors), "planted balconies"
        if asset_id == "factory":
            assert specs.ROLES.index("metal") in _roles(colors), "metal roof"
