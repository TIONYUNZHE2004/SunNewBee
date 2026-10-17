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
        body += kit.gable_roof(bw, main, eave, GABLE_PITCH, overhang=0.4, ridge_axis="z")
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
        trim = kit.panel(-bw / 2, -bw / 2 + 2.2, STOREY_M + 0.3, h, depth=0.08, role="accent")
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


BUILDERS: dict[str, Callable[[Variant, int], list]] = {
    "link_intermediate": _link,
    "link_long": _link,
    "superlink": _superlink,
    "semi_d": _semi_d,
    "bungalow": _bungalow,
    "townhouse": _townhouse,
}
