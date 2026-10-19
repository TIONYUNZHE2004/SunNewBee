"""The journey hero (C-T2): a chibi older woman in a purple baju kurung and a lilac tudung,
with a scripted walker. Runs only inside Blender 5.2 (imports bpy).

Frame: Blender z-up, metres, true scale (1.55 m); she faces -y (glTF +z, the frontage
convention of `core`). Her right side is -x. Origin between the feet on the ground.

`build_hero(pose)` returns `(body, walker)`:
- `body`: one mesh, separate closed shells per part, `COLOR_0` (corner, linear RGBA) holds the
  clay colour, vertex groups name the rig regions for C-T3 (`head`, `face`, `tudung_cape`,
  `torso`, `kain`, `arm_L/R`, `hand_L/R`, `shoe_L/R`), one material `hero_body`.
- `walker`: one mesh, `COLOR_0`, material `hero_walker`; `None` for the T-pose.
`pose` is `"tpose"` (arms level, the bind pose for rigging) or `"walker"` (hands on the grips).
"""

import math

import bpy
import numpy as np

from . import geom
from . import proportions as P

# --- layout (true metres) ----------------------------------------------------------------

FACE_C = (0.0, -0.13, 1.215)
FACE_R = (0.20, 0.135, 0.235)  # a flattened face disc; chin at 0.98 (P.CHIN_Z)
HOOD_C = (0.0, 0.02, 1.2475)
HOOD_R = 0.3025  # crown at 1.55 (P.HEIGHT)
HOOD_OPENING = math.radians(43)  # half-angle of the face opening
HOOD_TILT = math.radians(8)  # the opening looks slightly down, so the hood wraps under the chin
SHOULDER = (0.16, 0.0, 0.86)
WALKER_X = 0.30  # half track of the walker frame (grip centre line)
GRIP_Z = 0.60
GRIP_Y = (-0.30, -0.44)
HAND_Y = -0.365

SEG = 32
STOOP = math.radians(14)  # forward bend of the upper body in the walker pose (age cue)
STOOP_PIVOT = (0.0, 0.0, 0.45)
NECK = (0.0, 0.0, 0.95)
HEAD_GROUPS = ("head", "face")  # ring segments on the big lathed parts


def _lin(role: str) -> tuple[float, float, float, float]:
    """A palette role (or a literal "#rrggbb") as linear RGBA."""
    r, g, b = (
        P.srgb_to_linear(c) for c in P.hex_rgb(role if role.startswith("#") else P.PALETTE[role])
    )
    return (r, g, b, 1.0)


def _mirror(mesh: geom.Mesh) -> geom.Mesh:
    """Mirror across x (and fix the winding)."""
    verts, faces = mesh
    return [(-x, y, z) for x, y, z in verts], [tuple(reversed(f)) for f in faces]


# --- parts -------------------------------------------------------------------------------


def _smooth_profile(points, samples=2):
    return [(max(0.0, r), z) for r, z in geom.catmull_rom(points, samples)]


def head_parts() -> list[tuple[str, str, geom.Mesh]]:
    parts: list[tuple[str, str, geom.Mesh]] = []
    # face: a skin ellipsoid that fills the hood opening
    parts.append(("face", "skin", geom.ellipsoid(FACE_C, FACE_R, 30, 16)))

    # hood: a sphere with an oval opening around -y, built along +z then turned to face -y
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
        return [(x * (0.93 if y < HOOD_C[1] - 0.12 else 1.0), y, z) for x, y, z in verts], faces

    parts.append(("head", "tudung", place(geom.lathe(prof, SEG))))

    # rim: a soft rolled edge (tudung trim) around the opening, hides the seam
    rim_r = HOOD_R * math.sin(HOOD_OPENING)
    rim_h = HOOD_R * math.cos(HOOD_OPENING)
    loop = [
        (rim_r * math.cos(a), rim_r * math.sin(a), rim_h)
        for a in (i * math.tau / 40 for i in range(40))
    ]
    parts.append(("head", "tudung_trim", place(geom.tube(loop, [0.021] * 40, 8, closed=True))))

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
        # brows: short soft arcs
        brow = [
            on_face(az + s * d, 0.22 + 0.02 * math.cos(d * 9), 0.004)[0]
            for d in (-0.09, -0.03, 0.03, 0.09)
        ]
        parts.append(("face", "brow", geom.tube(brow, [0.009] * 4, 6)))
        # glasses: a round lens rim around each eye, temples back into the hood
        pc, n = on_face(az, 0.04, 0.0)
        up = (0.0, 0.0, 1.0)
        u = geom._norm(geom._cross(up, n))
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
    parts.append(
        (
            "face",
            "glasses",
            geom.tube(
                [
                    on_face(-0.17, 0.06, 0.026)[0],
                    on_face(0.0, 0.07, 0.03)[0],
                    on_face(0.17, 0.06, 0.026)[0],
                ],
                [0.0065] * 3,
                6,
            ),
        )
    )
    parts.append(stuck(0.0, -0.12, (0.024, 0.019, 0.018), "skin", lift=0.006))
    smile = [on_face(a, -0.34 + 1.4 * a * a, 0.002)[0] for a in (-0.11, -0.055, 0.0, 0.055, 0.11)]
    parts.append(("face", "mouth", geom.tube(smile, [0.0055] * 5, 6)))
    return parts


def body_parts() -> list[tuple[str, str, geom.Mesh]]:
    parts: list[tuple[str, str, geom.Mesh]] = []
    # tudung cape: from inside the hood over the shoulders, a soft point at the front
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

    def cape_dz(theta, k):
        w = min(1.0, max(0.0, (0.95 - zs[k]) / 0.12))
        front = max(0.0, -math.sin(theta)) ** 3
        folds = 0.012 * math.cos(7 * theta) * w  # soft fabric folds on the hem
        return -0.075 * w * front + folds

    parts.append(("tudung_cape", "tudung", geom.lathe(cape_prof, SEG, sy=0.88, dz=cape_dz)))

    torso_prof = _smooth_profile(
        [
            (0.0, 0.93),
            (0.12, 0.92),
            (0.175, 0.88),
            (0.19, 0.80),
            (0.195, 0.68),
            (0.215, 0.52),
            (0.24, 0.40),
            (0.248, 0.37),
            (0.235, 0.355),
            (0.0, 0.36),
        ]
    )
    parts.append(("torso", "baju", geom.lathe(torso_prof, SEG, sy=0.82)))

    kain_prof = _smooth_profile(
        [
            (0.0, 0.46),
            (0.18, 0.455),
            (0.196, 0.36),
            (0.206, 0.2),
            (0.215, 0.07),
            (0.21, 0.04),
            (0.19, 0.03),
            (0.0, 0.03),
        ]
    )
    parts.append(("kain", "kain", geom.lathe(kain_prof, SEG, sy=0.86)))

    shoe = geom.ellipsoid((0.075, -0.10, 0.038), (0.055, 0.088, 0.038), 14, 8)
    parts.append(("shoe_L", "shoe", shoe))
    parts.append(("shoe_R", "shoe", _mirror(shoe)))
    return parts


def _smoothstep(a: float, b: float, x: float) -> float:
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def stoop(v: geom.Vec) -> geom.Vec:
    """Bend a point forward (towards -y) about the hip, more the higher it is."""
    x, y, z = v
    a = STOOP * _smoothstep(0.45, 0.92, z)
    py, pz = STOOP_PIVOT[1], STOOP_PIVOT[2]
    c, s_ = math.cos(a), math.sin(a)
    return (x, py + c * (y - py) - s_ * (z - pz), pz + s_ * (y - py) + c * (z - pz))


def stoop_parts(parts):
    """Stoop the body; the head rides along with the neck without tilting, so the face
    stays readable from the front and in 3/4."""
    nx, ny, nz = NECK
    sx, sy, sz = stoop(NECK)
    d = (sx - nx, sy - ny, sz - nz)
    out = []
    for group, role, (pv, pf) in parts:
        if group in HEAD_GROUPS:
            pv = [(x + d[0], y + d[1], z + d[2]) for x, y, z in pv]
        else:
            pv = [stoop(v) for v in pv]
        out.append((group, role, (pv, pf)))
    return out


def arm_parts(pose: str) -> list[tuple[str, str, geom.Mesh]]:
    if pose == "tpose":
        ctrl = [SHOULDER, (0.29, 0.0, 0.865), (0.42, 0.0, 0.865), (0.54, 0.0, 0.865)]
        hand_c, hand_r = (0.60, 0.0, 0.865), (0.064, 0.044, 0.048)
        thumb_c = (0.585, -0.038, 0.875)
        cuff = [(0.525, 0.0, 0.865), (0.555, 0.0, 0.865)]
    else:
        x = WALKER_X
        ctrl = [
            SHOULDER,
            (0.25, -0.025, 0.79),
            (0.305, -0.10, 0.705),
            (x + 0.005, -0.22, 0.645),
            (x, -0.305, 0.625),
        ]
        hand_c, hand_r = (x, HAND_Y, GRIP_Z + 0.022), (0.048, 0.064, 0.044)
        thumb_c = (x - 0.04, HAND_Y + 0.008, GRIP_Z + 0.036)
        cuff = [(x + 0.002, -0.285, 0.628), (x, -0.315, 0.623)]
    if pose != "tpose":  # the shoulder follows the stoop; the hand stays on the grip
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
    out = []
    for side, mir in (("L", False), ("R", True)):
        f = _mirror if mir else (lambda m: m)
        out += [
            (f"arm_{side}", "baju", f(sleeve)),
            (f"arm_{side}", "baju_trim", f(cuff_m)),
            (f"hand_{side}", "skin", f(hand)),
            (f"hand_{side}", "skin", f(thumb)),
        ]
    return out


def walker_parts() -> list[tuple[str, str, geom.Mesh]]:
    out = []
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
        out.append(("frame", "metal", geom.tube(frame, [0.018] * len(frame), 8)))
        out.append(
            (
                "grip",
                "grip",
                geom.tube(
                    [(x, GRIP_Y[0], GRIP_Z + 0.001), (x, GRIP_Y[1], GRIP_Z + 0.001)],
                    [0.026, 0.026],
                    10,
                ),
            )
        )
        out.append(
            ("frame", "grip", geom.ellipsoid((x, -0.20, 0.026), (0.026, 0.026, 0.028), 10, 5))
        )
        out.append(
            (
                "frame",
                "metal",
                geom.tube([(x, -0.575, 0.11), (x, -0.585, 0.068)], [0.012, 0.012], 8),
            )
        )
        out.append(
            ("wheel", "wheel", geom.ellipsoid((x, -0.585, 0.066), (0.022, 0.066, 0.066), 16, 8))
        )
        out.append(
            (
                "wheel",
                "metal",
                geom.ellipsoid((x + s * 0.016, -0.585, 0.066), (0.012, 0.026, 0.026), 10, 6),
            )
        )
    out.append(
        (
            "frame",
            "metal",
            geom.tube([(-WALKER_X, -0.535, 0.42), (WALKER_X, -0.535, 0.42)], [0.016, 0.016], 8),
        )
    )
    return out


# --- bpy ---------------------------------------------------------------------------------


def clay_material(name: str, roughness: float = 0.62, metallic: float = 0.0, sheen: float = 0.25):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "COLOR_0"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if "Sheen Weight" in bsdf.inputs:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    if "Subsurface Weight" in bsdf.inputs:
        bsdf.inputs["Subsurface Weight"].default_value = 0.08
    return mat


def make_object(name: str, parts, material) -> bpy.types.Object:
    verts: list = []
    faces: list = []
    face_roles: list[str] = []
    groups: dict[str, list[int]] = {}
    for group, role, (pv, pf) in parts:
        base = len(verts)
        verts += pv
        faces += [tuple(i + base for i in f) for f in pf]
        face_roles += [role] * len(pf)
        groups.setdefault(group, []).extend(range(base, base + len(pv)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate(clean_customdata=False)
    me.update()
    attr = me.color_attributes.new("COLOR_0", "FLOAT_COLOR", "CORNER")
    cols = np.zeros((len(me.loops), 4), dtype=np.float32)
    lut = {r: _lin(r) for r in set(face_roles)}
    for poly in me.polygons:
        cols[poly.loop_start : poly.loop_start + poly.loop_total] = lut[face_roles[poly.index]]
    attr.data.foreach_set("color", cols.ravel())
    me.shade_smooth()
    me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for g, ids in groups.items():
        obj.vertex_groups.new(name=g).add(ids, 1.0, "REPLACE")
    return obj


def build_hero(pose: str = "walker", suffix: str = ""):
    body_mat = bpy.data.materials.get("hero_body") or clay_material("hero_body")
    walker_mat = bpy.data.materials.get("hero_walker") or clay_material(
        "hero_walker", 0.4, 0.35, 0.0
    )
    parts = head_parts() + body_parts()
    if pose != "tpose":
        parts = stoop_parts(parts)
    parts += arm_parts(pose)
    body = make_object(f"hero_{pose}{suffix}", parts, body_mat)
    walker = (
        make_object(f"walker{suffix}", walker_parts(), walker_mat) if pose == "walker" else None
    )
    return body, walker
