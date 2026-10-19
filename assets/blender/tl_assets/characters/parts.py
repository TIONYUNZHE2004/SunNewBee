"""The hero's parts as pure geometry (no bpy): the Blender builder (`hero.py`) turns them into
objects, and the tests measure the very same vertices (H3, H4).

Frame: Blender z-up, metres, true scale (1.55 m); she faces -y (glTF +z). Her right is -x.
Origin between the feet on the ground. A part is `(group, role, mesh)`: `group` is the vertex
group (a rig region for C-T3), `role` a palette key or a callable `(face centroid) -> key`.
"""

import math
from collections.abc import Callable

from . import geom
from . import proportions as P

Role = "str | Callable[[geom.Vec], str] | Gradient"
Part = tuple[str, Role, geom.Mesh]

# --- layout (true metres) ----------------------------------------------------------------

FACE_C = (0.0, -0.13, 1.197)
FACE_R = (0.20, 0.135, 0.235)  # a flattened face disc; chin at P.CHIN_Z
HOOD_C = (0.0, 0.02, 1.2295)
HOOD_R = 0.3025
HOOD_UP = 1.06  # the crown is stretched up 6% (taller than wide); crown at P.HEIGHT
HOOD_OPENING = math.radians(43)  # half-angle of the face opening
HOOD_TILT = math.radians(8)  # the opening looks slightly down, so the hood wraps under the chin
SHOULDER = (0.16, -0.03, 0.855)  # rounded slightly forward
WALKER_X = 0.30  # half track of the walker frame (grip centre line)
GRIP_Z = 0.60
GRIP_Y = (-0.30, -0.44)
HAND_Y = -0.365

SEG = 32  # ring segments on the big lathed parts
STOOP = math.radians(14)  # forward bend of the upper body in the walker pose (age cue)
STOOP_PIVOT = (0.0, 0.0, 0.45)
NECK = (0.0, 0.0, 0.95)
HEAD_DROP = (0.0, -0.025, -0.03)  # walker pose: head a little lower and forward of the shoulders
HEAD_GROUPS = ("head", "face")  # groups that move rigidly with the neck in the stoop


def smoothstep(a: float, b: float, x: float) -> float:
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def _mirror(mesh: geom.Mesh) -> geom.Mesh:
    """Mirror across x (and fix the winding)."""
    verts, faces = mesh
    return [(-x, y, z) for x, y, z in verts], [tuple(reversed(f)) for f in faces]


def _smooth_profile(points, samples=2):
    return [(max(0.0, r), z) for r, z in geom.catmull_rom(points, samples)]


def _back(theta: float, power: float = 2.0) -> float:
    """1 at the centre of her back (+y), 0 on the sides and the front."""
    return max(0.0, math.sin(theta)) ** power


def _bell(z: float, mid: float, width: float) -> float:
    return math.exp(-(((z - mid) / width) ** 2))


# --- head ----------------------------------------------------------------------------------


def shape_hood(v: geom.Vec) -> geom.Vec:
    """Hood shape: taller than wide, a little flatter and narrower at the back."""
    x, y, z = v
    cx, cy, cz = HOOD_C
    dy, dz = y - cy, z - cz
    back = smoothstep(0.0, HOOD_R, dy)
    x = cx + (x - cx) * (1 - 0.05 * back)
    dy *= 1 - 0.12 * back
    if dz > 0:  # stretch the crown, but not the face opening (front)
        dz *= 1 + (HOOD_UP - 1) * smoothstep(-0.2, 0.0, dy)
    return (x, cy + dy, cz + dz)


def head_parts() -> list[Part]:
    parts: list[Part] = []
    parts.append(("face", "skin", geom.ellipsoid(FACE_C, FACE_R, 30, 16)))

    # hood: a sphere with an oval opening, built along +z then turned to face -y
    rings = 14
    prof = []
    for i in range(rings + 1):
        phi = HOOD_OPENING + (math.pi - HOOD_OPENING) * i / rings
        prof.append((HOOD_R * math.sin(phi), HOOD_R * math.cos(phi)))
    prof[-1] = (0.0, -HOOD_R)
    turn = geom.rot_x(math.pi / 2 + HOOD_TILT)  # lathe +z -> forward (-y), tilted down

    def place(mesh):
        verts, faces = geom.transform(mesh, turn, move=HOOD_C)
        # squash the front a little narrower than tall (an oval face frame)
        verts = [(x * (0.93 if y < HOOD_C[1] - 0.12 else 1.0), y, z) for x, y, z in verts]
        return [shape_hood(v) for v in verts], faces

    parts.append(("head", "tudung", place(geom.lathe(prof, SEG))))

    # rim: a soft rolled edge around the opening, one step deeper than the crown
    rim_r = HOOD_R * math.sin(HOOD_OPENING)
    rim_h = HOOD_R * math.cos(HOOD_OPENING)
    loop = [
        (rim_r * math.cos(a), rim_r * math.sin(a), rim_h)
        for a in (i * math.tau / 40 for i in range(40))
    ]
    parts.append(("head", "tudung_trim", place(geom.tube(loop, [0.021] * 40, 8, closed=True))))

    # nape: a soft bun under the inner cap, and a faint gather line from the crown to the nape
    cx, cy, cz = HOOD_C
    parts.append(
        (
            "head",
            "tudung_mid",
            geom.ellipsoid((0.0, cy + 0.19, cz - 0.15), (0.15, 0.07, 0.08), 16, 8),
        )
    )
    seam = [
        shape_hood((0.0, cy + (HOOD_R + 0.002) * math.sin(a), cz + (HOOD_R + 0.002) * math.cos(a)))
        for a in (0.25 + i * 0.22 for i in range(8))
    ]
    parts.append(("head", "tudung_mid", geom.tube(seam, [0.0055] * len(seam), 6)))

    def on_face(az, el, lift=0.0):
        p, n = geom.ellipsoid_point(FACE_C, FACE_R, az, el)
        return tuple(p[j] + n[j] * lift for j in range(3)), n

    def stuck(az, el, radii, role, lift=0.0, seg=14, rng=8):
        p, n = on_face(az, el, lift)
        m = geom.ellipsoid((0.0, 0.0, 0.0), radii, seg, rng)
        return ("face", role, geom.transform(m, geom.orient_z_to(n), move=p))

    for s in (-1, 1):
        az = s * 0.37
        parts.append(stuck(az, 0.02, (0.025, 0.031, 0.014), "eye", lift=0.002, seg=12, rng=7))
        lid_p, lid_n = on_face(az, 0.055, 0.001)
        lid = geom.ellipsoid((0.0, 0.0, 0.0), (0.032, 0.022, 0.009), 12, 7)
        parts.append(("face", "skin", geom.transform(lid, geom.orient_z_to(lid_n), move=lid_p)))
        p, n = on_face(az + s * 0.04, 0.0, 0.016)
        parts.append(("face", "eye_hi", geom.ellipsoid(p, (0.007, 0.007, 0.007), 6, 4)))
        parts.append(stuck(s * 0.66, -0.20, (0.042, 0.026, 0.008), "blush", lift=0.001))
        brow = [
            on_face(az + s * d, 0.22 + 0.02 * math.cos(d * 9), 0.004)[0]
            for d in (-0.09, -0.03, 0.03, 0.09)
        ]
        parts.append(("face", "brow", geom.tube(brow, [0.009] * 4, 6)))
        # glasses: a round lens rim around each eye, temples back into the hood
        pc, n = on_face(az, 0.04, 0.0)
        u = geom._norm(geom._cross((0.0, 0.0, 1.0), n))
        v = geom._cross(n, u)
        lens = [
            tuple(
                pc[j] + n[j] * 0.022 + (u[j] * math.cos(a) * 0.062) + (v[j] * math.sin(a) * 0.055)
                for j in range(3)
            )
            for a in (i * math.tau / 16 for i in range(16))
        ]
        parts.append(("face", "glasses", geom.tube(lens, [0.0065] * 16, 6, closed=True)))
        rim = lens[0] if s > 0 else lens[8]
        temple = [rim, on_face(s * 0.95, 0.07, 0.01)[0], on_face(s * 1.3, 0.08, -0.01)[0]]
        parts.append(("face", "glasses", geom.tube(temple, [0.006] * 3, 6)))
    bridge = [
        on_face(-0.17, 0.06, 0.026)[0],
        on_face(0.0, 0.07, 0.03)[0],
        on_face(0.17, 0.06, 0.026)[0],
    ]
    parts.append(("face", "glasses", geom.tube(bridge, [0.0065] * 3, 6)))
    parts.append(stuck(0.0, -0.12, (0.024, 0.019, 0.018), "skin", lift=0.006))
    smile = [on_face(a, -0.34 + 1.4 * a * a, 0.002)[0] for a in (-0.11, -0.055, 0.0, 0.055, 0.11)]
    parts.append(("face", "mouth", geom.tube(smile, [0.0055] * 5, 6)))
    return parts


# --- body ----------------------------------------------------------------------------------


class Gradient:
    """A per-vertex colour (sRGB floats) instead of one palette role per face, so colour
    changes blend smoothly across faces."""

    def __init__(self, fn: Callable[[geom.Vec], tuple[float, float, float]]):
        self.fn = fn

    def __call__(self, v: geom.Vec) -> tuple[float, float, float]:
        return self.fn(v)


def _tudung_shade(v: geom.Vec) -> tuple[float, float, float]:
    """Crown light, the drape a step deeper as it falls (value contrast from behind)."""
    t = smoothstep(0.97, 0.68, v[2])
    a, b = P.hex_rgb(P.PALETTE["tudung"]), P.hex_rgb(P.PALETTE["tudung_deep"])
    return tuple(a[j] + (b[j] - a[j]) * t for j in range(3))  # type: ignore[return-value]


def _kain_band(c: geom.Vec) -> str:
    """A thin batik band near the ankle: gold motifs on a light lilac ground."""
    x, y, z = c
    if not 0.072 < z < 0.118:
        return "kain"
    theta = math.atan2(y / 0.86, x)
    return "batik" if math.cos(10 * theta) > 0.55 else "baju_trim"


def body_parts() -> list[Part]:
    parts: list[Part] = []
    # tudung cape: from inside the hood over the shoulders. A soft point at the front; at the
    # back it falls to mid-back in a rounded point with three vertical fold ridges.
    cape_prof = _smooth_profile(
        [
            (0.0, 1.07),
            (0.12, 1.06),
            (0.185, 1.0),
            (0.225, 0.94),
            (0.25, 0.875),
            (0.258, 0.82),
            (0.25, 0.79),
            (0.225, 0.78),
            (0.0, 0.79),
        ]
    )
    zs = [z for _r, z in cape_prof]

    def lower(k):
        return smoothstep(0.98, 0.80, zs[k]) if zs[k] < 0.98 else 0.0

    def cape_dz(theta, k):
        w = lower(k)
        front = max(0.0, -math.sin(theta)) ** 3
        folds = 0.010 * math.cos(7 * theta) * w * (1 - _back(theta))
        return -0.075 * w * front - 0.20 * w * _back(theta, 1.6) + folds

    def cape_dr(theta, k):
        w = lower(k)
        ridges = 0.024 * max(0.0, math.cos(12 * theta)) ** 2 * _back(theta, 3)  # outward only
        return w * (ridges - 0.012 * _back(theta))

    parts.append(
        (
            "tudung_cape",
            Gradient(_tudung_shade),
            geom.lathe(cape_prof, SEG, sy=0.88, dz=cape_dz, dr=cape_dr),
        )
    )

    # baju: fuller at bust and hip, a soft waist, a knee-length hem with side-slit notches,
    # a mild hump on the upper back
    torso_prof = _smooth_profile(
        [
            (0.0, 0.93),
            (0.12, 0.92),
            (0.175, 0.885),
            (0.2, 0.81),
            (0.218, 0.75),
            (0.205, 0.655),
            (0.222, 0.55),
            (0.236, 0.44),
            (0.233, 0.36),
            (0.237, 0.33),
            (0.222, 0.318),
            (0.0, 0.322),
        ]
    )
    tz = [z for _r, z in torso_prof]

    def torso_dr(theta, k):
        z = tz[k]
        hump = 0.032 * _back(theta) * _bell(z, 0.80, 0.08)
        bust = 0.014 * max(0.0, -math.sin(theta)) ** 2 * _bell(z, 0.75, 0.05)
        return hump + bust

    def torso_dz(theta, k):
        return 0.06 * abs(math.cos(theta)) ** 60 * (1 - smoothstep(0.322, 0.37, tz[k]))

    parts.append(("torso", "baju", geom.lathe(torso_prof, SEG, sy=0.82, dr=torso_dr, dz=torso_dz)))

    # kain: flares at the ankle; soft front/back creases hint at two legs (eases C-T3 skinning)
    kain_prof = _smooth_profile(
        [
            (0.0, 0.46),
            (0.18, 0.455),
            (0.19, 0.36),
            (0.195, 0.24),
            (0.205, 0.15),
            (0.222, 0.118),
            (0.236, 0.072),
            (0.24, 0.05),
            (0.225, 0.032),
            (0.0, 0.03),
        ]
    )
    kz = [z for _r, z in kain_prof]

    def kain_dr(theta, k):
        return -0.016 * abs(math.sin(theta)) ** 6 * (1 - smoothstep(0.15, 0.40, kz[k]))

    parts.append(("kain", _kain_band, geom.lathe(kain_prof, SEG, sy=0.86, dr=kain_dr)))

    shoe = geom.ellipsoid((0.075, -0.10, 0.038), (0.055, 0.088, 0.038), 14, 8)
    parts.append(("shoe_L", "shoe", shoe))
    parts.append(("shoe_R", "shoe", _mirror(shoe)))
    return parts


# --- pose ------------------------------------------------------------------------------------


def stoop(v: geom.Vec) -> geom.Vec:
    """Bend a point forward (towards -y) about the hip, more the higher it is."""
    x, y, z = v
    a = STOOP * smoothstep(0.45, 0.92, z)
    py, pz = STOOP_PIVOT[1], STOOP_PIVOT[2]
    c, s_ = math.cos(a), math.sin(a)
    return (x, py + c * (y - py) - s_ * (z - pz), pz + s_ * (y - py) + c * (z - pz))


def stoop_parts(parts: list[Part]) -> list[Part]:
    """Stoop the body; the head rides with the neck (a little lower and forward) without
    tilting, so the face stays readable from the front and in 3/4."""
    nx, ny, nz = NECK
    sx, sy, sz = stoop(NECK)
    d = (sx - nx + HEAD_DROP[0], sy - ny + HEAD_DROP[1], sz - nz + HEAD_DROP[2])
    out = []
    for group, role, (pv, pf) in parts:
        if group in HEAD_GROUPS:
            pv = [(x + d[0], y + d[1], z + d[2]) for x, y, z in pv]
        else:
            pv = [stoop(v) for v in pv]
        out.append((group, role, (pv, pf)))
    return out


def arm_parts(pose: str) -> list[Part]:
    if pose == "tpose":
        sy = SHOULDER[1]
        ctrl = [SHOULDER, (0.29, sy, 0.862), (0.42, sy * 0.5, 0.865), (0.54, 0.0, 0.865)]
        hand_c, hand_r = (0.60, 0.0, 0.865), (0.064, 0.044, 0.048)
        thumb_c = (0.585, -0.038, 0.875)
        cuff = [(0.525, 0.0, 0.865), (0.555, 0.0, 0.865)]
    else:
        x = WALKER_X
        ctrl = [
            SHOULDER,
            (0.25, -0.05, 0.785),
            (0.305, -0.115, 0.70),
            (x + 0.005, -0.22, 0.645),
            (x, -0.305, 0.625),
        ]
        hand_c, hand_r = (x, HAND_Y, GRIP_Z + 0.022), (0.048, 0.064, 0.044)
        thumb_c = (x - 0.04, HAND_Y + 0.008, GRIP_Z + 0.036)
        cuff = [(x + 0.002, -0.285, 0.628), (x, -0.315, 0.623)]
        # the shoulder follows the stoop; the hand stays on the grip
        sh = stoop(SHOULDER)
        d = tuple(sh[j] - SHOULDER[j] for j in range(3))
        last = len(ctrl) - 1
        ctrl = [
            tuple(c[j] + d[j] * (1 - i / last) ** 1.5 for j in range(3)) for i, c in enumerate(ctrl)
        ]
    path = geom.catmull_rom(ctrl, 4)
    n = len(path)
    radii = [0.07 - 0.016 * i / (n - 1) for i in range(n)]
    sleeve = geom.tube(path, radii, 14)
    cuff_m = geom.tube(cuff, [0.06, 0.06], 14)
    hand = geom.ellipsoid(hand_c, hand_r, 14, 8)
    thumb = geom.ellipsoid(thumb_c, (0.02, 0.026, 0.02), 8, 5)
    out: list[Part] = []
    for side, mir in (("L", False), ("R", True)):
        f = _mirror if mir else (lambda m: m)
        out += [
            (f"arm_{side}", "baju", f(sleeve)),
            (f"arm_{side}", "baju_trim", f(cuff_m)),
            (f"hand_{side}", "skin", f(hand)),
            (f"hand_{side}", "skin", f(thumb)),
        ]
    return out


def hero_parts(pose: str) -> list[Part]:
    """The body parts for `"tpose"` (upright bind pose) or `"walker"` (stooped, on the grips)."""
    if pose not in ("tpose", "walker"):
        raise ValueError(f"unknown pose {pose!r}")
    parts = head_parts() + body_parts()
    if pose == "walker":
        parts = stoop_parts(parts)
    return parts + arm_parts(pose)


def walker_parts() -> list[Part]:
    out: list[Part] = []
    for s in (1, -1):
        x = s * WALKER_X
        frame = geom.catmull_rom(
            [
                (x, -0.20, 0.035),
                (x, -0.22, 0.35),
                (x, -0.24, 0.55),
                (x, -0.275, GRIP_Z),
                (x, -0.37, GRIP_Z + 0.002),
                (x, -0.47, GRIP_Z),
                (x, -0.51, 0.56),
                (x, -0.545, 0.35),
                (x, -0.575, 0.11),
            ],
            3,
        )
        grip = [(x, GRIP_Y[0], GRIP_Z + 0.001), (x, GRIP_Y[1], GRIP_Z + 0.001)]
        out += [
            ("frame", "metal", geom.tube(frame, [0.018] * len(frame), 8)),
            ("grip", "grip", geom.tube(grip, [0.026, 0.026], 10)),
            ("frame", "grip", geom.ellipsoid((x, -0.20, 0.026), (0.026, 0.026, 0.028), 10, 5)),
            (
                "frame",
                "metal",
                geom.tube([(x, -0.575, 0.11), (x, -0.585, 0.068)], [0.012, 0.012], 8),
            ),
            ("wheel", "wheel", geom.ellipsoid((x, -0.585, 0.066), (0.022, 0.066, 0.066), 16, 8)),
            (
                "wheel",
                "metal",
                geom.ellipsoid((x + s * 0.016, -0.585, 0.066), (0.012, 0.026, 0.026), 10, 6),
            ),
        ]
    bar = [(-WALKER_X, -0.535, 0.42), (WALKER_X, -0.535, 0.42)]
    out.append(("frame", "metal", geom.tube(bar, [0.016, 0.016], 8)))
    return out


def role_of(role: Role, centroid: geom.Vec) -> str | None:
    """The palette role of a face, or None for a per-vertex `Gradient`."""
    if isinstance(role, Gradient):
        return None
    return role(centroid) if callable(role) else role


def measure(parts: list[Part]) -> dict:
    """Height, crown, chin (lowest `face` vertex) and the H4 head ratio of a set of parts."""
    zs = [v[2] for _g, _r, (pv, _f) in parts for v in pv]
    chin = min(v[2] for g, _r, (pv, _f) in parts if g == "face" for v in pv)
    top, bottom = max(zs), min(zs)
    height = top - bottom
    return {
        "height": height,
        "crown": top,
        "chin": chin,
        "head_ratio": P.head_ratio(height, top, chin),
        "tris": sum(geom.tri_count(f) for _g, _r, (_v, f) in parts),
    }
