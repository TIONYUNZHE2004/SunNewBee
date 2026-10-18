"""Landmark builders (imports bpy): `BUILDERS[asset_id](variant, lod) -> [objects]`.

Merged into `build.BUILDERS`. Same conventions as `archetypes.py`: origin at the footprint
centre on the ground, LOD1 has no dark frames, LOD2 is a simplified massing.

* `lakeside_mall` is extruded from its OSM outline (`landmarks.geojson`, `model ==
  "lakeside_mall"`), in local metres around the ring centroid. The footprint is never invented:
  a missing feature is an error.
* `kanopi` is a residential slab on a podium sized to the OBB of its traced outline
  (`specs.KANOPI_OBB`, placement "obb"); 36 storeys is the developer's design height.
* `masjid_denai_alam` is a generic stylised form of the described building on a nominal
  footprint (placement "deferred": nothing places it until a sourced outline exists).
  No text, logos or brand marks anywhere; sign bands are blank (role light).
"""

import json
import math
import random
from pathlib import Path

from . import kit
from .geo import outline_local, outline_ring
from .kit import Opening, _keep, _Mesh
from .specs import Variant

ROOT = Path(__file__).resolve().parents[3]
LANDMARKS_GEOJSON = ROOT / "data" / "seed" / "elmina" / "base" / "landmarks.geojson"


def _spread(length: float, n: int) -> list[float]:
    """n centres evenly spread over `length` (centred on 0)."""
    return [(k + 0.5) * length / n - length / 2 for k in range(n)]


# --- lakeside mall ----------------------------------------------------------------------

WALL_H = 9.0
PARAPET_H = 0.8
PARAPET_T = 0.3
CANOPY_Y = 4.2  # underside of the canopy slab
CANOPY_T = 0.25
CANOPY_OUT = 1.5  # overhang past the outline
MIN_EDGE = 0.5


def mall_outline(path: Path = LANDMARKS_GEOJSON) -> list[tuple[float, float]]:
    """The mall's outline as open (x, z) metres around its centroid; raises if there is none."""
    fc = json.loads(Path(path).read_text(encoding="utf-8"))
    ring = outline_ring(fc, "lakeside_mall")
    if ring is None:
        raise ValueError(f"{path}: no feature with model 'lakeside_mall'; never invent a footprint")
    return outline_local(ring)


def _inside(pts: list[tuple[float, float]], x: float, z: float) -> bool:
    ins = False
    for (x1, z1), (x2, z2) in zip(pts, pts[1:] + pts[:1], strict=True):
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
            ins = not ins
    return ins


def _dist_to_edges(pts: list[tuple[float, float]], x: float, z: float) -> float:
    best = math.inf
    for (x1, z1), (x2, z2) in zip(pts, pts[1:] + pts[:1], strict=True):
        dx, dz = x2 - x1, z2 - z1
        t = max(0.0, min(1.0, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz or 1.0)))
        best = min(best, math.hypot(x - (x1 + t * dx), z - (z1 + t * dz)))
    return best


def _edges(pts: list[tuple[float, float]]):
    """(a, b, outward unit normal (nx, nz), length) per edge; short edges are dropped."""
    area2 = sum(
        x1 * z2 - x2 * z1 for (x1, z1), (x2, z2) in zip(pts, pts[1:] + pts[:1], strict=True)
    )
    sign = 1.0 if area2 > 0 else -1.0  # CCW in (x, z): interior is on the left, outward = right
    out = []
    for a, b in zip(pts, pts[1:] + pts[:1], strict=True):
        dx, dz = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dz)
        if length < MIN_EDGE:
            continue
        n = (sign * dz / length, -sign * dx / length)
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if _inside(pts, mid[0] + n[0] * 0.05, mid[1] + n[1] * 0.05):
            raise ValueError("outline normal points inward (self-intersecting outline?)")
        out.append((a, b, n, length))
    return out


def _lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _off(p, n, k: float):
    return (p[0] + n[0] * k, p[1] + n[1] * k)


def _slab(m: _Mesh, a, b, n, off0: float, off1: float, y0: float, y1: float, skip=("bottom",)):
    """A box along edge a-b spanning the normal offsets off0..off1 and heights y0..y1."""
    ring = [_off(a, n, off0), _off(b, n, off0), _off(b, n, off1), _off(a, n, off1)]
    m.hexa([(p[0], y0, p[1]) for p in ring] + [(p[0], y1, p[1]) for p in ring], skip)


def _strip(m: _Mesh, p, q, n, y0: float, y1: float, off: float) -> None:
    """A quad facing outward over p-q, heights y0..y1, `off` metres proud of the wall."""
    pp, qq = _off(p, n, off), _off(q, n, off)
    m.face(
        [(pp[0], y0, pp[1]), (qq[0], y0, qq[1]), (qq[0], y1, qq[1]), (pp[0], y1, pp[1])],
        (n[0], 0.0, n[1]),
    )


def _clip(poly, axis: int, val: float, keep_ge: bool):
    """Sutherland-Hodgman: `poly` ((x, z) points) against one axis-aligned half-plane."""
    out = []
    for p, q in zip(poly, poly[1:] + poly[:1], strict=True):
        pin = (p[axis] >= val) if keep_ge else (p[axis] <= val)
        qin = (q[axis] >= val) if keep_ge else (q[axis] <= val)
        if pin != qin:
            t = (val - p[axis]) / (q[axis] - p[axis])
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
        if qin:
            out.append(q)
    return out


def _deck(pts: list[tuple[float, float]], y: float, cell: float) -> _Mesh:
    """The outline as a flat deck split into about cell x cell pieces (the polygon clipped to
    each grid cell), so the baked AO has interior vertices instead of four crevice corners."""
    m = _Mesh()
    xs, zs = [p[0] for p in pts], [p[1] for p in pts]
    x = math.floor(min(xs) / cell) * cell
    while x < max(xs):
        z = math.floor(min(zs) / cell) * cell
        while z < max(zs):
            poly = pts
            for axis, val, ge in (
                (0, x, True),
                (0, x + cell, False),
                (1, z, True),
                (1, z + cell, False),
            ):
                poly = _clip(poly, axis, val, ge) if poly else poly
            if len(poly) >= 3:
                m.face([(p[0], y, p[1]) for p in poly], (0.0, 1.0, 0.0))
            z += cell
        x += cell
    return m


def _mall(variant: Variant, lod: int) -> list:
    """Single storey, open-air in character: wall shell with an accent band, a deep white canopy
    on posts over glazed shopfront bays, a parapet, a light grey roof deck with plant boxes and a
    blank sign band. No text, logos or sign tower."""
    pts = mall_outline()
    edges = _edges(pts)
    if lod >= 2:  # simplified massing: one wall quad per edge and the roof
        walls = _Mesh()
        for a, b, n, _ in edges:
            _strip(walls, a, b, n, 0.0, WALL_H, 0.0)
        return _keep(walls.obj("walls", "primary"), _deck(pts, WALL_H, 30.0).obj("roof", "metal"))

    walls, parapet = _Mesh(), _Mesh()
    canopy, accent, sign, plant = _Mesh(), _Mesh(), _Mesh(), _Mesh()
    posts = _Mesh()
    glass = [_Mesh() for _ in range(kit.WINDOW_BUCKETS)]
    seeds = [kit.window_seed() for _ in glass]
    frame = _Mesh()
    for a, b, n, length in edges:
        bays: list[tuple[float, float]] = []
        if length >= 8.0:
            nb = max(1, round((length - 2.0) / 6.0)) if lod == 0 else 1
            for k in range(nb):
                bays.append((1.0 + (length - 2.0) * k / nb, 1.0 + (length - 2.0) * (k + 0.9) / nb))

        def cells(s: float, e: float, y0: float, y1: float, a=a, b=b, n=n, length=length):
            nu = max(1, round((e - s) / 6.0)) if lod == 0 else 1
            for i in range(nu):
                p = _lerp(a, b, (s + (e - s) * i / nu) / length)
                q = _lerp(a, b, (s + (e - s) * (i + 1) / nu) / length)
                _strip(walls, p, q, n, y0, y1, 0.0)

        if lod == 0:
            # no wall behind the glazed bays (their frames cover 0.2-3.7 m): the wall verts 4 cm
            # under the glass would bake black. Piers between bays, plinth and upper wall full.
            cells(0.0, length, 0.0, 0.2)
            gaps, s = [], 0.0
            for t0, t1 in bays:
                gaps.append((s, t0 - 0.1))
                s = t1 + 0.1
            gaps.append((s, length))
            for s, e in gaps:
                cells(s, e, 0.2, 3.7)
            for y0, y1 in ((3.7, 6.0), (6.0, WALL_H)):
                cells(0.0, length, y0, y1)
        else:
            cells(0.0, length, 0.0, WALL_H)
        # parapet from the deck up; canopy over the shopfronts; accent band below the parapet
        _slab(parapet, a, b, n, 0.0, -PARAPET_T, WALL_H, WALL_H + PARAPET_H)
        _slab(canopy, a, b, n, 0.0, CANOPY_OUT, CANOPY_Y, CANOPY_Y + CANOPY_T, skip=("s0",))
        y_lo, y_hi = CANOPY_Y - 0.55, CANOPY_Y + CANOPY_T + 0.3
        _slab(canopy, a, b, n, CANOPY_OUT - 0.2, CANOPY_OUT, y_lo, y_hi)  # deep white fascia
        if lod == 0:
            _slab(accent, a, b, n, 0.0, 0.1, 7.2, 8.2, skip=("bottom", "s0"))
        for t0, t1 in bays:  # glazed shopfront bays under the canopy
            p, q = _lerp(a, b, t0 / length), _lerp(a, b, t1 / length)
            _strip(random.choice(glass), p, q, n, 0.3, 3.6, 0.04)
            if lod == 0:
                p, q = _lerp(a, b, (t0 - 0.1) / length), _lerp(a, b, (t1 + 0.1) / length)
                _strip(frame, p, q, n, 0.2, 3.7, 0.015)
        if lod == 0:  # canopy posts every ~9 m, 0.3 m inside the canopy edge
            m = max(1, round(length / 9.0))
            for k in range(m):
                c = _off(_lerp(a, b, (k + 0.5) / m), n, CANOPY_OUT - 0.3)
                posts.box(c[0] - 0.12, c[0] + 0.12, 0.0, CANOPY_Y, c[1] - 0.12, c[1] + 0.12)

    # a blank sign band (role light, no text) on the longest edge, above the canopy
    a, b, n, length = max(edges, key=lambda e: e[3])
    half = min(10.0, length / 2 - 1.0) / length
    p, q = _lerp(a, b, 0.5 - half), _lerp(a, b, 0.5 + half)
    _slab(sign, p, q, n, 0.0, 0.12, 4.9, 6.5, skip=("bottom", "s0"))

    # roof plant: boxes on a coarse grid, well inside the outline
    xs, zs = [p[0] for p in pts], [p[1] for p in pts]
    step = 38.0 if lod == 0 else 76.0
    gx = min(xs) + step / 2
    while gx < max(xs):
        gz = min(zs) + step / 2
        while gz < max(zs):
            if _inside(pts, gx, gz) and _dist_to_edges(pts, gx, gz) > 9.0:
                sx, sz = random.uniform(5.0, 9.0), random.uniform(3.0, 6.0)
                sy = random.uniform(1.4, 2.6)
                plant.box(gx - sx / 2, gx + sx / 2, WALL_H, WALL_H + sy, gz - sz / 2, gz + sz / 2)
            gz += step
        gx += step

    objs = _keep(
        walls.obj("walls", "primary"),
        _deck(pts, WALL_H, 4.0 if lod == 0 else 12.0).obj("roof", "metal"),
        parapet.obj("parapet", "primary"),
        canopy.obj("canopy", "primary"),
        accent.obj("accent_band", "accent"),
        sign.obj("sign_band", "light"),
        plant.obj("roof_plant", "secondary"),
        posts.obj("canopy_posts", "dark"),
        frame.obj("shopfront_frame", "dark"),
    )
    objs += _keep(*(m.obj(f"shopfront_{i}", "glass", seeds[i]) for i, m in enumerate(glass)))
    return objs


# --- kanopi -----------------------------------------------------------------------------

POD_H = 8.7  # the podium: OSM way 1545153991 is 8.71 m
FLOORS = 36  # design storeys of the tower (developer figure, not surveyed)
FLOOR_H = 3.2
INSET = 1.0  # the tower stands this far inside the podium footprint, leaving a roof ledge
RECESS_D = 1.4  # depth of the dark balcony strips
STRIPS = (-32.0, -16.0, 0.0, 16.0, 32.0)  # strip centres on the front and back faces
STRIP_W = 3.6
WIN_PITCH = 3.8  # window spacing along a module
POD_FLOOR = 18  # the single Sky Pod: floors 18-19, in the middle strip, on the front face
POD_OUT = 0.9  # how far it projects past the tower face (kept inside the podium footprint)


def _modules(w: float) -> list[tuple[float, float]]:
    """The light module spans (u0, u1) between the dark strips, edge to edge."""
    edges = [-w / 2]
    for c in STRIPS:
        edges += [c - STRIP_W / 2, c + STRIP_W / 2]
    edges.append(w / 2)
    return [(edges[i], edges[i + 1]) for i in range(0, len(edges), 2)]


def _kanopi(variant: Variant, lod: int) -> list:
    """A residential slab, 36 design storeys: six light modules separated by five dark recessed
    balcony strips (thin foliage bands on every floor), one Sky Pod cantilevered at mid height,
    on a low podium of the full traced footprint with a planted roof ledge, and a crown of plant
    room, lift overrun, tank and mast. 88.9 m long and 27.8 m deep, like the traced outline."""
    w, h, d = variant.size
    tw, bd = w - 2 * INSET, d - 2 * INSET  # the tower plate
    zt = 0.0
    zf, zb = zt + bd / 2, zt - bd / 2
    fh = FLOOR_H
    tower_h = FLOORS * fh
    body_top = POD_H + tower_h
    pod_y = POD_H + POD_FLOOR * fh
    if lod >= 2:
        m, g, s = _Mesh(), _Mesh(), _Mesh()
        m.box(-w / 2, w / 2, 0.0, POD_H, -d / 2, d / 2)
        m.box(-tw / 2, tw / 2, POD_H, body_top, zb, zf)
        m.box(-w * 0.17, w * 0.17, body_top, body_top + 2.8, -bd * 0.2, bd * 0.2)
        for c in STRIPS:  # the dark strips, as quads proud of the front face
            lo, hi = POD_H + 3, body_top - 1
            s.face(
                [(c - 1.8, lo, zf + 0.03), (c + 1.8, lo, zf + 0.03)]
                + [(c + 1.8, hi, zf + 0.03), (c - 1.8, hi, zf + 0.03)],
                (0.0, 0.0, 1.0),
            )
        g.box(-2.8, 2.8, pod_y, pod_y + 2 * fh, zf - RECESS_D, zf + POD_OUT)
        return _keep(
            m.obj("massing", "primary"), s.obj("strips", "dark"), g.obj("pod", "glass", 0.5)
        ) + kit.prism(0.0, zt, 0.4, body_top + 2.8, h, 4, "metal", r_top=0.0, name="mast")

    cell = (5.0, 3.5) if lod == 0 else (40.0, 40.0)
    objs: list = []
    # podium: shopfront level and one office level, a door on +z
    covered, panes = [], []
    for face, length in (("front", w), ("back", w), ("left", d), ("right", d)):
        cols = _spread(length - 3.0, 14 if length == w else 4)
        if face == "front":
            cols = [c for c in cols if abs(c) > 4.0]
        for rows, ww, wh in (([0.9], 3.2, 3.6), ([5.4], 2.2, 1.6)):
            kw = {"cols": cols, "rows": rows, "ww": ww, "wh": wh}
            panes += kit.window_panes(face, w, d, lod=lod, **kw)
            if lod == 0:
                covered += kit.pane_cover(face, **kw)
    pod = kit.walls(
        w,
        d,
        POD_H,
        openings=[Opening("front", 0.0, 0.0, 4.0, 4.5, "door")],
        lod=lod,
        cell=cell,
        covered=covered,
    )
    objs += pod + panes + kit.flat_roof(w, d, POD_H, 0.9, deck_role="metal", cell=3.0)

    # tower: light modules with applied windows; dark strips recessed behind the face
    tpanes = []
    tcover = [  # recessed strips: no wall on the front and back faces
        (face, c - STRIP_W / 2, c + STRIP_W / 2, 0.0, tower_h)
        for face in ("front", "back")
        for c in STRIPS
    ]
    rows = [k * fh + 0.9 for k in range(FLOORS)]
    for face in ("front", "back"):
        for u0, u1 in _modules(tw):
            c = (u0 + u1) / 2
            n = max(2, round((u1 - u0 - 1.6) / WIN_PITCH))
            kw = {
                "cols": [c + (i - (n - 1) / 2) * WIN_PITCH for i in range(n)],
                "rows": rows,
                "ww": 1.8,
                "wh": fh - 1.6,
            }
            tpanes += kit.window_panes(face, tw, bd, lod=lod, **kw)
            if lod == 0:
                tcover += kit.pane_cover(face, **kw)
    for face in ("left", "right"):
        kw = {"cols": _spread(bd - 3.0, 4), "rows": rows, "ww": 2.0, "wh": fh - 1.6}
        tpanes += kit.window_panes(face, tw, bd, lod=lod, **kw)
        if lod == 0:
            tcover += kit.pane_cover(face, **kw)
    tcell = (6.0, fh) if lod == 0 else cell
    tow = kit.walls(tw, bd, tower_h, openings=[], lod=lod, cell=tcell, covered=tcover)
    tow += tpanes + kit.flat_roof(tw, bd, tower_h, 0.9, deck_role="metal", cell=3.0)
    # the recessed strips: dark back wall and side walls, and (LOD0) a balcony slab and a thin
    # foliage band on every floor; the Sky Pod takes the middle strip's front bay at its floors
    rear, side, slab, band = _Mesh(), _Mesh(), _Mesh(), _Mesh()
    for face, sgn in (("front", 1.0), ("back", -1.0)):
        zface = sgn * bd / 2
        zrec = zface - sgn * RECESS_D
        for c in STRIPS:
            x0, x1 = c - STRIP_W / 2, c + STRIP_W / 2
            for k in range(FLOORS):
                if face == "front" and c == 0.0 and POD_FLOOR <= k < POD_FLOOR + 2:
                    continue
                y0, y1 = k * fh, (k + 1) * fh
                rear.face(
                    [(x0, y0, zrec), (x1, y0, zrec), (x1, y1, zrec), (x0, y1, zrec)],
                    (0.0, 0.0, sgn),
                )
                for xs, nx in ((x0, 1.0), (x1, -1.0)):
                    side.face(
                        [(xs, y0, zrec), (xs, y0, zface), (xs, y1, zface), (xs, y1, zrec)],
                        (nx, 0.0, 0.0),
                    )
                if lod == 0:
                    za, zb2 = sorted((zrec, zface))
                    slab.box(x0, x1, y0 + 0.9, y0 + 1.1, za, zb2)
                    za2, zb3 = sorted((zface - sgn * 0.5, zface))
                    band.box(x0 + 0.15, x1 - 0.15, y0 + 1.1, y0 + 1.45, za2, zb3)
    role = "dark" if lod == 0 else "secondary"  # LOD1 carries no dark role
    tow += _keep(rear.obj("strip_back", role), side.obj("strip_sides", role))
    tow += _keep(slab.obj("strip_slabs", "secondary"), band.obj("strip_foliage", "foliage"))
    objs += kit.place(tow, y=POD_H, z=zt)

    # the single Sky Pod: a glazed box cantilevered from the middle strip at mid height
    pg, pf, pp = _Mesh(), _Mesh(), _Mesh()
    pz0, pz1 = zf - RECESS_D, zf + POD_OUT
    pg.box(-2.8, 2.8, pod_y + 0.3, pod_y + 2 * fh - 0.3, pz0, pz1, skip=("bottom",))
    pf.box(-3.0, 3.0, pod_y, pod_y + 0.3, pz0, pz1, skip=())
    pf.box(-3.0, 3.0, pod_y + 2 * fh - 0.3, pod_y + 2 * fh, pz0, pz1, skip=())
    pp.box(-2.6, 2.6, pod_y + 0.3, pod_y + 0.8, zf + 0.4, zf + POD_OUT - 0.05)
    objs += _keep(
        pg.obj("sky_pod", "glass", kit.window_seed()),
        pf.obj("sky_pod_frame", "accent"),
        pp.obj("sky_pod_planter", "foliage"),
    )

    # the podium roof ledge round the tower: a low planted strip, nothing else
    planting = _Mesh()
    ex, ez = w / 2 - 0.25, d / 2 - 0.25
    ix, iz = tw / 2 + 0.25, bd / 2 + 0.25
    planting.box(-ex, ex, POD_H, POD_H + 0.6, iz, ez)
    planting.box(-ex, ex, POD_H, POD_H + 0.6, -ez, -iz)
    planting.box(-ex, -ix, POD_H, POD_H + 0.6, -iz, iz)
    planting.box(ix, ex, POD_H, POD_H + 0.6, -iz, iz)
    objs += _keep(planting.obj("terrace_planting", "foliage"))

    # crown: plant room, lift overrun, cooling units, tank and mast
    crown, crown_m = _Mesh(), _Mesh()
    top = body_top + 0.9
    crown.box(-w * 0.17, w * 0.17, top, top + 2.8, zt - bd * 0.2, zt + bd * 0.2)
    crown.box(-4.0, 4.0, top + 2.8, top + 3.6, zt - 3.0, zt + 3.0)
    crown_m.box(w * 0.17 + 0.5, w * 0.17 + 4.5, top, top + 2.0, zt - 2.0, zt + 2.0)
    objs += _keep(crown.obj("crown", "secondary"), crown_m.obj("crown_plant", "metal"))
    objs += kit.prism(-w * 0.17 - 2.5, zt, 2.2, top, top + 2.4, 10, "metal", name="tank")
    objs += kit.prism(0.0, zt, 0.4, top + 3.6, h, 6, "metal", r_top=0.0, name="mast")
    return objs


# --- masjid denai alam ------------------------------------------------------------------


def _masjid(variant: Variant, lod: int) -> list:
    """A generic prayer hall: a hall under a flat roof, a main dome on a drum, four small corner
    domes, a front arcade with a raised portal, and one minaret at the front-right corner."""
    w, h, d = variant.size
    arcade_d = 6.0
    hall_w, hall_d, hall_h = w, d - arcade_d, 9.5
    zc = -d / 2 + hall_d / 2
    z_front = zc + hall_d / 2
    base = hall_h + 0.8
    dome_r = 9.0
    gallery = 3.0  # circumradius of the 45 degree square gallery; outer edges stay at w/2, d/2
    mx = w / 2 - gallery / math.sqrt(2)
    mz = d / 2 - gallery / math.sqrt(2)
    shaft_top, gal_top, up_top = 22.0, 22.6, 27.5
    segs, rings = (32, 8) if lod == 0 else (12, 3)
    if lod >= 2:
        objs = kit.far_block((hall_w, base, d), "flat")
        objs += kit.dome(0.0, zc, dome_r, base + 3.5, "accent", segs=8, rings=2)
        objs += kit.prism(
            mx, mz, 2.6, 0.0, up_top + 3.5, 4, "primary", name="minaret", phase_deg=45
        )
        return objs
    covered, panes = [], []
    for face, length in (("front", hall_w), ("back", hall_w), ("left", hall_d), ("right", hall_d)):
        cs = _spread(length - 3, 8 if length == hall_w else 6)
        if face == "front":
            cs = [c for c in cs if abs(c) > 4.5]
        kw = {"cols": cs, "rows": [3.4], "ww": 1.8, "wh": 4.2}
        panes += kit.window_panes(face, hall_w, hall_d, lod=lod, **kw)
        if lod == 0:  # no wall behind the applied panes (black AO smudges)
            covered += kit.pane_cover(face, **kw)
    walls = kit.walls(
        hall_w,
        hall_d,
        hall_h,
        openings=[Opening("front", 0.0, 0.0, 3.4, 4.8, "door")],
        lod=lod,
        cell=(3.6, 3.0),
        covered=covered,
    )
    walls += panes
    walls += kit.flat_roof(hall_w, hall_d, hall_h, 0.8, deck_role="metal", cell=3.0)
    objs = kit.place(walls, z=zc)
    if lod == 0:  # accent band round the hall
        zb = zc - hall_d / 2
        for x0, x1, z0, z1 in (
            (-w / 2 - 0.06, w / 2 + 0.06, z_front, z_front + 0.06),
            (-w / 2 - 0.06, w / 2 + 0.06, zb - 0.06, zb),
            (-w / 2 - 0.06, -w / 2, zb, z_front),
            (w / 2, w / 2 + 0.06, zb, z_front),
        ):
            objs += kit.block(x0, x1, 7.9, 8.5, z0, z1, "accent", name="band")
    # front arcade: roof slab on columns, and a raised portal around the door
    arcade_w, arch_h = w * 0.7, 5.2
    objs += kit.block(
        -arcade_w / 2,
        arcade_w / 2,
        arch_h,
        arch_h + 0.4,
        z_front,
        d / 2,
        "secondary",
        name="arcade",
    )
    for x in _spread(arcade_w - 0.8, 9):
        objs += kit.block(
            x - 0.3, x + 0.3, 0.0, arch_h, d / 2 - 0.8, d / 2, "primary", name="column"
        )
    objs += kit.block(-5.0, 5.0, 0.0, 12.5, z_front, z_front + 0.5, "accent", name="portal")
    # main dome on a drum, with a finial
    objs += kit.prism(0.0, zc, dome_r, base, base + 3.5, segs, "primary", name="drum", top=False)
    objs += kit.dome(0.0, zc, dome_r + 0.4, base + 3.5, "accent", segs=segs, rings=rings)
    tip = base + 3.5 + dome_r + 0.4
    objs += kit.prism(0.0, zc, 0.4, tip, tip + 2.2, 6, "metal", r_top=0.0, name="finial")
    if lod == 0:
        for sx in (-1.0, 1.0):
            for sz in (-1.0, 1.0):
                x, z = sx * w * 0.38, zc + sz * hall_d * 0.34
                objs += kit.dome(x, z, 3.0, base, "accent", segs=14, rings=4, name="small")
    # minaret: square shaft, a gallery, a narrower upper shaft, a domed cap and a tip
    objs += kit.prism(mx, mz, 2.6, 0.0, shaft_top, 4, "primary", name="shaft", phase_deg=45)
    objs += kit.prism(
        mx, mz, gallery, shaft_top, gal_top, 4, "secondary", name="gallery", phase_deg=45
    )
    objs += kit.prism(mx, mz, 1.9, gal_top, up_top, 4, "primary", name="upper", phase_deg=45)
    cap_segs, cap_rings = (10, 3) if lod == 0 else (6, 1)
    objs += kit.dome(mx, mz, 1.7, up_top, "accent", segs=cap_segs, rings=cap_rings, name="cap")
    objs += kit.prism(mx, mz, 0.25, up_top + 1.7, up_top + 3.6, 6, "metal", r_top=0.0, name="tip")
    return objs


BUILDERS = {
    "lakeside_mall": _mall,
    "kanopi": _kanopi,
    "masjid_denai_alam": _masjid,
}
