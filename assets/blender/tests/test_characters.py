"""Pure tests for the hero's geometry helpers and proportions (no Blender)."""

import math
import re

import pytest
from tl_assets.characters import geom, proportions

HEX = re.compile(r"^#[0-9a-f]{6}$")


def _closed(faces) -> bool:
    """Every edge of a closed (watertight) shell is shared by exactly two faces."""
    edges: dict[tuple[int, int], int] = {}
    for f in faces:
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]
            key = (min(a, b), max(a, b))
            edges[key] = edges.get(key, 0) + 1
    return all(n == 2 for n in edges.values())


def test_catmull_rom_passes_through_control_points():
    pts = [(0.0, 0.0), (1.0, 1.0), (2.0, 0.0), (3.0, 1.0)]
    out = geom.catmull_rom(pts, 4)
    for p in pts:
        assert any(math.dist(p, q) < 1e-9 for q in out)
    assert out[0] == pts[0] and out[-1] == pts[-1]
    assert len(out) == (len(pts) - 1) * 4 + 1


def test_lathe_with_poles_is_closed_and_counts():
    profile = [(0.0, 1.0), (0.5, 0.8), (0.6, 0.4), (0.0, 0.0)]
    verts, faces = geom.lathe(profile, 12)
    assert len(verts) == 2 + 2 * 12
    assert _closed(faces)
    assert geom.tri_count(faces) == 12 * 2 + 12 * 2  # two fans + one quad band


def test_lathe_shape_fn_moves_vertices():
    profile = [(0.0, 1.0), (0.5, 0.5), (0.0, 0.0)]
    _v0, _ = geom.lathe(profile, 8)
    v1, _ = geom.lathe(profile, 8, dz=lambda theta, k: -0.1 if k == 1 else 0.0)
    ring = [v for v in v1 if abs(v[2] - 0.4) < 1e-9]
    assert len(ring) == 8


def test_ellipsoid_extent():
    verts, faces = geom.ellipsoid((1.0, 2.0, 3.0), (0.1, 0.2, 0.3), 16, 8)
    xs, ys, zs = zip(*verts, strict=True)
    assert max(zs) == pytest.approx(3.3) and min(zs) == pytest.approx(2.7)
    assert max(xs) == pytest.approx(1.1, abs=1e-3)
    assert max(ys) == pytest.approx(2.2, abs=1e-3)
    assert _closed(faces)


def test_tube_open_path_is_capped_and_closed():
    path = [(0.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.5, 0.0, 1.5)]
    verts, faces = geom.tube(path, [0.1, 0.1, 0.05], 8)
    assert _closed(faces)
    zs = [v[2] for v in verts]
    assert min(zs) < 0.0  # rounded cap extends past the end point


def test_tube_loop_is_closed():
    loop = [(math.cos(a), math.sin(a), 0.0) for a in [i * math.tau / 10 for i in range(10)]]
    _verts, faces = geom.tube(loop, [0.05] * 10, 6, closed=True)
    assert _closed(faces)


def test_orient_maps_z_to_direction():
    for d in [(1, 0, 0), (0, -1, 0), (0, 0, -1), (0.3, -0.8, 0.2)]:
        m = geom.orient_z_to(d)
        z = geom.mat_vec(m, (0.0, 0.0, 1.0))
        n = math.sqrt(sum(c * c for c in d))
        assert z == pytest.approx(tuple(c / n for c in d), abs=1e-9)


def test_head_ratio_meets_h4():
    p = proportions
    ratio = p.HEIGHT / (p.HEAD_TOP - p.CHIN_Z)
    assert 2.4 <= ratio <= 2.8
    assert p.head_ratio(p.HEIGHT, p.HEAD_TOP, p.CHIN_Z) == pytest.approx(ratio)
    lo, hi = p.DISPLAY_SCALE_RANGE
    assert p.HEIGHT * lo >= 2.2 and p.HEIGHT * hi <= 2.5 + 1e-9


def test_h4_check_rejects_out_of_range():
    assert proportions.h4_ok(2.6)
    assert not proportions.h4_ok(2.3)
    assert not proportions.h4_ok(3.0)


def test_palette_hex_and_roles():
    pal = proportions.PALETTE
    assert all(HEX.match(v) for v in pal.values())
    for role in ("skin", "baju", "kain", "tudung", "eye", "blush", "metal", "grip"):
        assert role in pal
    r, g, b = proportions.hex_rgb(pal["baju"])
    assert b > g and r > g  # purple
