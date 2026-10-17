"""Landmark builders (imports bpy): `BUILDERS[asset_id](variant, lod) -> [objects]`.

Merged into `build.BUILDERS`. Same conventions as `archetypes.py`: origin at the footprint
centre on the ground, LOD1 has no dark frames, LOD2 is a simplified massing.

* `lakeside_mall` is extruded from its OSM outline (`landmarks.geojson`, `model ==
  "lakeside_mall"`), in local metres around the ring centroid. The footprint is never invented:
  a missing feature is an error.
* `kanopi` and `masjid_denai_alam` are generic stylised forms of the described buildings on a
  nominal footprint (placement "deferred": nothing places them until a sourced outline exists).
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


def _mall(variant: Variant, lod: int) -> list:
    """Single storey, open-air in character: wall shell with an accent band, a continuous canopy
    on posts over glazed shopfront bays, a parapet, roof plant boxes and a blank sign band."""
    pts = mall_outline()
    edges = _edges(pts)
    if lod >= 2:  # simplified massing: one wall quad per edge and the roof
        walls, roof = _Mesh(), _Mesh()
        for a, b, n, _ in edges:
            _strip(walls, a, b, n, 0.0, WALL_H, 0.0)
        roof.face([(p[0], WALL_H, p[1]) for p in pts], (0.0, 1.0, 0.0))
        return _keep(walls.obj("walls", "primary"), roof.obj("roof", "secondary"))

    walls, deck, parapet = _Mesh(), _Mesh(), _Mesh()
    canopy, accent, sign, plant = _Mesh(), _Mesh(), _Mesh(), _Mesh()
    posts = _Mesh()
    glass = [_Mesh() for _ in range(kit.WINDOW_BUCKETS)]
    seeds = [kit.window_seed() for _ in glass]
    frame = _Mesh()
    rows = [0.0, 2.2, 3.8, 6.0, WALL_H] if lod == 0 else [0.0, WALL_H]
    for a, b, n, length in edges:
        nu = max(1, round(length / 6.0)) if lod == 0 else 1
        for i in range(nu):
            p, q = _lerp(a, b, i / nu), _lerp(a, b, (i + 1) / nu)
            for y0, y1 in zip(rows, rows[1:], strict=False):
                _strip(walls, p, q, n, y0, y1, 0.0)
        # parapet from the deck up; canopy over the shopfronts; accent band below the parapet
        _slab(parapet, a, b, n, 0.0, -PARAPET_T, WALL_H, WALL_H + PARAPET_H)
        _slab(canopy, a, b, n, 0.0, CANOPY_OUT, CANOPY_Y, CANOPY_Y + CANOPY_T, skip=("s0",))
        if lod == 0:
            _slab(accent, a, b, n, 0.0, 0.1, 7.2, 8.2, skip=("bottom", "s0"))
        # glazed shopfront bays under the canopy
        if length >= 8.0:
            bays = max(1, round((length - 2.0) / 6.0)) if lod == 0 else 1
            for k in range(bays):
                t0 = 1.0 + (length - 2.0) * k / bays
                t1 = 1.0 + (length - 2.0) * (k + 0.9) / bays
                p, q = _lerp(a, b, t0 / length), _lerp(a, b, t1 / length)
                _strip(random.choice(glass), p, q, n, 0.3, 3.6, 0.04)
                if lod == 0:
                    _strip(frame, p, q, n, 0.2, 3.7, 0.015)
        if lod == 0:  # canopy posts every ~9 m, 0.3 m inside the canopy edge
            m = max(1, round(length / 9.0))
            for k in range(m):
                c = _off(_lerp(a, b, (k + 0.5) / m), n, CANOPY_OUT - 0.3)
                posts.box(c[0] - 0.12, c[0] + 0.12, 0.0, CANOPY_Y, c[1] - 0.12, c[1] + 0.12)
    deck.face([(p[0], WALL_H, p[1]) for p in pts], (0.0, 1.0, 0.0))

    # a blank sign band (role light, no text) on the longest edge, above the canopy
    a, b, n, length = max(edges, key=lambda e: e[3])
    half = min(10.0, length / 2 - 1.0) / length
    _slab(
        sign,
        _lerp(a, b, 0.5 - half),
        _lerp(a, b, 0.5 + half),
        n,
        0.0,
        0.12,
        4.9,
        6.5,
        skip=("bottom", "s0"),
    )

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
        deck.obj("roof", "secondary"),
        parapet.obj("parapet", "primary"),
        canopy.obj("canopy", "secondary"),
        accent.obj("accent_band", "accent"),
        sign.obj("sign_band", "light"),
        plant.obj("roof_plant", "metal"),
        posts.obj("canopy_posts", "dark"),
        frame.obj("shopfront_frame", "dark"),
    )
    objs += _keep(*(m.obj(f"shopfront_{i}", "glass", seeds[i]) for i, m in enumerate(glass)))
    return objs


# --- kanopi -----------------------------------------------------------------------------

POD_H = 21.5  # podium: levels 1-6; the facilities deck is level 7
FLOORS = 30  # tower floors above the deck: 36 storeys in all
INSET = 2.0  # balconies project this far, so the envelope is the nominal footprint
SKY_FLOORS = (26, 28)


def _kanopi(variant: Variant, lod: int) -> list:
    """A 36-storey tower on a 6-level podium. Level 7 is a facilities deck (a terrace in front
    of the tower: pool, pavilion, planting); above it staggered planted balconies on every face
    and glazed Sky Pods near the top; a crown of plant room, lift overrun, tank and mast."""
    w, h, d = variant.size
    bw, bd = w - 2 * INSET, d - 2 * INSET - 6.0  # 6 m more depth leaves the terrace
    zt = -d / 2 + INSET + bd / 2  # tower centre z (toward the back)
    zf, zb = zt + bd / 2, zt - bd / 2
    body_top = h - 7.5
    fh = (body_top - POD_H) / FLOORS
    tower_h = FLOORS * fh
    if lod >= 2:
        m, g = _Mesh(), _Mesh()
        m.box(-w / 2, w / 2, 0.0, POD_H, -d / 2, d / 2)
        m.box(-bw / 2, bw / 2, POD_H, body_top, zb, zf)
        m.box(-bw * 0.3, bw * 0.3, body_top, body_top + 3.5, zt - bd * 0.3, zt + bd * 0.3)
        for px in (-6.0, 6.0):
            g.box(px - 4.0, px + 4.0, POD_H + 26 * fh, POD_H + 27 * fh, zf, zf + INSET)
        return _keep(m.obj("massing", "primary"), g.obj("pods", "glass", 0.5)) + kit.prism(
            0.0, zt, 0.4, body_top + 3.5, h, 4, "metal", r_top=0.0, name="mast"
        )

    cell = (5.0, 3.5) if lod == 0 else (40.0, 40.0)
    objs: list = []
    # podium: shopfront level, five office levels, a door on +z
    pod = kit.walls(
        w, d, POD_H, openings=[Opening("front", 0.0, 0.0, 4.0, 4.5, "door")], lod=lod, cell=cell
    )
    for face, length in (("front", w), ("back", w), ("left", d), ("right", d)):
        cols = _spread(length - 3.0, 6 if length == w else 4)
        if face == "front":
            cols = [c for c in cols if abs(c) > 4.0]
        pod += kit.window_panes(face, w, d, cols=cols, rows=[0.9], ww=3.2, wh=3.6, lod=lod)
        rows = [6.3 + 3.2 * k for k in range(5)]
        pod += kit.window_panes(face, w, d, cols=cols, rows=rows, ww=2.2, wh=1.9, lod=lod)
    pod += kit.flat_roof(w, d, POD_H, 0.9)
    objs += pod
    # tower walls and windows
    tw = kit.walls(bw, bd, tower_h, openings=[], lod=lod, cell=(6.0, fh) if lod == 0 else cell)
    for face, length in (("front", bw), ("back", bw), ("left", bd), ("right", bd)):
        cols = _spread(length - 3.0, 8 if length == bw else 5)
        rows = [k * fh + 0.8 for k in range(FLOORS)]
        tw += kit.window_panes(face, bw, bd, cols=cols, rows=rows, ww=2.6, wh=fh - 1.5, lod=lod)
    tw += kit.flat_roof(bw, bd, tower_h, 0.9)
    objs += kit.place(tw, y=POD_H, z=zt)

    # planted balconies (staggered per floor) and Sky Pods on the front face
    slab, planter, pod_glass, pod_frame = _Mesh(), _Mesh(), _Mesh(), _Mesh()
    for k in range(1, FLOORS - 1):
        y = POD_H + k * fh
        for face, length in (("front", bw), ("back", bw), ("left", bd), ("right", bd)):
            n_units = (3 - k % 2) if length == bw else 2
            cs = _spread(length - 2.0, n_units) if lod == 0 else [0.0]
            uw = 8.5 if lod == 0 else length * 0.8
            for c in cs:
                if face == "front" and k in SKY_FLOORS and abs(c) < 12.0:
                    continue  # a Sky Pod takes this bay
                if face == "front":
                    x0, x1, z0, z1 = c - uw / 2, c + uw / 2, zf, zf + INSET
                    plant_box = (x0, x1, z1 - 0.6, z1)
                elif face == "back":
                    x0, x1, z0, z1 = c - uw / 2, c + uw / 2, zb - INSET, zb
                    plant_box = (x0, x1, z0, z0 + 0.6)
                elif face == "right":
                    x0, x1, z0, z1 = bw / 2, bw / 2 + INSET, zt + c - uw / 2, zt + c + uw / 2
                    plant_box = (x1 - 0.6, x1, z0, z1)
                else:
                    x0, x1, z0, z1 = -bw / 2 - INSET, -bw / 2, zt + c - uw / 2, zt + c + uw / 2
                    plant_box = (x0, x0 + 0.6, z0, z1)
                slab.box(x0, x1, y - 0.25, y, z0, z1)
                if face in ("front", "back"):
                    planter.box(x0, x1, y, y + 0.8, plant_box[2], plant_box[3])
                else:
                    planter.box(plant_box[0], plant_box[1], y, y + 0.8, z0, z1)
        if k in SKY_FLOORS:  # a glazed Sky Pod cantilevered from the front face
            for px in (-6.0, 6.0):
                pod_glass.box(px - 4.0, px + 4.0, y + 0.1, y + fh - 0.4, zf, zf + INSET)
                pod_frame.box(px - 4.3, px + 4.3, y - 0.3, y + 0.1, zf, zf + INSET)
                pod_frame.box(px - 4.3, px + 4.3, y + fh - 0.4, y + fh - 0.15, zf, zf + INSET)
    objs += _keep(
        slab.obj("balcony_slabs", "secondary"),
        planter.obj("balcony_planters", "foliage"),
        pod_glass.obj("sky_pods", "glass", kit.window_seed()),
        pod_frame.obj("sky_pod_frames", "accent"),
    )

    # level-7 facilities terrace: a pool, a pavilion on four posts, planting along the edge
    zc = (zf + INSET + d / 2) / 2
    terrace, pool, planting = _Mesh(), _Mesh(), _Mesh()
    y_pool = POD_H + 0.06
    pool.face(
        [(-14, y_pool, zc - 1.6), (-2, y_pool, zc - 1.6), (-2, y_pool, zc + 1.6)]
        + [(-14, y_pool, zc + 1.6)],
        (0.0, 1.0, 0.0),
    )
    terrace.box(-14.4, -1.6, POD_H, POD_H + 0.3, zc - 2.0, zc + 2.0, skip=("bottom", "top"))
    for px in (4.0, 14.0):
        for pz in (zc - 1.6, zc + 1.6):
            terrace.box(px - 0.15, px + 0.15, POD_H, POD_H + 3.2, pz - 0.15, pz + 0.15)
    terrace.box(3.5, 14.5, POD_H + 3.2, POD_H + 3.5, zc - 2.0, zc + 2.0)
    planting.box(-w / 2 + 0.3, w / 2 - 0.3, POD_H, POD_H + 0.7, d / 2 - 1.0, d / 2 - 0.3)
    for sx in (-1.0, 1.0):
        x0, x1 = sorted((sx * (w / 2 - 0.3), sx * (w / 2 - 1.5)))
        planting.box(x0, x1, POD_H, POD_H + 0.7, zb - INSET, d / 2 - 1.0)
    objs += _keep(
        pool.obj("pool", "glass", kit.window_seed()),
        terrace.obj("terrace", "secondary"),
        planting.obj("terrace_planting", "foliage"),
    )

    # crown: plant room, lift overrun, cooling units, tank and mast
    crown, crown_m = _Mesh(), _Mesh()
    top = body_top + 0.9
    crown.box(-bw * 0.3, bw * 0.3, top, top + 3.5, zt - bd * 0.3, zt + bd * 0.3)
    crown.box(-4.0, 4.0, top + 3.5, top + 5.0, zt - 3.0, zt + 3.0)
    crown_m.box(bw * 0.3 + 0.5, bw * 0.3 + 4.5, top, top + 2.2, zt - 2.0, zt + 2.0)
    objs += _keep(crown.obj("crown", "secondary"), crown_m.obj("crown_plant", "metal"))
    objs += kit.prism(-bw * 0.3 - 2.5, zt, 2.2, top, top + 2.8, 10, "metal", name="tank")
    objs += kit.prism(0.0, zt, 0.4, top + 5.0, h, 6, "metal", r_top=0.0, name="mast")
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
    walls = kit.walls(
        hall_w,
        hall_d,
        hall_h,
        openings=[Opening("front", 0.0, 0.0, 3.4, 4.8, "door")],
        lod=lod,
        cell=(3.6, 3.0),
    )
    for face, length in (("front", hall_w), ("back", hall_w), ("left", hall_d), ("right", hall_d)):
        cs = _spread(length - 3, 8 if length == hall_w else 6)
        if face == "front":
            cs = [c for c in cs if abs(c) > 4.5]
        walls += kit.window_panes(
            face, hall_w, hall_d, cols=cs, rows=[3.4], ww=1.8, wh=4.2, lod=lod
        )
    walls += kit.flat_roof(hall_w, hall_d, hall_h, 0.8)
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
