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
GABLE_PITCH = 30.0  # [?] charcoal concrete tile roof (other archetypes)
PORCH_H = 3.0  # car porch slab top
MAIN_MAX_D = 13.0  # two-storey body depth (EG4 A1 upper floor 13.2 m); the rest is a kitchen
KITCHEN_H = 3.3
PARAPET = 0.6  # flat-roof parapet (other archetypes)

# Owner gate A round 1 (Elmina Green 4 design 3): ridge parallel to the street, gable ends on
# the party walls with no overhang so a row reads as one roof; the upper floor is a white frame
# around a brick panel with a gridded dark-framed window and a breeze-block screen beside it.
LINK_EAVE = {"gable": 6.4, "modern": 7.2}  # front/back wall top
MODERN_PITCH = 8.0  # low pitch behind the front parapet
EAVE_OVERHANG = (0.4, 0.6)  # (back, front)
FRAME_D = 0.3  # white frame proud of the upper-floor wall
FRAME_JAMB = 0.25
BRICK_D = 0.05
SCREEN_W = 1.4  # breeze-block screen width (about a quarter of the frontage)


def _porch_depth(d: float) -> float:
    return 5.0 if d < 20.0 else 5.5


def _upper_box(variant: str) -> tuple[float, float]:
    """(bottom, top) of the brick-and-screen field inside the white frame."""
    if variant == "gable":  # the top band stays under the front eave (0.6 m overhang)
        return STOREY_M + 0.3, LINK_EAVE["gable"] - 0.75
    return STOREY_M + 0.3, LINK_EAVE["modern"] - 0.45


def _upper_window(variant: str, w: float) -> Opening:
    """The big gridded upper window, inside the brick panel beside the screen."""
    yb, yt = _upper_box(variant)
    inner0, inner1 = -w / 2 + FRAME_JAMB, w / 2 - FRAME_JAMB
    ww = 2.8 if variant == "gable" else 3.0
    if variant == "gable":  # screen on the right
        u1 = inner1 - SCREEN_W - 0.35
        u0 = u1 - ww
    else:  # screen on the left
        u0 = inner0 + SCREEN_W + 0.35
        u1 = u0 + ww
    v0, v1 = yb + 0.25, yt - 0.3
    grid = (4, 2) if variant == "gable" else (3, 1)
    return Opening("front", (u0 + u1) / 2, v0, ww, v1 - v0, "window", grid=grid)


def _front_openings(variant: str, w: float) -> list[Opening]:
    ground = [  # a gridded sliding glass door onto the porch and a solid side door
        Opening("front", -0.9, 0.0, 3.0, 2.4, "window", grid=(4, 1)),
        Opening("front", w / 2 - 0.8, 0.0, 0.9, 2.2, "door"),
    ]
    return [*ground, _upper_window(variant, w)]


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


def _upper_facade(variant: str, w: float, h: float, lod: int) -> list:
    """The white frame, the brick panel around the window and the breeze-block screen
    (front-anchored on the body's front wall)."""
    yb, yt = _upper_box(variant)
    eave = LINK_EAVE[variant]
    x0, x1 = -w / 2, w / 2
    i0, i1 = x0 + FRAME_JAMB, x1 - FRAME_JAMB
    objs = kit.panel(x0, x1, STOREY_M - 0.1, yb, depth=FRAME_D, role="primary")  # A/C ledge
    if variant == "gable":  # the top band runs up into the eave slab (its top is hidden)
        top = eave - 0.15
        objs += kit.panel(x0, x1, yt, top, depth=FRAME_D, role="primary", hidden=("top",))
    else:  # the parapet hides the low-pitch roof from the street
        objs += kit.block(x0, x1, yt, h, 0.0, FRAME_D, "primary", name="parapet")
    for jx0, jx1 in ((x0, i0), (i1, x1)):  # jambs between the ledge and the band
        objs += kit.panel(jx0, jx1, yb, yt, depth=FRAME_D, role="primary", hidden=("top", "bottom"))
    win = _upper_window(variant, w)
    wu0, wu1, wv0, wv1 = win.rect
    if variant == "gable":
        s0, s1, b0, b1 = i1 - SCREEN_W, i1, i0, i1 - SCREEN_W
    else:
        s0, s1, b0, b1 = i0, i0 + SCREEN_W, i0 + SCREEN_W, i1
    for bx0, bx1, by0, by1 in (  # brick around the window hole
        (b0, wu0, yb, yt),
        (wu1, b1, yb, yt),
        (wu0, wu1, yb, wv0),
        (wu0, wu1, wv1, yt),
    ):
        if bx1 - bx0 > 0.01 and by1 - by0 > 0.01:
            objs += kit.panel(bx0, bx1, by0, by1, depth=BRICK_D, role="accent")
    objs += kit.screen_block(s0, s1, yb, yt, lod=lod)
    return objs


def _link(variant: Variant, lod: int) -> list:
    """A two-storey link house: car porch at the front, body behind it, optional rear kitchen.

    Both variants: the ridge runs along x (parallel to the street), the gable ends sit on the
    party walls with no overhang, and the upper floor is a white frame around a brick panel, a
    gridded window and a breeze-block screen; brick gate pillars and a dark gate. `gable`: a
    charcoal tiled roof whose eave overhangs the frame (Elmina Green). `modern`: a low-pitch
    roof hidden behind a front parapet, the screen on the other side (Elmina Valley 2).
    """
    w, h, d = variant.size
    vid = variant.id
    eave = LINK_EAVE[vid]
    porch = _porch_depth(d)
    body_d = d - porch
    main = min(body_d, MAIN_MAX_D)
    kitchen = body_d - main if body_d - main > 1.0 else 0.0
    main = body_d - kitchen
    gable_pitch = math.degrees(math.atan((h - eave) / (main / 2)))  # ridge exactly at h
    pitch = gable_pitch if vid == "gable" else MODERN_PITCH
    if lod >= 2:  # same roof form: the gable keeps its eave height, modern its low pitch
        far_pitch = math.degrees(math.atan((h - eave) / (d / 2))) if vid == "gable" else pitch
        return kit.far_block((w, h, d), "gable", pitch_deg=far_pitch, ridge_axis="x")

    z_front = d / 2 - porch
    z_main = z_front - main / 2

    objs: list = []
    openings = _front_openings(vid, w) + _back_upper(w)
    if not kitchen:
        openings += _back_ground(w)
    # the white frame, brick and screen hide the upper front wall (around the window hole)
    yb, yt = _upper_box(vid)
    top = eave  # the gable's top band runs into the eave slab; modern's parapet is above
    wu0, wu1, wv0, wv1 = _upper_window(vid, w).rect
    covered = [
        ("front", -w / 2, w / 2, STOREY_M - 0.1, wv0),
        ("front", -w / 2, w / 2, wv1, top),
        ("front", -w / 2, wu0, wv0, wv1),
        ("front", wu1, w / 2, wv0, wv1),
    ]
    body = kit.walls(w, main, eave, openings=openings, lod=lod, covered=covered)
    overhang = EAVE_OVERHANG if vid == "gable" else (EAVE_OVERHANG[0], 0.0)
    body += kit.gable_roof(
        w, main, eave, pitch, ridge_axis="x", across_overhang=overhang, end_overhang=0.0
    )
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
    objs += kit.place(_upper_facade(vid, w, h, lod), z=z_front)

    if lod == 0:
        gate = kit.gate_and_fence(w, pillar_role="accent", gate_role="dark", low_wall=0.3)
        # a low brick wall on one party line (each unit owns its right one: no doubled walls)
        gate += kit.block(w / 2 - 0.2, w / 2, 0.0, 1.2, -3.0, -0.3, "accent", name="side_wall")
        objs += kit.place(gate, z=d / 2)
        ac = kit.ac_units(2, "back", w=w, d=main, y=3.7 if kitchen else 3.2)
        objs += kit.place(ac, z=z_main)
    return objs


# --- superlink, semi-d, bungalow, townhouse ----------------------------------------------

SOLAR_TILT = 10.0
BUNGALOW_EAVE = 6.3  # two-storey detached: eaves above the upper windows, hip ridge at h
TOWNHOUSE_PITCH = 5.0  # low pitch hidden behind the front parapet
DECK = "metal"  # a light-grey deck: nothing seen from above is a large dark slab


def _covered_front(vid: str, w: float, eave: float) -> list:
    """Wall areas the link-style white frame, brick and screen hide (see `_upper_facade`)."""
    wu0, wu1, wv0, wv1 = _upper_window(vid, w).rect
    return [
        ("front", -w / 2, w / 2, STOREY_M - 0.1, wv0),
        ("front", -w / 2, w / 2, wv1, eave),
        ("front", -w / 2, wu0, wv0, wv1),
        ("front", wu1, w / 2, wv0, wv1),
    ]


def _superlink(variant: Variant, lod: int) -> list:
    """Elmina Ridge 2: a two-storey box with a deep dark flying roof canopy over the centre bay,
    full-height black-framed glass on both floors, a vertical timber-louvre screen, a timber
    door, white box gate pillars with a solid white wall and a dark gate. The roof deck is white
    and carries the rooftop solar panels and a skylight."""
    w, h, d = variant.size
    if lod >= 2:
        return kit.far_block((w, h, d), "flat")
    porch = 5.0
    main = d - porch
    z_front = d / 2 - porch
    z_main = z_front - main / 2
    eave = h - PARAPET
    up0, up1 = STOREY_M + 0.3, 7.6
    louvre = (-5.3, -2.2)
    openings = [
        Opening("front", -2.0, 0.0, 4.6, 2.7, "window", grid=(5, 1)),
        Opening("front", 3.2, 0.0, 1.1, 2.6, "door"),  # timber door (accent leaf)
        Opening("front", 4.9, 0.0, 0.8, 2.6, "window", grid=(1, 3)),
        Opening("front", 0.5, up0, 4.0, up1 - up0, "window", grid=(4, 2)),  # centre bay
        Opening("front", 3.6, up0, 0.9, up1 - up0, "window", grid=(1, 3)),
        Opening("right", 1.0, 1.0, 1.2, 1.2, "window"),
        Opening("right", 1.0, 4.4, 1.2, 1.2, "window"),
        Opening("left", -1.0, 4.4, 1.2, 1.2, "window"),
        *_back_ground(w),
        *_back_upper(w),
    ]
    covered = [("front", louvre[0], louvre[1], up0, up1)]
    body = kit.walls(w, main, eave, openings=openings, lod=lod, covered=covered)
    body += kit.flat_roof(w, main, eave, PARAPET, deck_role="primary", cell=1.6)
    body += kit.skylight(1.2, 2.4, eave, x=-3.5, z=4.0, lod=lod)
    if lod == 0:  # rooftop solar, tilted towards the sun, inside the parapet
        body += kit.solar_panels(w - 3.0, main - 9.0, eave + 0.1, SOLAR_TILT, x=-0.6, z=-1.0)
    objs = kit.place(body, z=z_main)
    objs += kit.place(kit.car_porch(w, porch, PORCH_H, inset=0.6), z=d / 2)
    front = kit.louvre_screen(louvre[0], louvre[1], up0, up1, lod=lod)
    # the deep dark flying roof over the centre bay: 1.5 m out front, 1.5 m back over the deck
    front += kit.block(-2.0, 4.4, eave - 0.1, h + 0.05, -1.5, 1.5, "secondary", name="canopy")
    if lod == 0:  # a dark fascia band at the first-floor line
        front += kit.panel(
            -w / 2, w / 2, STOREY_M - 0.15, STOREY_M + 0.15, depth=0.15, role="secondary"
        )
    objs += kit.place(front, z=z_front)
    if lod == 0:  # white box pillars, a solid white wall segment on the left, a dark gate
        gw = 8.0
        gate = kit.gate_and_fence(gw, h=1.6, pillar_role="primary", gate_role="dark")
        objs += kit.place(gate, x=w / 2 - gw / 2, z=d / 2)
        objs += kit.block(-w / 2, w / 2 - gw, 0.0, 1.6, d / 2 - 0.3, d / 2, "primary", name="wall")
        objs += kit.place(kit.ac_units(2, "back", w=w, d=main, y=3.2), z=z_main)
    return objs


def _semi_d(variant: Variant, lod: int) -> list:
    """One half of a semi-detached pair, with the link-house treatment (ridge along x, white
    frame, brick panel, gridded window, breeze-block screen, dark gate, brick pillars). The
    party wall is on -x: a flush gable end with no overhang and no openings. A side garden
    (brick low wall and hedge) takes the +x part of the plot, inside the size; the roof's +x
    end may overhang it."""
    w, h, d = variant.size
    vid = variant.id
    gable = vid == "gable"
    garden = 3.0
    bw = w - garden
    cx = -w / 2 + bw / 2  # body centre; its -x face is the party wall at x = -w / 2
    porch, kitchen = 5.5, 5.5
    main = d - porch - kitchen
    eave = LINK_EAVE[vid]
    pitch = math.degrees(math.atan((h - eave) / (main / 2))) if gable else MODERN_PITCH
    if lod >= 2:
        far = math.degrees(math.atan((h - eave) / (d / 2))) if gable else pitch
        objs = kit.far_block((bw, h, d), "gable", pitch_deg=far, ridge_axis="x")
        kit.place(objs, x=cx)
        return objs + kit.block(w / 2 - 0.1, w / 2, 0.0, 1.2, -d / 2, d / 2, "primary")
    z_front = d / 2 - porch
    z_main = z_front - main / 2
    side = [  # garden side (+x) only: the -x party wall stays blank
        Opening("right", 1.5, 1.0, 1.4, 1.2, "window"),
        Opening("right", 1.5, 4.3, 1.2, 1.2, "window"),
    ]
    openings = _front_openings(vid, bw) + side + _back_upper(bw)
    body = kit.walls(
        bw, main, eave, openings=openings, lod=lod, covered=_covered_front(vid, bw, eave)
    )
    overhang = (EAVE_OVERHANG[0], EAVE_OVERHANG[1] if gable else 0.0)
    body += kit.gable_roof(
        bw, main, eave, pitch, ridge_axis="x", across_overhang=overhang, end_overhang=(0.0, 0.4)
    )
    objs = kit.place(body, x=cx, z=z_main)
    k = kit.walls(
        bw, kitchen, KITCHEN_H, openings=_back_ground(bw), lod=lod, faces=("back", "left", "right")
    )
    k += kit.flat_roof(bw, kitchen, KITCHEN_H, 0.3, deck_role=DECK, cell=1.6)
    objs += kit.place(k, x=cx, z=-d / 2 + kitchen / 2)
    objs += kit.place(kit.car_porch(bw, porch, PORCH_H, inset=0.6), x=cx, z=d / 2)
    objs += kit.place(_upper_facade(vid, bw, h, lod), x=cx, z=z_front)
    # side garden: a low brick front wall, a hedge along the +x edge
    objs += kit.block(
        -w / 2 + bw, w / 2, 0.0, 0.9, d / 2 - 0.3, d / 2, "accent", name="garden_wall"
    )
    objs += kit.block(
        w / 2 - 0.5, w / 2, 0.0, 1.2, -d / 2 + kitchen, d / 2 - 0.3, "foliage", name="hedge"
    )
    if lod == 0:  # the gate stands 0.15 m in from the party line: nothing flush on the wall
        gate = kit.gate_and_fence(bw - 0.15, pillar_role="accent", gate_role="dark", low_wall=0.3)
        objs += kit.place(gate, x=cx + 0.075, z=d / 2)
        ac = kit.ac_units(2, "back", w=bw, d=kitchen, y=1.0)
        objs += kit.place(ac, x=cx, z=-d / 2 + kitchen / 2)
    return objs


def _bungalow(variant: Variant, lod: int) -> list:
    """A generous two-storey detached house (the Malaysian bungalow): a hip roof with its ridge
    along x, a wide portico with a balcony above it, large windows, brick accent panels, a dark
    gate between brick pillars and a low brick boundary wall."""
    w, h, d = variant.size
    porch = 4.0
    main = 11.0  # the rest of the 18 m plot is a rear yard behind a low brick wall
    pitch = math.degrees(math.atan((h - BUNGALOW_EAVE) / (min(w, main) / 2)))
    if lod >= 2:
        return kit.far_block((w, h, d), "hip", pitch_deg=pitch)
    z_front = d / 2 - porch
    z_main = z_front - main / 2
    panels = [(-7.3, -5.9), (5.9, 7.3)]
    side = [
        Opening(f, u, v, 1.6, 1.4, "window")
        for f in ("left", "right")
        for u in (0.0,)
        for v in (0.9, 3.9)
    ]
    openings = [
        Opening("front", 0.0, 0.0, 1.4, 2.4, "door"),
        Opening("front", -4.0, 0.8, 2.6, 1.6, "window", grid=(3, 2)),
        Opening("front", 4.0, 0.8, 2.6, 1.6, "window", grid=(3, 2)),
        Opening("front", -4.5, 3.9, 2.6, 1.9, "window", grid=(3, 2)),
        Opening("front", 0.0, 3.5, 2.6, 2.4, "window", grid=(3, 2)),  # onto the balcony
        Opening("front", 4.5, 3.9, 2.6, 1.9, "window", grid=(3, 2)),
        *side,
        Opening("back", -3.0, 0.9, 1.6, 1.3, "window"),
        Opening("back", 3.0, 0.0, 1.0, 2.1, "door"),
        *([Opening("back", u, 3.9, 1.6, 1.4, "window") for u in (-3.0, 3.0)] if lod == 0 else []),
    ]
    covered = [("front", a, b, 3.6, 6.0) for a, b in panels]
    body = kit.walls(w, main, BUNGALOW_EAVE, openings=openings, lod=lod, covered=covered)
    body += kit.hip_roof(w, main, BUNGALOW_EAVE, pitch, overhang=0.5)
    objs = kit.place(body, z=z_main)
    objs += kit.place(kit.car_porch(10.0, porch - 0.5, STOREY_M, slab=0.2, inset=0.3), z=d / 2)
    front = kit.balcony(6.0, 1.4, STOREY_M + 0.15, lod=lod)
    for a, b in panels:  # brick accent panels at the ends of the upper floor
        front += kit.panel(a, b, 3.6, 6.0, depth=0.05, role="accent")
    objs += kit.place(front, z=z_front)
    if lod == 0:
        gate = kit.gate_and_fence(10.0, pillar_role="accent", gate_role="dark", low_wall=0.3)
        objs += kit.place(gate, z=d / 2)
        for x0, x1 in ((-w / 2, -5.0), (5.0, w / 2)):  # low brick boundary wall, both sides
            objs += kit.block(x0, x1, 0.0, 1.2, d / 2 - 0.3, d / 2 - 0.1, "accent", name="wall")
        objs += kit.place(kit.ac_units(2, "back", w=w, d=main, y=3.4, u=-3.0), z=z_main)
    rear = kit.block(-w / 2, w / 2, 0.0, 1.2, -d / 2, -d / 2 + 0.2, "accent", name="rear_wall")
    return objs + rear


def _townhouse(variant: Variant, lod: int) -> list:
    """A two-storey stacked unit with two doors on the front (lower unit and the upper unit's
    stair door), a balcony, and a low-pitch light-grey roof (ridge along x) behind a front
    parapet."""
    w, h, d = variant.size
    if lod >= 2:
        return kit.far_block((w, h, d), "gable", pitch_deg=TOWNHOUSE_PITCH, ridge_axis="x")
    main = d - 1.0
    z_main = -0.5
    eave = h - 0.6
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
    body += kit.gable_roof(
        w,
        main,
        eave,
        TOWNHOUSE_PITCH,
        ridge_axis="x",
        across_overhang=(0.3, 0.0),
        end_overhang=0.0,
        roof_role=DECK,
    )
    body += kit.block(-w / 2, w / 2, eave, h, main / 2 - 0.3, main / 2, "primary", name="parapet")
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
DECK = "metal"  # roof decks seen from above: light grey, never the black of a bare AO deck


def _spread(length: float, n: int) -> list[float]:
    """n centres evenly spread over `length` (centred on 0)."""
    return [(k + 0.5) * length / n - length / 2 for k in range(n)]


class _Panes:
    """Applied windows for one wall volume: the wall is built with `covered()` (no wall behind a
    pane, so no black AO vertices under the glass) and the glass comes from `build()`."""

    def __init__(self, w: float, d: float) -> None:
        self.w, self.d = w, d
        self.specs: list[tuple] = []

    def add(self, face, cols, rows, ww, wh, border=0.1) -> None:
        self.specs.append((face, list(cols), list(rows), ww, wh, border))

    def covered(self, lod: int, extra=()) -> list:
        """Wall areas to leave out. Only LOD0 does it for the panes: at LOD1 the walls are a few
        big quads (corners clear of the glass) and the cuts would cost triangles."""
        out = list(extra)
        if lod > 0:
            return out
        for face, cols, rows, ww, wh, border in self.specs:
            out += kit.pane_cover(face, cols=cols, rows=rows, ww=ww, wh=wh, border=border)
        return out

    def build(self, lod: int) -> list:
        out: list = []
        for face, cols, rows, ww, wh, border in self.specs:
            out += kit.window_panes(
                face, self.w, self.d, cols=cols, rows=rows, ww=ww, wh=wh, lod=lod, border=border
            )
        return out


def _shop_office(variant: Variant, lod: int) -> list:
    """One 22-foot shophouse unit after the Jumpa shop offices: brick (accent) pilasters at the
    unit edges, two floors of tall dark-framed glass bays between white spandrels, a white
    parapet and cornice, a blank sign band over the shopfront and a deep canopy in front of the
    five-foot way. (Ground + two upper floors = 3 storeys in the 11 m size.)"""
    w, h, d = variant.size
    if lod >= 2:
        return kit.far_block((w, h, d), "flat")
    parapet = 0.8
    eave = h - parapet
    up_h = eave - SHOP_STOREY
    gd = d - FIVE_FOOT  # ground block depth; the walkway takes the rest
    pil = 0.55  # pilaster width
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
    pn = _Panes(w, d)
    bay = w - 2 * pil - 0.9
    pn.add("front", [-bay / 4 - 0.05, bay / 4 + 0.05], [1.15, 3.75], bay / 2 - 0.2, 2.0, 0.15)
    pn.add("back", [-1.5, 1.5], [1.1, 4.3], 1.6, 1.6)
    cov = [("front", -w / 2, -w / 2 + pil, 0.0, up_h), ("front", w / 2 - pil, w / 2, 0.0, up_h)]
    upper = kit.walls(
        w, d, up_h, openings=[], lod=lod, cell=(1.6, 1.6), covered=pn.covered(lod, cov)
    )
    upper += pn.build(lod)
    upper += kit.flat_roof(w, d, up_h, parapet, deck_role=DECK, cell=2.0)
    objs += kit.place(upper, y=SHOP_STOREY)
    front = kit.panel(-w / 2, -w / 2 + pil, 0.0, up_h, depth=0.22, role="accent")
    front += kit.panel(w / 2 - pil, w / 2, 0.0, up_h, depth=0.22, role="accent")
    front += kit.panel(-w / 2 + pil, w / 2 - pil, 3.2, 3.55, depth=0.12, role="primary")  # spandrel
    front += kit.panel(-w / 2, w / 2, up_h - 0.3, up_h + 0.05, depth=0.3, role="primary")  # cornice
    objs += kit.place(front, y=SHOP_STOREY, z=d / 2)
    objs += kit.place(kit.five_foot_way(w, FIVE_FOOT, SHOP_STOREY), z=d / 2)
    band = kit.sign_band(w - 2 * pil - 0.2, 0.8, SHOP_STOREY + 0.1)  # blank: role light, no text
    objs += kit.place(band, z=d / 2)
    # a deep canopy over the pavement in front of the five-foot way
    objs += kit.block(
        -w / 2 + 0.1,
        w / 2 - 0.1,
        3.4,
        3.6,
        d / 2,
        d / 2 + 0.8,
        "primary",
        name="canopy",
        closed=True,
    )
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
    pp = _Panes(w, d)
    for face, length in (("back", w), ("left", d), ("right", d)):
        pp.add(face, _spread(length - 2, 6 if length == w else 4), [4.0], 2.0, 1.8)
    pod = kit.walls(
        w,
        d,
        podium,
        openings=[Opening("front", 0.0, 0.1, 8.0, 3.8, "shopfront")],
        lod=lod,
        cell=(3.2, 3.5),
        covered=pp.covered(lod),
    )
    pod += pp.build(lod)
    pod += kit.flat_roof(w, d, podium, 0.6, deck_role=DECK, cell=3.0)
    objs = pod
    tp = _Panes(wt, dt)
    for face, length in (("front", wt), ("back", wt), ("left", dt), ("right", dt)):
        if lod == 0:
            cs = cols if length == wt else _spread(dt, max(3, int(dt // 3.2)))
            tp.add(face, cs, rows, 2.2, 1.7)
        else:  # LOD1: one glass ribbon per floor
            tp.add(face, [0.0], rows, length - 1.2, 1.7)
    bands = []  # a slab edge every storey: the wall is left out behind it
    if lod == 0:
        for k in range(1, n):
            for face, length in (("front", wt), ("back", wt), ("left", dt), ("right", dt)):
                bands.append((face, -length / 2, length / 2, k * fh - 0.14, k * fh + 0.14))
    tower = kit.walls(
        wt, dt, top - podium, openings=[], lod=lod, cell=(4.0, 4.0), covered=tp.covered(lod, bands)
    )
    tower += tp.build(lod)
    if lod == 0:
        for k in range(1, n):
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
            for c in (cols[1], cols[-2]):  # planted balconies on the two long faces
                for s in (1.0, -1.0):
                    z0, z1 = (dt / 2, dt / 2 + 1.2) if s > 0 else (-dt / 2 - 1.2, -dt / 2)
                    tower += kit.block(
                        c - 1.2, c + 1.2, y - 0.15, y, z0, z1, "secondary", name="balcony"
                    )
                    zp = (z1 - 0.4, z1) if s > 0 else (z0, z0 + 0.4)
                    tower += kit.block(
                        c - 1.2, c + 1.2, y, y + 0.55, zp[0], zp[1], "foliage", name="planter"
                    )
    tower += kit.flat_roof(wt, dt, top - podium, 1.0, deck_role=DECK, cell=3.0)
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
    """One 20 m bay of a JKR block: four storeys of classrooms, an open corridor with accent
    railings on +z, a stair core at each end and a low pitched roof with an accent fascia."""
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
    rows = [k * storey + 1.0 for k in range(4)]
    pn = _Panes(bw, bd)
    pn.add("front", [c + bw / 8 for c in _spread(bw, 4)[:-1]], rows, 1.6, 1.2)
    pn.add("back", _spread(bw, 4), rows, 1.6, 1.2)
    body = kit.walls(
        bw,
        bd,
        eave,
        openings=doors,
        lod=lod,
        cell=(2.4, 1.5),
        faces=("front", "back"),
        covered=pn.covered(lod),
    )
    body += pn.build(lod)
    objs = kit.place(body, z=zb)
    for sx, face in ((-1.0, "left"), (1.0, "right")):
        cp = _Panes(core_w, d)
        for f in ("front", "back"):
            cp.add(f, [0.0], [1.6], 1.0, eave - 3.2, 0.12)
        core = kit.walls(
            core_w,
            d,
            eave,
            openings=[],
            lod=lod,
            cell=(1.5, 2.0),
            faces=("front", "back", face),
            covered=cp.covered(lod),
        )
        core += cp.build(lod)
        objs += kit.place(core, x=sx * (w / 2 - core_w / 2))
    for k in range(1, 4):  # corridor floors with accent railings, between the cores
        bal = kit.balcony(bw, corridor, k * storey, lod=lod, rail_role="accent")
        objs += kit.place(bal, z=d / 2 - corridor)
    objs += kit.gable_roof(w, d, eave, pitch, 0.4, "x")
    # a coloured fascia board along both long eaves
    drop = 0.4 * math.tan(math.radians(pitch))
    for s in (1.0, -1.0):
        z0, z1 = (d / 2 + 0.4, d / 2 + 0.48) if s > 0 else (-d / 2 - 0.48, -d / 2 - 0.4)
        objs += kit.block(
            -w / 2 - 0.4,
            w / 2 + 0.4,
            eave - drop - 0.45,
            eave - drop + 0.05,
            z0,
            z1,
            "accent",
            name="fascia",
            closed=True,
        )
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
    pn = _Panes(hall_w, hall_d)
    for face, length in (("front", hall_w), ("back", hall_w), ("left", hall_d), ("right", hall_d)):
        cs = _spread(length - 2, 6 if length == hall_w else 5)
        if face == "front":
            cs = [c for c in cs if abs(c) > 4.0]
        pn.add(face, cs, [3.2], 1.8, 3.8)
    walls = kit.walls(
        hall_w,
        hall_d,
        hall_h,
        openings=[Opening("front", 0.0, 0.0, 3.2, 4.6, "door")],
        lod=lod,
        cell=(3.6, 3.0),
        covered=pn.covered(lod),
    )
    walls += pn.build(lod)
    walls += kit.flat_roof(hall_w, hall_d, hall_h, 0.8, deck_role=DECK, cell=3.0)
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
    g0, g1, up, cap = 1.2 * h, 1.2 * h + 0.5, 1.53 * h, 1.53 * h
    objs += kit.prism(mx, mz, 2.1, 0.0, g0, 4, "primary", name="minaret_shaft", phase_deg=45.0)
    objs += kit.prism(
        mx, mz, gallery, g0, g1, 4, "secondary", name="minaret_gallery", phase_deg=45.0
    )
    objs += kit.prism(mx, mz, 1.5, g1, up, 4, "primary", name="minaret_upper", phase_deg=45.0)
    objs += kit.dome(mx, mz, 1.3, cap, "accent", segs=8, rings=2 if lod else 3, name="cap")
    objs += kit.prism(mx, mz, 0.12, cap + 1.3, cap + 3.6 * k, 4, "metal", r_top=0.0, name="finial")
    return objs


def _factory(variant: Variant, lod: int) -> list:
    """After the Elmina Business Park factory: a grey metal-clad shed (metal walls and roof) with
    a 3-storey office block at the front (+z): a deep timber-look (accent) roof eave, a brick
    (accent) panel, vertical louvre fins, a glazed entrance and a drive-through loading bay."""
    w, h, d = variant.size
    pitch = 10.0
    if lod >= 2:
        return kit.far_block((w, h, d), "gable", pitch_deg=pitch)
    eave_o = 1.6  # the block's roof eave, so it stays within the size
    bw = 19.8  # block width; the block sits 1.2 m in from the shed's -x end
    bx = -w / 2 + 1.2 + bw / 2
    bz1 = d / 2 - eave_o  # block front wall
    shed_d = d - 14.0
    zs = -d / 2 + shed_d / 2
    z_join = -d / 2 + shed_d  # shed front wall
    bd = bz1 - z_join
    zb = z_join + bd / 2
    eave = h - w / 2 * math.tan(math.radians(pitch))
    # shed: metal-clad walls and roof, clerestory ribbons, roller doors
    ps = _Panes(w, shed_d)
    for face in ("left", "right"):
        ps.add(face, _spread(shed_d - 4, 7), [eave - 2.0], 2.4, 1.0)
    shed_ops = [
        Opening("front", w / 2 - 4.0, 0.0, 5.0, 5.0, "garage"),
        Opening("right", -4.0, 0.0, 4.5, 4.5, "garage"),
        Opening("left", 8.0, 0.0, 0.9, 2.1, "door"),
        Opening("back", 0.0, 0.0, 5.0, 5.0, "garage"),
    ]
    hidden = [("front", -w / 2, -w / 2 + 1.2 + bw, 0.0, eave)]  # behind the office block
    shed = kit.walls(
        w,
        shed_d,
        eave,
        openings=shed_ops,
        lod=lod,
        cell=(4.0, 2.5),
        role="metal",
        covered=ps.covered(lod, hidden),
    )
    shed += ps.build(lod)
    shed += kit.gable_roof(w, shed_d, eave, pitch, 0.4, "z", roof_role="metal", wall_role="metal")
    objs = kit.place(shed, z=zs)
    # office block: ground storey 3.8 m with a drive-through bay, two upper floors
    gh, up_h = 3.8, 5.6
    bh = gh + up_h
    bay0, bay1 = -6.0, -0.2  # drive-through bay, along the block's front
    pb = _Panes(bw, bd)
    pb.add("front", [4.4], [gh + 0.4, gh + 3.0], 5.0, 1.6)
    pb.add("left", _spread(bd - 2, 3), [gh + 0.4, gh + 3.0], 1.6, 1.6)
    pb.add("right", _spread(bd - 2, 3), [gh + 0.4, gh + 3.0], 1.6, 1.6)
    brick_u1 = -bw / 2 + 3.7
    cov = [
        ("front", bay0, bay1, 0.0, gh),  # the open drive-through
        ("front", -bw / 2, brick_u1, 0.0, bh),  # under the brick panel
        ("front", bay0, bay1 + 0.7, gh, bh),  # under the fins
    ]
    block = kit.walls(
        bw,
        bd,
        bh,
        openings=[Opening("front", 4.4, 0.1, 5.4, 3.0, "shopfront")],
        lod=lod,
        cell=(3.0, 2.8),
        covered=pb.covered(lod, cov),
    )
    block += pb.build(lod)
    objs += kit.place(block, x=bx, z=zb)
    front = kit.panel(-bw / 2, brick_u1, 0.0, bh, depth=0.2, role="accent")
    front += kit.louvre_screen(bay0, bay1 + 0.7, gh + 0.2, bh - 0.3, lod=lod, role="accent")
    objs += kit.place(front, x=bx, z=bz1)
    # the bay's soffit and its two columns, then the deep eave: an accent underside, a grey roof
    bay = kit.car_porch(bay1 - bay0, bd, gh, slab=0.25, column=0.4)
    objs += kit.place(bay, x=bx + (bay0 + bay1) / 2, z=bz1)
    x1 = -w / 2 + 1.2 + bw + eave_o
    objs += kit.block(-w / 2, x1, bh, bh + 0.2, z_join, d / 2, "accent", name="eave", closed=True)
    objs += kit.block(-w / 2, x1, bh + 0.2, bh + 0.4, z_join, d / 2, "metal", name="roof")
    return objs


def _mall(variant: Variant, lod: int) -> list:
    """A big-box retail unit: glazed shopfront bays along the front under a deep white canopy
    with a blank sign band, accent corner pillars, loading doors at the back, plant on a light
    roof deck."""
    w, h, d = variant.size
    if lod >= 2:
        return kit.far_block((w, h, d), "flat")
    canopy_d, parapet = 6.0, 0.8
    bd = d - canopy_d
    eave = h - parapet
    zb = -d / 2 + bd / 2
    ops = [
        Opening("front", -14.0, 0.0, 11.0, 4.4, "shopfront"),
        Opening("front", 0.0, 0.0, 11.0, 4.4, "shopfront"),
        Opening("front", 14.0, 0.0, 11.0, 4.4, "shopfront"),
        Opening("front", -25.0, 0.0, 3.0, 2.6, "door"),
        Opening("back", -12.0, 0.0, 4.0, 4.2, "garage"),
        Opening("back", 0.0, 0.0, 4.0, 4.2, "garage"),
        Opening("back", 12.0, 0.0, 4.0, 4.2, "garage"),
    ]
    pn = _Panes(w, bd)
    pn.add("front", [c for c in _spread(w - 6, 9) if abs(c) > 8.0], [6.3], 3.4, 1.0)
    body = kit.walls(w, bd, eave, openings=ops, lod=lod, cell=(6.0, 4.0), covered=pn.covered(lod))
    body += pn.build(lod)
    body += kit.flat_roof(w, bd, eave, parapet, deck_role=DECK, cell=4.0)
    objs = kit.place(body, z=zb)
    # a deep white canopy along the whole front, on columns
    cw = 46.0
    objs += kit.place(kit.car_porch(cw, canopy_d, 5.6, inset=0.6), z=d / 2)
    for x in (-cw / 2 + 11.5, 0.0, cw / 2 - 11.5):
        objs += kit.block(
            x - 0.3, x + 0.3, 0.0, 5.4, d / 2 - 1.0, d / 2 - 0.4, "primary", name="col"
        )
    objs += kit.place(kit.sign_band(14.0, 1.2, 5.8), z=zb + bd / 2)
    stripes = kit.panel(-w / 2, -w / 2 + 1.5, 0.0, eave, depth=0.15, role="accent")
    stripes += kit.panel(w / 2 - 1.5, w / 2, 0.0, eave, depth=0.15, role="accent")
    stripes += kit.panel(-w / 2, w / 2, eave - 0.6, eave, depth=0.15, role="accent")
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
    pn = _Panes(w, d)
    for face in ("front", "back", "left", "right"):
        pn.add(face, cols, rows[1:] if face == "front" else rows, 1.5, 1.5)
    pn.add("front", [cols[0], cols[2]], [0.9], 1.5, 1.5)
    cov = [("front", -0.75, 0.75, 0.0, 2.4)]
    objs = kit.walls(
        w, d, eave - 0.4, openings=[], lod=lod, cell=(2.5, 2.0), covered=pn.covered(lod, cov)
    )
    objs += pn.build(lod)
    objs += kit.place(kit.panel(-0.7, 0.7, 0.0, 2.3, depth=0.06, role="accent"), z=d / 2)
    objs += kit.block(
        -w / 2 - 0.2,
        w / 2 + 0.2,
        eave - 0.4,
        eave - 0.03,  # just under the deck, which would otherwise be hidden by this top face
        -d / 2 - 0.2,
        d / 2 + 0.2,
        "secondary",
        name="cornice",
    )
    objs += kit.flat_roof(w, d, eave, parapet, deck_role=DECK, cell=2.0)
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
