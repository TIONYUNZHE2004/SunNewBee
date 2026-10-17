"""Archetype builders (imports bpy): `BUILDERS[asset_id](variant, lod) -> [objects]`.

Merged into `build.BUILDERS` when present. Sizes come from `specs.ASSETS` (the variant's
`size`), so a builder never hard-codes the footprint. LOD1 is the same builder with `lod=1`
(no frames, sills, gate or AC; windows are inset glass faces), LOD2 is `kit.far_block`.
"""

import math
from collections.abc import Callable

from . import kit
from .kit import Opening
from .specs import Variant

# --- link houses ------------------------------------------------------------------------

STOREY_M = 3.3  # ground floor height (first-floor slab)
GABLE_PITCH = 30.0  # [?] charcoal concrete tile roof
PORCH_H = 3.0  # car porch slab top
MAIN_MAX_D = 13.0  # two-storey body depth; a longer lot gets a single-storey rear kitchen
KITCHEN_H = 3.3
PARAPET = 0.6  # modern flat roof


def _porch_depth(d: float) -> float:
    return 5.0 if d < 20.0 else 5.5


def _front_openings(variant: str, w: float) -> list[Opening]:
    if variant == "gable":
        return [
            Opening("front", -w / 2 + 0.95, 0.0, 0.9, 2.1, "door"),
            Opening("front", w / 2 - 1.6, 0.9, 2.0, 1.4, "window"),
            Opening("front", -(w / 4 + 0.05), 4.2, 1.4, 1.4, "window"),
            Opening("front", w / 4 + 0.05, 4.2, 1.4, 1.4, "window"),
        ]
    return [  # modern: a glazed sliding door, a side door and one wide upper window
        Opening("front", -0.5, 0.0, 2.6, 2.3, "window"),
        Opening("front", w / 2 - 0.75, 0.0, 0.9, 2.2, "door"),
        Opening("front", 0.9, 4.4, 3.4, 1.5, "window"),
    ]


def _back_ground(face_w: float) -> list[Opening]:
    """Kitchen door and window on a back face (u is along -x seen from outside)."""
    return [
        Opening("back", face_w / 2 - 1.3, 0.0, 0.8, 2.1, "door"),
        Opening("back", -0.9, 1.1, 1.2, 1.0, "window"),
    ]


def _back_upper(w: float) -> list[Opening]:
    return [
        Opening("back", -(w / 4 + 0.2), 4.4, 1.2, 1.2, "window"),
        Opening("back", w / 4 + 0.2, 4.4, 1.2, 1.2, "window"),
    ]


def _link(variant: Variant, lod: int) -> list:
    """A two-storey link house: car porch at the front, body behind it, optional rear kitchen.

    `gable`: white walls, a charcoal tiled gable roof with its ridge along z, porch slab
    (Elmina Green / Denai Alam). `modern`: a flat roof behind a parapet, a brick accent panel
    and clean lines (Elmina Valley 2).
    """
    w, h, d = variant.size
    gable = variant.id == "gable"
    if lod >= 2:
        return kit.far_block((w, h, d), "gable" if gable else "flat", pitch_deg=GABLE_PITCH)

    porch = _porch_depth(d)
    body_d = d - porch
    main = min(body_d, MAIN_MAX_D)
    kitchen = body_d - main if body_d - main > 1.0 else 0.0
    main = body_d - kitchen
    z_front = d / 2 - porch
    z_main = z_front - main / 2
    eave = h - w / 2 * math.tan(math.radians(GABLE_PITCH)) if gable else h - PARAPET

    objs: list = []
    openings = _front_openings(variant.id, w) + _back_upper(w)
    if not kitchen:
        openings += _back_ground(w)
    body = kit.walls(w, main, eave, openings=openings, lod=lod)
    if gable:
        body += kit.gable_roof(w, main, eave, GABLE_PITCH, overhang=0.4, ridge_axis="z")
    else:
        body += kit.flat_roof(w, main, eave, PARAPET)
    objs += kit.place(body, z=z_main)

    if kitchen:
        k = kit.walls(
            w,
            kitchen,
            KITCHEN_H,
            openings=_back_ground(w),
            lod=lod,
            faces=("back", "left", "right"),
        )
        k += kit.flat_roof(w, kitchen, KITCHEN_H, 0.3)
        objs += kit.place(k, z=-d / 2 + kitchen / 2)

    # columns set back 0.6 m so the LOD0 gate pillars stand in front of them
    objs += kit.place(kit.car_porch(w, porch, PORCH_H, inset=0.6), z=d / 2)

    front: list = []
    if not gable:  # brick accent panel up the upper floor's left side, to the parapet top
        front += kit.panel(-w / 2, -1.0, STOREY_M + 0.3, h, depth=0.08, role="accent")
    if lod == 0:
        if gable:  # a string course at the first-floor line
            front += kit.panel(-w / 2, w / 2, STOREY_M - 0.1, STOREY_M + 0.02, role="primary")
        else:  # a thin canopy fin over the wide upper window
            front += kit.panel(-0.85, w / 2 - 0.15, 6.0, 6.12, depth=0.5, role="secondary")
    objs += kit.place(front, z=z_front)

    if lod == 0:
        objs += kit.place(kit.gate_and_fence(w), z=d / 2)
        ac = kit.ac_units(2, "back", w=w, d=main, y=3.7 if kitchen else 3.2)
        objs += kit.place(ac, z=z_main)
    return objs


# --- superlink, semi-d, bungalow, townhouse ----------------------------------------------

SOLAR_TILT = 10.0
BUNGALOW_PITCH = 20.0
BUNGALOW_EAVE = 2.95


def _superlink(variant: Variant, lod: int) -> list:
    """A two-storey modern house behind a flat parapet roof with rooftop solar panels and a
    skylight (Elmina Ridge). Car porch at the front, a terrace over it."""
    w, h, d = variant.size
    if lod >= 2:
        return kit.far_block((w, h, d), "flat")
    porch = 5.0
    main = d - porch
    z_front = d / 2 - porch
    z_main = z_front - main / 2
    eave = h - PARAPET
    openings = [
        Opening("front", -2.5, 0.0, 2.6, 2.3, "window"),
        Opening("front", w / 2 - 1.3, 0.0, 0.9, 2.2, "door"),
        Opening("front", -1.5, 4.4, 4.0, 1.5, "window"),
        Opening("front", w / 2 - 1.8, 4.4, 1.4, 1.5, "window"),
        Opening("right", 1.0, 1.0, 1.2, 1.2, "window"),
        Opening("right", 1.0, 4.4, 1.2, 1.2, "window"),
        Opening("left", -1.0, 4.4, 1.2, 1.2, "window"),
        *_back_ground(w),
        *_back_upper(w),
    ]
    body = kit.walls(w, main, eave, openings=openings, lod=lod)
    body += kit.flat_roof(w, main, eave, PARAPET)
    body += kit.skylight(1.2, 2.4, eave, x=2.2, z=main / 2 - 3.2, lod=lod)
    if lod == 0:  # rooftop solar, tilted towards the sun, inside the parapet
        body += kit.solar_panels(w - 3.0, main - 9.0, eave + 0.1, SOLAR_TILT, x=-0.6, z=-1.0)
    objs = kit.place(body, z=z_main)
    objs += kit.place(kit.car_porch(w, porch, PORCH_H, inset=0.6), z=d / 2)
    front = kit.panel(-w / 2, -3.9, STOREY_M + 0.3, h, depth=0.08, role="accent")
    front += kit.balcony(4.0, 1.2, PORCH_H + 0.5, lod=lod)  # a terrace over the porch
    if lod == 0:
        front += kit.panel(-3.7, w / 2 - 0.15, 6.2, 6.32, depth=0.5, role="secondary")
    objs += kit.place(front, z=z_front)
    if lod == 0:
        objs += kit.place(kit.gate_and_fence(w), z=d / 2)
        objs += kit.place(kit.ac_units(2, "back", w=w, d=main, y=3.2), z=z_main)
    return objs


def _semi_d(variant: Variant, lod: int) -> list:
    """One half of a semi-detached pair. The party wall is on -x and has no openings; a side
    garden (low wall and hedge) takes the +x part of the plot, inside the size."""
    w, h, d = variant.size
    gable = variant.id == "gable"
    if lod >= 2:
        return kit.far_block((w, h, d), "gable" if gable else "flat", pitch_deg=GABLE_PITCH)
    garden = 3.0
    bw = w - garden
    cx = -w / 2 + bw / 2  # body centre; its -x face is the party wall at x = -w / 2
    porch, kitchen = 5.5, 5.5
    main = d - porch - kitchen
    z_front = d / 2 - porch
    z_main = z_front - main / 2
    eave = h - bw / 2 * math.tan(math.radians(GABLE_PITCH)) if gable else h - PARAPET
    if gable:
        front = [
            Opening("front", -bw / 2 + 1.0, 0.0, 0.9, 2.1, "door"),
            Opening("front", bw / 2 - 1.8, 0.9, 2.0, 1.4, "window"),
            Opening("front", -0.4, 4.2, 1.4, 1.4, "window"),
            Opening("front", 2.4, 4.2, 1.4, 1.4, "window"),
        ]
    else:
        front = [
            Opening("front", -0.3, 0.0, 2.6, 2.3, "window"),
            Opening("front", bw / 2 - 0.9, 0.0, 0.9, 2.2, "door"),
            Opening("front", 0.5, 4.4, 3.0, 1.5, "window"),
        ]
    side = [  # garden side (+x) only: the -x party wall stays blank
        Opening("right", 1.5, 1.0, 1.4, 1.2, "window"),
        Opening("right", 1.5, 4.3, 1.2, 1.2, "window"),
    ]
    body = kit.walls(bw, main, eave, openings=front + side + _back_upper(bw), lod=lod)
    if gable:
        body += kit.gable_roof(
            bw, main, eave, GABLE_PITCH, overhang=0.4, ridge_axis="z", across_overhang=(0.0, 0.4)
        )  # no overhang past the party wall (-x)
    else:
        body += kit.flat_roof(bw, main, eave, PARAPET)
    objs = kit.place(body, x=cx, z=z_main)
    k = kit.walls(
        bw, kitchen, KITCHEN_H, openings=_back_ground(bw), lod=lod, faces=("back", "left", "right")
    )
    k += kit.flat_roof(bw, kitchen, KITCHEN_H, 0.3)
    objs += kit.place(k, x=cx, z=-d / 2 + kitchen / 2)
    objs += kit.place(kit.car_porch(bw, porch, PORCH_H, inset=0.6), x=cx, z=d / 2)
    if not gable:
        trim = kit.panel(-bw / 2 + 0.3, -bw / 2 + 2.2, STOREY_M + 0.3, h, depth=0.08, role="accent")
        objs += kit.place(trim, x=cx, z=z_front)
    # side garden: a low front wall, a hedge along the +x edge
    objs += kit.block(
        -w / 2 + bw, w / 2, 0.0, 0.9, d / 2 - 0.3, d / 2, "primary", name="garden_wall"
    )
    objs += kit.block(
        w / 2 - 0.5, w / 2, 0.0, 1.2, -d / 2 + kitchen, d / 2 - 0.3, "foliage", name="hedge"
    )
    if lod == 0:
        objs += kit.place(kit.gate_and_fence(bw), x=cx, z=d / 2)
        ac = kit.ac_units(2, "back", w=bw, d=kitchen, y=1.0)
        objs += kit.place(ac, x=cx, z=-d / 2 + kitchen / 2)
    return objs


def _bungalow(variant: Variant, lod: int) -> list:
    """A single-storey house under a hip roof, with a wide front porch."""
    w, h, d = variant.size
    if lod >= 2:
        return kit.far_block((w, h, d), "hip", pitch_deg=BUNGALOW_PITCH)
    porch = 4.0
    main = d - porch
    z_front = d / 2 - porch
    z_main = z_front - main / 2
    openings = [
        Opening("front", 0.0, 0.0, 1.0, 2.1, "door"),
        Opening("front", -3.6, 0.9, 2.2, 1.3, "window"),
        Opening("front", 3.6, 0.9, 2.2, 1.3, "window"),
        Opening("right", 0.0, 0.9, 1.6, 1.3, "window"),
        Opening("left", 0.0, 0.9, 1.6, 1.3, "window"),
        Opening("back", -3.0, 0.9, 1.6, 1.3, "window"),
        Opening("back", 3.0, 0.0, 1.0, 2.1, "door"),
    ]
    body = kit.walls(w, main, BUNGALOW_EAVE, openings=openings, lod=lod)
    body += kit.hip_roof(w, main, BUNGALOW_EAVE, BUNGALOW_PITCH, overhang=0.5)
    objs = kit.place(body, z=z_main)
    objs += kit.place(kit.car_porch(10.0, porch - 0.5, 2.55, slab=0.15, inset=0.3), z=d / 2)
    if lod == 0:
        objs += kit.place(kit.gate_and_fence(w), z=d / 2)
        objs += kit.place(kit.ac_units(2, "back", w=w, d=main, y=1.2, u=-3.0), z=z_main)
    return objs


def _townhouse(variant: Variant, lod: int) -> list:
    """A two-storey stacked unit with two doors on the front (lower unit and the upper unit's
    stair door), a balcony and a flat parapet roof."""
    w, h, d = variant.size
    if lod >= 2:
        return kit.far_block((w, h, d), "flat")
    main = d - 1.0
    z_main = -0.5
    eave = h - 0.5
    openings = [
        Opening("front", -2.2, 0.0, 0.9, 2.1, "door"),
        Opening("front", 0.2, 0.9, 1.4, 1.3, "window"),
        Opening("front", 2.4, 0.0, 0.9, 2.1, "door"),
        Opening("front", -1.5, 3.5, 1.4, 1.4, "window"),
        Opening("front", 1.8, 3.5, 1.9, 1.6, "window"),
        Opening("back", -1.5, 1.0, 1.2, 1.2, "window"),
        Opening("back", 1.5, 4.0, 1.2, 1.2, "window"),
    ]
    body = kit.walls(w, main, eave, openings=openings, lod=lod)
    body += kit.flat_roof(w, main, eave, 0.5)
    objs = kit.place(body, z=z_main)
    front = kit.balcony(w - 0.4, 1.0, 3.2, lod=lod)
    if lod == 0:
        front += kit.panel(-w / 2, w / 2, 3.0, 3.12, depth=0.06, role="secondary")
    objs += kit.place(front, z=d / 2 - 1.0)
    if lod == 0:
        objs += kit.place(kit.ac_units(2, "back", w=w, d=main, y=2.6), z=z_main)
    return objs


# --- shop-office, high-rise, school, mosque, factory, mall, generic -----------------------

FIVE_FOOT = 1.8  # covered walkway depth, inside the shop-office size
SHOP_STOREY = 3.8  # ground storey (shopfront); the upper floors sit on the five-foot way


def _spread(length: float, n: int) -> list[float]:
    """n centres evenly spread over `length` (centred on 0)."""
    return [(k + 0.5) * length / n - length / 2 for k in range(n)]


def _shop_office(variant: Variant, lod: int) -> list:
    """One 22-foot shophouse unit: a shopfront under a covered five-foot way, two floors of large
    windows above it (cantilevered over the way), a blank sign band, a flat roof with parapet."""
    w, h, d = variant.size
    if lod >= 2:
        return kit.far_block((w, h, d), "flat")
    parapet = 0.8
    eave = h - parapet
    up_h = eave - SHOP_STOREY
    gd = d - FIVE_FOOT  # ground block depth; the walkway takes the rest
    ground = kit.walls(
        w,
        gd,
        SHOP_STOREY,
        openings=[
            Opening("front", -0.3, 0.1, 4.4, 3.0, "shopfront"),
            Opening("front", w / 2 - 0.85, 0.1, 0.9, 2.5, "door"),
            Opening("back", 0.0, 0.0, 1.0, 2.1, "door"),
        ],
        lod=lod,
        cell=(1.6, 1.4),
    )
    objs = kit.place(ground, z=-FIVE_FOOT / 2)
    upper = kit.walls(w, d, up_h, openings=[], lod=lod, cell=(1.6, 1.6))
    upper += kit.window_panes(
        "front", w, d, cols=[0.0], rows=[1.1, 4.3], ww=w - 1.4, wh=1.9, lod=lod, border=0.12
    )
    upper += kit.window_panes(
        "back", w, d, cols=[-1.5, 1.5], rows=[1.1, 4.3], ww=1.6, wh=1.6, lod=lod
    )
    upper += kit.flat_roof(w, d, up_h, parapet)
    objs += kit.place(upper, y=SHOP_STOREY)
    objs += kit.place(kit.five_foot_way(w, FIVE_FOOT, SHOP_STOREY), z=d / 2)
    band = kit.sign_band(w - 0.8, 0.8, SHOP_STOREY + 0.1)  # blank: role light, no text
    objs += kit.place(band, z=d / 2)
    if lod == 0:
        objs += kit.place(kit.ac_units(2, "back", w=w, d=d, y=SHOP_STOREY + 1.0, u=1.0))
        objs += kit.block(
            -0.8, 0.8, eave, eave + 0.7, -d / 2 + 2.0, -d / 2 + 3.6, "metal", name="tank"
        )
    return objs


def _highrise(variant: Variant, lod: int) -> list:
    """A podium with a shopfront, a tower of repeated floor bands (windows, planted balconies on
    the long faces) and a crown with a plant room on the roof."""
    w, h, d = variant.size
    if lod >= 2:
        return kit.far_block((w, h, d), "flat")
    podium = 7.0 if h < 60 else 8.0
    top = h - 2.2  # tower roof deck; the plant room tops out at h
    n = round((top - podium) / 3.3)
    fh = (top - podium) / n
    wt, dt = w - 6.0, d - 6.0
    cols = _spread(wt, max(3, int(wt // 3.2)))
    rows = [k * fh + 0.9 for k in range(n)]
    pod = kit.walls(
        w,
        d,
        podium,
        openings=[Opening("front", 0.0, 0.1, 8.0, 3.8, "shopfront")],
        lod=lod,
        cell=(3.2, 3.5),
    )
    for face, length in (("back", w), ("left", d), ("right", d)):
        cs = _spread(length - 2, 6 if length == w else 4)
        pod += kit.window_panes(face, w, d, cols=cs, rows=[4.0], ww=2.0, wh=1.8, lod=lod)
    pod += kit.flat_roof(w, d, podium, 0.6)
    objs = pod
    tower = kit.walls(wt, dt, top - podium, openings=[], lod=lod, cell=(4.0, 4.0))
    for face, length in (("front", wt), ("back", wt), ("left", dt), ("right", dt)):
        if lod == 0:
            cs = cols if length == wt else _spread(dt, max(3, int(dt // 3.2)))
            tower += kit.window_panes(face, wt, dt, cols=cs, rows=rows, ww=2.2, wh=1.7, lod=lod)
        else:  # LOD1: one glass ribbon per floor
            tower += kit.window_panes(
                face, wt, dt, cols=[0.0], rows=rows, ww=length - 1.2, wh=1.7, lod=lod
            )
    if lod == 0:
        for k in range(1, n):  # floor bands: a slab edge every storey
            y = k * fh
            tower += kit.block(
                -wt / 2 - 0.1,
                wt / 2 + 0.1,
                y - 0.12,
                y + 0.12,
                -dt / 2 - 0.1,
                dt / 2 + 0.1,
                "secondary",
                name="floor_band",
            )
        for k in range(1, n):  # planted balconies on the two long faces
            y = k * fh
            for c in (cols[1], cols[-2]):
                for s in (1.0, -1.0):
                    z0, z1 = (dt / 2, dt / 2 + 1.2) if s > 0 else (-dt / 2 - 1.2, -dt / 2)
                    tower += kit.block(
                        c - 1.2, c + 1.2, y - 0.15, y, z0, z1, "secondary", name="balcony"
                    )
                    zp = (z1 - 0.4, z1) if s > 0 else (z0, z0 + 0.4)
                    tower += kit.block(
                        c - 1.2, c + 1.2, y, y + 0.55, zp[0], zp[1], "foliage", name="planter"
                    )
    tower += kit.flat_roof(wt, dt, top - podium, 1.0)
    objs += kit.place(tower, y=podium)
    # crown: plant room, a lift overrun and a water tank
    objs += kit.block(
        -wt * 0.3, wt * 0.3, top, h, -dt * 0.25, dt * 0.25, "metal", name="plant_room"
    )
    objs += kit.block(
        wt * 0.32, wt * 0.42, top, top + 1.2, -dt * 0.1, dt * 0.1, "primary", name="lift"
    )
    if lod == 0:
        objs += kit.prism(-wt * 0.35, dt * 0.3, 1.1, top, top + 1.8, 8, "metal", name="tank")
    return objs


def _school(variant: Variant, lod: int) -> list:
    """One 20 m bay of a JKR block: four storeys of classrooms, an open corridor with railings on
    +z, a stair core at each end and a low pitched roof over everything."""
    w, h, d = variant.size
    pitch = 14.9
    if lod >= 2:
        return kit.far_block((w, h, d), "gable", pitch_deg=pitch, ridge_axis="x")
    storey, corridor, core_w = 3.0, 2.4, 3.0
    eave = h - d / 2 * math.tan(math.radians(pitch))
    bw = w - 2 * core_w  # body between the cores
    bd = d - corridor
    zb = -corridor / 2  # body centre: the corridor is on +z
    doors = [
        Opening("front", u, v, 1.0, 2.1, "door")
        for u in _spread(bw, 4)
        for v in (0.0, 3.0, 6.0, 9.0)
    ]
    body = kit.walls(
        bw, bd, eave, openings=doors, lod=lod, cell=(2.4, 1.5), faces=("front", "back")
    )
    rows = [k * storey + 1.0 for k in range(4)]
    # front: between the doors; back: one per bay. Every pane stays inside the body wall.
    for face, cols in (("front", _spread(bw, 4)[:-1]), ("back", _spread(bw, 4))):
        if face == "front":
            cols = [c + bw / 8 for c in cols]
        body += kit.window_panes(face, bw, bd, cols=cols, rows=rows, ww=1.6, wh=1.2, lod=lod)
    objs = kit.place(body, z=zb)
    for sx, face in ((-1.0, "left"), (1.0, "right")):
        core = kit.walls(
            core_w, d, eave, openings=[], lod=lod, cell=(1.5, 2.0), faces=("front", "back", face)
        )
        for f in ("front", "back"):
            core += kit.window_panes(
                f, core_w, d, cols=[0.0], rows=[1.6], ww=1.0, wh=eave - 3.2, lod=lod, border=0.12
            )
        objs += kit.place(core, x=sx * (w / 2 - core_w / 2))
    for k in range(1, 4):  # corridor floors with railings, between the cores
        objs += kit.place(kit.balcony(bw, corridor, k * storey, lod=lod), z=d / 2 - corridor)
    objs += kit.gable_roof(w, d, eave, pitch, 0.4, "x")
    return objs


def _mosque(variant: Variant, lod: int) -> list:
    """A generic prayer hall: a rectangular hall under a flat roof, a central drum and accent
    dome, four small corner domes, a front arcade and one minaret by the front-right corner."""
    w, h, d = variant.size
    k = h / 15.0  # vertical proportions are set for the 15 m size
    hall_w, hall_d, hall_h = w, d - 4.0, 0.6 * h  # a 4 m arcade takes the front
    zc = -d / 2 + hall_d / 2
    z_front = zc + hall_d / 2  # the hall's front wall
    dome_r = hall_d / 4
    gallery = 2.7  # circumradius of the (45 degree) square gallery; half side = gallery / sqrt 2
    mx = w / 2 - gallery / math.sqrt(2)  # the gallery's outer edges stay inside w and d
    mz = d / 2 - gallery / math.sqrt(2)
    segs, rings = (16, 5) if lod == 0 else (8, 2)
    if lod >= 2:
        objs = kit.far_block((w, hall_h + 0.8, d), "flat")
        objs += kit.dome(0.0, zc, dome_r, hall_h + 0.8, "accent", segs=8, rings=2)
        objs += kit.prism(mx, mz, 1.5, 0.0, 1.8 * h, 4, "primary", name="minaret", phase_deg=45.0)
        return objs
    walls = kit.walls(
        hall_w,
        hall_d,
        hall_h,
        openings=[Opening("front", 0.0, 0.0, 3.2, 4.6, "door")],
        lod=lod,
        cell=(3.6, 3.0),
    )
    for face, length in (("front", hall_w), ("back", hall_w), ("left", hall_d), ("right", hall_d)):
        cs = _spread(length - 2, 6 if length == hall_w else 5)
        if face == "front":
            cs = [c for c in cs if abs(c) > 4.0]
        walls += kit.window_panes(
            face, hall_w, hall_d, cols=cs, rows=[3.2], ww=1.8, wh=3.8, lod=lod
        )
    walls += kit.flat_roof(hall_w, hall_d, hall_h, 0.8)
    objs = kit.place(walls, z=zc)
    # front arcade between the hall's front wall and the front edge, clear of the minaret
    arcade_w, arch_h = w * 2 / 3, 4.4
    objs += kit.block(
        -arcade_w / 2,
        arcade_w / 2,
        arch_h,
        arch_h + 0.35,
        z_front,
        d / 2,
        "secondary",
        name="arcade",
    )
    for x in _spread(arcade_w - 0.6, 7):
        objs += kit.block(
            x - 0.3, x + 0.3, 0.0, arch_h, d / 2 - 0.6, d / 2, "primary", name="column"
        )
    # drum and accent dome with a finial
    base = hall_h + 0.8
    objs += kit.prism(0.0, zc, dome_r, base, base + 2.2, segs, "primary", name="drum", top=False)
    objs += kit.dome(0.0, zc, dome_r + 0.3, base + 2.2, "accent", segs=segs, rings=rings)
    tip = base + 2.2 + dome_r + 0.3
    objs += kit.prism(0.0, zc, 0.35, tip, tip + 1.6, 6, "metal", r_top=0.0, name="finial")
    if lod == 0:
        for sx in (-1.0, 1.0):
            for sz in (-1.0, 1.0):
                objs += kit.dome(
                    sx * w * 0.4,
                    zc + sz * hall_d * 0.35,
                    1.8,
                    base,
                    "accent",
                    segs=10,
                    rings=3,
                    name="small",
                )
    # minaret: square shaft, a gallery, a narrower upper shaft, a domed cap
    g0, g1, up, cap = 1.2 * h, 1.2 * h + 0.5, 1.53 * h, 1.53 * h  # shaft, gallery, upper, cap
    objs += kit.prism(mx, mz, 2.1, 0.0, g0, 4, "primary", name="minaret_shaft", phase_deg=45.0)
    objs += kit.prism(
        mx, mz, gallery, g0, g1, 4, "secondary", name="minaret_gallery", phase_deg=45.0
    )
    objs += kit.prism(mx, mz, 1.5, g1, up, 4, "primary", name="minaret_upper", phase_deg=45.0)
    objs += kit.dome(mx, mz, 1.3, cap, "accent", segs=8, rings=2 if lod else 3, name="cap")
    objs += kit.prism(mx, mz, 0.12, cap + 1.3, cap + 3.6 * k, 4, "metal", r_top=0.0, name="finial")
    return objs


def _factory(variant: Variant, lod: int) -> list:
    """A portal-frame shed under a low-pitch metal roof with roller doors, and an office annex
    on +z."""
    w, h, d = variant.size
    pitch = 10.0
    if lod >= 2:
        return kit.far_block((w, h, d), "gable", pitch_deg=pitch)
    annex_d, annex_h, annex_w = 8.0, 6.2, 13.0
    shed_d = d - annex_d
    zs = -d / 2 + shed_d / 2
    eave = h - w / 2 * math.tan(math.radians(pitch))
    shed_ops = [
        Opening("front", 6.0, 0.0, 5.0, 5.0, "garage"),
        Opening("right", -4.0, 0.0, 4.5, 4.5, "garage"),
        Opening("left", 8.0, 0.0, 0.9, 2.1, "door"),
        Opening("back", 0.0, 0.0, 5.0, 5.0, "garage"),
    ]
    shed = kit.walls(w, shed_d, eave, openings=shed_ops, lod=lod, cell=(4.0, 2.5))
    for face in ("left", "right"):
        cs = _spread(shed_d - 4, 7)
        shed += kit.window_panes(
            face, w, shed_d, cols=cs, rows=[eave - 2.0], ww=2.4, wh=1.0, lod=lod
        )
    shed += kit.gable_roof(w, shed_d, eave, pitch, 0.4, "z", roof_role="metal")
    objs = kit.place(shed, z=zs)
    ops = [
        Opening("front", -2.0, 0.0, 1.0, 2.2, "door"),
        Opening("front", 3.2, 1.0, 2.2, 1.3, "window"),
        Opening("left", 0.0, 1.0, 2.0, 1.3, "window"),
    ]
    annex = kit.walls(annex_w, annex_d, annex_h, openings=ops, lod=lod, cell=(3.2, 2.2))
    annex += kit.window_panes(
        "front", annex_w, annex_d, cols=[-2.0, 3.2], rows=[3.8], ww=2.2, wh=1.3, lod=lod
    )
    annex += kit.flat_roof(annex_w, annex_d, annex_h, 0.4)
    objs += kit.place(annex, x=-w / 2 + annex_w / 2, z=d / 2 - annex_d / 2)
    return objs


def _mall(variant: Variant, lod: int) -> list:
    """A big-box retail unit: a plain wall with accent stripes, a glazed entrance under a
    canopy with a blank sign band, loading doors at the back and plant on the roof."""
    w, h, d = variant.size
    if lod >= 2:
        return kit.far_block((w, h, d), "flat")
    canopy_d, parapet = 6.0, 0.8
    bd = d - canopy_d
    eave = h - parapet
    zb = -d / 2 + bd / 2
    ops = [
        Opening("front", 0.0, 0.0, 16.0, 4.4, "shopfront"),
        Opening("front", -23.0, 0.0, 3.0, 2.6, "door"),
        Opening("back", -12.0, 0.0, 4.0, 4.2, "garage"),
        Opening("back", 0.0, 0.0, 4.0, 4.2, "garage"),
        Opening("back", 12.0, 0.0, 4.0, 4.2, "garage"),
    ]
    body = kit.walls(w, bd, eave, openings=ops, lod=lod, cell=(6.0, 4.0))
    body += kit.window_panes(
        "front", w, bd, cols=[-14.0, 14.0, 22.0], rows=[5.0], ww=4.0, wh=1.4, lod=lod
    )
    body += kit.flat_roof(w, bd, eave, parapet)
    objs = kit.place(body, z=zb)
    objs += kit.place(kit.car_porch(26.0, canopy_d, 5.6, inset=0.6), z=d / 2)
    objs += kit.place(kit.sign_band(14.0, 1.2, 5.8), z=zb + bd / 2)
    stripes = kit.panel(-w / 2, -w / 2 + 1.5, 0.0, eave, depth=0.15, role="accent")
    stripes += kit.panel(w / 2 - 1.5, w / 2, 0.0, eave, depth=0.15, role="accent")
    stripes += kit.panel(-w / 2, w / 2, eave - 0.9, eave, depth=0.15, role="accent")
    objs += kit.place(stripes, z=zb + bd / 2)
    if lod == 0:
        for x in (-18.0, -6.0, 6.0, 18.0):  # rooftop plant
            objs += kit.block(x - 2.0, x + 2.0, eave, eave + 1.2, -6.0, -1.0, "metal", name="plant")
    return objs


def _generic(variant: Variant, lod: int) -> list:
    """A neutral three-storey block: a regular grid of applied windows, a ground-floor door, a
    projecting cornice and a parapet. Details are coarse so it reads when the loader scales it."""
    w, h, d = variant.size
    if lod >= 2:
        return kit.far_block((w, h, d), "flat")
    parapet = 0.6
    eave = h - parapet
    # No cut openings: the loader scales this in x and z by 0.3-4, so a cut door would become
    # a slit or a garage gap. The door is an applied panel, the windows applied glass quads
    # 1.5 m wide (0.45 m at 0.3x, 6 m at 4x), three columns per face.
    cols = _spread(w - 1.0, 3)
    rows = [0.9, 3.4, 5.9]
    objs = kit.walls(w, d, eave - 0.4, openings=[], lod=lod, cell=(2.5, 2.0))
    objs += kit.place(kit.panel(-0.7, 0.7, 0.0, 2.3, depth=0.06, role="accent"), z=d / 2)
    for face in ("front", "back", "left", "right"):
        r = rows[1:] if face == "front" and abs(cols[1]) < 0.1 else rows
        objs += kit.window_panes(face, w, d, cols=cols, rows=r, ww=1.5, wh=1.5, lod=lod, border=0.1)
    objs += kit.window_panes(
        "front", w, d, cols=[cols[0], cols[2]], rows=[0.9], ww=1.5, wh=1.5, lod=lod, border=0.1
    )
    objs += kit.block(
        -w / 2 - 0.2,
        w / 2 + 0.2,
        eave - 0.4,
        eave,
        -d / 2 - 0.2,
        d / 2 + 0.2,
        "secondary",
        name="cornice",
    )
    objs += kit.flat_roof(w, d, eave, parapet)
    return objs


BUILDERS: dict[str, Callable[[Variant, int], list]] = {
    "link_intermediate": _link,
    "link_long": _link,
    "superlink": _superlink,
    "semi_d": _semi_d,
    "bungalow": _bungalow,
    "townhouse": _townhouse,
    "shop_office": _shop_office,
    "highrise": _highrise,
    "school": _school,
    "mosque": _mosque,
    "factory": _factory,
    "mall": _mall,
    "generic": _generic,
}
