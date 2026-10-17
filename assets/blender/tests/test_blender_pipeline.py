"""End-to-end: headless Blender builds `calib`, gltf-transform packs it (opt-in, slow)."""

import json
import statistics
import subprocess
import sys
from pathlib import Path

import pytest
from tl_assets import specs
from tl_assets.glbinfo import read_attribute, read_glb

ASSETS_DIR = Path(__file__).resolve().parents[1]
ROOT = ASSETS_DIR.parents[1]
LANDMARKS_GEOJSON = ROOT / "data" / "seed" / "elmina" / "base" / "landmarks.geojson"
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
# (height fraction, min mean AO); default (0.5, 0.5). Measured mean upper-wall AO: bungalow 0.493
# (hip eaves and the portico shade the walls), school 0.446 (corridor and roof overhang)
UPPER_FROM = {"school": (0.5, 0.4), "bungalow": (0.5, 0.4)}
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
    _check_ridge_along_x(raw, asset_id)


def _ridge(pos, colors, role: int | None) -> tuple[float, float]:
    """(x span, z span) of the highest vertices (within 5 cm) of `role` (None = any role)."""
    pts = [p for c, p in zip(colors, pos, strict=True) if role is None or round(c[1] * 7) == role]
    top = max(p[1] for p in pts)
    ridge = [p for p in pts if p[1] >= top - 0.05]
    xs, zs = [p[0] for p in ridge], [p[2] for p in ridge]
    return max(xs) - min(xs), max(zs) - min(zs)


def _check_ridge_along_x(raw: Path, asset_id: str) -> None:
    """Owner gate A: the ridge runs parallel to the street (x), on LOD0's roof (secondary) and
    on the LOD2 block, and the gable ends do not overhang the party walls."""
    secondary = specs.ROLES.index("secondary")
    for v in specs.ASSETS[asset_id].variants:
        w = v.size[0]
        for lod, role in ((0, secondary), (2, None)):
            name = f"{asset_id}__{v.id}__LOD{lod}"
            pos = read_attribute(raw, name, "POSITION")
            x_span, z_span = _ridge(pos, read_attribute(raw, name, "COLOR_0"), role)
            # LOD0: the highest roof (secondary) vertices; for modern that is the low-pitch
            # ridge under the parapet top (the parapet is primary)
            assert x_span >= 0.8 * w, (name, x_span, w)
            assert z_span <= 0.3, (name, z_span)
        lo, hi = read_glb(raw).nodes[f"{asset_id}__{v.id}__LOD0"].bounds
        assert hi[0] - lo[0] <= w + 0.01, "no eave or gable overhang past the party walls"


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


MIN_FEATURE_M, MAX_FEATURE_M = 0.4, 7.0
WALL_AO_P5 = 0.35  # 5th percentile of the AO of upper primary-wall vertices


def _check_light_deck(colors, normals, pos) -> None:
    """A flat roof deck is a light grey (role metal), subdivided, and not baked black: take the
    height with the most up-facing metal vertices and require a decent mean AO there."""
    metal = specs.ROLES.index("metal")
    deck = [
        (round(p[1], 2), c[0])
        for c, n, p in zip(colors, normals, pos, strict=True)
        if round(c[1] * 7) == metal and n[1] > 0.9
    ]
    assert deck, "a light-grey (role metal) roof deck"
    levels: dict[float, list[float]] = {}
    for y, ao in deck:
        levels.setdefault(y, []).append(ao)
    ys = max(levels, key=lambda k: len(levels[k]))
    ao = levels[ys]
    assert len(ao) >= 12, (ys, len(ao))
    assert statistics.fmean(ao) >= 0.4, (
        ys,
        statistics.fmean(ao),
    )  # measured 0.47 (highrise podium ring) to 0.7+


def _widths(items: list[tuple[float, float]]) -> list[float]:
    """Feature widths from (along, y) vertices of applied quads: at one height a quad has its
    two edge coordinates, so the sorted coordinates pair up as (left, right)."""
    by_y: dict[float, set[float]] = {}
    for u, y in items:
        by_y.setdefault(round(y, 3), set()).add(round(u, 3))
    out = []
    for us in by_y.values():
        us_sorted = sorted(us)
        assert len(us_sorted) % 2 == 0, us_sorted
        out += [b - a for a, b in zip(us_sorted[::2], us_sorted[1::2], strict=True)]
    return out


def _check_scale_proof(colors, normals, pos) -> None:
    """The loader scales `generic` in x and z by 0.3-4. Proxy for 'reads well': after either
    scale no glass or dark feature on a side face is narrower than 0.4 m or wider than 7 m (a
    ribbon window on a 40 m frontage; the 3 m of the brief is unreachable for one geometry over
    a 13x range), and no vertex sits behind the facade plane (no cut openings)."""
    glass, dark = specs.ROLES.index("glass"), specs.ROLES.index("dark")
    half = specs.ASSETS["generic"].variants[0].size[0] / 2
    for role in (glass, dark):
        for axis, along in ((0, 2), (2, 0)):  # a face facing +-x is measured along z, and so on
            for sign in (1.0, -1.0):
                v = [
                    (p[along], p[1])
                    for c, n, p in zip(colors, normals, pos, strict=True)
                    if round(c[1] * 7) == role and n[axis] * sign > 0.9
                ]
                if not v:
                    continue
                depth = [
                    p[axis] * sign
                    for c, n, p in zip(colors, normals, pos, strict=True)
                    if round(c[1] * 7) == role and n[axis] * sign > 0.9
                ]
                assert min(depth) > half - 0.01, "applied features only, nothing recessed"
                for width in _widths(v):
                    assert width * 0.3 >= MIN_FEATURE_M, (role, width)
                    assert width * 4.0 <= MAX_FEATURE_M, (role, width)


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
        if asset_id in ("generic", "highrise"):  # no black blotches between the windows
            h = v.size[1]
            wall = sorted(
                c[0] for c, p in zip(colors, pos, strict=True) if c[1] < 0.05 and p[1] > h * 0.5
            )
            p5 = wall[len(wall) // 20]
            assert p5 >= WALL_AO_P5, (lod0, p5)  # measured 0.44-0.47; the unfixed build gave 0.0
        if asset_id in ("shop_office", "highrise", "mosque", "mall", "generic"):
            _check_light_deck(colors, normals, pos)
        if asset_id == "generic":
            _check_scale_proof(colors, normals, pos)
        if asset_id == "factory":
            assert specs.ROLES.index("metal") in _roles(colors), "metal roof"


# --- landmarks (Task 5) -----------------------------------------------------------------

LANDMARK_IDS = ("lakeside_mall", "kanopi", "masjid_denai_alam")
# measured mean upper-wall AO (primary walls above half height, from a run with the scaled
# ground plane): lakeside_mall 0.712, kanopi 0.510, masjid_denai_alam 0.663; each threshold
# sits about 0.1 under the measurement
UPPER_FROM.update(
    {"lakeside_mall": (0.5, 0.6), "kanopi": (0.5, 0.4), "masjid_denai_alam": (0.5, 0.55)}
)


@pytest.fixture(scope="module")
def landmarks_built(tmp_path_factory) -> dict[str, tuple[Path, Path]]:
    return _build_and_pack(LANDMARK_IDS, tmp_path_factory)


@pytest.mark.parametrize("asset_id", LANDMARK_IDS)
def test_landmarks(landmarks_built, asset_id):
    raw, packed = landmarks_built[asset_id]
    spec = specs.ASSETS[asset_id]
    check_archetype(raw, packed, asset_id)  # contract, caps, bounds_errors on every LOD
    assert packed.stat().st_size <= specs.LANDMARK_MAX_BYTES
    info = read_glb(raw)
    assert info.images <= 1  # none are used
    v = spec.variants[0]
    lo, hi = info.nodes[f"{asset_id}__{v.id}__LOD0"].bounds
    if asset_id == "lakeside_mall":
        from tl_assets.geo import outline_local, outline_ring

        fc = json.loads(LANDMARKS_GEOJSON.read_text(encoding="utf-8"))
        pts = outline_local(outline_ring(fc, "lakeside_mall"))
        bx = (min(p[0] for p in pts), max(p[0] for p in pts))
        bz = (min(p[1] for p in pts), max(p[1] for p in pts))
        # the canopy overhangs the outline bbox by at most 1.5 m a side, never inside it
        for axis, (a, b) in ((0, bx), (2, bz)):
            assert a - 1.5 - 0.01 <= lo[axis] <= a + 0.01, (axis, lo[axis], a)
            assert b - 0.01 <= hi[axis] <= b + 1.5 + 0.01, (axis, hi[axis], b)
        assert 8.0 <= hi[1] <= 12.0
        colors = read_attribute(raw, f"{asset_id}__{v.id}__LOD0", "COLOR_0")
        light = specs.ROLES.index("light")
        assert light in _roles(colors), "a blank sign band"
    if asset_id == "kanopi":
        assert 118.0 < hi[1] < 132.0
        colors = read_attribute(raw, f"{asset_id}__{v.id}__LOD0", "COLOR_0")
        assert specs.ROLES.index("foliage") in _roles(colors), "planted balconies"
    if asset_id == "masjid_denai_alam":
        assert 16.0 < hi[1] < 34.0
        colors = read_attribute(raw, f"{asset_id}__{v.id}__LOD0", "COLOR_0")
        pos = read_attribute(raw, f"{asset_id}__{v.id}__LOD0", "POSITION")
        accent = specs.ROLES.index("accent")
        ys = [p[1] for c, p in zip(colors, pos, strict=True) if round(c[1] * 7) == accent]
        assert ys and max(ys) > 16.0, "a main dome"


@pytest.mark.parametrize("asset_id", ["kanopi", "masjid_denai_alam"])
def test_landmark_ao_ground_scales_with_the_asset(landmarks_built, asset_id):
    """These reach +-20 m, the edge of the old 40 m plane. With ground only out to the wall
    base, the +-x wall bases baked lit (mean AO measured 0.806 kanopi, 0.64 masjid); with the
    scaled plane they get contact shading (0.437 and 0.434)."""
    raw, _ = landmarks_built[asset_id]
    v = specs.ASSETS[asset_id].variants[0].id
    name = f"{asset_id}__{v}__LOD0"
    colors = read_attribute(raw, name, "COLOR_0")
    pos = read_attribute(raw, name, "POSITION")
    normals = read_attribute(raw, name, "NORMAL")
    base = [
        c[0]
        for c, p, n in zip(colors, pos, normals, strict=True)
        if p[1] < 1.0 and c[1] < 0.05 and abs(n[0]) > 0.9
    ]
    assert len(base) > 10
    assert statistics.fmean(base) < 0.55, statistics.fmean(base)


# --- trees and street furniture (Task 6) ----------------------------------------------------

KIT_IDS = ("trees", "furniture")


@pytest.fixture(scope="module")
def kits_built(tmp_path_factory) -> dict[str, tuple[Path, Path]]:
    return _build_and_pack(KIT_IDS, tmp_path_factory)


def check_kit(raw: Path, packed: Path, asset_id: str, lit_top: bool = False) -> dict[str, list]:
    """The kit counterpart of check_archetype: every mesh is decorative, so there are no
    window seeds, glass or upper-wall AO checks. Everything else is kept: node names, one
    primitive, COLOR_0, tris caps per LOD (any LOD count), bounds on every LOD, AO varied on
    LOD0, no images, meshopt and the byte budget. Returns {variant id: raw LOD0 COLOR_0}."""
    spec = specs.ASSETS[asset_id]
    assert spec.group == "kit" and spec.decorative
    a, b = read_glb(raw), read_glb(packed)
    assert packed.stat().st_size <= spec.max_bytes
    assert b.materials == ["tl_role"]
    assert b.images == 0
    assert "EXT_meshopt_compression" in b.extensions_used
    out = {}
    for v in spec.variants:
        tris = []
        for n, cap in enumerate(v.tris):
            name = f"{asset_id}__{v.id}__LOD{n}"
            node = b.nodes[name]
            assert node.primitives == 1, name
            assert "COLOR_0" in node.attributes, name
            assert 0 < node.tris <= cap, (name, node.tris, cap)
            assert node.tris == a.nodes[name].tris, name
            assert specs.bounds_errors(v, node.bounds) == [], (name, node.bounds)
            tris.append(node.tris)
        assert tris == sorted(tris, reverse=True) and len(set(tris)) == len(tris), tris
        lod0 = f"{asset_id}__{v.id}__LOD0"
        colors = read_attribute(raw, lod0, "COLOR_0")
        reds = [c[0] for c in colors]
        assert statistics.pstdev(reds) > 0.05, (lod0, statistics.pstdev(reds))  # AO varies
        # dense canopies and shelters hold a lot of enclosed surface (trees measured 0.29,
        # bus shelter 0.299), so the mean floor is 0.2; the exposed top must be lit instead
        assert 0.2 <= statistics.fmean(reds) <= 1.0, lod0
        assert all(c[3] == pytest.approx(1.0) for c in colors), lod0
        pos = read_attribute(raw, lod0, "POSITION")
        assert min(p[1] for p in pos) > -0.01, (lod0, "nothing below the ground")
        if lit_top:  # a tree crown is open to the sky (lowest measured: frangipani 0.454)
            top = max(p[1] for p in pos)
            crown = [c[0] for c, p in zip(colors, pos, strict=True) if p[1] > 0.85 * top]
            assert crown and statistics.fmean(crown) > 0.4, (lod0, statistics.fmean(crown))
        out[v.id] = colors
    return out


def test_trees_furniture_have_the_spec_variants():
    assert [v.id for v in specs.ASSETS["trees"].variants] == [
        "rain_tree",
        "coconut_palm",
        "royal_palm",
        "frangipani",
        "flame_tree",
        "oil_palm",
        "shrub_round",
        "shrub_hedge",
    ]
    assert len(specs.ASSETS["furniture"].variants) == 9


def test_trees(kits_built):
    raw, packed = kits_built["trees"]
    colors = check_kit(raw, packed, "trees", lit_top=True)
    info = read_glb(packed)
    foliage, dark = specs.ROLES.index("foliage"), specs.ROLES.index("dark")
    accent = specs.ROLES.index("accent")
    for v in specs.ASSETS["trees"].variants:
        roles = _roles(colors[v.id])
        assert {foliage, dark} <= roles, (v.id, roles)  # leaves and trunk
        if v.id in ("frangipani", "flame_tree"):
            assert accent in roles, f"{v.id} has flowers"
        # aux B is the sway weight: 0 at the trunk base, rising to 1 at the canopy top
        bs = [c[2] for c in colors[v.id]]
        assert max(bs) > 0.8 and min(bs) < 0.2, (v.id, min(bs), max(bs))
        pos = read_attribute(raw, f"trees__{v.id}__LOD0", "POSITION")
        low = [c[2] for c, p in zip(colors[v.id], pos, strict=True) if p[1] < 0.15]
        high = [c[2] for c, p in zip(colors[v.id], pos, strict=True) if p[1] > v.size[1] * 0.9]
        assert low and statistics.fmean(low) < 0.15, v.id  # shrubs start at 0.12 m
        assert high and statistics.fmean(high) > 0.85, v.id
        # every LOD keeps the foliage role for the shader
        for n in (1, 2):
            r = _roles(read_attribute(raw, f"trees__{v.id}__LOD{n}", "COLOR_0"))
            assert foliage in r, (v.id, n)
    lo, hi = info.nodes["trees__rain_tree__LOD0"].bounds
    assert 15.0 <= hi[0] - lo[0] <= 25.0 and 15.0 <= hi[2] - lo[2] <= 25.0
    assert 12.0 <= hi[1] <= 20.0


def test_furniture(kits_built):
    raw, packed = kits_built["furniture"]
    colors = check_kit(raw, packed, "furniture")
    light = specs.ROLES.index("light")
    for vid in ("lamp_single", "lamp_double"):
        pos = read_attribute(raw, f"furniture__{vid}__LOD0", "POSITION")
        heads = [p[1] for c, p in zip(colors[vid], pos, strict=True) if round(c[1] * 7) == light]
        assert heads and min(heads) > 7.0, (vid, "light faces above 7 m")
        pos1 = read_attribute(raw, f"furniture__{vid}__LOD1", "POSITION")
        col1 = read_attribute(raw, f"furniture__{vid}__LOD1", "COLOR_0")
        assert any(round(c[1] * 7) == light and p[1] > 7.0 for c, p in zip(col1, pos1, strict=True))
    assert light in _roles(colors["traffic_light"]), "traffic light lamps"
    solid = {specs.ROLES.index("metal"), specs.ROLES.index("dark"), specs.ROLES.index("secondary")}
    for vid, cols in colors.items():
        assert _roles(cols) & solid, vid


# --- people and vehicles (Task 7) -------------------------------------------------------------

PV_IDS = ("people", "vehicles")
WALKERS = (
    "office_man",
    "office_woman",
    "tudung_baju_kurung",
    "older_adult",
    "jogger",
    "parent_stroller",
    "school_boy",
    "school_girl",
    "child",
)


@pytest.fixture(scope="module")
def people_vehicles_built(tmp_path_factory) -> dict[str, tuple[Path, Path]]:
    return _build_and_pack(PV_IDS, tmp_path_factory)


def test_people_vehicles_have_the_spec_variants():
    assert [v.id for v in specs.ASSETS["people"].variants] == [
        "office_man",
        "office_woman",
        "tudung_baju_kurung",
        "older_adult",
        "jogger",
        "cyclist",
        "parent_stroller",
        "school_boy",
        "school_girl",
        "child",
    ]
    assert [v.id for v in specs.ASSETS["vehicles"].variants] == [
        "hatchback",
        "city_car",
        "sedan",
        "mpv",
        "pickup",
        "motorcycle",
        "delivery_motorcycle",
        "bus",
        "lorry",
    ]


def test_people_vehicles(people_vehicles_built):
    # people: limb code in B, true heights
    raw, packed = people_vehicles_built["people"]
    colors = check_kit(raw, packed, "people")
    info = read_glb(packed)
    ok = (0.25, 0.5, 0.75)
    roles = [specs.ROLES.index(r) for r in ("primary", "secondary", "accent", "dark")]
    for v in specs.ASSETS["people"].variants:
        _, hi = (
            info.nodes[f"people__{v.id}__LOD0"].bounds[0],
            info.nodes[f"people__{v.id}__LOD0"].bounds[1],
        )
        assert v.y_range[0] <= hi[1] <= v.y_range[1], (v.id, hi[1])
        bs = [c[2] for c in colors[v.id]]
        assert all(any(abs(b - o) <= 0.02 for o in ok) for b in bs), (v.id, sorted(set(bs)))
        got = {o for o in ok if any(abs(b - o) <= 0.02 for b in bs)}
        assert 0.5 in got, v.id
        if v.id in WALKERS:
            assert {0.25, 0.75} <= got, (v.id, "limbs swing", got)
        assert set(roles) <= _roles(colors[v.id]), (v.id, _roles(colors[v.id]))
        lo1, hi1 = info.nodes[f"people__{v.id}__LOD1"].bounds
        assert v.y_range[0] <= hi1[1] <= v.y_range[1], (v.id, "LOD1", hi1[1])
    lo, hi = info.nodes["people__cyclist__LOD0"].bounds
    assert hi[2] - lo[2] >= 1.5, "the bike is included"
    lo, hi = info.nodes["people__parent_stroller__LOD0"].bounds
    assert hi[2] - lo[2] >= 1.3, "the stroller is included"
    # vehicles: length along z, front at +z, lamps coded in B
    raw, packed = people_vehicles_built["vehicles"]
    colors = check_kit(raw, packed, "vehicles")
    info = read_glb(packed)
    light = specs.ROLES.index("light")
    for v in specs.ASSETS["vehicles"].variants:
        lo, hi = info.nodes[f"vehicles__{v.id}__LOD0"].bounds
        assert v.z_range[0] <= hi[2] - lo[2] <= v.z_range[1], (v.id, hi[2] - lo[2])
        if v.id == "hatchback":
            assert 3.7 <= hi[2] - lo[2] <= 4.0
        assert {specs.ROLES.index(r) for r in ("primary", "dark", "metal", "light")} <= _roles(
            colors[v.id]
        ), v.id
        if v.id not in ("motorcycle", "delivery_motorcycle"):
            assert specs.ROLES.index("glass") in _roles(colors[v.id]), v.id
        for lod in (0, 1):
            name = f"vehicles__{v.id}__LOD{lod}"
            cols = colors[v.id] if lod == 0 else read_attribute(raw, name, "COLOR_0")
            pos = read_attribute(raw, name, "POSITION")
            lamps = [
                (c[2], p[2]) for c, p in zip(cols, pos, strict=True) if round(c[1] * 7) == light
            ]
            heads = [b for b, z in lamps if z > 0]
            tails = [b for b, z in lamps if z < 0]
            assert heads and all(b < 0.5 for b in heads), (name, "headlights at the front")
            assert tails and all(b >= 0.5 for b in tails), (name, "tail lights at the rear")


# --- construction (Task 8) --------------------------------------------------------------------


@pytest.fixture(scope="module")
def construction_built(tmp_path_factory) -> dict[str, tuple[Path, Path]]:
    return _build_and_pack(("construction",), tmp_path_factory)


def test_construction_has_the_spec_variants():
    assert [v.id for v in specs.ASSETS["construction"].variants] == [
        "tower_crane",
        "mobile_crane",
        "excavator",
        "cement_mixer",
        "site_cabin",
        "hoarding_6m",
        "scaffold_bay",
        "material_stack",
    ]


def test_construction(construction_built):
    raw, packed = construction_built["construction"]
    colors = check_kit(raw, packed, "construction")
    info = read_glb(packed)
    for v in specs.ASSETS["construction"].variants:
        assert len(v.tris) == 3, v.id  # every variant keeps LOD2
        assert info.nodes[f"construction__{v.id}__LOD2"].tris <= 60, v.id
        roles = _roles(colors[v.id])
        assert specs.ROLES.index("primary") in roles, v.id  # equipment yellow by palette
        assert roles <= {specs.ROLES.index(r) for r in ("primary", "metal", "dark", "glass")}, (
            v.id,
            roles,
        )
    # the tower crane keeps its height and a tiny LOD2 on every distance
    for lod in (0, 1, 2):
        lo, hi = info.nodes[f"construction__tower_crane__LOD{lod}"].bounds
        assert 40.0 <= hi[1] <= 60.0, (lod, hi[1])
    assert info.nodes["construction__tower_crane__LOD2"].tris <= 60
    lo, hi = info.nodes["construction__hoarding_6m__LOD0"].bounds
    assert hi[0] - lo[0] == pytest.approx(6.0, abs=0.1)
    hoarding = info.nodes["construction__hoarding_6m__LOD0"]
    assert hoarding.primitives == 1 and b_images(packed) == 0, "a blank panel: no images"


def b_images(packed: Path) -> int:
    return read_glb(packed).images


# --- vendor intake (import_vendor, scale_to) on a synthetic source ---------------------------

SYNTH_SOURCE = r"""
import sys
import bpy
from pathlib import Path
out = Path(sys.argv[sys.argv.index("--") + 1])
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
# colormap: 4 x 1 px; px 0 green, px 1 near black, px 2 off-white, px 3 red-brown
img = bpy.data.images.new("colormap", 4, 1)
cols = [(0.10, 0.55, 0.12), (0.05, 0.05, 0.06), (0.92, 0.90, 0.85), (0.60, 0.25, 0.12)]
img.pixels = [c for rgb in cols for c in (*rgb, 1.0)]
img.pack()
tex = bpy.data.materials.new("colormap")
tex.use_nodes = True
bsdf = next(n for n in tex.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
node = tex.node_tree.nodes.new("ShaderNodeTexImage")
node.image = img
node.interpolation = "Closest"
tex.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
plain = bpy.data.materials.new("Trunk")
plain.diffuse_color = (0.3, 0.2, 0.1, 1.0)

# a 1 x 1 x 3 m trunk with the plain material
bpy.ops.mesh.primitive_cube_add(size=1.0)
trunk = bpy.context.active_object
trunk.name = "trunk"
trunk.scale = (1.0, 1.0, 3.0)
trunk.location = (0.0, 0.0, 1.5)
trunk.data.materials.append(plain)
# a 4-quad strip whose quads sample px 0 (green), 1 (near black), 2 (off-white), 3 (red-brown)
mesh = bpy.data.meshes.new("strip")
verts = [(i, 0.0, 0.0) for i in range(5)] + [(i, 0.0, 1.0) for i in range(5)]
faces = [(i, i + 1, i + 6, i + 5) for i in range(4)]
mesh.from_pydata(verts, [], faces)
uv = mesh.uv_layers.new(name="UVMap")
for poly in mesh.polygons:
    u = (poly.index + 0.5) / 4.0
    for li in poly.loop_indices:
        uv.data[li].uv = (u, 0.5)
mesh.materials.append(tex)
strip = bpy.data.objects.new("strip", mesh)
bpy.context.scene.collection.objects.link(strip)
strip.location = (4.0, 0.0, 0.0)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", use_selection=True)
"""

SYNTH_RUN = r"""
import json, sys
from pathlib import Path
ASSETS = sys.argv[sys.argv.index("--") + 1]
ROOT = sys.argv[sys.argv.index("--") + 2]
RESULT = sys.argv[sys.argv.index("--") + 3]
sys.path.insert(0, ASSETS)
import bpy
from tl_assets import props
from tl_assets.specs import ROLES
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for mat in list(bpy.data.materials):
    bpy.data.materials.remove(mat)
objs = props.import_vendor("synth", root=Path(ROOT))
roles = {}
for o in objs:
    attr = o.data.color_attributes["COLOR_0"]
    seq = []
    for poly in o.data.polygons:  # glTF triangulates: a quad is two polygons in a row
        c = attr.data[poly.loop_start].color
        role = ROLES[round(c[1] * 7)]
        if not seq or seq[-1] != role:
            seq.append(role)
    roles[o.name] = seq
def extent(axis):
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    i = {"x": 0, "y": 2, "z": 1}[axis]  # glTF y is Blender z
    vals = [p[i] for p in pts]
    return max(vals) - min(vals)
before = extent("y")
props.scale_to(objs, "y", 2.0)
res = {
    "roles": roles,
    "images": len(bpy.data.images),
    "materials": sorted(m.name for m in bpy.data.materials if m.users),
    "y_before": before,
    "y_after": extent("y"),
    "x_after": extent("x"),
    "min_y": min((o.matrix_world @ v.co)[2] for o in objs for v in o.data.vertices),
    "uv_layers": sum(len(o.data.uv_layers) for o in objs),
}
props.scale_to(objs, "x", 10.0)
res["x_scaled"] = extent("x")
res["y_scaled"] = extent("y")
Path(RESULT).write_text(json.dumps(res))
"""


def _blender(script: Path, *args: str) -> None:
    from conftest import blender_path

    cmd = [
        blender_path(),
        "--background",
        "--factory-startup",
        "--disable-autoexec",
        "--python-exit-code",
        "1",
        "--python",
        str(script),
        "--",
        *args,
    ]
    run = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    assert run.returncode == 0, run.stdout[-3000:] + run.stderr[-3000:]


def _synth_vendor(tmp_path: Path, role_map: dict[str, str]) -> Path:
    """A throwaway vendor root (never under assets/blender/vendor) with one synthetic source."""
    root = tmp_path / "vendor_root"
    folder = root / "vendor" / "trees" / "synth"
    folder.mkdir(parents=True)
    maker = tmp_path / "make_source.py"
    maker.write_text(SYNTH_SOURCE, encoding="utf-8")
    _blender(maker, str(folder / "source.glb"))
    entry = {
        "slug": "synth",
        "kind": "trees",
        "url": "https://example.invalid/synth",
        "author": "test",
        "licence": "CC0",
        "files": ["vendor/trees/synth/source.glb"],
        "sha256": {},
        "role_map": role_map,
    }
    (root / "vendor" / "vendor.json").write_text(json.dumps([entry]), encoding="utf-8")
    return root


def _run_synth(tmp_path: Path, role_map: dict[str, str]) -> dict:
    root = _synth_vendor(tmp_path, role_map)
    runner = tmp_path / "run_import.py"
    runner.write_text(SYNTH_RUN, encoding="utf-8")
    result = tmp_path / "result.json"
    _blender(runner, str(ASSETS_DIR), str(root), str(result))
    return json.loads(result.read_text(encoding="utf-8"))


def test_import_vendor_maps_materials_by_role_map(tmp_path):
    """The plain material goes through role_map by name; the colormap material's faces are
    sampled at their UV centroids and mapped to the nearest role."""
    res = _run_synth(tmp_path, {"Trunk": "dark"})
    by_obj = res["roles"]
    trunk = next(r for k, r in by_obj.items() if "trunk" in k.lower())
    strip = next(r for k, r in by_obj.items() if "strip" in k.lower())
    assert set(trunk) == {"dark"}
    assert strip == ["foliage", "dark", "primary", "accent"], strip


def test_import_vendor_uses_a_role_table_for_the_colormap(tmp_path):
    """A '#rrggbb' key in role_map is a palette role table entry for sampled colours."""
    res = _run_synth(
        tmp_path,
        {
            "Trunk": "dark",
            "#1a8c1f": "secondary",  # the green px
            "#0d0d0f": "metal",
            "#ebe6d9": "light",
            "#99401f": "foliage",
        },
    )
    strip = next(r for k, r in res["roles"].items() if "strip" in k.lower())
    assert strip == ["secondary", "metal", "light", "foliage"]


def test_import_vendor_drops_images_and_scale_to_hits_the_target(tmp_path):
    res = _run_synth(tmp_path, {"Trunk": "dark"})
    assert res["images"] == 0
    assert res["uv_layers"] == 0
    assert res["materials"] == []
    assert res["min_y"] == pytest.approx(0.0, abs=1e-4)  # seated on the ground
    assert res["y_before"] == pytest.approx(3.0, abs=1e-4)
    assert res["y_after"] == pytest.approx(2.0, abs=1e-4)
    assert res["x_scaled"] == pytest.approx(10.0, abs=1e-4)  # uniform: y scales with it
    assert res["y_scaled"] == pytest.approx(res["y_after"] * 10.0 / res["x_after"], rel=1e-4)
