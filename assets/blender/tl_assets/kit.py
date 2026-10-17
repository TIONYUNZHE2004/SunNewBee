"""The parametric building kit (imports bpy; runs only inside Blender 5.2).

Every function returns a list of Blender objects that already carry their role (`COLOR_0`), so
a builder only concatenates lists and `core.join`s them. All sizes are metres in the glTF
frame: x = width, y = up, z = towards the frontage (glTF +z == Blender -y).

Two anchoring conventions:
- **Footprint-centred** (`walls`, the roofs, `solar_panels`, `far_block`, `ac_units`): the
  origin is the centre of the footprint on the ground.
- **Front-anchored** (`window`, `car_porch`, `five_foot_way`, `balcony`, `gate_and_fence`,
  `sign_band`): built on a facade plane at z = 0, centred on x = 0, with "outside" towards +z.
  Move them with `place`.

Face-local coordinates for an `Opening`: `u` is the opening centre along the face, measured from
the face centre towards the right as seen from outside; `v` is the height of its bottom edge
above the ground; `w` and `h` are its width and height. Faces: `front` (+z, u along +x),
`back` (-z, u along -x), `right` (+x, u along -z), `left` (-x, u along +z).

Kept small on purpose: no bottom faces on parts that stand on the ground, no faces hidden
inside a wall, and LOD1 is built by the same code with `lod=1` (no frames, sills, rails or AC).
"""

import math
import random
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

import bpy
from mathutils import Matrix

from . import core

FACES = ("front", "back", "left", "right")
KINDS = ("window", "door", "garage", "shopfront")
ROOFS = ("gable", "hip", "flat", "mono")

FRAME_W = 0.06  # window and door frame bar width
RECESS = (0.15, 0.12)  # reveal depth per LOD (LOD2 has no openings)
EPS = 1e-6

Vec = tuple[float, float, float]


@dataclass(frozen=True)
class Opening:
    face: str  # front | back | left | right
    u: float  # centre along the face, from the face centre, rightwards seen from outside
    v: float  # bottom edge above the ground
    w: float
    h: float
    kind: str  # window | door | garage | shopfront

    def __post_init__(self) -> None:
        if self.face not in FACES:
            raise ValueError(f"opening face {self.face!r} not in {FACES}")
        if self.kind not in KINDS:
            raise ValueError(f"opening kind {self.kind!r} not in {KINDS}")
        if self.w <= 0 or self.h <= 0 or self.v < 0:
            raise ValueError(f"opening has no area or starts below ground: {self}")

    @property
    def rect(self) -> tuple[float, float, float, float]:
        """(u0, u1, v0, v1) on its face."""
        return (self.u - self.w / 2, self.u + self.w / 2, self.v, self.v + self.h)


# --- mesh building in the glTF frame -----------------------------------------------------


class _Frame:
    """A facade plane: p(u, v, n) = origin + u * udir + v * up + n * ndir (n > 0 is outside)."""

    def __init__(self, origin: Vec, udir: Vec, ndir: Vec, length: float):
        self.origin, self.udir, self.ndir, self.length = origin, udir, ndir, length

    def p(self, u: float, v: float, n: float = 0.0) -> Vec:
        o, a, b = self.origin, self.udir, self.ndir
        return (o[0] + u * a[0] + n * b[0], o[1] + v, o[2] + u * a[2] + n * b[2])

    def vec(self, u: float, v: float, n: float) -> Vec:
        a, b = self.udir, self.ndir
        return (u * a[0] + n * b[0], v, u * a[2] + n * b[2])


CANONICAL = _Frame((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), 0.0)


def face_frame(face: str, w: float, d: float) -> _Frame:
    """The facade plane of `face` on a w × d footprint centred at the origin."""
    if face == "front":
        return _Frame((0.0, 0.0, d / 2), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), w)
    if face == "back":
        return _Frame((0.0, 0.0, -d / 2), (-1.0, 0.0, 0.0), (0.0, 0.0, -1.0), w)
    if face == "right":
        return _Frame((w / 2, 0.0, 0.0), (0.0, 0.0, -1.0), (1.0, 0.0, 0.0), d)
    if face == "left":
        return _Frame((-w / 2, 0.0, 0.0), (0.0, 0.0, 1.0), (-1.0, 0.0, 0.0), d)
    raise ValueError(f"face {face!r} not in {FACES}")


def _sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _mean(pts: Sequence[Vec]) -> Vec:
    n = len(pts)
    return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n, sum(p[2] for p in pts) / n)


def _newell(pts: Sequence[Vec]) -> Vec:
    nx = ny = nz = 0.0
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
    return (nx, ny, nz)


class _Mesh:
    """Collects glTF-frame faces (oriented by a normal hint) and becomes one Blender object."""

    def __init__(self) -> None:
        self.verts: list[Vec] = []
        self.index: dict[tuple[int, int, int], int] = {}
        self.faces: list[list[int]] = []

    def _v(self, p: Vec) -> int:
        key = (round(p[0] * 1e5), round(p[1] * 1e5), round(p[2] * 1e5))
        i = self.index.get(key)
        if i is None:
            i = self.index[key] = len(self.verts)
            self.verts.append(p)
        return i

    def face(self, pts: Sequence[Vec], normal: Vec) -> None:
        """Add a planar convex polygon; its winding is flipped to agree with `normal`."""
        idx: list[int] = []
        for p in pts:
            i = self._v(p)
            if not idx or idx[-1] != i:
                idx.append(i)
        if len(idx) > 1 and idx[0] == idx[-1]:
            idx.pop()
        if len(idx) < 3:
            return
        poly = [self.verts[i] for i in idx]
        if _dot(_newell(poly), normal) < 0:
            idx.reverse()
        self.faces.append(idx)

    def hexa(self, c: Sequence[Vec], skip: Iterable[str] = ()) -> None:
        """A convex hexahedron from 8 corners: bottom ring c[0:4], top ring c[4:8] above it.

        `skip` drops faces by name: "bottom", "top", "s0".."s3" (side i joins corners i, i+1).
        """
        skip = set(skip)
        centre = _mean(c)
        rings = {"bottom": c[0:4], "top": c[4:8]}
        for i in range(4):
            j = (i + 1) % 4
            rings[f"s{i}"] = (c[i], c[j], c[4 + j], c[4 + i])
        for name, pts in rings.items():
            if name not in skip:
                self.face(pts, _sub(_mean(pts), centre))

    def box(self, x0, x1, y0, y1, z0, z1, skip: Iterable[str] = ("bottom",)) -> None:
        """An axis-aligned box. Side names: s0 = -z (back), s1 = +x, s2 = +z (front), s3 = -x."""
        self.hexa(
            [
                (x0, y0, z0),
                (x1, y0, z0),
                (x1, y0, z1),
                (x0, y0, z1),
                (x0, y1, z0),
                (x1, y1, z0),
                (x1, y1, z1),
                (x0, y1, z1),
            ],
            skip,
        )

    def fbox(self, f: _Frame, u0, u1, v0, v1, n0, n1, skip: Iterable[str] = ()) -> None:
        """A box in a facade frame (u, v, n ranges)."""
        self.hexa(
            [
                f.p(u0, v0, n0),
                f.p(u1, v0, n0),
                f.p(u1, v0, n1),
                f.p(u0, v0, n1),
                f.p(u0, v1, n0),
                f.p(u1, v1, n0),
                f.p(u1, v1, n1),
                f.p(u0, v1, n1),
            ],
            skip,
        )

    def fquad(self, f: _Frame, u0, u1, v0, v1, n: float) -> None:
        """A quad in the facade plane at offset n, facing outside."""
        self.face([f.p(u0, v0, n), f.p(u1, v0, n), f.p(u1, v1, n), f.p(u0, v1, n)], f.vec(0, 0, 1))

    def fgrid(self, f: _Frame, u0, u1, v0, v1, n: float, cell: float | None) -> None:
        """`fquad` split into about cell × cell quads (interior vertices let AO vary)."""
        nu = max(1, round((u1 - u0) / cell)) if cell else 1
        nv = max(1, round((v1 - v0) / cell)) if cell else 1
        for i in range(nu):
            a, b = u0 + (u1 - u0) * i / nu, u0 + (u1 - u0) * (i + 1) / nu
            for j in range(nv):
                c, e = v0 + (v1 - v0) * j / nv, v0 + (v1 - v0) * (j + 1) / nv
                self.fquad(f, a, b, c, e, n)

    def obj(self, name: str, role: str, aux: float = 0.0):
        """The collected faces as one linked Blender object with `role` (None if empty)."""
        if not self.faces:
            return None
        me = bpy.data.meshes.new(name)
        me.from_pydata([core.to_blender(*p) for p in self.verts], [], self.faces)
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        core.set_role(ob, role, aux)
        return ob


def _keep(*objs) -> list:
    return [o for o in objs if o is not None]


def window_seed() -> float:
    """A per-window aux value strictly inside (0, 1) (from the build's seeded `random`)."""
    return 0.02 + 0.96 * random.random()


def place(objs: list, x: float = 0.0, y: float = 0.0, z: float = 0.0, rot_y_deg: float = 0.0):
    """Rotate about glTF y (through the origin), then translate, baking it into the meshes."""
    m = Matrix.Translation(core.to_blender(x, y, z)) @ Matrix.Rotation(
        math.radians(rot_y_deg), 4, "Z"
    )
    for o in objs:
        o.data.transform(m)
        o.data.update()
    return objs


# --- walls and openings -------------------------------------------------------------------


def _check_openings(face: str, length: float, h: float, openings: list[Opening]) -> None:
    rects = [o.rect for o in openings]
    for o, (u0, u1, _v0, v1) in zip(openings, rects, strict=True):
        if u0 < -length / 2 + 0.1 - EPS or u1 > length / 2 - 0.1 + EPS or v1 > h - 0.1 + EPS:
            raise ValueError(f"opening {o} does not fit the {face} face ({length} x {h})")
    for i, a in enumerate(rects):
        for b in rects[i + 1 :]:
            if a[0] < b[1] - EPS and b[0] < a[1] - EPS and a[2] < b[3] - EPS and b[2] < a[3] - EPS:
                raise ValueError(f"openings overlap on the {face} face: {a} and {b}")


def _breaks(lo: float, hi: float, edges: Iterable[float], step: float | None) -> list[float]:
    pts = {lo, hi, *edges}
    if step:
        n = max(1, round((hi - lo) / step))
        pts.update(lo + (hi - lo) * k / n for k in range(1, n))
    return sorted(p for p in {round(p, 5) for p in pts} if lo - EPS <= p <= hi + EPS)


def _wall_face(mesh: _Mesh, f: _Frame, h: float, rects, lod: int, recess: float) -> None:
    """The face as a grid of quads around the holes, plus a reveal on each hole's sides."""
    length = f.length
    us = _breaks(
        -length / 2,
        length / 2,
        [r[0] for r in rects] + [r[1] for r in rects],
        1.6 if lod == 0 else None,
    )
    vs = _breaks(0.0, h, [r[2] for r in rects] + [r[3] for r in rects], 1.2 if lod == 0 else None)
    for u0, u1 in zip(us, us[1:], strict=False):
        for v0, v1 in zip(vs, vs[1:], strict=False):
            um, vm = (u0 + u1) / 2, (v0 + v1) / 2
            if any(r[0] < um < r[1] and r[2] < vm < r[3] for r in rects):
                continue
            mesh.fquad(f, u0, u1, v0, v1, 0.0)
    for u0, u1, v0, v1 in rects:
        n0, n1 = -recess, 0.0
        if v0 > EPS:  # sill side (a door at ground level has none)
            mesh.face(
                [f.p(u0, v0, n0), f.p(u1, v0, n0), f.p(u1, v0, n1), f.p(u0, v0, n1)],
                (0.0, 1.0, 0.0),
            )
        mesh.face(
            [f.p(u0, v1, n0), f.p(u1, v1, n0), f.p(u1, v1, n1), f.p(u0, v1, n1)], (0.0, -1.0, 0.0)
        )
        mesh.face(
            [f.p(u0, v0, n0), f.p(u0, v1, n0), f.p(u0, v1, n1), f.p(u0, v0, n1)], f.vec(1, 0, 0)
        )
        mesh.face(
            [f.p(u1, v0, n0), f.p(u1, v1, n0), f.p(u1, v1, n1), f.p(u1, v0, n1)], f.vec(-1, 0, 0)
        )


def _fill(o: Opening, lod: int, f: _Frame, recess: float) -> list:
    """What sits in an opening, on frame `f`, recessed by `recess` behind the facade plane."""
    u0, u1, v0, v1 = o.rect
    back = -recess
    tag = f"{o.kind}_{o.face}"
    pane, frame, sill = _Mesh(), _Mesh(), _Mesh()
    # LOD0 panes are split into ~0.35 m cells and LOD1 into 2 × 2, so the AO bake has interior
    # vertices: a pane's four corners all sit in the reveal or frame crevice (AO near 0).
    cells = max(2, round(min(o.w, o.h) / 0.35)) if lod == 0 else 2
    pane.fgrid(f, u0, u1, v0, v1, back, min(o.w, o.h) / cells)
    fw, fd = FRAME_W, back + 0.07
    if lod == 0:  # frame bars drop the faces that lie against the pane or the reveal
        frame.fbox(f, u0, u1, v1 - fw, v1, back, fd, skip=("s0", "top", "s1", "s3"))  # head
        frame.fbox(f, u0, u0 + fw, v0, v1 - fw, back, fd, skip=("s0", "s3", "bottom", "top"))
        frame.fbox(f, u1 - fw, u1, v0, v1 - fw, back, fd, skip=("s0", "s1", "bottom", "top"))
        if o.kind != "door":
            frame.fbox(f, u0 + fw, u1 - fw, v0, v0 + fw, back, fd, skip=("s0", "bottom"))
        bar = ("s0", "bottom", "top")
        if o.kind == "window" and o.w >= 1.2:  # a mullion
            frame.fbox(f, o.u - fw / 2, o.u + fw / 2, v0 + fw, v1 - fw, back, fd, skip=bar)
        if o.kind == "shopfront":
            n = max(1, round(o.w / 1.5))
            for k in range(1, n):
                u = u0 + o.w * k / n
                frame.fbox(f, u - fw / 2, u + fw / 2, v0 + fw, v1 - fw, back, fd, skip=bar)
            if o.h > 2.8:  # a transom
                tv = v1 - 0.6
                frame.fbox(f, u0 + fw, u1 - fw, tv, tv + fw, back, fd, skip=("s0", "s1", "s3"))
        if o.kind == "window" and v0 >= 0.3:  # no sill on full-height glazing
            sill.fbox(f, u0 - 0.08, u1 + 0.08, v0 - 0.06, v0, back, 0.1, skip=("s0",))
    if o.kind in ("window", "shopfront"):
        glass = pane.obj(f"{tag}_glass", "glass", window_seed())
    elif o.kind == "door":
        glass = pane.obj(f"{tag}_leaf", "accent")
    else:
        glass = pane.obj(f"{tag}_shutter", "metal")
    return _keep(glass, frame.obj(f"{tag}_frame", "dark"), sill.obj(f"{tag}_sill", "secondary"))


def window(o: Opening, lod: int) -> list:
    """The fill of one opening on the canonical facade (z = 0, u along x); see `place`.

    LOD0: a dark frame (and a mullion on wide windows), the glass (role glass, aux = a seeded
    value per window) and a sill. LOD1: the inset glass face only. Doors get a leaf (accent),
    garages a shutter (metal), shopfronts glass with mullions.
    """
    return _fill(o, lod, CANONICAL, RECESS[min(lod, 1)])


def walls(
    w: float,
    d: float,
    h: float,
    *,
    openings: list[Opening],
    lod: int,
    role: str = "primary",
    faces: Sequence[str] = FACES,
) -> list:
    """Four walls of a w × d × h box (no top, no bottom), holes cut for `openings`.

    Each hole gets a reveal and its fill (`window`). LOD0 also subdivides the wall into about
    1.6 × 1.2 m cells so the baked AO has vertices to vary across.
    """
    recess = RECESS[min(lod, 1)]
    mesh = _Mesh()
    fills: list = []
    for face in faces:
        f = face_frame(face, w, d)
        ops = [o for o in openings if o.face == face]
        _check_openings(face, f.length, h, ops)
        _wall_face(mesh, f, h, [o.rect for o in ops], lod, recess)
        for o in ops:
            fills += _fill(o, lod, f, recess)
    return _keep(mesh.obj("walls", role)) + fills


# --- roofs --------------------------------------------------------------------------------


def _axis_map(ridge_axis: str):
    """(across, y, along) -> glTF (x, y, z) for a ridge along `ridge_axis`."""
    if ridge_axis == "z":
        return lambda a, y, ln: (a, y, ln)
    if ridge_axis == "x":
        return lambda a, y, ln: (ln, y, a)
    raise ValueError(f"ridge_axis {ridge_axis!r} not in ('x', 'z')")


def gable_roof(
    w: float,
    d: float,
    eave_h: float,
    pitch_deg: float,
    overhang: float = 0.4,
    ridge_axis: str = "z",
    *,
    thickness: float = 0.15,
    wall_role: str = "primary",
) -> list:
    """Two tiled slabs (role secondary) over a w × d footprint, plus the two gable infills.

    The slab tops meet at the ridge, at eave_h + span / 2 * tan(pitch); they overhang the walls
    by `overhang` on every side. The gable triangles (role `wall_role`) close the end walls.
    """
    m = _axis_map(ridge_axis)
    span, length = (w, d) if ridge_axis == "z" else (d, w)
    t = math.tan(math.radians(pitch_deg))
    half, o = span / 2, overhang
    ridge = eave_h + half * t
    low = eave_h - o * t
    l0, l1 = -(length / 2 + o), length / 2 + o
    roof = _Mesh()
    for s in (-1.0, 1.0):
        top = [(0.0, ridge), (s * (half + o), low)]
        bot = [(0.0, ridge - thickness), (s * (half + o), low - thickness)]
        ring = [bot[0], bot[1]]
        c = [m(a, y, l0) for a, y in ring] + [m(a, y, l1) for a, y in reversed(ring)]
        c += [m(a, y, l0) for a, y in top] + [m(a, y, l1) for a, y in reversed(top)]
        # s3 is the vertical face at the ridge: the two slabs' s3 faces coincide with
        # opposite normals (internal, degenerate AO), so neither is built
        roof.hexa(c, skip=("s3",))
    gables = _Mesh()
    for s in (-1.0, 1.0):
        ln = s * length / 2
        pts = [m(-half, eave_h, ln), m(half, eave_h, ln), m(0.0, ridge - thickness, ln)]
        gables.face(pts, m(0.0, 0.0, s))
    return _keep(roof.obj("gable_roof", "secondary"), gables.obj("gable_ends", wall_role))


def hip_roof(
    w: float,
    d: float,
    eave_h: float,
    pitch_deg: float,
    overhang: float = 0.5,
    *,
    thickness: float = 0.15,
) -> list:
    """A hipped roof (role secondary): four slopes at one pitch, a fascia and a soffit.

    The ridge runs along the longer side; a square footprint gives a pyramid.
    """
    t = math.tan(math.radians(pitch_deg))
    o = overhang
    hw, hd = w / 2 + o, d / 2 + o
    short = min(hw, hd)
    ridge = eave_h + min(w, d) / 2 * t
    low = eave_h - o * t
    rx, rz = (hw - short, 0.0) if w >= d else (0.0, hd - short)
    r0, r1 = (-rx, ridge, -rz), (rx, ridge, rz)
    e = [(-hw, low, -hd), (hw, low, -hd), (hw, low, hd), (-hw, low, hd)]
    b = [(x, y - thickness, z) for x, y, z in e]
    mesh = _Mesh()
    centre = (0.0, (ridge + low - thickness) / 2, 0.0)
    tops = (
        (e[0], e[1], r1, r0) if w >= d else (e[0], e[1], r0),  # back (-z)
        (e[1], e[2], r1) if w >= d else (e[1], e[2], r1, r0),  # right (+x)
        (e[2], e[3], r0, r1) if w >= d else (e[2], e[3], r1),  # front (+z)
        (e[3], e[0], r0) if w >= d else (e[3], e[0], r0, r1),  # left (-x)
    )
    for pts in tops:
        mesh.face(pts, _sub(_mean(pts), centre))
    for i in range(4):
        j = (i + 1) % 4
        pts = (b[i], b[j], e[j], e[i])
        mesh.face(pts, _sub(_mean(pts), centre))
    mesh.face(b, (0.0, -1.0, 0.0))
    return _keep(mesh.obj("hip_roof", "secondary"))


def flat_roof(
    w: float,
    d: float,
    h: float,
    parapet: float = 0.6,
    *,
    thickness: float = 0.2,
    wall_role: str = "primary",
) -> list:
    """A flat deck (role secondary) at height h, ringed by a parapet up to h + parapet."""
    deck = _Mesh()
    deck.face(
        [(-w / 2, h, -d / 2), (w / 2, h, -d / 2), (w / 2, h, d / 2), (-w / 2, h, d / 2)],
        (0.0, 1.0, 0.0),
    )
    ring = _Mesh()
    if parapet > 0:
        t, top, base = thickness, h + parapet, h - 0.05
        x0, x1, z0, z1 = -w / 2, w / 2, -d / 2, d / 2
        ring.box(x0, x1, base, top, z1 - t, z1)  # front
        ring.box(x0, x1, base, top, z0, z0 + t)  # back
        ring.box(x0, x0 + t, base, top, z0 + t, z1 - t, skip=("bottom", "s0", "s2"))
        ring.box(x1 - t, x1, base, top, z0 + t, z1 - t, skip=("bottom", "s0", "s2"))
    return _keep(deck.obj("flat_roof", "secondary"), ring.obj("parapet", wall_role))


# --- front-anchored parts ------------------------------------------------------------------


def car_porch(
    w: float,
    depth: float,
    h: float,
    *,
    slab: float = 0.2,
    column: float = 0.25,
    inset: float = 0.0,
):
    """A flat slab at height h over z in [-depth, 0], on two columns at the front corners.

    `inset` sets the columns back from the slab edge (to clear a gate's pillars).
    """
    s, c = _Mesh(), _Mesh()
    s.box(-w / 2, w / 2, h - slab, h, -depth, 0.0, skip=())
    for x in (-w / 2, w / 2 - column):
        c.box(x, x + column, 0.0, h - slab, -inset - column, -inset)
    return _keep(s.obj("porch_slab", "primary"), c.obj("porch_columns", "primary"))


def five_foot_way(
    length: float, depth: float = 1.8, h: float = 3.4, *, column: float = 0.4, bay: float = 4.0
):
    """A covered walkway over z in [-depth, 0]: front columns about `bay` apart, a soffit at h
    and a raised floor (role secondary)."""
    cols, soffit, floor = _Mesh(), _Mesh(), _Mesh()
    n = max(1, math.ceil((length - column) / bay))
    for k in range(n + 1):
        x = -length / 2 + (length - column) * k / n
        cols.box(x, x + column, 0.15, h, -column, 0.0)
    soffit.face(
        [
            (-length / 2, h, -depth),
            (length / 2, h, -depth),
            (length / 2, h, 0.0),
            (-length / 2, h, 0.0),
        ],
        (0.0, -1.0, 0.0),
    )
    floor.box(-length / 2, length / 2, 0.0, 0.15, -depth, 0.0, skip=("bottom", "s0"))
    return _keep(
        cols.obj("ffw_columns", "primary"),
        soffit.obj("ffw_soffit", "primary"),
        floor.obj("ffw_floor", "secondary"),
    )


def balcony(w: float, depth: float, y: float, *, lod: int = 0, rail_h: float = 1.0):
    """A slab (top at y) projecting over z in [0, depth]; LOD0 adds a metal rail, LOD1 a solid
    low parapet."""
    slab, rail = _Mesh(), _Mesh()
    slab.box(-w / 2, w / 2, y - 0.15, y, 0.0, depth, skip=("s0",))
    if lod == 0:
        r = 0.05
        rail.box(-w / 2, w / 2, y + rail_h - r, y + rail_h, depth - r, depth, skip=("s0",))
        n = max(2, round(w / 1.0) + 1)
        for k in range(n):
            x = -w / 2 + (w - r) * k / (n - 1)
            rail.box(x, x + r, y, y + rail_h - r, depth - r, depth)
        for x in (-w / 2, w / 2 - r):
            rail.box(x, x + r, y + rail_h - r, y + rail_h, 0.0, depth - r, skip=("s0", "s2"))
        return _keep(slab.obj("balcony_slab", "primary"), rail.obj("balcony_rail", "metal"))
    rail.box(-w / 2, w / 2, y, y + rail_h * 0.9, depth - 0.1, depth, skip=("bottom", "s0"))
    return _keep(slab.obj("balcony_slab", "primary"), rail.obj("balcony_parapet", "primary"))


def gate_and_fence(w: float, *, h: float = 1.5, walk_gate: float = 1.1, bar: float = 0.25):
    """The front boundary across x in [-w/2, w/2] at z in [-0.3, 0]: brick pillars (primary) and
    a barred metal gate (role metal) for the drive plus a pedestrian gate."""
    pillars, gate = _Mesh(), _Mesh()
    p = 0.3
    xs = (-w / 2, w / 2 - walk_gate - p, w / 2 - p)
    for x in xs:
        pillars.box(x, x + p, 0.0, h + 0.1, -p, 0.0)
    r, z0, z1 = 0.05, -0.2, -0.15
    for a, b in ((xs[0] + p, xs[1]), (xs[1] + p, xs[2])):
        for y0 in (0.1, h - r):
            gate.box(a, b, y0, y0 + r, z0, z1, skip=("s1", "s3"))
        n = max(1, round((b - a) / bar))
        for k in range(1, n):
            x = a + (b - a) * k / n
            gate.box(x - r / 2, x + r / 2, 0.1 + r, h - r, z0, z1, skip=("bottom", "top"))
    return _keep(pillars.obj("gate_pillars", "primary"), gate.obj("gate", "metal"))


def panel(x0: float, x1: float, y0: float, y1: float, *, depth: float = 0.08, role: str = "accent"):
    """A facade panel proud of the wall by `depth` (brick accent, a ledge or a canopy fin)."""
    m = _Mesh()
    m.box(x0, x1, y0, y1, 0.0, depth, skip=("s0",) if y0 > EPS else ("s0", "bottom"))
    return _keep(m.obj(f"panel_{role}", role))


def sign_band(w: float, h: float, y: float, *, depth: float = 0.12):
    """A blank sign band (role light, no text) over x in [-w/2, w/2], y in [y, y + h]."""
    m = _Mesh()
    m.box(-w / 2, w / 2, y, y + h, 0.0, depth, skip=("s0",))
    return _keep(m.obj("sign_band", "light"))


# --- footprint-centred parts --------------------------------------------------------------


def ac_units(
    n: int,
    face: str,
    *,
    w: float,
    d: float,
    y: float = 3.6,
    u: float = 0.0,
    spacing: float = 1.1,
) -> list:
    """`n` wall-mounted AC condensers (metal box, dark fan face) on `face` of a w × d footprint,
    in a row centred on `u`, bottoms at height y. `w` and `d` are required (> 0), so the
    units are never left at the origin."""
    if w <= 0 or d <= 0:
        raise ValueError(f"ac_units needs the footprint: w={w}, d={d} must both be > 0")
    f = face_frame(face, w, d)
    body, fan = _Mesh(), _Mesh()
    uw, uh, un = 0.8, 0.55, 0.3
    for k in range(n):
        c = u + (k - (n - 1) / 2) * spacing
        body.fbox(f, c - uw / 2, c + uw / 2, y, y + uh, 0.0, un, skip=("s0",))
        fan.fquad(f, c - 0.3, c + 0.1, y + 0.08, y + uh - 0.08, un + 0.005)
    return _keep(body.obj(f"ac_{face}", "metal"), fan.obj(f"ac_fan_{face}", "dark"))


def solar_panels(
    w: float,
    d: float,
    y: float,
    tilt_deg: float,
    *,
    x: float = 0.0,
    z: float = 0.0,
    panel: tuple[float, float] = (1.0, 1.7),
    gap: float = 0.1,
) -> list:
    """Rows of panels (role metal) filling w × d around (x, z), bottom edges at height y,
    tilted up towards -z by `tilt_deg`."""
    pw, pl = panel
    t = math.radians(tilt_deg)
    run, rise = pl * math.cos(t), pl * math.sin(t)
    cols = max(1, int((w + gap) // (pw + gap)))
    rows = max(1, int((d + gap) // (run + gap)))
    m = _Mesh()
    th = 0.04
    for i in range(cols):
        x0 = x - w / 2 + i * (pw + gap)
        for j in range(rows):
            zf = z + d / 2 - j * (run + gap)  # front (low) edge
            zb = zf - run
            lo = [(x0, y, zf), (x0 + pw, y, zf), (x0 + pw, y + rise, zb), (x0, y + rise, zb)]
            hi = [(px, py + th, pz) for px, py, pz in lo]
            m.hexa([lo[3], lo[2], lo[1], lo[0], hi[3], hi[2], hi[1], hi[0]])
    return _keep(m.obj("solar_panels", "metal"))


def far_block(
    size: tuple[float, float, float], roof: str, *, pitch_deg: float = 30.0, ridge_axis: str = "z"
) -> list:
    """LOD2: a wall box (primary) plus the true roof form (secondary), at most 16 triangles.

    `roof`: gable (ridge along `ridge_axis`), hip, flat or mono (high side at the back). The
    roof top is at the size's h.
    """
    if roof not in ROOFS:
        raise ValueError(f"roof {roof!r} not in {ROOFS}")
    w, h, d = size
    t = math.tan(math.radians(pitch_deg))
    span = (w if ridge_axis == "z" else d) if roof == "gable" else min(w, d)
    rise = 0.0 if roof == "flat" else min(span / 2 * t if roof != "mono" else d * t * 0.3, h * 0.45)
    eave = h - rise
    body, top = _Mesh(), _Mesh()
    body.box(-w / 2, w / 2, 0.0, eave, -d / 2, d / 2, skip=("bottom", "top"))
    x0, x1, z0, z1 = -w / 2, w / 2, -d / 2, d / 2
    if roof == "flat":
        top.face([(x0, h, z0), (x1, h, z0), (x1, h, z1), (x0, h, z1)], (0.0, 1.0, 0.0))
    elif roof == "gable":
        m = _axis_map(ridge_axis)
        half, ln = span / 2, (d if ridge_axis == "z" else w) / 2
        for s in (-1.0, 1.0):
            pts = [m(0.0, h, -ln), m(0.0, h, ln), m(s * half, eave, ln), m(s * half, eave, -ln)]
            top.face(pts, m(s, 1.0, 0.0))
            body.face(
                [m(-half, eave, s * ln), m(half, eave, s * ln), m(0.0, h, s * ln)], m(0.0, 0.0, s)
            )
    elif roof == "hip":
        mesh = top
        short = min(w, d) / 2
        rx, rz = (w / 2 - short, 0.0) if w >= d else (0.0, d / 2 - short)
        r0, r1 = (-rx, h, -rz), (rx, h, rz)
        e = [(x0, eave, z0), (x1, eave, z0), (x1, eave, z1), (x0, eave, z1)]
        centre = (0.0, eave, 0.0)
        for pts in (
            (e[0], e[1], r1, r0) if w >= d else (e[0], e[1], r0),
            (e[1], e[2], r1) if w >= d else (e[1], e[2], r1, r0),
            (e[2], e[3], r0, r1) if w >= d else (e[2], e[3], r1),
            (e[3], e[0], r0) if w >= d else (e[3], e[0], r0, r1),
        ):
            mesh.face(pts, _sub(_mean(pts), centre))
    else:  # mono: low at the front (+z), high at the back
        top.face([(x0, eave, z1), (x1, eave, z1), (x1, h, z0), (x0, h, z0)], (0.0, 1.0, 0.3))
        body.face([(x0, eave, z0), (x1, eave, z0), (x1, h, z0), (x0, h, z0)], (0.0, 0.0, -1.0))
        for s, x in ((-1.0, x0), (1.0, x1)):
            body.face([(x, eave, z0), (x, eave, z1), (x, h, z0)], (s, 0.0, 0.0))
    return _keep(body.obj("far_walls", "primary"), top.obj("far_roof", "secondary"))
