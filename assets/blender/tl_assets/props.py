"""Kit builders (trees, furniture, people, vehicles, construction) and third-party intake (bpy).

Registered into `build.BUILDERS` as `trees`, `furniture`, `people`, `vehicles` and `construction`:
`(variant, lod) -> [objects]`.
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


# --- people and vehicles ------------------------------------------------------------------


class _Parts:
    """Meshes keyed by (role, aux): B is a per-part constant (limb code, light code)."""

    def __init__(self, aux: float = 0.5) -> None:
        self.aux = aux
        self.d: dict[tuple[str, float], _Mesh] = {}

    def m(self, role: str, aux: float | None = None) -> _Mesh:
        return self.d.setdefault((role, self.aux if aux is None else aux), _Mesh())

    def objs(self, prefix: str) -> list:
        out: list = []
        for (role, aux), mesh in self.d.items():
            out += _obj(mesh, f"{prefix}_{role}_{aux}", role, aux)
        return out


def _ring_tube(
    m: _Mesh,
    rings: Sequence[tuple[float, float, float, float, float]],
    n: int = 8,
    *,
    cap_top: bool = True,
    cap_bottom: bool = False,
) -> None:
    """A tube of horizontal elliptical rings (cx, cy, cz, rx, rz), bottom to top."""
    pts = [
        [
            (cx + rx * math.cos(2 * math.pi * k / n), cy, cz + rz * math.sin(2 * math.pi * k / n))
            for k in range(n)
        ]
        for cx, cy, cz, rx, rz in rings
    ]
    cs = [Vector((r[0], r[1], r[2])) for r in rings]
    for i in range(len(rings) - 1):
        mid = (cs[i] + cs[i + 1]) / 2
        for k in range(n):
            j = (k + 1) % n
            quad = [pts[i][k], pts[i][j], pts[i + 1][j], pts[i + 1][k]]
            m.face(quad, tuple(Vector(_mean(quad)) - mid))
    if cap_top:
        m.face(pts[-1], (0.0, 1.0, 0.0))
    if cap_bottom:
        m.face(pts[0], (0.0, -1.0, 0.0))


def _sbox(m: _Mesh, s: float, xa: float, xb: float, y0, y1, z0, z1, *, bottom=False) -> None:
    """A box on side `s` (+1 / -1): |x| runs from xa to xb."""
    x0, x1 = sorted((s * xa, s * xb))
    _box(m, x0, x1, y0, y1, z0, z1, bottom=bottom)


def _shift(objs: list, dz: float) -> None:
    """Move the meshes by `dz` along glTF z (Blender -y)."""
    for o in objs:
        o.data.transform(Matrix.Translation((0.0, -dz, 0.0)))


def _stand(objs: list, top: float) -> None:
    """Scale uniformly about the origin so the highest point is exactly `top`."""
    f = top / _extent(objs)[1][1]
    for o in objs:
        o.data.transform(Matrix.Scale(f, 4))
        o.data.update()


def _wheel(
    tyre: _Mesh, hub: _Mesh | None, cx: float, cy: float, cz: float, r: float, w: float, n: int
) -> None:
    """A tyre (a short cylinder along x) with a hub disc on its outer face."""
    _tube(tyre, [(cx - w / 2, cy, cz), (cx + w / 2, cy, cz)], [r, r], n, cap_bottom=True)
    if hub is not None:
        s = 1.0 if cx > 0 else -1.0
        x0 = cx + s * (w / 2 - 0.01)
        _tube(hub, [(x0, cy, cz), (x0 + s * 0.025, cy, cz)], [r * 0.6, r * 0.6], n, cap_bottom=True)


# people ---------------------------------------------------------------------------------
# glTF frame, facing +z, left = +x. Limb code B: left leg + right arm 0.25, right leg + left
# arm 0.75, everything else 0.5 (the vertex shader swings the limbs by it).

L_CODE, R_CODE = 0.25, 0.75  # left leg / right arm, right leg / left arm


def _figure(
    P: _Parts,
    H: float,
    lod: int,
    *,
    hs: float = 1.0,
    hip: float = 0.50,
    sh: float = 0.81,
    sw: float = 0.12,
    stride: float = 0.13,
    lean: float = 0.0,
    ky: float = 1.0,
    head_fwd: float = 0.0,
    sleeve: str = "short",
    legs: str = "long",
    top: str = "shirt",
    tudung: bool = False,
    hair: str = "short",
    arms: str = "walk",
    cane: bool = False,
    pack: str | None = None,
    jog_lift: bool = False,
    seated: dict | None = None,
    reach: tuple[float, float, float] | None = None,
    hip_abs: float | None = None,
    hz0: float = 0.0,
) -> None:
    """A static mid-stride person of height ~H (the caller rescales to exact). `seated` gives
    explicit leg points per side (cyclist); `reach` is where both hands hold a handle."""
    n = 8 if lod == 0 else 4
    nt = 8 if lod == 0 else 5
    bs, br = (8, 5) if lod == 0 else (5, 3)
    prim, sec, skin, dark = P.m("primary"), P.m("secondary"), P.m("accent"), P.m("dark")
    hipy = hip_abs if hip_abs is not None else hip * H
    shy = hipy + (sh - hip) * H * ky
    lz = hz0 + lean * H  # shoulder z

    def zl(y: float) -> float:  # torso centre z at height y
        return hz0 + (lz - hz0) * (y - hipy) / max(shy - hipy, 1e-6)

    # legs and shoes
    for s in (1.0, -1.0):
        code = 0.5 if seated is not None else (L_CODE if s > 0 else R_CODE)
        hx = s * 0.055 * H
        if seated is not None:
            hp, kp, ap = seated[s]
        else:
            az = (stride if s > 0 else -0.95 * stride) * H
            ay = 0.045 * H + (0.0 if s > 0 else 0.03 * H)
            kz = az * 0.55 if s > 0 else az * 0.45 + 0.02 * H
            kyy = 0.26 * H
            if jog_lift and s > 0:
                az, ay, kz, kyy = 0.10 * H, 0.17 * H, 0.17 * H, 0.33 * H
            hp, kp, ap = (hx, hipy, 0.0), (hx, kyy, kz), (hx, ay, az)
        bare = legs in ("short", "skirt")
        mt, ms = P.m("secondary", code), P.m("accent" if bare else "secondary", code)
        if lod == 0:
            _limb(mt, hp, kp, 0.055 * H, 0.042 * H, n, rings=0)
            _limb(ms, kp, ap, 0.042 * H, 0.03 * H, n, rings=0)
        else:
            _limb(ms if bare else mt, hp, ap, 0.05 * H, 0.03 * H, n, rings=0)
        ay0 = ap[1]
        _box(
            P.m("dark", code),
            hp[0] - 0.036 * H,
            hp[0] + 0.036 * H,
            max(0.0, ay0 - 0.045 * H),
            ay0 + 0.005 * H,
            ap[2] - 0.045 * H,
            ap[2] + 0.13 * H,
        )

    # torso
    def ring(y: float, rx: float, rz: float):
        return (0.0, y, zl(y), rx * H, rz * H)

    if top == "kurung":
        _ring_tube(
            prim,
            [
                ring(0.30 * H, 0.145, 0.10),
                ring(0.40 * H, 0.13, 0.09),
                ring(0.55 * H, 0.115, 0.08),
                ring(0.72 * H, 0.112, 0.07),
                ring(shy - 0.005 * H, 0.122, 0.066),
            ],
            nt,
        )
        _ring_tube(
            sec,
            [
                ring(0.07 * H, 0.142, 0.107),
                ring(0.18 * H, 0.14, 0.104),
                ring(0.31 * H, 0.138, 0.098),
            ],
            nt,
            cap_top=False,
            cap_bottom=True,
        )
    else:
        if legs == "skirt":
            _ring_tube(
                sec,
                [
                    ring(0.32 * H, 0.125, 0.09),
                    ring(0.45 * H, 0.112, 0.078),
                    ring(hipy + 0.07 * H, 0.1, 0.066),
                ],
                nt,
                cap_top=False,
            )
        _ring_tube(
            sec,
            [ring(hipy + 0.02 * H, 0.105, 0.062), ring(hipy + 0.11 * H * ky, 0.092, 0.058)],
            nt,
            cap_top=False,
            cap_bottom=True,
        )
        mid, up = hipy + (shy - hipy) * 0.35, hipy + (shy - hipy) * 0.7
        _ring_tube(
            prim,
            [
                ring(hipy + 0.11 * H * ky, 0.092, 0.058),
                ring(mid, 0.105, 0.066),
                ring(up, 0.114, 0.07),
                ring(shy - 0.005 * H, 0.122, 0.066),
            ],
            nt,
        )
    neck_c = shy + 0.045 * H
    ry = 0.066 * H * hs
    hcy = neck_c + ry * 0.85
    hz = lz + head_fwd * H
    _tube(
        skin,
        [(0, shy - 0.01 * H, lz + head_fwd * H * 0.4), (0, neck_c, hz)],
        [0.03 * H, 0.027 * H],
        6 if lod == 0 else 4,
    )
    rx_, rz_ = 0.056 * H * hs, 0.062 * H * hs
    _blob(skin, (0, hcy, hz + (0.012 * H if tudung else 0.0)), (rx_, ry, rz_), segs=bs, rings=br)
    if tudung:
        _blob(
            prim,
            (0, hcy + 0.004 * H, hz - 0.008 * H),
            (rx_ * 1.12, ry * 1.1, rz_ * 1.1),
            segs=bs,
            rings=br,
            floor=hcy - ry * 0.85,
        )
        _ring_tube(
            prim,
            [
                (0, hcy - ry * 0.8, hz - 0.004 * H, rx_ * 1.05, rz_),
                (0, shy - 0.02 * H, lz, 0.12 * H, 0.085 * H),
                (0, shy - 0.13 * H, lz + 0.005 * H, 0.15 * H, 0.1 * H),
            ],
            nt,
            cap_top=False,
        )
    elif hair != "none":
        floor = hcy + ry * (0.05 if hair == "short" else 0.0)
        _blob(
            dark,
            (0, hcy + 0.012 * H * hs, hz - 0.012 * H),
            (rx_ * 1.06, ry, rz_ * 1.08),
            segs=bs,
            rings=br,
            floor=floor,
        )
        if hair == "long" and lod == 0:
            _blob(
                dark,
                (0, hcy - ry * 0.8, hz - rz_ * 0.55),
                (rx_ * 0.95, ry * 1.25, rz_ * 0.55),
                segs=bs,
                rings=br,
            )
    if pack:
        _box(
            prim if pack == "primary" else sec,
            -0.09 * H,
            0.09 * H,
            shy - 0.2 * H,
            shy - 0.02 * H,
            lz - 0.14 * H,
            lz - 0.065 * H,
        )

    # arms
    for s in (1.0, -1.0):
        code = R_CODE if s > 0 else L_CODE  # left arm 0.75, right arm 0.25
        shoulder = (s * sw * H, shy - 0.025 * H, lz)
        ex = s * (sw + 0.012) * H
        if reach is not None:
            code = 0.5
            wrist = (s * reach[0], reach[1], reach[2])
            elbow = (
                s * (sw + 0.03) * H,
                (shoulder[1] + wrist[1]) / 2 - 0.05 * H,
                (shoulder[2] + wrist[2]) / 2,
            )
        elif arms == "jog":
            if s < 0:
                elbow, wrist = (
                    (ex, shy - 0.14 * H, 0.09 * H),
                    (s * 0.095 * H, shy - 0.07 * H, 0.14 * H),
                )
            else:
                elbow, wrist = (
                    (ex, shy - 0.14 * H, -0.13 * H),
                    (s * 0.115 * H, shy - 0.2 * H, -0.07 * H),
                )
        else:
            f = 0.10 if s < 0 else -0.10
            elbow = (ex, shy - 0.17 * H, f * 0.45 * H + lz)
            wrist = (s * (sw + 0.018) * H, shy - 0.335 * H, f * H + lz)
            if cane and s < 0:
                code = 0.5
                wrist = (s * 0.15 * H, shy - 0.34 * H, 0.1 * H + lz)
        upper = P.m("primary", code)
        lower = P.m("primary" if sleeve == "long" else "accent", code)
        _limb(upper, shoulder, elbow, 0.036 * H, 0.032 * H, n, rings=0)
        _limb(lower, elbow, wrist, 0.032 * H, 0.026 * H, n, rings=0)
        if lod == 0:
            _blob(P.m("accent", code), wrist, (0.03 * H, 0.035 * H, 0.03 * H), segs=6, rings=3)
            _blob(upper, shoulder, (0.042 * H,) * 3, segs=6, rings=3)
        if cane and s < 0:
            cz = wrist[2] + 0.03 * H
            _tube(
                P.m("dark", 0.5),
                [(wrist[0], 0.0, cz + 0.05 * H), (wrist[0], wrist[1] - 0.02 * H, cz)],
                [0.012 * H, 0.012 * H],
                5,
            )


STRIDE = {
    "older_adult": 0.09,
    "jogger": 0.20,
    "child": 0.11,
    "school_boy": 0.12,
    "school_girl": 0.11,
}
_KID = dict(hs=1.2, hip=0.47, sh=0.78, sw=0.125)

PEOPLE: dict[str, dict] = {
    "office_man": dict(H=1.76, sleeve="long", legs="long", hair="short"),
    "office_woman": dict(H=1.66, sleeve="short", legs="skirt", hair="long", hs=0.97),
    "tudung_baju_kurung": dict(H=1.62, sleeve="long", top="kurung", legs="kain", tudung=True),
    "older_adult": dict(
        H=1.62,
        sleeve="long",
        legs="long",
        hair="short",
        lean=0.045,
        head_fwd=0.05,
        cane=True,
        hs=0.97,
    ),
    "jogger": dict(H=1.74, sleeve="short", legs="short", arms="jog", lean=0.04, jog_lift=True),
    "school_boy": dict(H=1.36, sleeve="short", legs="short", pack="secondary", **_KID),
    "school_girl": dict(H=1.32, sleeve="long", top="kurung", legs="kain", tudung=True, **_KID),
    "child": dict(
        H=1.25, sleeve="short", legs="short", **{**_KID, "hs": 1.3, "hip": 0.46, "sh": 0.77}
    ),
}


def _bike(P: _Parts, lod: int) -> None:
    n = 12 if lod == 0 else 6
    tyre, metal, dark, body = P.m("dark"), P.m("metal"), P.m("dark"), P.m("primary")
    r, wz = 0.34, 0.5
    for z in (wz, -wz):
        _tube(tyre, [(-0.03, r, z), (0.03, r, z)], [r, r], n, cap_bottom=True)
        if lod == 0:
            _tube(metal, [(-0.04, r, z), (0.04, r, z)], [0.09, 0.09], 6, cap_bottom=True)
    bb, seat, head = (0, 0.30, -0.05), (0, 0.92, -0.2), (0, 0.97, 0.38)
    rear, front, fork = (0, r, -wz), (0, r, wz), (0, 0.8, 0.4)
    frame = [(rear, bb), (bb, seat), (rear, seat), (seat, head), (bb, fork), (fork, front)]
    for a, b in frame if lod == 0 else [(bb, seat), (seat, head), (fork, front)]:
        _limb(body, a, b, 0.016, 0.016, n=5 if lod == 0 else 3, rings=0)
    _tube(metal, [(-0.3, 1.02, 0.4), (0.3, 1.02, 0.4)], [0.013, 0.013], 5 if lod == 0 else 3)
    if lod == 0:
        _limb(metal, head, (0, 1.02, 0.4), 0.014, 0.014, n=4, rings=0)
        _box(dark, -0.05, 0.05, 0.92, 0.96, -0.3, -0.08)
        _box(metal, 0.07, 0.13, 0.27, 0.29, -0.08, 0.04)
        _box(metal, -0.13, -0.07, 0.27, 0.29, -0.04, 0.0)


def _rider(P: _Parts, lod: int) -> None:
    seated = {
        1.0: ((0.09, 1.0, -0.2), (0.12, 0.66, 0.2), (0.11, 0.32, 0.1)),
        -1.0: ((-0.09, 1.0, -0.2), (-0.12, 0.62, 0.0), (-0.11, 0.26, -0.14)),
    }
    _bike(P, lod)
    _figure(
        P,
        1.7,
        lod,
        sleeve="short",
        legs="short",
        hair="short",
        ky=0.8,
        lean=0.2,
        head_fwd=0.07,
        seated=seated,
        reach=(0.28, 1.04, 0.38),
        hip_abs=1.0,
        hz0=-0.2,
    )


def _stroller(P: _Parts, lod: int) -> None:
    n = 6 if lod == 0 else 3
    metal, dark, canopy = P.m("metal"), P.m("dark"), P.m("secondary")
    _tube(metal, [(-0.28, 1.0, 0.1), (0.28, 1.0, 0.1)], [0.016, 0.016], n)
    for s in (1.0, -1.0):
        _limb(metal, (s * 0.26, 1.0, 0.1), (s * 0.26, 0.55, 0.62), 0.014, 0.014, n=4, rings=0)
        if lod == 0:
            _limb(metal, (s * 0.26, 0.55, 0.62), (s * 0.26, 0.2, 0.9), 0.014, 0.014, n=4, rings=0)
            _limb(metal, (s * 0.26, 0.55, 0.62), (s * 0.26, 0.2, 0.3), 0.014, 0.014, n=4, rings=0)
        for z, r in ((0.3, 0.14), (0.9, 0.11)) if lod == 0 else ((0.3, 0.14),):
            _wheel(dark, None, s * 0.3, r, z, r, 0.05, 10 if lod == 0 else 4)
    _box(canopy, -0.24, 0.24, 0.5, 0.9, 0.4, 0.88)
    if lod == 0:
        _box(canopy, -0.24, 0.24, 0.55, 0.9, 0.34, 0.4)
    if lod == 0:
        _blob(canopy, (0, 0.8, 0.66), (0.28, 0.26, 0.3), segs=8, rings=4, floor=0.62)


def _people_builder(v: Variant, lod: int) -> list:
    P = _Parts()
    extra: list = []
    if v.id == "cyclist":
        _rider(P, lod)
        top = 1.72
    elif v.id == "parent_stroller":
        S = _Parts()
        _stroller(S, lod)
        extra = S.objs("stroller")
        _shift(extra, 0.45)  # the handle sits in the hands
        top = 1.7
        _figure(
            P,
            top,
            lod,
            sleeve="long",
            legs="long",
            hair="long",
            lean=0.1,
            head_fwd=0.03,
            stride=0.12,
            reach=(0.14, 1.0, 0.55),
            hs=0.97,
        )
    else:
        cfg = dict(PEOPLE[v.id])
        top = cfg.pop("H")
        _figure(P, top, lod, stride=STRIDE.get(v.id, 0.13), **cfg)
    objs = P.objs("person") + extra
    _stand(objs, top)
    return objs


# vehicles -------------------------------------------------------------------------------
# glTF frame: length along z, front at +z, x = width. Lamps (role light): B 0.25 at the front
# (headlights, warm white) and 0.75 at the rear (tail lights, red). All bodies are unbranded.


def _loft(m: _Mesh, secs: Sequence[tuple[float, float, float, float, float]], caps: bool = True):
    """A chain of hexahedra through sections (z, y_bottom, y_top, half_w_bottom, half_w_top)."""

    def corners(s):
        z, y0, y1, w0, w1 = s
        return [(-w0, y0, z), (w0, y0, z), (w1, y1, z), (-w1, y1, z)]

    last = len(secs) - 2
    for i in range(len(secs) - 1):
        a, b = corners(secs[i]), corners(secs[i + 1])
        skip = ["bottom"]
        if i > 0 or not caps:
            skip.append("s0")
        if i < last or not caps:
            skip.append("s2")
        m.hexa([a[0], a[1], b[1], b[0], a[3], a[2], b[2], b[3]], skip)


CARS: dict[str, dict] = {
    "hatchback": dict(
        L=3.85,
        hw=0.78,
        belt=0.86,
        roof=1.5,
        cf=0.2,
        wt=0.04,
        rt=-0.3,
        rb=-0.485,
        ax=(0.72, 0.68),
        r=0.29,
        drop=0.0,
    ),
    "city_car": dict(
        L=3.7,
        hw=0.75,
        belt=0.84,
        roof=1.48,
        cf=0.21,
        wt=0.06,
        rt=-0.28,
        rb=-0.48,
        ax=(0.7, 0.65),
        r=0.28,
        drop=0.0,
    ),
    "sedan": dict(
        L=4.6,
        hw=0.82,
        belt=0.88,
        roof=1.43,
        cf=0.18,
        wt=0.0,
        rt=-0.16,
        rb=-0.3,
        ax=(0.85, 0.9),
        r=0.31,
        drop=0.08,
    ),
    "mpv": dict(
        L=4.7,
        hw=0.82,
        belt=0.9,
        roof=1.68,
        cf=0.22,
        wt=0.12,
        rt=-0.4,
        rb=-0.485,
        ax=(0.85, 0.9),
        r=0.31,
        drop=0.0,
    ),
    "pickup": dict(
        L=5.25,
        hw=0.9,
        belt=1.0,
        roof=1.78,
        cf=0.17,
        wt=0.05,
        rt=-0.07,
        rb=None,
        ax=(1.05, 1.1),
        r=0.36,
        drop=0.0,
    ),
}


def _car(v: Variant, lod: int) -> list:
    p = CARS[v.id]
    L, hw, belt, roof, r = p["L"], p["hw"], p["belt"], p["roof"], p["r"]
    H2, drop = L / 2, p["drop"]
    pick = v.id == "pickup"
    P = _Parts(0.0)
    body, glass, dark, metal = P.m("primary"), P.m("glass"), P.m("dark"), P.m("metal")
    head, tail = P.m("light", 0.25), P.m("light", 0.75)
    rear_z = p["rt"] * L - 0.04 * L if pick else -H2 + 0.04
    lower = [
        (H2 - 0.04, 0.34, belt - 0.2, hw * 0.92, hw * 0.9),
        (H2 - 0.3, 0.27, belt - 0.04, hw, hw * 0.97),
        (p["cf"] * L, 0.27, belt, hw, hw * 0.96),
        (rear_z + (0.0 if pick else 0.35), 0.27, belt - drop, hw, hw * 0.95),
    ]
    if not pick:
        lower.append((rear_z, 0.34, belt - drop, hw * 0.92, hw * 0.9))
    if lod > 0:
        lower = [lower[0], lower[2], lower[-1]]
    _loft(body, lower)
    cab = [
        (p["cf"] * L, belt, belt + 0.04, hw * 0.96, hw * 0.9),
        (p["wt"] * L, belt, roof, hw * 0.94, hw * 0.82),
        (p["rt"] * L, belt, roof, hw * 0.94, hw * 0.82),
    ]
    if p["rb"] is not None:
        cab.append((p["rb"] * L, belt - drop, belt + 0.1, hw * 0.93, hw * 0.86))
    _loft(glass, cab)
    zw, zr = p["wt"] * L, p["rt"] * L
    _loft(
        body,
        [
            (zw, roof, roof + 0.05, hw * 0.83, hw * 0.83),
            (zr, roof, roof + 0.05, hw * 0.83, hw * 0.83),
        ],
    )
    zb = (zw + zr) / 2
    for s in (1.0, -1.0):
        z = p["cf"] * L - 0.12  # mirrors
        _sbox(body, s, hw * 0.95, hw + 0.1, belt + 0.02, belt + 0.12, z - 0.08, z + 0.06)
        if lod > 0:
            continue
        _limb(
            body,
            (s * hw * 0.96, belt, p["cf"] * L),
            (s * hw * 0.83, roof, zw),
            0.03,
            0.026,
            n=4,
            rings=0,
        )
        _limb(
            body, (s * hw * 0.935, belt, zb), (s * hw * 0.825, roof, zb), 0.026, 0.024, n=4, rings=0
        )
        _limb(body, (s * hw * 0.94, belt, zr), (s * hw * 0.82, roof, zr), 0.04, 0.03, n=4, rings=0)
        _sbox(metal, s, hw - 0.01, hw + 0.02, belt - 0.14, belt - 0.1, zb - 0.35, zb - 0.15)
        _sbox(dark, s, hw - 0.03, hw + 0.012, 0.27, 0.35, -H2 + 0.9, H2 - 0.9)
        if v.id == "mpv":
            _sbox(metal, s, hw * 0.78 - 0.015, hw * 0.78 + 0.015, roof + 0.05, roof + 0.09, zw, zr)
    _box(dark, -hw * 0.9, hw * 0.9, 0.3, 0.44, H2 - 0.08, H2)
    _box(dark, -hw * 0.9, hw * 0.9, 0.3, 0.44, -H2, -H2 + 0.08)
    if lod == 0:
        _box(dark, -0.32, 0.32, 0.46, 0.58, H2 - 0.05, H2 - 0.03)
        _box(metal, -0.28, 0.28, 0.6, 0.63, H2 - 0.05, H2 - 0.03)
    for s in (1.0, -1.0):
        _sbox(head, s, hw * 0.5, hw * 0.9, belt - 0.34, belt - 0.2, H2 - 0.07, H2)
        _sbox(tail, s, hw * 0.5, hw * 0.9, belt - 0.28 - drop, belt - 0.14 - drop, -H2, -H2 + 0.05)
    if pick:  # open bed
        wl, bz1 = hw - 0.07, rear_z
        for s in (1.0, -1.0):
            _sbox(body, s, wl, hw, 0.27, belt + 0.16, -H2 + 0.01, bz1)
        _box(body, -wl, wl, 0.27, belt + 0.16, -H2 + 0.01, -H2 + 0.07)
        _box(dark, -wl, wl, 0.66, 0.74, -H2 + 0.07, bz1)
    n = 14 if lod == 0 else 8
    for s in (1.0, -1.0):
        for z in (H2 - p["ax"][0], -H2 + p["ax"][1]):
            _wheel(dark, metal, s * (hw - 0.07), r, z, r, 0.2, n)
    return P.objs("car")


def _motorcycle(v: Variant, lod: int) -> list:
    P = _Parts(0.0)
    body, dark, metal = P.m("primary"), P.m("dark"), P.m("metal")
    head, tail = P.m("light", 0.25), P.m("light", 0.75)
    r, wz = 0.3, 0.65
    n = 12 if lod == 0 else 7
    for z in (wz, -wz):
        _tube(dark, [(-0.055, r, z), (0.055, r, z)], [r, r], n, cap_bottom=True)
        _tube(
            metal,
            [(-0.07, r, z), (0.07, r, z)],
            [0.13, 0.13],
            6 if lod == 0 else 4,
            cap_bottom=True,
        )
    for s in (1.0, -1.0):
        _limb(
            metal,
            (s * 0.09, r, wz),
            (s * 0.1, 0.98, 0.4),
            0.02,
            0.025,
            n=5 if lod == 0 else 4,
            rings=0,
        )
    _tube(metal, [(-0.36, 1.02, 0.38), (0.36, 1.02, 0.38)], [0.016, 0.016], 5)
    _tube(dark, [(-0.4, 1.02, 0.38), (-0.3, 1.02, 0.38)], [0.022, 0.022], 5)
    _tube(dark, [(0.3, 1.02, 0.38), (0.4, 1.02, 0.38)], [0.022, 0.022], 5)
    _box(head, -0.09, 0.09, 0.82, 0.97, 0.38, 0.5)
    _blob(
        body,
        (0, 0.82, 0.1),
        (0.16, 0.14, 0.3),
        segs=8 if lod == 0 else 6,
        rings=4 if lod == 0 else 3,
    )
    _box(dark, -0.14, 0.14, 0.76, 0.84, -0.52, -0.05)
    _box(metal, -0.1, 0.1, 0.28, 0.52, -0.12, 0.22)
    _limb(metal, (0, 0.34, 0.2), (0, 0.78, 0.36), 0.02, 0.02, n=4, rings=0)
    _limb(metal, (0, 0.34, -0.1), (0, 0.76, -0.5), 0.02, 0.02, n=4, rings=0)
    _tube(metal, [(0.15, 0.3, 0.0), (0.17, 0.34, -0.7)], [0.035, 0.03], 6 if lod == 0 else 4)
    _box(body, -0.1, 0.1, 0.62, 0.66, -0.78, -0.4)
    if v.id == "delivery_motorcycle":  # a plain rear box, no lettering
        _box(metal, -0.2, 0.2, 0.84, 0.88, -0.98, -0.34)
        _box(body, -0.28, 0.28, 0.88, 1.3, -1.0, -0.36)
        _box(dark, -0.29, 0.29, 1.24, 1.28, -1.01, -0.35)
        _box(tail, -0.2, 0.2, 0.96, 1.04, -1.03, -1.0)
    else:
        _box(tail, -0.08, 0.08, 0.66, 0.72, -0.68, -0.62)
    return P.objs("moto")


def _bus(v: Variant, lod: int) -> list:
    P = _Parts(0.0)
    body, glass, dark, metal = P.m("primary"), P.m("glass"), P.m("dark"), P.m("metal")
    head, tail = P.m("light", 0.25), P.m("light", 0.75)
    H2 = 5.75
    _loft(
        body,
        [
            (5.7, 0.55, 2.9, 1.2, 1.15),
            (5.45, 0.45, 3.1, 1.25, 1.2),
            (-5.45, 0.45, 3.1, 1.25, 1.2),
            (-5.7, 0.55, 2.9, 1.2, 1.15),
        ],
    )
    wx = 1.225
    for s in (1.0, -1.0):
        if lod == 0:
            for k in range(8):  # windows from the door back
                z = 3.5 - 1.15 * k
                _sbox(glass, s, wx, wx + 0.03, 1.35, 2.5, z - 0.5, z + 0.5, bottom=True)
            _sbox(dark, s, wx, wx + 0.03, 0.6, 2.55, 4.55, 4.62)
        else:
            _sbox(glass, s, wx, wx + 0.03, 1.35, 2.5, -4.6, 4.0, bottom=True)
    _box(glass, -1.0, 1.0, 1.4, 2.8, 5.62, 5.71, bottom=True)
    _box(glass, -1.0, 1.0, 1.5, 2.7, -5.71, -5.62, bottom=True)
    _box(dark, -0.9, 0.9, 2.82, 3.0, 5.62, 5.71)
    _box(dark, -1.2, 1.2, 0.45, 0.75, 5.65, H2)
    _box(dark, -1.2, 1.2, 0.45, 0.75, -H2, -5.65)
    _box(metal, -0.7, 0.7, 3.1, 3.2, -2.0, 0.6)
    for s in (1.0, -1.0):
        _sbox(head, s, 0.75, 1.1, 0.8, 0.98, 5.68, H2)
        _sbox(tail, s, 0.75, 1.1, 0.9, 1.1, -H2, -5.68)
        _sbox(metal, s, 1.25, 1.55, 1.9, 2.4, 5.2, 5.28)  # mirror arm
        _sbox(metal, s, 1.5, 1.58, 1.7, 2.5, 5.18, 5.3)
    n = 16 if lod == 0 else 8
    for s in (1.0, -1.0):
        for z in (3.9, -3.3):
            _wheel(dark, metal, s * 1.1, 0.5, z, 0.5, 0.3, n)
    return P.objs("bus")


def _lorry(v: Variant, lod: int) -> list:
    P = _Parts(0.0)
    body, glass, dark, metal = P.m("primary"), P.m("glass"), P.m("dark"), P.m("metal")
    head, tail = P.m("light", 0.25), P.m("light", 0.75)
    _box(body, -0.98, 0.98, 0.8, 3.0, 2.4, 3.95)  # cab-over cab
    _box(glass, -0.82, 0.82, 1.7, 2.7, 3.94, 3.98, bottom=True)
    _box(dark, -0.6, 0.6, 1.05, 1.5, 3.94, 3.97)
    _box(dark, -1.0, 1.0, 0.55, 0.85, 3.88, 4.0)
    _box(dark, -0.9, 0.9, 0.55, 0.85, -4.0, -3.88)
    _box(body, -1.15, 1.15, 0.95, 3.2, -3.95, 2.25)  # cargo box
    _box(dark, -0.8, 0.8, 0.6, 0.95, -3.9, 3.8)  # chassis
    for s in (1.0, -1.0):
        _sbox(glass, s, 0.98, 1.01, 1.7, 2.6, 3.0, 3.75, bottom=True)
        _sbox(head, s, 0.64, 0.94, 0.95, 1.2, 3.93, 4.0)
        _sbox(tail, s, 0.85, 1.07, 1.05, 1.25, -4.0, -3.95)
        _sbox(metal, s, 1.0, 1.35, 1.8, 2.3, 3.7, 3.78)
        if lod == 0:
            for k in range(10):
                z = -3.6 + k * 0.6
                _sbox(metal, s, 1.15, 1.18, 1.0, 3.15, z - 0.03, z + 0.03)
    n = 16 if lod == 0 else 8
    for s in (1.0, -1.0):
        _wheel(dark, metal, s * 0.92, 0.5, 2.8, 0.5, 0.3, n)
        _wheel(dark, metal, s * 0.92, 0.5, -2.4, 0.5, 0.3, n)
        _wheel(dark, None, s * 0.6, 0.5, -2.4, 0.5, 0.3, n)
    return P.objs("lorry")


def _vehicle_builder(v: Variant, lod: int) -> list:
    if v.id in CARS:
        return _car(v, lod)
    if v.id in ("motorcycle", "delivery_motorcycle"):
        return _motorcycle(v, lod)
    if v.id == "bus":
        return _bus(v, lod)
    if v.id == "lorry":
        return _lorry(v, lod)
    raise KeyError(f"no vehicle builder for {v.id!r}")


# --- construction -------------------------------------------------------------------------
# Equipment is role `primary` (yellow by palette), lattice and rails `metal`, tyres, tracks and
# counterweights `dark`, cabs `glass`. Aux B is 0 everywhere. Every LOD of a variant spans the
# same x/z extent and top height, so the bounds hold on all three LODs.


def _strut(m: _Mesh, p: Vec, q: Vec, r: float, trim: float, n: int = 4) -> None:
    """A thin tube p -> q whose ends stop `trim` short, so the cap vertices sit on the chord
    it joins instead of inside it (buried vertices bake to black AO)."""
    a, b = Vector(p), Vector(q)
    d = (b - a).normalized()
    _tube(m, [tuple(a + d * trim), tuple(b - d * trim)], [r, r], n)


def _truss(m: _Mesh, a: Vec, b: Vec, w: float, h: float, step: float, r: float, diag: bool) -> None:
    """A triangular truss along a -> b (level in y/z): two lower chords at +-w/2 (z) at the
    level of `a`, one top chord h above, cross rings every `step` m and zig-zag diagonals."""
    x0, x1 = a[0], b[0]
    y0, z0 = a[1], a[2]
    for z in (z0 - w / 2, z0 + w / 2):
        _tube(m, [(x0, y0, z), (x1, y0, z)], [r, r], 4)
    _tube(m, [(x0, y0 + h, z0), (x1, y0 + h, z0)], [r, r], 4)
    n = max(1, round(abs(x1 - x0) / step))
    t = r * 1.1
    for i in range(1, n):
        x = x0 + (x1 - x0) * i / n
        lo_l, lo_r, top = (x, y0, z0 - w / 2), (x, y0, z0 + w / 2), (x, y0 + h, z0)
        _strut(m, lo_l, lo_r, r * 0.7, t)
        _strut(m, lo_l, top, r * 0.6, t)
        _strut(m, lo_r, top, r * 0.6, t)
        if diag:
            xn = x0 + (x1 - x0) * (i + 1) / n
            for z in (z0 - w / 2, z0 + w / 2):
                _strut(m, (x, y0, z), (xn, y0 + h, z0), r * 0.5, t)


def _tower_crane(v: Variant, lod: int) -> list:
    P = _Parts(0.0)
    body, metal, dark, glass = P.m("primary"), P.m("metal"), P.m("dark"), P.m("glass")
    mx, top, jtip, ctip = -12.0, 50.0, 20.25, -20.25  # mast x; apex; jib tip; counter-jib end
    h0, h1 = 0.5, 45.0
    if lod == 2:  # 5 boxes, 50 tris
        _box(dark, mx - 2.0, mx + 2.0, 0.0, 0.5, -2.0, 2.0)
        _box(body, mx - 0.9, mx + 0.9, h0, h1, -0.9, 0.9)
        _box(body, ctip, jtip, 45.8, 47.2, -0.65, 0.65)
        _box(dark, ctip, ctip + 2.5, 44.7, 46.8, -1.1, 1.1)
        _box(body, mx - 0.4, mx + 0.4, 47.2, top, -0.4, 0.4)
        return P.objs("tower_crane")
    _box(dark, mx - 2.0, mx + 2.0, 0.0, h0, -2.0, 2.0)
    for sx in (-0.9, 0.9):
        for sz in (-0.9, 0.9):
            _tube(body, [(mx + sx, h0, sz), (mx + sx, h1, sz)], [0.09, 0.09], 4)
    levels = 15 if lod == 0 else 2
    corners = ((-0.9, -0.9), (0.9, -0.9), (0.9, 0.9), (-0.9, 0.9))
    for i in range(levels + 1):
        y = h0 + (h1 - h0 - 0.2) * i / levels
        for (ax, az), (bx, bz) in zip(corners, corners[1:] + corners[:1], strict=True):
            _strut(body, (mx + ax, y, az), (mx + bx, y, bz), 0.05, 0.1)
            if lod == 0 and i < levels:
                y2 = h0 + (h1 - h0 - 0.2) * (i + 1) / levels
                _strut(body, (mx + ax, y, az), (mx + bx, y2, bz), 0.045, 0.1)
    _box(dark, mx - 1.2, mx + 1.2, h1, h1 + 0.8, -1.2, 1.2)  # slewing ring
    _box(body, mx - 1.2, mx + 1.2, h1 + 0.8, h1 + 1.0, -1.2, 1.2)
    # operator cab, beside the mast
    _box(body, mx - 1.3, mx - 0.3, h1 + 0.8, h1 + 2.7, 1.2, 2.0)
    _box(glass, mx - 1.2, mx - 0.4, h1 + 1.3, h1 + 2.5, 2.0, 2.04, bottom=True)
    # apex (cathead)
    for sx in (-0.8, 0.8):
        for sz in (-0.8, 0.8):
            _tube(body, [(mx + sx, h1 + 1.0, sz), (mx, top, 0.0)], [0.08, 0.02], 4, cap_top=False)
    # jib and counter jib
    jy = h1 + 0.8
    _truss(
        body,
        (mx, jy, 0.0),
        (jtip - 0.25, jy, 0.0),
        1.3,
        1.6,
        2.25 if lod == 0 else 11.0,
        0.07,
        lod == 0,
    )
    _truss(
        body,
        (ctip + 0.25, jy, 0.0),
        (mx, jy, 0.0),
        1.3,
        1.6,
        2.0 if lod == 0 else 8.0,
        0.07,
        lod == 0,
    )
    _box(body, jtip - 0.25, jtip, jy, jy + 1.0, -0.4, 0.4)  # tip plate
    _box(dark, ctip, ctip + 2.5, jy - 1.1, jy + 1.0, -1.1, 1.1)  # counterweights
    if lod == 0:
        for k in range(3):
            _box(dark, ctip + 2.6 + k * 0.9, ctip + 3.4 + k * 0.9, jy - 0.6, jy + 0.1, -0.6, 0.6)
    # pendants, trolley, hook
    for tx in (8.0, 18.0):
        _tube(metal, [(mx, top - 0.1, 0.0), (tx, jy + 1.6, 0.0)], [0.03, 0.03], 4)
    _tube(metal, [(mx, top - 0.1, 0.0), (ctip + 2.0, jy + 1.6, 0.0)], [0.03, 0.03], 4)
    _box(dark, 11.5, 12.5, jy - 0.5, jy, -0.5, 0.5)
    _tube(metal, [(12.0, jy - 0.5, 0.0), (12.0, 22.0, 0.0)], [0.025, 0.025], 4)
    _box(dark, 11.7, 12.3, 21.0, 22.0, -0.3, 0.3)
    return P.objs("tower_crane")


def _mobile_crane(v: Variant, lod: int) -> list:
    P = _Parts(0.0)
    body, metal, dark, glass = P.m("primary"), P.m("metal"), P.m("dark"), P.m("glass")
    _box(dark, -1.2, 1.2, 0.55, 1.1, -6.2, 5.9)  # chassis
    _box(body, -1.4, 1.4, 1.1, 2.0, -6.2, 2.2)  # carrier deck
    _box(body, -1.3, 1.3, 1.1, 3.0, 3.2, 5.5)  # cab
    _box(body, -0.6, 0.6, 2.9, 4.0, -6.2, 0.2)  # boom base section
    _box(body, -0.5, 0.5, 3.0, 3.9, 0.2, 5.4)
    if lod == 2:
        _box(dark, -1.0, 1.0, 0.0, 0.55, -5.5, 5.9)  # wheels as one block
        return P.objs("mobile_crane")
    _box(glass, -1.15, 1.15, 1.9, 2.8, 5.5, 5.54, bottom=True)
    _box(body, -0.9, 0.9, 2.0, 2.9, -2.4, -0.6)  # turntable housing
    n = 16 if lod == 0 else 8
    for z in (-4.6, -3.4, -2.2, 3.8, 5.0):
        for s in (1.0, -1.0):
            _wheel(dark, metal if lod == 0 else None, s * 1.25, 0.55, z, 0.55, 0.3, n)
    _box(dark, -1.4, 1.4, 0.7, 0.95, -4.0, -3.7)  # stowed outriggers
    _box(dark, -1.4, 1.4, 0.7, 0.95, 1.4, 1.7)
    _box(metal, -0.5, 0.5, 3.55, 3.85, 5.4, 5.7)  # boom-head sheave
    for s in (1.0, -1.0):
        _sbox(metal, s, 1.0, 1.1, 2.9, 3.3, 5.5, 5.58)  # mirror arm
    if lod == 0:
        for k in range(6):  # boom side ribs
            z = -5.0 + k * 1.0
            _sbox(metal, 1.0, 0.6, 0.64, 3.0, 3.9, z, z + 0.08)
            _sbox(metal, -1.0, 0.6, 0.64, 3.0, 3.9, z, z + 0.08)
        _box(dark, -1.0, 1.0, 0.7, 1.0, 5.5, 5.9)  # front bumper
        _box(dark, -0.7, 0.7, 4.0, 4.15, -3.0, -1.0)  # hook block stowed on the boom
    return P.objs("mobile_crane")


def _excavator(v: Variant, lod: int) -> list:
    P = _Parts(0.0)
    body, metal, dark, glass = P.m("primary"), P.m("metal"), P.m("dark"), P.m("glass")
    for s in (1.0, -1.0):
        _sbox(dark, s, 1.0, 1.5, 0.0, 0.9, -2.4, 2.4)  # tracks
    _box(body, -1.4, 1.4, 1.0, 2.1, -3.3, 1.2)  # house
    _box(dark, -1.3, 1.3, 1.1, 2.2, -4.5, -3.3)  # counterweight
    _box(dark, -0.5, 0.5, 0.25, 0.95, 3.9, 4.5)  # bucket
    if lod == 2:
        _box(body, -0.25, 0.25, 1.5, 3.17, 0.5, 4.2)  # boom and arm
        return P.objs("excavator")
    _box(dark, -1.0, 1.0, 0.7, 1.0, -1.8, 1.8)  # undercarriage
    _box(body, -1.4, -0.3, 2.1, 3.1, 0.1, 1.2)  # cab
    _box(glass, -1.3, -0.4, 2.2, 3.0, 1.2, 1.24, bottom=True)

    n = 8 if lod == 0 else 5
    _tube(
        body, [(0, 1.7, 0.5), (0, 2.6, 1.8), (0, 2.95, 3.4)], [0.22, 0.22, 0.22], n, cap_bottom=True
    )
    _tube(body, [(0, 2.95, 3.4), (0, 1.8, 4.0), (0, 0.9, 4.2)], [0.18, 0.16, 0.14], n)
    if lod == 0:
        _tube(metal, [(0.25, 1.4, 0.7), (0.25, 2.5, 2.1)], [0.06, 0.06], 6)  # boom cylinder
        _tube(metal, [(0.25, 3.2, 2.2), (0.25, 2.9, 3.3)], [0.05, 0.05], 6)
        _tube(metal, [(0.25, 2.3, 3.6), (0.25, 1.3, 4.1)], [0.05, 0.05], 6)
        for s in (1.0, -1.0):
            for z in (-2.0, -1.0, 0.0, 1.0, 2.0):
                _wheel(metal, None, s * 1.0, 0.3, z, 0.22, 0.12, 8)
            _sbox(metal, s, 1.0, 1.52, 0.9, 0.98, -2.4, 2.4)  # track guard
        _box(dark, -0.9, 0.9, 2.1, 2.3, -3.2, -1.4)  # engine hood
        _box(metal, 0.7, 0.85, 2.1, 3.1, -2.4, -2.3)  # exhaust
    else:
        for s in (1.0, -1.0):
            _sbox(dark, s, 1.0, 1.52, 0.9, 0.98, -2.4, 2.4)
    return P.objs("excavator")


def _cement_mixer(v: Variant, lod: int) -> list:
    P = _Parts(0.0)
    body, metal, dark, glass = P.m("primary"), P.m("metal"), P.m("dark"), P.m("glass")
    _box(dark, -0.9, 0.9, 0.6, 1.2, -4.3, 4.3)  # chassis
    _box(body, -1.2, 1.2, 1.0, 2.9, 2.5, 4.3)  # cab
    _box(dark, -1.1, 1.1, 0.6, 1.0, 4.2, 4.35)  # bumper
    if lod == 2:
        _box(body, -1.1, 1.1, 1.3, 3.7, -4.0, 1.8)
        return P.objs("cement_mixer")
    _box(glass, -1.05, 1.05, 1.7, 2.7, 4.3, 4.34, bottom=True)
    _box(dark, -1.0, 1.0, 1.2, 1.5, -4.3, -3.6)  # rear support
    n = 14 if lod == 0 else 8
    drum = [(0, 1.75, 1.8), (0, 2.2, -0.4), (0, 2.55, -2.2), (0, 2.7, -4.0)]
    _tube(body, drum, [0.5, 1.15, 1.15, 0.55], n, cap_bottom=True)
    _tube(metal, [(0, 2.45, -3.9), (0, 1.3, -4.3)], [0.18, 0.18], 6)  # chute
    wn = 16 if lod == 0 else 8
    for s in (1.0, -1.0):
        for z in (3.2, -1.4, -2.7):
            _wheel(dark, metal if lod == 0 else None, s * 1.0, 0.55, z, 0.55, 0.3, wn)
    if lod == 0:
        for z, y in ((0.2, 2.3), (-1.2, 2.42)):  # hoop bands
            _tube(metal, [(0, y, z), (0, y + 0.02, z - 0.1)], [1.19, 1.19], n, cap_bottom=True)
        _box(dark, -0.7, 0.7, 1.2, 1.6, -1.0, 0.8)  # drum pedestal
        for s in (1.0, -1.0):
            _sbox(metal, s, 1.2, 1.3, 1.9, 2.4, 4.2, 4.28)  # mirror
            _sbox(metal, s, 0.7, 0.75, 1.4, 3.0, -4.25, -4.15)  # ladder rail
        for k in range(5):
            y = 1.5 + k * 0.35
            _box(metal, -0.7, 0.7, y, y + 0.04, -4.25, -4.15)
    return P.objs("cement_mixer")


def _site_cabin(v: Variant, lod: int) -> list:
    P = _Parts(0.0)
    body, metal, dark, glass = P.m("primary"), P.m("metal"), P.m("dark"), P.m("glass")
    _box(dark, -1.2, 1.2, 0.0, 0.3, -3.0, 3.0)  # skid base
    _box(body, -1.2, 1.2, 0.3, 2.5, -3.0, 3.0)  # body
    _box(metal, -1.2, 1.2, 2.5, 2.6, -3.0, 3.0)  # roof
    if lod == 2:
        return P.objs("site_cabin")
    _box(dark, -0.5, 0.5, 0.3, 2.2, 3.0, 3.04)  # door (front +z)
    for s in (1.0, -1.0):
        for z in (-1.8, 0.0, 1.8):
            _sbox(glass, s, 1.2, 1.24, 1.2, 2.0, z - 0.5, z + 0.5, bottom=True)
    if lod == 0:
        for s in (1.0, -1.0):
            for z in (-1.8, 0.0, 1.8):
                _sbox(dark, s, 1.2, 1.26, 1.15, 1.2, z - 0.55, z + 0.55)  # sills
        _box(metal, -0.7, 0.7, 0.0, 0.3, 3.0, 3.5)  # steps
        _box(dark, -0.5, 0.5, 2.6, 2.75, -2.6, -2.2)  # AC unit
        _box(metal, 0.5, 0.56, 0.3, 1.1, 3.0, 3.6)  # handrail
    return P.objs("site_cabin")


def _hoarding(v: Variant, lod: int) -> list:
    """A blank 6 m panel segment on posts and feet. No text, no print, no images."""
    P = _Parts(0.0)
    body, metal, dark = P.m("primary"), P.m("metal"), P.m("dark")
    _box(body, -3.0, 3.0, 0.2, 2.4, -0.05, 0.05)
    _box(dark, -3.0, 3.0, 0.0, 0.2, -0.1, 0.1)  # plinth
    if lod == 2:
        return P.objs("hoarding_6m")
    for x in (-2.9, 2.9) if lod == 1 else (-2.9, -1.0, 1.0, 2.9):
        _box(metal, x - 0.06, x + 0.06, 0.0, 2.4, 0.05, 0.17)
    for x in (-2.7, 2.7):
        _box(dark, x - 0.3, x + 0.3, 0.0, 0.1, -0.3, 0.6)  # feet
    if lod == 0:
        _box(metal, -3.0, 3.0, 2.4, 2.46, -0.07, 0.07)  # top rail
        _box(metal, -3.0, 3.0, 1.1, 1.16, 0.05, 0.12)  # mid rail
        for x in (-2.7, 2.7):
            _tube(metal, [(x, 0.1, 0.35), (x, 1.5, 0.15)], [0.03, 0.03], 5)  # prop
    return P.objs("hoarding_6m")


def _scaffold_bay(v: Variant, lod: int) -> list:
    P = _Parts(0.0)
    body, metal, dark = P.m("primary"), P.m("metal"), P.m("dark")
    X, Z, H = 1.25, 0.6, 6.0
    lifts = (0.4, 2.4, 4.4)
    if lod == 2:
        _box(metal, -X, -X + 0.1, 0.0, H, -Z, -Z + 0.1)
        _box(metal, X - 0.1, X, 0.0, H, Z - 0.1, Z)
        _box(dark, -X, X, 4.4, 4.5, -Z, Z)
        _box(body, -X, X, 5.4, 5.5, Z - 0.05, Z)
        return P.objs("scaffold_bay")
    n = 6 if lod == 0 else 4
    for sx in (-X + 0.05, X - 0.05):
        for sz in (-Z + 0.05, Z - 0.05):
            _tube(metal, [(sx, 0.0, sz), (sx, H, sz)], [0.024, 0.024], n)
    for y in lifts:
        _box(dark, -X, X, y, y + 0.05, -Z, Z)  # deck boards
    for y in (0.2, 2.2, 4.2, 5.4) if lod == 0 else (2.2, 4.2, 5.4):
        for sz in (-Z + 0.05, Z - 0.05):
            _tube(metal, [(-X + 0.05, y, sz), (X - 0.05, y, sz)], [0.02, 0.02], 4)
        if lod == 0:
            for sx in (-X + 0.05, X - 0.05):
                _tube(metal, [(sx, y, -Z + 0.05), (sx, y, Z - 0.05)], [0.02, 0.02], 4)
    for sz in (-Z + 0.05, Z - 0.05):  # guard rails: top rails are the high-visibility yellow
        _tube(body, [(-X + 0.05, 5.5, sz), (X - 0.05, 5.5, sz)], [0.028, 0.028], 4)
    _tube(body, [(-X + 0.05, 3.5, Z - 0.05), (X - 0.05, 3.5, Z - 0.05)], [0.028, 0.028], 4)
    for y0, y1 in ((0.4, 2.4), (2.4, 4.4)):  # facade braces
        _tube(metal, [(-X + 0.05, y0, Z - 0.05), (X - 0.05, y1, Z - 0.05)], [0.02, 0.02], 4)
    if lod == 0:
        for y in lifts:
            _box(dark, -X, X, y + 0.05, y + 0.2, Z - 0.05, Z)  # toe boards
        for k in range(8):
            y = 0.6 + k * 0.25
            _tube(metal, [(-0.45, y, Z), (-0.3, y, Z)], [0.012, 0.012], 3)
        for sx in (-X + 0.05, X - 0.05):
            _box(dark, sx - 0.08, sx + 0.08, 0.0, 0.03, -Z, Z)  # base plates
    return P.objs("scaffold_bay")


def _material_stack(v: Variant, lod: int) -> list:
    P = _Parts(0.0)
    body, metal, dark = P.m("primary"), P.m("metal"), P.m("dark")
    _box(dark, -1.2, 1.2, 0.0, 0.15, -0.6, 0.6)  # pallet
    if lod >= 1:
        _box(body, -1.15, 1.15, 0.15, 1.2, -0.55, 0.55)
        if lod == 1:
            _box(metal, -1.17, 1.17, 0.5, 0.56, -0.57, 0.57)
        return P.objs("material_stack")
    for layer in range(6):
        y0 = 0.15 + layer * 0.175
        off = 0.0 if layer % 2 == 0 else 0.2
        for i in range(6):
            x0 = -1.15 + off + i * 0.38
            if x0 + 0.36 > 1.17:
                continue
            for z0 in (-0.55, 0.01):
                _box(body, x0, x0 + 0.36, y0, y0 + 0.165, z0, z0 + 0.54)
    for y in (0.5, 0.9):  # strapping
        _box(metal, -1.17, 1.17, y, y + 0.04, -0.57, 0.57)
    return P.objs("material_stack")


CONSTRUCTION: dict[str, Callable[[Variant, int], list]] = {
    "tower_crane": _tower_crane,
    "mobile_crane": _mobile_crane,
    "excavator": _excavator,
    "cement_mixer": _cement_mixer,
    "site_cabin": _site_cabin,
    "hoarding_6m": _hoarding,
    "scaffold_bay": _scaffold_bay,
    "material_stack": _material_stack,
}


def _construction_builder(v: Variant, lod: int) -> list:
    if v.id not in CONSTRUCTION:
        raise KeyError(f"no construction builder for {v.id!r}")
    return CONSTRUCTION[v.id](v, lod)


BUILDERS: dict[str, Callable[[Variant, int], list]] = {
    "trees": _tree_builder,
    "furniture": _furniture_builder,
    "people": _people_builder,
    "vehicles": _vehicle_builder,
    "construction": _construction_builder,
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
