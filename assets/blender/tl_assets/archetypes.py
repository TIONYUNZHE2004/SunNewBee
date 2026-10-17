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


BUILDERS: dict[str, Callable[[Variant, int], list]] = {
    "link_intermediate": _link,
    "link_long": _link,
}
