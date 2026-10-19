"""Crowd bodies, outfits and props as pure geometry (C-T6; no bpy, tested with pytest).

The crowd is built by the same scripted chibi pipeline as the hero (`geom.py` lathes, tubes
and ellipsoids), simplified to the crowd budget (P4: LOD0 <= 1.5k triangles per person with
its prop, LOD1 <= 400), so hero and crowd read as one family. The Kenney Mini Characters
(vendor/people) served only as a proportion reference; no vendor geometry is used.

Frame: Blender z-up, true metres, a person faces -y (glTF +z), her left is +x, origin between
the feet on the ground. Bind pose: upright A-pose (arms 14 degrees out). A part is
`(group, role, mesh)`: `group` names a skin region (`crowd_rig.vertex_weights`), `role` is a
role name from `ROLES` or a callable `(face centroid) -> role`.

Colour is not baked per look: every face carries a role, and a look is a body + outfit
(+ prop) + a palette (role -> colour, `crowd_looks.LOOKS`). The exported meshes encode the role
in TEXCOORD_0.u = (index + 0.5) / len(ROLES) (`role_u`), so C-T7 can recolour instances from a
palette texture (u = role, v = look row) and B-T1 can map role names to its clay tokens.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass

from . import geom
from .parts import _mirror, smoothstep

Role = "str | Callable[[geom.Vec], str]"
Part = tuple[str, Role, geom.Mesh]

ROLES = (
    "skin",
    "hair",
    "eye",
    "blush",
    "top",
    "top_trim",
    "bottom",
    "outer",
    "headwear",
    "headwear_trim",
    "accent",
    "shoe",
    "prop_metal",
    "prop_grip",
    "prop_wheel",
    "prop_fabric",
    "prop_canopy",
    "glasses",
)
PROPS = ("walker", "stroller", "wheelchair")
LOD_MAX_TRIS = (1500, 400)  # P4, per person including the prop

# Segment counts per LOD.
SEG = (10, 6)  # big lathes (torso, skirts, cape)
HEAD_RINGS = (7, 4)
LIMB = (6, 3)
CAP_RINGS = (1, 0)


def role_u(role: str) -> float:
    return (ROLES.index(role) + 0.5) / len(ROLES)


def role_from_u(u: float) -> str:
    i = min(len(ROLES) - 1, max(0, int(u * len(ROLES))))
    return ROLES[i]


def role_at(role, centroid: geom.Vec) -> str:
    return role(centroid) if callable(role) else role


# --- bodies --------------------------------------------------------------------------------


@dataclass(frozen=True)
class Body:
    id: str
    label: str
    height: float  # crown of the bare head, upright (true metres)
    head_ratio: float  # standing height / head height (crown to chin)
    leg: float  # hip joint height / height
    shoulder_w: float  # half width at the shoulders (at 1.55 m; scaled with height)
    hip_w: float  # half width at the hips (at 1.55 m)
    waist: float  # waist width / hip width (< 1 a waist, > 1 a belly)
    bust: float  # front bulge at the chest (m at 1.55 m)
    stoop: float  # degrees, forward bend of the upper body in every clip (age cue)


BODIES: dict[str, Body] = {
    b.id: b
    for b in (
        Body("child", "Child (about 7)", 1.10, 2.05, 0.27, 0.165, 0.165, 1.02, 0.0, 0.0),
        Body("school_age", "School-age (about 12)", 1.35, 2.30, 0.29, 0.175, 0.17, 0.92, 0.0, 0.0),
        Body("adult_man", "Adult man", 1.72, 2.70, 0.31, 0.205, 0.175, 0.95, 0.0, 0.0),
        Body("adult_woman", "Adult woman", 1.60, 2.60, 0.30, 0.18, 0.19, 0.84, 0.018, 0.0),
        Body("older_man", "Older man", 1.62, 2.60, 0.30, 0.195, 0.185, 1.04, 0.0, 14.0),
        Body("older_woman", "Older woman", 1.50, 2.50, 0.29, 0.175, 0.205, 0.97, 0.014, 18.0),
    )
}


@dataclass(frozen=True)
class Layout:
    """Derived joint heights and radii of a body (true metres, Blender frame)."""

    s: float  # scale against the hero's 1.55 m
    height: float
    chin: float
    head_c: geom.Vec
    head_r: geom.Vec
    shoulder_z: float
    chest_z: float
    waist_z: float
    hip_z: float
    knee_z: float
    ankle_z: float
    shoulder_w: float
    hip_w: float
    waist_w: float
    leg_x: float
    neck_r: float
    shoulder_joint: geom.Vec
    arm_dir: geom.Vec  # bind-pose arm direction (A-pose), left side
    upper: float
    fore: float
    hand_c: float  # wrist to hand centre
    toe: geom.Vec  # foot bone tail (left)
    depth: float  # torso depth / width


ARM_ANGLE = math.radians(14)


def layout(b: Body) -> Layout:
    s = b.height / 1.55
    head_h = b.height / b.head_ratio
    chin = b.height - head_h
    rz = head_h / 2
    head_c = (0.0, -0.01 * s, chin + rz)
    head_r = (rz * 1.02, rz * 0.95, rz)
    hip_z = b.height * b.leg
    shoulder_z = chin - 0.085 * s
    ankle_z = 0.06 * s
    knee_z = ankle_z + 0.5 * (hip_z - ankle_z)
    sw, hw = b.shoulder_w * s, b.hip_w * s
    sj = (sw - 0.03 * s, 0.0, shoulder_z - 0.035 * s)
    arm_len = 0.85 * (sj[2] - hip_z)
    d = (math.sin(ARM_ANGLE), 0.0, -math.cos(ARM_ANGLE))
    leg_x = hw * 0.48
    return Layout(
        s=s,
        height=b.height,
        chin=chin,
        head_c=head_c,
        head_r=head_r,
        shoulder_z=shoulder_z,
        chest_z=hip_z + 0.72 * (shoulder_z - hip_z),
        waist_z=hip_z + 0.36 * (shoulder_z - hip_z),
        hip_z=hip_z,
        knee_z=knee_z,
        ankle_z=ankle_z,
        shoulder_w=sw,
        hip_w=hw,
        waist_w=hw * b.waist,
        leg_x=leg_x,
        neck_r=0.05 * s,
        shoulder_joint=sj,
        arm_dir=d,
        upper=arm_len / 2,
        fore=arm_len / 2,
        hand_c=0.04 * s,
        toe=(leg_x, -0.10 * s, 0.025 * s),
        depth=0.80,
    )


# --- outfits -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Outfit:
    id: str
    label: str
    category: str  # baju_kurung | baju_melayu | school_shirt | school_pinafore | office | casual
    headwear: str | None = None  # tudung | songkok | kopiah
    hair: str | None = "short"  # short | bob | bun | None (under a tudung)
    top: str = "tee"  # tee | shirt | tunic_hip | tunic_knee | blazer | dress | batik
    sleeves: str = "short"  # short | long
    legs: str | None = "trousers"  # trousers | shorts | None (inside an ankle skirt)
    skirt: str | None = None  # ankle
    samping: bool = False
    tie: bool = False
    backpack: bool = False


OUTFITS: dict[str, Outfit] = {
    o.id: o
    for o in (
        Outfit(
            "baju_kurung",
            "Baju kurung with tudung",
            "baju_kurung",
            headwear="tudung",
            hair=None,
            top="tunic_knee",
            sleeves="long",
            legs=None,
            skirt="ankle",
        ),
        Outfit(
            "baju_melayu",
            "Baju melayu with songkok and samping",
            "baju_melayu",
            headwear="songkok",
            top="tunic_hip",
            sleeves="long",
            samping=True,
        ),
        Outfit(
            "school_shirt",
            "School uniform: white shirt, dark trousers",
            "school_shirt",
            top="shirt",
            backpack=True,
        ),
        Outfit(
            "school_pinafore",
            "School uniform: pinafore over white blouse, white tudung",
            "school_pinafore",
            headwear="tudung",
            hair=None,
            top="dress",
            sleeves="long",
            legs=None,
            skirt="ankle",
            backpack=True,
        ),
        Outfit(
            "office_shirt", "Office: shirt and tie", "office", top="shirt", sleeves="long", tie=True
        ),
        Outfit(
            "office_tudung",
            "Office: blazer, trousers, tudung",
            "office",
            headwear="tudung",
            hair=None,
            top="blazer",
            sleeves="long",
        ),
        Outfit(
            "office_batik", "Office: long-sleeve batik shirt", "office", top="batik", sleeves="long"
        ),
        Outfit("casual_shorts", "Casual: T-shirt and shorts", "casual", legs="shorts"),
        Outfit("casual_tee", "Casual: T-shirt and trousers", "casual"),
        Outfit("casual_bob", "Casual: T-shirt, jeans, bob hair", "casual", hair="bob"),
        Outfit(
            "casual_tudung",
            "Casual: long top, trousers, tudung",
            "casual",
            headwear="tudung",
            hair=None,
            top="tunic_hip",
            sleeves="long",
        ),
        Outfit("casual_bun", "Casual: blouse, trousers, hair bun", "casual", hair="bun"),
        Outfit("casual_kopiah", "Casual: polo, trousers, kopiah", "casual", headwear="kopiah"),
    )
}

BODY_OUTFITS: dict[str, tuple[str, ...]] = {
    "child": ("casual_shorts", "baju_melayu", "baju_kurung"),
    "school_age": ("school_shirt", "school_pinafore", "casual_tee"),
    "adult_man": ("baju_melayu", "office_shirt", "casual_tee"),
    "adult_woman": ("baju_kurung", "office_tudung", "casual_bob", "casual_tudung"),
    "older_man": ("baju_melayu", "office_batik", "casual_kopiah"),
    "older_woman": ("baju_kurung", "casual_tudung", "casual_bun"),
}


# --- shared shapes -------------------------------------------------------------------------


def _cap(
    centre: geom.Vec,
    radii: geom.Vec,
    opening: float,
    tilt: float,
    seg: int,
    rings: int,
) -> geom.Mesh:
    """A shell around the head with an opening at the front, tilted `tilt` rad downwards:
    hair, a tudung hood. `radii` are (x, depth, z)."""
    prof = []
    for i in range(rings + 1):
        phi = opening + (math.pi - opening) * i / rings
        prof.append((math.sin(phi), math.cos(phi)))
    prof[-1] = (0.0, -1.0)
    rx, ry, rz = radii
    mesh = geom.lathe([(r, z * ry) for r, z in prof], seg, sx=rx, sy=rz)
    return geom.transform(mesh, geom.rot_x(math.pi / 2 + tilt), move=centre)


def _hood_open_dir(tilt: float) -> geom.Vec:
    return (0.0, -math.cos(tilt), -math.sin(tilt))


def _torso_profile(lay: Layout, b: Body, top: str, lod: int) -> list[tuple[float, float]]:
    s = lay.s
    sw, hw = lay.shoulder_w, lay.hip_w
    chest_r = max(sw * 0.86, hw * 0.92)
    prof = [
        (0.0, lay.chin + 0.015 * s),
        (lay.neck_r, lay.chin),
        (sw * 0.6, lay.shoulder_z + 0.03 * s),
        (sw * 0.93, lay.shoulder_z - 0.025 * s),
        (chest_r, lay.chest_z),
        (lay.waist_w, lay.waist_z),
        (hw, lay.hip_z + 0.015 * s),
    ]
    if top == "tunic_knee":
        prof += [(hw * 1.10, lay.hip_z - 0.06 * s), (hw * 1.16, lay.knee_z + 0.02 * s)]
        prof += [(0.0, lay.knee_z + 0.03 * s)]
    elif top in ("tunic_hip", "batik", "blazer"):
        prof += [(hw * 1.07, lay.hip_z - 0.06 * s), (0.0, lay.hip_z - 0.05 * s)]
    else:
        prof += [(hw * 0.86, lay.hip_z - 0.035 * s), (0.0, lay.hip_z - 0.04 * s)]
    if lod == 1:  # fewer rings far away: drop the upper shoulder slope, the waist, the hip flare
        drop = {2, 5} | ({7} if top == "tunic_knee" else set())
        prof = [p for i, p in enumerate(prof) if i not in drop]
    return prof


def _theta(c: geom.Vec) -> float:
    return math.atan2(c[1], c[0])


# --- the person ----------------------------------------------------------------------------


def person_parts(body_id: str, outfit_id: str, lod: int) -> list[Part]:
    """Every part of one body in one outfit at LOD 0 or 1, in the bind pose."""
    b = BODIES[body_id]
    o = OUTFITS[outfit_id]
    if outfit_id not in BODY_OUTFITS[body_id]:
        raise ValueError(f"{outfit_id} is not an outfit of {body_id}")
    lay = layout(b)
    s = lay.s
    seg, limb, rings, caps = SEG[lod], LIMB[lod], HEAD_RINGS[lod], CAP_RINGS[lod]
    parts: list[Part] = []

    # head and face
    parts.append(
        (
            "face",
            "skin",
            geom.ellipsoid(lay.head_c, lay.head_r, seg + 2 if lod == 0 else seg, rings),
        )
    )
    if lod == 0:

        def stuck(az, el, radii, role, lift=0.0):
            p, n = geom.ellipsoid_point(lay.head_c, lay.head_r, az, el)
            p = tuple(p[j] + n[j] * lift for j in range(3))
            m = geom.ellipsoid((0.0, 0.0, 0.0), radii, 6, 3)
            return ("face", role, geom.transform(m, geom.orient_z_to(n), move=p))

        rz = lay.head_r[2]
        for sd in (-1, 1):
            parts.append(stuck(sd * 0.33, -0.02, (0.075 * rz, 0.1 * rz, 0.05 * rz), "eye"))
            parts.append(stuck(sd * 0.62, -0.24, (0.13 * rz, 0.08 * rz, 0.03 * rz), "blush"))
        if b.id == "older_woman":  # age cue, as on the hero: round glasses
            parts += _glasses(lay)

    hc, (hx, hy, hz) = lay.head_c, lay.head_r
    if o.headwear == "tudung":
        tilt = math.radians(10)
        centre = (0.0, hc[1] + 0.012 * s, hc[2] + 0.006 * s)
        hood = _cap(
            centre,
            (hx * 1.13, hy * 1.16, hz * 1.12),
            math.radians(50),
            tilt,
            seg + 2 if lod == 0 else seg,
            rings - 1 if lod == 0 else 2,
        )
        hood = (
            [_shape_hood(v, centre, (hx * 1.13, hy * 1.16, hz * 1.12)) for v in hood[0]],
            hood[1],
        )
        parts.append(("hood", "headwear", hood))
        parts.append(("cape", "headwear", _cape(lay, seg, lod)))
    else:
        if o.hair in ("short", "bun"):
            hair = _cap(
                (0.0, hc[1] + 0.008 * s, hc[2] + 0.012 * s),
                (hx * 1.05, hy * 1.07, hz * 1.05),
                math.radians(72),
                math.radians(32),
                seg,
                max(2, rings - 3),
            )
            parts.append(("hair", "hair", hair))
        elif o.hair == "bob":
            hair = _cap(
                (0.0, hc[1] + 0.01 * s, hc[2] - 0.004 * s),
                (hx * 1.10, hy * 1.10, hz * 1.09),
                math.radians(68),
                math.radians(36),
                seg,
                max(2, rings - 2),
            )
            parts.append(("hair", "hair", hair))
        if o.hair == "bun":
            parts.append(
                (
                    "hair",
                    "hair",
                    geom.ellipsoid(
                        (0.0, hc[1] + hy * 0.85, hc[2] + hz * 0.55),
                        (0.30 * hx, 0.26 * hx, 0.26 * hx),
                        limb + 2 if lod == 0 else 4,
                        3 if lod == 0 else 2,
                    ),
                )
            )
        if o.headwear == "songkok":
            # a short black oval cap on the upper forehead, a little above the crown, with a
            # lighter edge band so it separates from black hair from behind
            base = hc[2] + hz * 0.56
            top = hc[2] + hz + 0.036 * s
            band = base + 0.022 * s
            r = hx * 0.99
            prof = [(0.0, top), (r * 0.95, top), (r * 0.99, band), (r * 1.03, base), (0.0, base)]

            def songkok_role(c, band=band):
                return "headwear_trim" if c[2] < band else "headwear"

            parts.append(
                (
                    "headwear",
                    songkok_role,
                    geom.lathe(prof, seg, sy=0.86, center=(0, hc[1] + 0.01 * s, 0)),
                )
            )
        elif o.headwear == "kopiah":
            # a white skullcap sitting on the crown
            base = hc[2] + hz * 0.50
            top = hc[2] + hz + 0.035 * s
            r = hx * 0.92
            prof = [(0.0, top), (r * 0.8, top - 0.01 * s), (r, base), (0.0, base)]
            if lod == 1:
                prof = [(0.0, top), (r, base), (0.0, base)]
            parts.append(
                (
                    "headwear",
                    "headwear",
                    geom.lathe(prof, seg, sy=0.9, center=(0, hc[1] + 0.01 * s, 0)),
                )
            )

    # torso
    tprof = _torso_profile(lay, b, o.top, lod)
    tz = [z for _r, z in tprof]

    def torso_dr(theta, k):
        bust = (
            b.bust
            * s
            * max(0.0, -math.sin(theta)) ** 2
            * math.exp(-(((tz[k] - lay.chest_z) / (0.07 * s)) ** 2))
        )
        belly = (
            max(0.0, b.waist - 1.0)
            * lay.hip_w
            * 1.5
            * max(0.0, -math.sin(theta)) ** 2
            * math.exp(-(((tz[k] - lay.waist_z) / (0.08 * s)) ** 2))
        )
        return bust + belly

    torso = geom.lathe(tprof, seg, sy=lay.depth, dr=torso_dr)
    parts.append(("torso", _torso_role(lay, o), torso))

    if o.tie and lod == 0:
        pts = []
        for z, r in (
            (lay.shoulder_z + 0.0, lay.shoulder_w * 0.75),
            (lay.chest_z, lay.shoulder_w * 0.9),
            (lay.waist_z + 0.02 * s, lay.waist_w),
        ):
            pts.append((0.0, -(r * lay.depth) - 0.004 * s, z))
        parts.append(
            ("torso", "accent", geom.tube(pts, [0.016 * s, 0.02 * s, 0.022 * s], 4, cap_rings=0))
        )
    if o.backpack:
        parts.append(
            (
                "torso",
                "accent",
                geom.ellipsoid(
                    (
                        0.0,
                        lay.shoulder_w * lay.depth * 0.95 + 0.045 * s,
                        (lay.chest_z + lay.waist_z) / 2,
                    ),
                    (lay.shoulder_w * 0.72, 0.06 * s, (lay.shoulder_z - lay.waist_z) * 0.55),
                    seg - 2,
                    4 if lod == 0 else 2,
                ),
            )
        )

    # skirts
    if o.skirt == "ankle":
        hw = lay.hip_w
        kprof = [
            (0.0, lay.waist_z),
            (lay.waist_w * 1.0, lay.waist_z),
            (hw * 1.03, lay.hip_z),
            (hw * 1.07, lay.knee_z),
            (hw * 1.13, lay.ankle_z + 0.01 * s),
            (hw * 1.10, 0.03 * s),
            (0.0, 0.035 * s),
        ]
        if lod == 1:
            kprof = [kprof[i] for i in (0, 1, 2, 4, 6)]
        role = "outer" if o.top == "dress" else _kain_role(lay)
        parts.append(("skirt", role, geom.lathe(kprof, seg, sy=0.86)))
    if o.samping:
        hw = lay.hip_w
        sprof = [
            (0.0, lay.waist_z - 0.01 * s),
            (hw * 1.06, lay.waist_z - 0.01 * s),
            (hw * 1.12, lay.hip_z - 0.04 * s),
            (hw * 1.15, lay.knee_z + 0.04 * s),
            (0.0, lay.knee_z + 0.05 * s),
        ]
        if lod == 1:
            sprof = [sprof[i] for i in (0, 2, 3, 4)]
        parts.append(("skirt", _samping_role(lay), geom.lathe(sprof, seg, sy=0.86)))

    # arms and hands
    sj, d = lay.shoulder_joint, lay.arm_dir
    arm_len = lay.upper + lay.fore
    el = tuple(sj[j] + d[j] * lay.upper for j in range(3))
    wr = tuple(sj[j] + d[j] * arm_len for j in range(3))
    start = tuple(sj[j] - d[j] * 0.01 * s for j in range(3))
    arm = geom.tube([start, el, wr], [0.05 * s, 0.043 * s, 0.037 * s], limb, cap_rings=caps)
    hc_ = tuple(wr[j] + d[j] * lay.hand_c for j in range(3))
    hand = geom.ellipsoid(hc_, (0.034 * s, 0.03 * s, 0.044 * s), limb, 4 if lod == 0 else 2)
    arm_role = _sleeve_role(lay, o)
    for side, mir in (("L", False), ("R", True)):
        f = _mirror if mir else (lambda m: m)
        parts.append((f"arm_{side}", arm_role, f(arm)))
        parts.append((f"hand_{side}", "skin", f(hand)))

    # legs and shoes
    if o.legs is not None:
        lx = lay.leg_x
        leg = geom.tube(
            [
                (lx, 0.0, lay.hip_z + 0.01 * s),
                (lx, 0.0, lay.knee_z),
                (lx, 0.0, lay.ankle_z + 0.012 * s),
            ],
            [0.06 * s, 0.05 * s, 0.043 * s],
            limb,
            cap_rings=caps,
        )
        knee_top = lay.knee_z + 0.03 * s

        def leg_role(c, shorts=o.legs == "shorts"):
            return "skin" if shorts and c[2] < knee_top else "bottom"

        for side, mir in (("L", False), ("R", True)):
            parts.append((f"leg_{side}", leg_role, _mirror(leg) if mir else leg))
    # a flat sole: the lower cap of the shoe is pressed onto the ground plane (contact, not a
    # single touching pole that reads as floating)
    sv, sf = geom.ellipsoid(
        (lay.leg_x, -0.03 * s, 0.028 * s),
        (0.047 * s, 0.078 * s, 0.038 * s),
        limb + 1,
        4 if lod == 0 else 2,
    )
    shoe = ([(x, y, max(0.0, z)) for x, y, z in sv], sf)
    parts.append(("shoe_L", "shoe", shoe))
    parts.append(("shoe_R", "shoe", _mirror(shoe)))
    return parts


def _shape_hood(v: geom.Vec, c: geom.Vec, r: geom.Vec) -> geom.Vec:
    """Pull the back of the hood in towards the head (narrower, flatter) and tuck the nape,
    as on the hero, so the tudung does not read as a ball from behind."""
    x, y, z = v
    dy, dz = y - c[1], z - c[2]
    back = smoothstep(0.0, r[1], dy)
    x = c[0] + (x - c[0]) * (1 - 0.10 * back)
    dy *= 1 - 0.09 * back
    nape = back * smoothstep(0.0, -r[2], dz)
    dy *= 1 - 0.10 * nape
    x = c[0] + (x - c[0]) * (1 - 0.06 * nape)
    return (x, c[1] + dy, z)


def _glasses(lay: Layout) -> list[Part]:
    """Two round lens rims and a bridge on the face (about 60 triangles)."""
    rz = lay.head_r[2]
    out: list[Part] = []
    rims = []
    for sd in (-1, 1):
        p, n = geom.ellipsoid_point(lay.head_c, lay.head_r, sd * 0.33, -0.02)
        u = geom._norm(geom._cross((0.0, 0.0, 1.0), n))
        w = geom._cross(n, u)
        c = tuple(p[j] + n[j] * 0.03 * rz for j in range(3))
        k = 4
        ring = [
            tuple(c[j] + (u[j] * math.cos(a) + w[j] * math.sin(a)) * 0.15 * rz for j in range(3))
            for a in (math.pi / 4 + i * math.tau / k for i in range(k))
        ]
        out.append(("face", "glasses", geom.tube(ring, [0.018 * rz] * k, 3, closed=True)))
        rims.append(c)
    mid = tuple((rims[0][j] + rims[1][j]) / 2 for j in range(3))
    a = tuple(rims[0][j] + (mid[j] - rims[0][j]) * 0.55 for j in range(3))
    b = tuple(rims[1][j] + (mid[j] - rims[1][j]) * 0.55 for j in range(3))
    out.append(("face", "glasses", geom.tube([a, b], [0.016 * rz] * 2, 3, cap_rings=0)))
    return out


def _cape(lay: Layout, seg: int, lod: int) -> geom.Mesh:
    s = lay.s
    sw = lay.shoulder_w
    prof = [
        (0.0, lay.chin + 0.04 * s),
        (lay.neck_r * 1.9, lay.chin + 0.02 * s),
        (sw * 0.78, lay.shoulder_z + 0.035 * s),
        (sw * 1.05, lay.shoulder_z - 0.025 * s),
        (sw * 1.08, lay.shoulder_z - 0.085 * s),
        (0.0, lay.shoulder_z - 0.09 * s),
    ]
    if lod == 1:
        prof = [prof[i] for i in (0, 1, 2, 4, 5)]
    n = len(prof)

    def dz(theta, k):
        w = 1.0 if k >= n - 3 else 0.0
        front = max(0.0, -math.sin(theta)) ** 3
        back = max(0.0, math.sin(theta)) ** 1.6
        point = max(0.0, math.sin(theta)) ** 10 if lod == 0 else 0.0
        return -w * (0.07 * s * front + 0.11 * s * back + 0.06 * s * point)

    return geom.lathe(prof, seg, sy=0.86, dz=dz)


def _torso_role(lay: Layout, o: Outfit) -> Callable[[geom.Vec], str]:
    s = lay.s
    neck_z = lay.shoulder_z + 0.02 * s

    def role(c: geom.Vec) -> str:
        z = c[2]
        if o.headwear != "tudung" and z > neck_z and o.top in ("tee", "shirt"):
            return "skin" if o.top == "tee" else "top_trim"  # a neckline / a collar
        if o.top == "shirt" and z < lay.hip_z + 0.005 * s:
            return "bottom"  # tucked in
        if o.top in ("blazer", "dress"):
            return "outer"
        if o.top == "batik":
            k = int(math.floor(z / (0.07 * s))) + int(
                math.floor((_theta(c) + math.pi) / (math.pi / 4))
            )
            return "accent" if k % 2 else "top"
        if o.top == "tunic_knee" and z < lay.knee_z + 0.05 * s:
            return "top_trim"  # the hem band
        return "top"

    return role


def _sleeve_role(lay: Layout, o: Outfit) -> Callable[[geom.Vec], str]:
    sj, d = lay.shoulder_joint, lay.arm_dir
    arm_len = lay.upper + lay.fore
    sleeve = "outer" if o.top == "blazer" else "top"
    if o.top == "batik":
        sleeve = "accent"

    def role(c: geom.Vec) -> str:
        p = (abs(c[0]) - sj[0], c[1] - sj[1], c[2] - sj[2])
        t = (p[0] * d[0] + p[1] * d[1] + p[2] * d[2]) / arm_len
        if o.sleeves == "short":
            return sleeve if t < 0.36 else "skin"
        if o.category == "baju_kurung" and t > 0.88:
            return "top_trim"
        return sleeve

    return role


def _kain_role(lay: Layout) -> Callable[[geom.Vec], str]:
    lo, hi = lay.ankle_z + 0.01 * lay.s, lay.ankle_z + 0.06 * lay.s

    def role(c: geom.Vec) -> str:
        return "accent" if lo < c[2] < hi else "bottom"  # a batik band at the ankle

    return role


def _samping_role(lay: Layout) -> Callable[[geom.Vec], str]:
    def role(c: geom.Vec) -> str:
        return (
            "headwear_trim" if abs(c[2] - (lay.hip_z - 0.04 * lay.s)) < 0.02 * lay.s else "accent"
        )

    return role


def measure(parts: list[Part]) -> dict:
    zs = [v[2] for _g, _r, (pv, _f) in parts for v in pv]
    chin = min(v[2] for g, _r, (pv, _f) in parts if g == "face" for v in pv)
    top = max(zs)
    return {
        "height": top - min(zs),
        "crown": top,
        "chin": chin,
        "min_z": min(zs),
        "head_ratio": (top - min(zs)) / (top - chin),
        "tris": sum(geom.tri_count(f) for _g, _r, (_v, f) in parts),
    }


# --- props (crowd-sized, parametric on the body; layouts follow props.py / parts.py) ---------


def push_grip(body_id: str, mode: str) -> geom.Vec:
    """Left hand-centre target on the walker grip or the stroller bar (rest frame)."""
    from . import crowd_rig

    return crowd_rig.grip_target(body_id, mode)


def prop_parts(body_id: str, prop: str, lod: int) -> list[Part]:
    """A prop sized for a body: group `prop` (rigid on the prop bone) or `wheels`."""
    lay = layout(BODIES[body_id])
    s = lay.s
    seg = LIMB[lod]
    if prop == "walker":
        gx, gy, gz = push_grip(body_id, "walker")
        out: list[Part] = []
        wr = 0.05 * s
        for sd in (1, -1):
            x = sd * gx
            frame = [
                (x, gy + 0.09 * s, 0.012 * s),
                (x, gy + 0.06 * s, gz * 0.55),
                (x, gy + 0.045 * s, gz),
                (x, gy - 0.07 * s, gz),
                (x, gy - 0.11 * s, gz * 0.55),
                (x, gy - 0.15 * s, wr),
            ]
            if lod == 1:
                del frame[1]
            out.append(
                (
                    "prop",
                    "prop_metal",
                    geom.tube(frame, [0.014 * s] * len(frame), max(3, seg - 2), cap_rings=0),
                )
            )
            grip = [(x, gy + 0.04 * s, gz + 0.004 * s), (x, gy - 0.05 * s, gz + 0.004 * s)]
            out.append(("prop", "prop_grip", geom.tube(grip, [0.022 * s] * 2, seg, cap_rings=0)))
            out.append(
                (
                    "prop",
                    "prop_wheel",
                    geom.ellipsoid(
                        (x, gy - 0.15 * s, wr),
                        (0.018 * s, wr, wr),
                        seg if lod == 0 else 4,
                        3 if lod == 0 else 2,
                    ),
                )
            )
        bar = [(-gx, gy - 0.09 * s, gz * 0.7), (gx, gy - 0.09 * s, gz * 0.7)]
        out.append(
            ("prop", "prop_metal", geom.tube(bar, [0.012 * s] * 2, max(3, seg - 2), cap_rings=0))
        )
        return out
    if prop == "stroller":
        gx, gy, gz = push_grip(body_id, "stroller")
        bx = gx + 0.05 * s
        out = [
            (
                "prop",
                "prop_grip",
                geom.tube([(-bx, gy, gz), (bx, gy, gz)], [0.02 * s] * 2, seg, cap_rings=0),
            )
        ]
        wr, fr = 0.07 * s, 0.05 * s
        for sd in (1, -1):
            x = sd * bx
            rear = [(x, gy, gz), (x, gy - 0.08 * s, gz * 0.62), (x, gy - 0.14 * s, wr)]
            front = [(x * 0.95, gy - 0.10 * s, gz * 0.58), (x * 0.9, gy - 0.50 * s, fr)]
            ws, wrg = (seg, 3) if lod == 0 else (4, 2)
            if lod == 0:
                out.append(
                    (
                        "prop",
                        "prop_metal",
                        geom.tube(rear, [0.013 * s] * 3, max(3, seg - 2), cap_rings=0),
                    )
                )
                out.append(
                    (
                        "prop",
                        "prop_metal",
                        geom.tube(front, [0.012 * s] * 2, max(3, seg - 2), cap_rings=0),
                    )
                )
            else:  # one bent tube per side: bar end, rear wheel, front wheel
                path = [(x, gy, gz), (x, gy - 0.14 * s, wr), (x * 0.9, gy - 0.50 * s, fr)]
                out.append(("prop", "prop_metal", geom.tube(path, [0.013 * s] * 3, 3, cap_rings=0)))
            out.append(
                (
                    "prop",
                    "prop_wheel",
                    geom.ellipsoid((x * 1.06, gy - 0.14 * s, wr), (0.02 * s, wr, wr), ws, wrg),
                )
            )
            out.append(
                (
                    "prop",
                    "prop_wheel",
                    geom.ellipsoid((x * 0.92, gy - 0.50 * s, fr), (0.017 * s, fr, fr), ws, wrg),
                )
            )
        bz = gz * 0.70
        out.append(
            (
                "prop",
                "prop_fabric",
                geom.ellipsoid(
                    (0.0, gy - 0.33 * s, bz),
                    (bx * 0.92, 0.24 * s, 0.085 * s),
                    SEG[lod],
                    4 if lod == 0 else 2,
                ),
            )
        )
        out.append(
            (
                "prop",
                "prop_canopy",
                geom.ellipsoid(
                    (0.0, gy - 0.18 * s, bz + 0.07 * s),
                    (bx * 0.86, 0.10 * s, 0.11 * s),
                    SEG[lod] if lod == 0 else 4,
                    4 if lod == 0 else 2,
                ),
            )
        )
        return out
    if prop == "wheelchair":
        from . import crowd_rig

        w = crowd_rig.wheelchair_dims(BODIES[body_id])
        es, er = (seg + 2, 3) if lod == 0 else (4, 2)
        out = [
            (
                "prop",
                "prop_grip",
                geom.ellipsoid(
                    (0.0, w.seat_y, w.seat_top - 0.012 * s),
                    (w.width * 0.95, w.seat_d, 0.016 * s),
                    es,
                    er,
                ),
            ),
            (
                "prop",
                "prop_grip",
                geom.ellipsoid(
                    (0.0, w.back_y, (w.seat_top + w.back_top) / 2),
                    (w.width * 0.92, 0.02 * s, (w.back_top - w.seat_top) / 2),
                    es,
                    er,
                ),
            ),
        ]
        if lod == 0:  # the footrest plate (too small to see beyond the LOD switch)
            out.append(
                (
                    "prop",
                    "prop_grip",
                    geom.ellipsoid(
                        (0.0, w.foot_y, w.foot_z - 0.008 * s),
                        (lay.leg_x + 0.07 * s, 0.065 * s, 0.01 * s),
                        seg,
                        2,
                    ),
                )
            )
        for sd in (1, -1):
            x = sd * w.width
            frame = [
                (x, w.back_y + 0.02 * s, w.back_top + 0.03 * s),
                (x, w.back_y, w.seat_top),
                (x, w.seat_y - w.seat_d, w.seat_top),
                (x * 0.8, w.foot_y, w.foot_z),
            ]
            if lod == 1:
                del frame[0]
            out.append(
                ("prop", "prop_metal", geom.tube(frame, [0.013 * s] * len(frame), 3, cap_rings=0))
            )
            if lod == 0:
                cy = w.seat_y - w.seat_d * 0.85
                fork = [(x, w.seat_y - w.seat_d * 0.8, w.seat_top), (x, cy, w.caster_r)]
                out.append(("prop", "prop_metal", geom.tube(fork, [0.011 * s] * 2, 3, cap_rings=0)))
                out.append(
                    (
                        "prop",
                        "prop_wheel",
                        geom.ellipsoid(
                            (x, cy, w.caster_r), (0.016 * s, w.caster_r, w.caster_r), seg, 3
                        ),
                    )
                )
        return out + _wheelchair_wheels(w, s, lod)
    raise ValueError(f"unknown prop {prop!r}")


def _wheelchair_wheels(w, s: float, lod: int) -> list[Part]:
    """Both rear wheels (group `wheels`, on the wheels bone): the tyre (the hands push on its
    side) and, at LOD0, a four-spoke cross. Tyre and cross are 90-degree symmetric, so a quarter
    turn per walk cycle loops seamlessly at both LODs."""
    out: list[Part] = []
    n = 12 if lod == 0 else 8
    for sd in (1, -1):
        x = sd * w.wheel_x
        ay, az = w.axle[1], w.axle[2]
        r = w.wheel_r - 0.018 * s
        ring = [
            (x, ay + r * math.sin(a), az + r * math.cos(a))
            for a in (i * math.tau / n for i in range(n))
        ]
        out.append(
            (
                "wheels",
                "prop_wheel",
                geom.tube(ring, [0.02 * s] * n, 4 if lod == 0 else 3, closed=True),
            )
        )
        if lod == 0:
            for a in (0.0, math.pi / 2):
                r = w.wheel_r - 0.03 * s
                p0 = (x, ay - r * math.sin(a), az - r * math.cos(a))
                p1 = (x, ay + r * math.sin(a), az + r * math.cos(a))
                out.append(
                    ("wheels", "prop_metal", geom.tube([p0, p1], [0.008 * s] * 2, 3, cap_rings=0))
                )
    return out
