"""Kit builders (trees, street furniture) and third-party model intake (imports bpy).

Registered into `build.BUILDERS` as `trees` and `furniture`: `(variant, lod) -> [objects]`.
Everything here is decorative (spec flag): never pickable, never a fact about the township.

* Trees are scripted: a tube trunk, clustered low-poly canopy lobes or palm fronds, flowers.
  Roles: `foliage` leaves, `dark` trunk, `accent` flowers. Aux B is the sway weight: 0 at the
  trunk base, rising linearly to 1 at the canopy top (set per vertex after the final fit).
  Every LOD is fitted to the same x/z extent and top height, so the bounds hold on all LODs.
* Street furniture is scripted from boxes and tubes; lamp heads and traffic lamps are role
  `light` (heads sit above 7 m on the street lamps).
* `import_vendor` / `scale_to` normalise a third-party model recorded in
  `assets/blender/vendor/vendor.json`: materials become vertex roles (see `import_vendor`), the
  images and UVs are dropped, transforms are applied and the model is seated on the ground
  at the footprint centre. A vendor pick replaces a variant's scripted builder with
  `import_vendor` + `scale_to` (owner gate E).
"""

import json
import math
import random
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import core
from .kit import Vec, _keep, _mean, _Mesh, _sub
from .specs import ROLES, Variant

ASSETS_DIR = Path(__file__).resolve().parents[1]

# --- geometry helpers ---------------------------------------------------------------------


def _tube(
    m: _Mesh,
    pts: Sequence[Vec],
    radii: Sequence[float],
    n: int = 6,
    *,
    cap_top: bool = True,
    cap_bottom: bool = False,
    phase: float = 0.0,
) -> None:
    """A tube of n-gon rings around the polyline `pts` (one radius per point)."""
    cs = [Vector(p) for p in pts]
    rings = []
    for i, c in enumerate(cs):
        d = (cs[min(i + 1, len(cs) - 1)] - cs[max(i - 1, 0)]).normalized()
        ref = Vector((0.0, 1.0, 0.0)) if abs(d.y) < 0.95 else Vector((1.0, 0.0, 0.0))
        u = d.cross(ref).normalized()
        v = d.cross(u).normalized()
        ring = [
            tuple(
                c
                + radii[i]
                * (
                    math.cos(phase + 2 * math.pi * k / n) * u
                    + math.sin(phase + 2 * math.pi * k / n) * v
                )
            )
            for k in range(n)
        ]
        rings.append((c, d, ring))
    for (c0, _d0, r0), (c1, _d1, r1) in zip(rings, rings[1:], strict=False):
        mid = (c0 + c1) / 2
        for k in range(n):
            j = (k + 1) % n
            quad = [r0[k], r0[j], r1[j], r1[k]]
            m.face(quad, tuple(Vector(_mean(quad)) - mid))
    if cap_top:
        m.face(rings[-1][2], tuple(rings[-1][1]))
    if cap_bottom:
        m.face(rings[0][2], tuple(-rings[0][1]))


def _limb(m: _Mesh, p0: Vec, p1: Vec, r0: float, r1: float, n: int = 6, rings: int = 1, **kw):
    """A straight tapered tube from p0 to p1 with `rings` evenly spaced intermediate rings."""
    a, b = Vector(p0), Vector(p1)
    ts = [k / (rings + 1) for k in range(rings + 2)]
    _tube(
        m,
        [tuple(a + (b - a) * t) for t in ts],
        [r0 + (r1 - r0) * t for t in ts],
        n,
        **kw,
    )


def _blob(
    m: _Mesh,
    c: Vec,
    r: Vec,
    *,
    segs: int = 8,
    rings: int = 5,
    jit: float = 0.0,
    rng: random.Random | None = None,
    floor: float | None = None,
    phase: float = 0.0,
) -> None:
    """A low-poly ellipsoid (a canopy lobe, a shrub); `rings` latitude bands, `segs` meridians.
    Vertices get a seeded radial jitter of +-`jit`; y is clamped to `floor` when given."""
    cx, cy, cz = c
    rx, ry, rz = r

    def scale() -> float:
        return 1.0 + (rng.uniform(-jit, jit) if (rng and jit) else 0.0)

    def clamp(y: float) -> float:
        return y if floor is None else max(floor, y)

    south = (cx, clamp(cy - ry * scale()), cz)
    north = (cx, clamp(cy + ry * scale()), cz)
    grid = []
    for i in range(1, rings):
        phi = -math.pi / 2 + math.pi * i / rings
        row = []
        for k in range(segs):
            a = phase + 2 * math.pi * k / segs
            s = scale()
            row.append(
                (
                    cx + rx * math.cos(phi) * math.cos(a) * s,
                    clamp(cy + ry * math.sin(phi) * s),
                    cz + rz * math.cos(phi) * math.sin(a) * s,
                )
            )
        grid.append(row)
    for k in range(segs):
        j = (k + 1) % segs
        tris = [[south, grid[0][j], grid[0][k]], [north, grid[-1][k], grid[-1][j]]]
        quads = [[grid[i][k], grid[i][j], grid[i + 1][j], grid[i + 1][k]] for i in range(rings - 2)]
        for pts in (*tris, *quads):
            m.face(pts, _sub(_mean(pts), c))


def _frond(
    m: _Mesh,
    base: Vec,
    yaw: float,
    length: float,
    width: float,
    rise: float,
    droop: float,
    segs: int,
    *,
    fold: float = 0.3,
    ridge: bool = True,
) -> None:
    """A palm frond: a two-sided leaf blade along an arc (height rise*t - droop*t^2). With
    `ridge` the blade is two strips folded down from the midrib (a shallow V); otherwise one
    flat strip."""
    dx, dz = math.cos(yaw), math.sin(yaw)
    sx, sz = -dz, dx
    prof = []
    for i in range(segs + 1):
        t = i / segs
        y = base[1] + rise * t - droop * t * t
        w = width * math.sin(math.pi * t) ** 0.7
        cx, cz = base[0] + dx * length * t, base[2] + dz * length * t
        fy = y - fold * w if ridge else y
        prof.append(((cx + sx * w, fy, cz + sz * w), (cx, y, cz), (cx - sx * w, fy, cz - sz * w)))
    for (l0, m0, r0), (l1, m1, r1) in zip(prof, prof[1:], strict=False):
        strips = [[l0, m0, m1, l1], [m0, r0, r1, m1]] if ridge else [[l0, r0, r1, l1]]
        for q in strips:
            m.face(q, (0.0, 1.0, 0.0))
            # the underside sits 4 cm lower: coincident faces would bake each other black
            m.face([(px, py - 0.04, pz) for px, py, pz in q], (0.0, -1.0, 0.0))


def _obj(m: _Mesh, name: str, role: str, aux: float = 0.0) -> list:
    return _keep(m.obj(name, role, aux))


def _extent(objs: Iterable) -> tuple[Vec, Vec]:
    """The glTF-frame bounding box (min, max) of the meshes (Blender (x, y, z) -> (x, z, -y))."""
    pts = [v.co for o in objs for v in o.data.vertices]
    xs = [p.x for p in pts]
    ys = [p.z for p in pts]
    zs = [-p.y for p in pts]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def _fit(objs: list, *, x: float, top: float, z: float, centre: bool = True) -> None:
    """Scale (non-uniformly, slightly) so the x/z extents are `x`/`z` and the top is `top`.
    With `centre` the x/z middle moves to the origin; otherwise the scale is about the origin."""
    lo, hi = _extent(objs)
    sx, sy, sz = x / (hi[0] - lo[0]), top / hi[1], z / (hi[2] - lo[2])
    cx = (lo[0] + hi[0]) / 2 if centre else 0.0
    cz = (lo[2] + hi[2]) / 2 if centre else 0.0
    mat = Matrix.Diagonal((sx, sz, sy, 1.0)) @ Matrix.Translation((-cx, cz, 0.0))
    for o in objs:
        o.data.transform(mat)
        co = np.empty(len(o.data.vertices) * 3, dtype=np.float32)
        o.data.vertices.foreach_get("co", co)
        co[2::3] = np.maximum(co[2::3], 0.0)  # a tilted trunk base ring must not dip below y = 0
        o.data.vertices.foreach_set("co", co)
        o.data.update()


def _sway(objs: list, top: float) -> None:
    """Aux B = vertex height / canopy top (0 at the trunk base, 1 at the top)."""
    for o in objs:
        me = o.data
        n = len(me.loops)
        vi = np.empty(n, dtype=np.int32)
        me.loops.foreach_get("vertex_index", vi)
        co = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        attr = me.color_attributes["COLOR_0"]
        col = np.empty(n * 4, dtype=np.float32)
        attr.data.foreach_get("color", col)
        col[2::4] = np.clip(co[2::3][vi] / top, 0.0, 1.0)
        attr.data.foreach_set("color", col)


# --- trees --------------------------------------------------------------------------------

BLOB = {0: (10, 6), 1: (6, 4), 2: (8, 3)}  # (segs, rings) of a canopy lobe per LOD
TUBE_N = {0: 8, 1: 5, 2: 4}  # trunk sides per LOD
JIT = 0.12


def _lobes(
    m: _Mesh, lobes: list[tuple[Vec, Vec]], lod: int, rng: random.Random, *, floor=None
) -> None:
    segs, rings = BLOB[lod]
    for c, r in lobes:
        _blob(m, c, r, segs=segs, rings=rings, jit=JIT if lod == 0 else 0.0, rng=rng, floor=floor)


def _envelope(lobes: list[tuple[Vec, Vec]]) -> tuple[Vec, Vec]:
    """One ellipsoid (centre, radii) around the lobes: the far LOD's whole crown."""
    lo = [min(c[a] - r[a] for c, r in lobes) for a in range(3)]
    hi = [max(c[a] + r[a] for c, r in lobes) for a in range(3)]
    return (
        tuple((l_ + h) / 2 for l_, h in zip(lo, hi, strict=True)),
        tuple((h - l_) / 2 for l_, h in zip(lo, hi, strict=True)),
    )


def _canopy_tree(v: Variant, lod: int, spec: dict) -> list:
    """Trunk + branches + foliage lobes (+ accent flowers) for a broadleaf tree or shrub."""
    rng = random.Random(f"tree-{v.id}")
    trunk, leaves, flowers = _Mesh(), _Mesh(), _Mesh()
    lobes = spec["lobes"](rng)
    n = TUBE_N[lod]
    if lod == 2:
        _tube(
            trunk,
            spec["trunk"][0][:1] + spec["trunk"][0][-1:],
            [spec["trunk"][1][0], spec["trunk"][1][-1]],
            n,
        )
        c, r = _envelope(lobes)
        segs, rings = BLOB[2]
        _blob(leaves, c, r, segs=segs, rings=rings, floor=spec.get("floor"))
    else:
        pts, radii = spec["trunk"]
        keep = list(range(len(pts))) if lod == 0 else [0, len(pts) // 2, len(pts) - 1]
        _tube(trunk, [pts[i] for i in keep], [radii[i] for i in keep], n)
        for p0, p1, r0, r1 in spec["branches"](rng):
            _limb(trunk, p0, p1, r0, r1, n=max(4, n - 2), rings=1 if lod == 0 else 0)
        major = [lb for lb in lobes if lb[1][0] >= spec["major_r"]]
        _lobes(
            leaves,
            lobes if lod == 0 else major[:: spec.get("lod1_step", 1)],
            lod,
            rng,
            floor=spec.get("floor"),
        )
        if spec.get("flowers") and lod == 0:
            for c, r in spec["flowers"](rng):
                _blob(flowers, c, r, segs=5, rings=3, jit=0.1, rng=rng)
    objs = _obj(trunk, "trunk", "dark") + _obj(leaves, "canopy", "foliage")
    objs += _obj(flowers, "flowers", "accent")
    return objs


def _rain_lobes(rng: random.Random):
    lobes = [((0.0, 13.2, 0.0), (4.2, 2.6, 4.2))]
    for k in range(7):  # inner ring
        a = 2 * math.pi * k / 7 + rng.uniform(-0.15, 0.15)
        lobes.append(
            ((3.0 * math.cos(a), 11.8 + rng.uniform(-0.4, 0.5), 3.0 * math.sin(a)), (4.6, 2.9, 4.6))
        )
    for k in range(9):  # outer ring, drooping lower
        a = 2 * math.pi * (k + 0.5) / 9 + rng.uniform(-0.12, 0.12)
        lobes.append(
            ((6.0 * math.cos(a), 10.3 + rng.uniform(-0.4, 0.5), 6.0 * math.sin(a)), (4.4, 2.6, 4.4))
        )
    for k in range(10):  # small detail lobes on the rim and top
        a = 2 * math.pi * k / 10 + rng.uniform(-0.2, 0.2)
        rad = rng.uniform(4.5, 8.0)
        lobes.append(
            ((rad * math.cos(a), rng.uniform(12.0, 14.2), rad * math.sin(a)), (2.0, 1.4, 2.0))
        )
    return lobes


def _rain_branches(rng: random.Random):
    out = []
    for k in range(5):
        a = 2 * math.pi * k / 5 + rng.uniform(-0.2, 0.2)
        reach = rng.uniform(3.5, 5.5)
        out.append(
            (
                (0.0, 4.4, 0.0),
                (reach * math.cos(a), rng.uniform(9.0, 10.5), reach * math.sin(a)),
                0.32,
                0.18,
            )
        )
    return out


def _flame_lobes(rng: random.Random):
    lobes = [((0.0, 7.6, 0.0), (3.2, 1.5, 3.2))]
    for k in range(8):
        a = 2 * math.pi * k / 8 + rng.uniform(-0.15, 0.15)
        lobes.append(
            ((3.4 * math.cos(a), 6.8 + rng.uniform(-0.3, 0.4), 3.4 * math.sin(a)), (3.0, 1.4, 3.0))
        )
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.3
        lobes.append(
            ((4.6 * math.cos(a), 6.4 + rng.uniform(-0.3, 0.3), 4.6 * math.sin(a)), (1.8, 1.1, 1.8))
        )
    return lobes


def _flame_flowers(rng: random.Random):
    out = []
    for _ in range(12):
        a, rad = rng.uniform(0, 2 * math.pi), rng.uniform(0.5, 4.8)
        out.append(
            (
                (rad * math.cos(a), rng.uniform(8.0, 8.9) - 0.04 * rad, rad * math.sin(a)),
                (0.9, 0.5, 0.9),
            )
        )
    return out


def _frangi_lobes(rng: random.Random):
    lobes = [((0.0, 3.4, 0.0), (1.5, 1.0, 1.5))]
    for k in range(5):
        a = 2 * math.pi * k / 5 + rng.uniform(-0.2, 0.2)
        lobes.append(
            ((1.5 * math.cos(a), 3.0 + rng.uniform(-0.2, 0.3), 1.5 * math.sin(a)), (1.3, 0.9, 1.3))
        )
    return lobes


def _frangi_flowers(rng: random.Random):
    out = []
    for k in range(9):
        a, rad = 2 * math.pi * k / 9 + rng.uniform(-0.2, 0.2), rng.uniform(0.3, 1.8)
        out.append(
            (
                (rad * math.cos(a), 3.95 - 0.25 * rad + rng.uniform(0, 0.2), rad * math.sin(a)),
                (0.3, 0.2, 0.3),
            )
        )
    return out


def _round_lobes(rng: random.Random):
    return [
        ((0.0, 0.5, 0.0), (0.72, 0.52, 0.72)),
        ((0.28, 0.45, 0.2), (0.5, 0.4, 0.5)),
        ((-0.3, 0.42, -0.15), (0.48, 0.38, 0.48)),
    ]


def _hedge_lobes(rng: random.Random):
    return [
        ((x, 0.5, rng.uniform(-0.04, 0.04)), (0.55, 0.5, 0.45)) for x in (-0.8, -0.4, 0.0, 0.4, 0.8)
    ]


CANOPY = {
    "rain_tree": {
        "trunk": ([(0, 0, 0), (0.25, 2.4, 0.15), (0, 4.8, -0.1)], [0.8, 0.6, 0.5]),
        "branches": _rain_branches,
        "lobes": _rain_lobes,
        "major_r": 3.0,
        "lod1_step": 2,
    },
    "flame_tree": {
        "trunk": ([(0, 0, 0), (0.15, 1.8, 0.1), (0, 3.6, 0)], [0.45, 0.34, 0.3]),
        "branches": lambda rng: [
            ((0.0, 3.2, 0.0), (3.0 * math.cos(a), 6.2, 3.0 * math.sin(a)), 0.22, 0.12)
            for a in (0.4, 1.9, 3.4, 4.9)
        ],
        "lobes": _flame_lobes,
        "flowers": _flame_flowers,
        "major_r": 2.5,
    },
    "frangipani": {
        "trunk": ([(0, 0, 0), (0.05, 1.0, 0), (0, 1.9, 0)], [0.28, 0.22, 0.18]),
        "branches": lambda rng: [
            ((0.0, 1.7, 0.0), (1.1 * math.cos(a), 2.8, 1.1 * math.sin(a)), 0.12, 0.07)
            for a in (0.5, 2.2, 4.0)
        ],
        "lobes": _frangi_lobes,
        "flowers": _frangi_flowers,
        "major_r": 1.2,
    },
    "shrub_round": {
        "trunk": ([(0, 0, 0), (0, 0.25, 0), (0, 0.5, 0)], [0.07, 0.06, 0.05]),
        "branches": lambda rng: [],
        "lobes": _round_lobes,
        "major_r": 0.0,
        "floor": 0.12,
    },
    "shrub_hedge": {
        "trunk": ([(0, 0, 0), (0, 0.25, 0), (0, 0.5, 0)], [0.07, 0.06, 0.05]),
        "branches": lambda rng: [
            ((x, 0.0, 0.0), (x, 0.45, 0.0), 0.05, 0.04) for x in (-0.8, 0.0, 0.8)
        ],
        "lobes": _hedge_lobes,
        "major_r": 0.0,
        "floor": 0.12,
        "lod1_step": 2,
    },
}


def _palm(v: Variant, lod: int, spec: dict) -> list:
    """A palm: a curved trunk and a rosette of fronds (a flat disc crown at LOD2)."""
    rng = random.Random(f"palm-{v.id}")
    trunk, leaves = _Mesh(), _Mesh()
    pts, radii = spec["trunk"]
    crown = pts[-1]
    if lod == 2:
        _tube(trunk, [pts[0], crown], [radii[0], radii[-1]], 4)
        reach = spec["length"] * 0.95
        segs, rings = BLOB[2]
        _blob(
            leaves,
            (crown[0], crown[1] + spec["disc_y"], crown[2]),
            (reach, spec["disc_h"], reach),
            segs=segs,
            rings=rings,
        )
    else:
        keep = list(range(len(pts))) if lod == 0 else [0, len(pts) // 2, len(pts) - 1]
        _tube(trunk, [pts[i] for i in keep], [radii[i] for i in keep], TUBE_N[lod])
        for k in range(spec["fronds"]):
            yaw = 2 * math.pi * k / spec["fronds"] + rng.uniform(-0.12, 0.12)
            ln = spec["length"] * rng.uniform(0.9, 1.05)
            _frond(
                leaves,
                (crown[0], crown[1] + rng.uniform(-0.1, 0.1), crown[2]),
                yaw,
                ln,
                spec["width"],
                spec["rise"] * rng.uniform(0.85, 1.15),
                spec["droop"],
                spec["segs"] if lod == 0 else 3,
                ridge=lod == 0,
            )
        if spec.get("crownshaft") and lod == 0:
            c0, c1 = spec["crownshaft"]
            _tube(leaves, [c0, c1], [0.3, 0.27], 7, cap_top=True)
    return _obj(trunk, "trunk", "dark") + _obj(leaves, "fronds", "foliage")


PALMS = {
    "coconut_palm": {
        "trunk": (
            [(0, 0, 0), (0.1, 3.0, 0.05), (0.25, 6.5, 0.1), (0.35, 10.0, 0.05), (0.35, 13.0, 0)],
            [0.46, 0.34, 0.3, 0.27, 0.24],
        ),
        "fronds": 13,
        "length": 3.4,
        "width": 0.7,
        "rise": 3.2,
        "droop": 4.6,
        "segs": 6,
        "disc_y": -0.3,
        "disc_h": 1.3,
    },
    "royal_palm": {
        "trunk": (
            [(0, 0, 0), (0, 2.5, 0), (0, 6.0, 0), (0, 9.5, 0), (0, 12.5, 0)],
            [0.42, 0.4, 0.34, 0.3, 0.27],
        ),
        "fronds": 12,
        "length": 2.9,
        "width": 0.55,
        "rise": 3.6,
        "droop": 3.4,
        "segs": 6,
        "crownshaft": ((0.0, 12.5, 0.0), (0.0, 14.4, 0.0)),
        "disc_y": 0.5,
        "disc_h": 0.55,
    },
    "oil_palm": {
        "trunk": (
            [(0, 0, 0), (0, 1.8, 0), (0, 3.6, 0), (0, 5.4, 0)],
            [0.4, 0.36, 0.33, 0.3],
        ),
        "fronds": 22,
        "length": 4.5,
        "width": 0.55,
        "rise": 5.0,
        "droop": 5.2,
        "segs": 6,
        "disc_y": 0.5,
        "disc_h": 0.8,
    },
}


def _tree_builder(v: Variant, lod: int) -> list:
    if v.id in PALMS:
        spec = PALMS[v.id]
        if v.id == "royal_palm":  # fronds spring from the top of the crownshaft
            spec = {**spec, "trunk": ([*spec["trunk"][0][:-1], (0.0, 14.4, 0.0)], spec["trunk"][1])}
        objs = _palm(v, lod, spec)
        centre = False
    elif v.id in CANOPY:
        objs = _canopy_tree(v, lod, CANOPY[v.id])
        centre = True
    else:
        raise KeyError(f"no tree builder for {v.id!r}")
    top = v.size[1]
    _fit(objs, x=v.size[0] + 0.4, top=top, z=v.size[2] + 0.4, centre=centre)
    _sway(objs, top)
    return objs


# --- street furniture ---------------------------------------------------------------------


def _box(m: _Mesh, x0, x1, y0, y1, z0, z1, *, bottom: bool = False) -> None:
    m.box(x0, x1, y0, y1, z0, z1, skip=() if bottom else ("bottom",))


def _lamp(v: Variant, lod: int) -> list:
    """A street lamp: a tapered pole, a curved arm and a head with a light panel. The
    double lamp mirrors the arm (arms reach +-1.45 m)."""
    sides = (1.0,) if v.id == "lamp_single" else (-1.0, 1.0)
    pole, heads, glow = _Mesh(), _Mesh(), _Mesh()
    n = 8 if lod == 0 else 6
    if lod == 0:
        _tube(pole, [(0, 0, 0), (0, 0.6, 0), (0, 3.0, 0), (0, 8.6, 0)], [0.12, 0.1, 0.09, 0.07], n)
        _tube(pole, [(0, 0.0, 0), (0, 0.3, 0)], [0.2, 0.2], n, cap_top=True)
    else:
        _tube(pole, [(0, 0, 0), (0, 8.6, 0)], [0.1, 0.07], n)
        _tube(pole, [(0, 0.0, 0), (0, 0.3, 0)], [0.2, 0.2], n, cap_top=True)
    for s in sides:
        if lod == 0:
            _tube(
                pole,
                [(0, 8.45, 0), (s * 0.5, 8.95, 0), (s * 1.15, 9.0, 0)],
                [0.055, 0.05, 0.045],
                5,
            )
        else:
            _box(pole, min(0.0, s * 1.15), max(0.0, s * 1.15), 8.9, 8.98, -0.04, 0.04)
        x0, x1 = sorted((s * 1.0, s * 1.65))
        _box(heads, x0, x1, 8.85, 9.05, -0.17, 0.17)
        _box(glow, x0 + 0.05, x1 - 0.05, 8.78, 8.85, -0.13, 0.13, bottom=True)
    return _obj(pole, "pole", "metal") + _obj(heads, "heads", "dark") + _obj(glow, "lamp", "light")


def _bench(v: Variant, lod: int) -> list:
    wood, frame = _Mesh(), _Mesh()
    w = 1.9
    if lod == 0:
        for z in (-0.04, 0.07, 0.18):  # seat slats
            _box(wood, -w / 2, w / 2, 0.44, 0.49, z - 0.04 + 0.1, z + 0.04 + 0.1)
        for y in (0.58, 0.7, 0.82):  # back slats
            _box(wood, -w / 2, w / 2, y - 0.04, y + 0.04, -0.3, -0.27)
        for x in (-w / 2 + 0.08, w / 2 - 0.08):
            _box(frame, x - 0.025, x + 0.025, 0.0, 0.44, 0.0, 0.05)
            _box(frame, x - 0.025, x + 0.025, 0.0, 0.44, -0.3, -0.25)
            _box(frame, x - 0.025, x + 0.025, 0.44, 0.85, -0.3, -0.27)
        _box(frame, -w / 2 + 0.1, w / 2 - 0.1, 0.18, 0.22, -0.28, -0.25)
    else:
        _box(wood, -w / 2, w / 2, 0.44, 0.49, -0.2, 0.32)
        _box(wood, -w / 2, w / 2, 0.5, 0.85, -0.3, -0.27)
        for x in (-w / 2 + 0.08, w / 2 - 0.08):
            _box(frame, x - 0.025, x + 0.025, 0.0, 0.44, -0.2, 0.3)
    return _obj(wood, "slats", "accent") + _obj(frame, "frame", "metal")


def _bus_shelter(v: Variant, lod: int) -> list:
    roof, post, glass, seat = _Mesh(), _Mesh(), _Mesh(), _Mesh()
    w, d = 6.1, 2.1
    _box(roof, -w / 2, w / 2, 2.68, 2.8, -d / 2, d / 2, bottom=True)
    xs = (-w / 2 + 0.1, w / 2 - 0.1)
    for x in xs:
        _box(post, x - 0.05, x + 0.05, 0.0, 2.68, -d / 2 + 0.1, -d / 2 + 0.2)
        if lod == 0:
            _box(post, x - 0.05, x + 0.05, 0.0, 2.68, d / 2 - 0.2, d / 2 - 0.1)
    if lod == 0:
        _box(glass, -w / 2 + 0.2, w / 2 - 0.2, 0.3, 2.6, -d / 2 + 0.2, -d / 2 + 0.24)
        for x in (-w / 2 + 0.2, w / 2 - 0.24):
            _box(glass, x, x + 0.04, 0.3, 2.6, -d / 2 + 0.24, d / 2 - 0.2)
        _box(seat, -1.4, 1.4, 0.44, 0.49, -d / 2 + 0.3, -d / 2 + 0.75)
        for x in (-1.3, 1.3):
            _box(post, x - 0.03, x + 0.03, 0.0, 0.44, -d / 2 + 0.4, -d / 2 + 0.65)
    else:
        _box(glass, -w / 2 + 0.2, w / 2 - 0.2, 0.3, 2.6, -d / 2 + 0.2, -d / 2 + 0.24)
    return (
        _obj(roof, "roof", "secondary")
        + _obj(post, "posts", "metal")
        + _obj(glass, "panels", "glass", 0.5)
        + _obj(seat, "seat", "accent")
    )


def _bollard(v: Variant, lod: int) -> list:
    body, band = _Mesh(), _Mesh()
    if lod == 0:
        _tube(
            body,
            [(0, 0, 0), (0, 0.1, 0), (0, 0.55, 0), (0, 0.9, 0), (0, 1.0, 0)],
            [0.115, 0.11, 0.1, 0.11, 0.07],
            8,
        )
        _tube(band, [(0, 0.6, 0), (0, 0.8, 0)], [0.108, 0.108], 8, cap_top=False)
    else:
        _tube(body, [(0, 0, 0), (0, 1.0, 0)], [0.11, 0.08], 5)
    return _obj(body, "body", "metal") + _obj(band, "band", "accent")


def _bin(v: Variant, lod: int) -> list:
    body, lid = _Mesh(), _Mesh()
    n = 8 if lod == 0 else 5
    _tube(body, [(0, 0, 0), (0, 0.85, 0)], [0.24, 0.27], n, cap_top=False)
    _tube(lid, [(0, 0.85, 0), (0, 0.95, 0)], [0.29, 0.25], n)
    return _obj(body, "body", "accent") + _obj(lid, "lid", "dark")


def _traffic_light(v: Variant, lod: int) -> list:
    pole, head, lamps = _Mesh(), _Mesh(), _Mesh()
    _tube(
        pole,
        [(0, 0, 0), (0, 0.5, 0), (0, 3.4, 0)] if lod == 0 else [(0, 0, 0), (0, 3.4, 0)],
        [0.1, 0.07, 0.07] if lod == 0 else [0.09, 0.07],
        8 if lod == 0 else 5,
    )
    _box(head, -0.28, 0.28, 3.35, 4.4, -0.27, 0.27)
    if lod == 0:
        for y in (4.15, 3.85, 3.55):
            _box(lamps, -0.12, 0.12, y - 0.12, y + 0.12, 0.27, 0.31, bottom=True)
    else:  # one panel stands in for the three lamps
        _box(lamps, -0.12, 0.12, 3.43, 4.27, 0.27, 0.31, bottom=True)
    return _obj(pole, "pole", "metal") + _obj(head, "head", "dark") + _obj(lamps, "lamps", "light")


def _sign_post(v: Variant, lod: int) -> list:
    post, panel = _Mesh(), _Mesh()
    _tube(post, [(0, 0, 0), (0, 2.6, 0)], [0.04, 0.04], 6 if lod == 0 else 4)
    _box(panel, -0.4, 0.4, 1.9, 2.5, 0.045, 0.075, bottom=True)
    return _obj(post, "post", "metal") + _obj(panel, "panel", "secondary")


def _railing(v: Variant, lod: int) -> list:
    metal = _Mesh()
    for x in (-0.96, 0.96):
        _box(metal, x - 0.04, x + 0.04, 0.0, 1.1, -0.04, 0.04)
    _box(metal, -0.96, 0.96, 1.04, 1.1, -0.03, 0.03)
    _box(metal, -0.96, 0.96, 0.2, 0.25, -0.03, 0.03)
    if lod == 0:
        for k in range(1, 8):
            x = -0.96 + 1.92 * k / 8
            _box(metal, x - 0.015, x + 0.015, 0.25, 1.04, -0.015, 0.015)
    return _obj(metal, "railing", "metal")


FURNITURE = {
    "lamp_single": _lamp,
    "lamp_double": _lamp,
    "bench": _bench,
    "bus_shelter": _bus_shelter,
    "bollard": _bollard,
    "bin": _bin,
    "traffic_light": _traffic_light,
    "sign_post_blank": _sign_post,
    "railing_2m": _railing,
}


def _furniture_builder(v: Variant, lod: int) -> list:
    if v.id not in FURNITURE:
        raise KeyError(f"no furniture builder for {v.id!r}")
    return FURNITURE[v.id](v, lod)


BUILDERS: dict[str, Callable[[Variant, int], list]] = {
    "trees": _tree_builder,
    "furniture": _furniture_builder,
}


# --- third-party model intake -------------------------------------------------------------


def _srgb(c: float) -> float:
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


# the sRGB colour each role stands for, used to classify a sampled colormap texel when the
# vendor entry has no "#rrggbb" role table; a semantic palette (green leaves, near-black dark...)
ROLE_REFERENCE: tuple[tuple[float, float, float], ...] = (
    (0.90, 0.88, 0.82),  # primary: pale walls and paint
    (0.40, 0.42, 0.46),  # secondary: mid grey
    (0.70, 0.40, 0.25),  # accent: brick and wood
    (0.50, 0.70, 0.85),  # glass: pale blue
    (0.10, 0.10, 0.10),  # dark
    (0.65, 0.67, 0.70),  # metal: light grey
    (0.25, 0.60, 0.20),  # foliage: green
    (1.00, 0.95, 0.60),  # light: warm yellow
)


def _hex(key: str) -> tuple[float, float, float] | None:
    if len(key) == 7 and key[0] == "#":
        try:
            return tuple(int(key[i : i + 2], 16) / 255.0 for i in (1, 3, 5))
        except ValueError:
            return None
    return None


def _nearest(rgb: Sequence[float], table: Sequence[tuple[Sequence[float], str]]) -> str:
    return min(table, key=lambda e: sum((a - b) ** 2 for a, b in zip(rgb, e[0], strict=True)))[1]


def _vendor_entry(slug: str, root: Path) -> dict:
    path = root / "vendor" / "vendor.json"
    for e in json.loads(path.read_text(encoding="utf-8")):
        if e["slug"] == slug:
            return e
    raise KeyError(f"{slug!r} is not in {path}")


def _material_image(mat):
    """The image feeding a material's Base Color (a colormap), or None."""
    if mat is None or mat.node_tree is None:
        return None
    for node in mat.node_tree.nodes:
        if node.type == "TEX_IMAGE" and node.image is not None:
            return node.image
    return None


def _flat_colour(mat) -> tuple[float, float, float]:
    if mat is not None and mat.node_tree is not None:
        for node in mat.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                c = node.inputs["Base Color"].default_value
                return tuple(_srgb(c[i]) for i in range(3))
    return tuple(_srgb(c) for c in (mat.diffuse_color[:3] if mat else (0.8, 0.8, 0.8)))


def _face_roles(obj, role_map: dict[str, str]) -> list[str]:
    """One role per polygon: by material name through `role_map`; else, for a textured
    material, the colormap sampled at the polygon's UV centroid and matched to the nearest role
    (to the nearest `#rrggbb` key when role_map has a palette table, else to the display
    palette); else an error."""
    me = obj.data
    table = [(c, r) for k, r in role_map.items() if (c := _hex(k)) is not None]
    table = table or [(rgb, role) for rgb, role in zip(ROLE_REFERENCE, ROLES, strict=True)]
    pixels: dict[str, tuple[np.ndarray, int, int]] = {}
    uv = me.uv_layers.active
    roles = []
    for poly in me.polygons:
        mat = me.materials[poly.material_index] if len(me.materials) else None
        if mat is not None and mat.name in role_map:
            roles.append(role_map[mat.name])
            continue
        img = _material_image(mat)
        if img is not None and uv is not None:
            if img.name not in pixels:
                img.colorspace_settings.name = "Non-Color"  # raw sRGB-encoded texels
                w, h = img.size
                buf = np.empty(w * h * 4, dtype=np.float32)
                img.pixels.foreach_get(buf)
                pixels[img.name] = (buf, w, h)
            buf, w, h = pixels[img.name]
            us = [uv.data[li].uv for li in poly.loop_indices]
            u = (sum(p[0] for p in us) / len(us)) % 1.0
            vv = (sum(p[1] for p in us) / len(us)) % 1.0
            i = (min(int(vv * h), h - 1) * w + min(int(u * w), w - 1)) * 4
            roles.append(_nearest(tuple(buf[i : i + 3]), table))
        else:
            raise ValueError(
                f"{obj.name}: material {mat.name if mat else None!r} has no role_map entry"
                " and no colormap texture"
            )
    return roles


def _write_roles(obj, roles: list[str]) -> None:
    me = obj.data
    for a in [a for a in me.color_attributes if a.name != core.COLOR_ATTR]:
        me.color_attributes.remove(a)
    attr = core._color_attr(me, core.COLOR_ATTR)
    values = [0.0] * (len(me.loops) * 4)
    for poly, role in zip(me.polygons, roles, strict=True):
        g = ROLES.index(role) / 7.0
        for li in range(poly.loop_start, poly.loop_start + poly.loop_total):
            values[li * 4 : li * 4 + 4] = (1.0, g, 0.0, 1.0)
    attr.data.foreach_set("color", values)
    core._make_active(me, core.COLOR_ATTR)


def import_vendor(slug: str, root: Path | None = None) -> list:
    """Import `vendor/<kind>/<slug>/source.glb` (recorded in vendor.json) as role-coloured meshes.

    Per polygon the role comes from `role_map` by material name; a textured material (a Kenney
    `colormap`) not named there is sampled at the polygon's UV centroid and matched to the
    nearest role: `role_map` may carry `"#rrggbb": role` entries as the palette's role table,
    else the display palette (`ROLE_REFERENCE`) is used. Materials, images and UVs are dropped,
    the hierarchy is flattened, transforms are applied, and the model is seated at the footprint
    centre on the ground. Returns the mesh objects (COLOR_0 set, no material); the builder joins
    them (`core.join`) after `scale_to`.
    """
    root = Path(root) if root is not None else ASSETS_DIR
    entry = _vendor_entry(slug, root)
    src = root / entry["files"][0]
    before = set(bpy.data.objects)
    mats_before = set(bpy.data.materials)
    bpy.ops.import_scene.gltf(filepath=str(src))
    bpy.context.view_layer.update()
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in meshes:  # flatten, keeping the world transform
        world = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = world
        o.data = o.data.copy()  # single user
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    for o in meshes:
        _write_roles(o, _face_roles(o, entry["role_map"]))
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        while o.data.uv_layers:
            o.data.uv_layers.remove(o.data.uv_layers[0])
        o.data.materials.clear()
    for mat in [m for m in bpy.data.materials if m not in mats_before]:
        bpy.data.materials.remove(mat)
    for img in list(bpy.data.images):
        bpy.data.images.remove(img)
    lo, hi = _extent(meshes)
    shift = Matrix.Translation(((-(lo[0] + hi[0]) / 2), ((lo[2] + hi[2]) / 2), -lo[1]))
    for o in meshes:
        o.data.transform(shift)
        o.data.update()
    return meshes


def scale_to(objs: list, axis: str, target_m: float) -> None:
    """Scale the objects uniformly (about the origin) so their combined extent on the glTF
    `axis` ("x", "y" or "z") is `target_m` metres."""
    if axis not in ("x", "y", "z"):
        raise ValueError(f"axis must be x, y or z, not {axis!r}")
    for o in objs:  # bake any object transform first
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    lo, hi = _extent(objs)
    i = "xyz".index(axis)
    extent = hi[i] - lo[i]
    if extent <= 1e-9:
        raise ValueError(f"no extent on axis {axis!r}")
    s = Matrix.Scale(target_m / extent, 4)
    for o in objs:
        o.data.transform(s)
        o.data.update()
