"""The hero rig (C-T3), pure Python: bones, skin weights, a two-bone IK solver and the clip
poses. `export_hero.py` turns these into a Blender armature, bakes the clips and exports glbs;
the tests check the same tables (bone budget, weights, reach, clip timing).

Frame: Blender z-up, true metres, she faces -y (glTF +z), her left is +x. The bind pose is the
upright T-pose of `parts.hero_parts("tpose")`. The web draws her at `P.DISPLAY_SCALE` (R-J3).

Clips are authored in place: the root never moves, so the runtime moves the hero object and
ties the walk rate to the pace (`stride / duration` per cycle, see `STRIDE`).
"""

import math
from dataclasses import dataclass, field, replace

from . import parts as H
from .parts import smoothstep

Vec = tuple[float, float, float]

FPS = 30
VARIANTS = ("walker", "stroller", "wheelchair", "none")
CLIPS = ("walk", "idle", "sit_down", "sit_idle", "stand_up", "look")
LOOPS = frozenset({"walk", "idle", "sit_idle"})
MAX_BONES = 60
MAX_INFLUENCES = 4

# --- bones -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Bone:
    name: str
    head: Vec
    tail: Vec
    parent: str | None
    deform: bool = True


HIP_Z = 0.45
KNEE_Z = 0.255
ANKLE_Z = 0.065
LEG_X = 0.085
THIGH = HIP_Z - KNEE_Z
SHIN = KNEE_Z - ANKLE_Z
SHOULDER = (0.16, -0.03, 0.86)
ELBOW = (0.35, -0.015, 0.863)
WRIST = (0.54, 0.0, 0.865)
PALM = (0.60, 0.0, 0.865)  # the hand ellipsoid centre in the T-pose
UPPER_ARM = math.dist(SHOULDER, ELBOW)
FOREARM = math.dist(ELBOW, WRIST)

# Wheelchair geometry the rig needs (the prop itself is in `props.py`).
WHEEL_AXLE = (0.0, 0.06, 0.30)
WHEEL_R = 0.30
RIM_R = 0.27
RIM_X = 0.31


def _mx(v: Vec, s: int) -> Vec:
    return (v[0] * s, v[1], v[2])


def grip_points(variant: str) -> dict[str, Vec]:
    """Palm targets on the prop (rest frame, true metres): where the palm bone sits."""
    if variant == "stroller":
        from .props import STROLLER_GRIP

        return {"L": STROLLER_GRIP, "R": _mx(STROLLER_GRIP, -1)}
    if variant == "wheelchair":
        p = rim_point(math.radians(15), 0.03)
        return {"L": p, "R": _mx(p, -1)}
    p = (H.WALKER_X, H.HAND_Y, H.GRIP_Z + 0.022)  # walker grips (also kept on `none`)
    return {"L": p, "R": _mx(p, -1)}


def rim_point(angle: float, lift: float = 0.0, side: int = 1) -> Vec:
    """A point on the left hand rim, `angle` forward of the top (rad), `lift` m outward."""
    r = RIM_R + lift
    ax, ay, az = WHEEL_AXLE
    return ((RIM_X + 0.01) * side, ay - r * math.sin(angle), az + r * math.cos(angle))


def bones(variant: str = "walker") -> list[Bone]:
    """The skeleton (same names and parents for every variant; grip rest points differ)."""
    out = [
        Bone("root", (0.0, 0.0, 0.0), (0.0, 0.0, 0.1), None, False),
        Bone("hips", (0.0, 0.0, HIP_Z), (0.0, 0.0, 0.58), "root"),
        Bone("spine", (0.0, 0.0, 0.58), (0.0, 0.0, 0.72), "hips"),
        Bone("chest", (0.0, 0.0, 0.72), (0.0, 0.0, 0.90), "spine"),
        Bone("neck", (0.0, 0.0, 0.90), (0.0, 0.0, 0.99), "chest"),
        Bone("head", (0.0, 0.0, 0.99), (0.0, 0.0, 1.30), "neck"),
    ]
    grips = grip_points(variant)
    for s, k in (("L", 1), ("R", -1)):
        out += [
            Bone(f"shoulder_{s}", _mx((0.04, -0.03, 0.86), k), _mx(SHOULDER, k), "chest"),
            Bone(f"upper_arm_{s}", _mx(SHOULDER, k), _mx(ELBOW, k), f"shoulder_{s}"),
            Bone(f"forearm_{s}", _mx(ELBOW, k), _mx(WRIST, k), f"upper_arm_{s}"),
            Bone(f"hand_{s}", _mx(WRIST, k), _mx(PALM, k), f"forearm_{s}"),
            Bone(f"palm_{s}", _mx(PALM, k), _mx((0.65, 0.0, 0.865), k), f"hand_{s}", False),
            Bone(f"thigh_{s}", (LEG_X * k, 0.0, HIP_Z), (LEG_X * k, 0.0, KNEE_Z), "hips"),
            Bone(f"shin_{s}", (LEG_X * k, 0.0, KNEE_Z), (LEG_X * k, 0.0, ANKLE_Z), f"thigh_{s}"),
            Bone(f"foot_{s}", (LEG_X * k, 0.0, ANKLE_Z), (0.08 * k, -0.14, 0.03), f"shin_{s}"),
            # leaf skirt bones: the kain and baju below the hip follow the legs through these,
            # and squash in depth when she sits (two soft lobes over the thighs)
            Bone(
                f"skirt_thigh_{s}", (LEG_X * k, 0.0, HIP_Z), (LEG_X * k, 0.0, KNEE_Z), f"thigh_{s}"
            ),
            Bone(
                f"skirt_shin_{s}", (LEG_X * k, 0.0, KNEE_Z), (LEG_X * k, 0.0, ANKLE_Z), f"shin_{s}"
            ),
        ]
    out.append(Bone("prop", (0.0, 0.0, 0.0), (0.0, -0.1, 0.0), "root", False))
    for s in ("L", "R"):
        g = grips[s]
        out.append(Bone(f"grip_{s}", g, (g[0], g[1] - 0.05, g[2]), "prop", False))
    ax = WHEEL_AXLE
    out.append(Bone("wheels", ax, (ax[0] + 0.1, ax[1], ax[2]), "prop", False))
    return out


BONE_NAMES = tuple(b.name for b in bones())

# --- skin weights --------------------------------------------------------------------------


def _chain(knots: list[tuple[float, str]], s: float) -> dict[str, float]:
    """Blend along a chain of bones: one-hot at each knot, smoothstep between knots."""
    if s <= knots[0][0]:
        return {knots[0][1]: 1.0}
    for (s0, b0), (s1, b1) in zip(knots, knots[1:], strict=False):
        if s <= s1:
            t = smoothstep(s0, s1, s)
            out: dict[str, float] = {}
            out[b0] = out.get(b0, 0.0) + 1 - t
            out[b1] = out.get(b1, 0.0) + t
            return out
    return {knots[-1][1]: 1.0}


def _add(acc: dict[str, float], w: dict[str, float], k: float) -> None:
    if k <= 0:
        return
    for b, v in w.items():
        acc[b] = acc.get(b, 0.0) + v * k


TRUNK = [(0.47, "hips"), (0.60, "spine"), (0.69, "spine"), (0.80, "chest")]


def body_field(v: Vec) -> dict[str, float]:
    """One spatial weight field for the torso, kain and cape, so overlapping shells (cape over
    torso, baju hem over kain) deform identically and never open a gap at the seams."""
    x, _y, z = v
    up = _chain(TRUNK, z)
    u = smoothstep(0.50, 0.38, z)  # share of the legs (skirt lobes) below the hip
    k = smoothstep(0.31, 0.21, z)  # shin share inside the legs
    sl = smoothstep(-0.07, 0.07, x)  # left lobe share
    out: dict[str, float] = {}
    _add(out, up, 1 - u)
    legs = {
        "skirt_thigh_L": (1 - k) * sl,
        "skirt_thigh_R": (1 - k) * (1 - sl),
        "skirt_shin_L": k * sl,
        "skirt_shin_R": k * (1 - sl),
    }
    _add(out, legs, u)
    return out


def _move(w: dict[str, float], src: str, dst: str, share: float) -> None:
    """Move `share` of `src`'s weight to `dst`."""
    if share <= 0 or src not in w:
        return
    m = w[src] * share
    w[src] -= m
    w[dst] = w.get(dst, 0.0) + m


def _arm_chain(side: str) -> list[tuple[float, str]]:
    return [
        (0.13, "chest"),
        (0.185, f"shoulder_{side}"),
        (0.25, f"upper_arm_{side}"),
        (0.32, f"upper_arm_{side}"),
        (0.38, f"forearm_{side}"),
        (0.515, f"forearm_{side}"),
        (0.60, f"hand_{side}"),
    ]


def vertex_weights(group: str, v: Vec) -> dict[str, float]:
    """Skin weights for one rest-pose vertex of a part in vertex group `group` (C-T2 names).
    At most `MAX_INFLUENCES` bones, normalised to 1."""
    x, _y, z = v
    side = "L" if x >= 0 else "R"
    ax = abs(x)
    if group in ("head", "face"):
        w = {"head": 1.0}
    elif group.startswith("shoe_"):
        w = {f"foot_{group[-1]}": 1.0}
    elif group.startswith("arm_"):
        # sleeve and cuff: blend chest -> shoulder -> upper arm -> forearm along the T-pose
        # arm (it runs along x); the cuff end takes a little of the hand (no gap at the wrist)
        w = _chain(_arm_chain(group[-1]), ax)
    elif group.startswith("hand_"):
        w = _chain([(0.53, f"forearm_{group[-1]}"), (0.575, f"hand_{group[-1]}")], ax)
    elif group in ("torso", "kain"):
        w = body_field(v)
        # the top of the baju near the shoulders follows the clavicle a little
        _move(
            w,
            "chest",
            f"shoulder_{side}",
            0.45 * smoothstep(0.08, 0.17, ax) * smoothstep(0.80, 0.86, z),
        )
    elif group == "tudung_cape":
        w = body_field(v)
        # inside the hood the cape follows the neck and head (covers the neck at every frame)
        top = smoothstep(0.95, 1.05, z)
        _move(w, "chest", "neck", 0.65 * top)
        _move(w, "neck", "head", 0.35 * top)
        # over the shoulders it rides the clavicle and a little of the upper arm
        sides = smoothstep(0.12, 0.24, ax) * smoothstep(0.95, 0.85, z)
        _move(w, "chest", f"shoulder_{side}", 0.3 * sides)
        _move(w, f"shoulder_{side}", f"upper_arm_{side}", 0.15 * smoothstep(0.18, 0.26, ax))
    else:
        raise ValueError(f"no weights for vertex group {group!r}")
    return normalise(w)


def normalise(w: dict[str, float]) -> dict[str, float]:
    top = sorted(((v, b) for b, v in w.items() if v > 1e-4), reverse=True)[:MAX_INFLUENCES]
    total = sum(v for v, _b in top)
    return {b: v / total for v, b in top}


# --- two-bone IK ---------------------------------------------------------------------------


def _sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _addv(a: Vec, b: Vec, k: float = 1.0) -> Vec:
    return (a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k)


def _dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(a: Vec) -> Vec:
    n = math.sqrt(_dot(a, a)) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def two_bone(root: Vec, target: Vec, a: float, b: float, pole: Vec) -> tuple[Vec, Vec]:
    """The middle joint and the reached end point of a two-bone chain from `root` towards
    `target`, bending towards `pole` (a direction). Out of reach, the chain straightens and
    the end stops short of the target (the caller measures the error)."""
    d_vec = _sub(target, root)
    d = math.sqrt(_dot(d_vec, d_vec))
    reach = a + b - 1e-5
    lo = abs(a - b) + 1e-5
    dist = min(max(d, lo), reach)
    u = _norm(d_vec)
    end = _addv(root, u, dist)
    along = (a * a - b * b + dist * dist) / (2 * dist)
    h = math.sqrt(max(0.0, a * a - along * along))
    p = _sub(pole, (u[0] * _dot(pole, u), u[1] * _dot(pole, u), u[2] * _dot(pole, u)))
    p = _norm(p)
    mid = _addv(_addv(root, u, along), p, h)
    return mid, end


# --- poses ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Arm:
    """Palm target. `grip` 1 = the palm rides its prop grip bone; 0 = the free target `pos`
    with the fingers along `fingers` and the palm facing `palm` (armature space)."""

    grip: float = 1.0
    pos: Vec = (0.0, 0.0, 0.0)
    fingers: Vec = (0.0, -1.0, 0.0)
    palm: Vec = (0.0, 0.0, -1.0)


@dataclass(frozen=True)
class Leg:
    ankle: Vec
    pitch: float = 0.0  # toes down, degrees


@dataclass(frozen=True)
class Pose:
    hips: Vec = (0.0, 0.0, 0.0)  # offset of the hips joint from rest
    rot: dict = field(default_factory=dict)  # bone -> (pitch fwd, roll left, yaw left) degrees
    arm_L: Arm = Arm()
    arm_R: Arm = Arm()
    leg_L: Leg = Leg((LEG_X, 0.0, ANKLE_Z))
    leg_R: Leg = Leg((-LEG_X, 0.0, ANKLE_Z))
    skirt: float = 0.0  # 0 standing, 1 seated (skirt lobes squashed into a lap)
    prop: Vec = (0.0, 0.0, 0.0)
    prop_yaw: float = 0.0  # degrees, + turns to her left
    wheel: float = 0.0  # wheelchair wheel angle, rad (+ rolls forward)


def _lerp(a, b, t):
    if isinstance(a, tuple):
        return tuple(x + (y - x) * t for x, y in zip(a, b, strict=True))
    return a + (b - a) * t


def _mix_arm(a: Arm, b: Arm, t: float) -> Arm:
    return Arm(
        _lerp(a.grip, b.grip, t),
        _lerp(a.pos, b.pos, t),
        _norm(_lerp(a.fingers, b.fingers, t)),
        _norm(_lerp(a.palm, b.palm, t)),
    )


def mix(a: Pose, b: Pose, t: float) -> Pose:
    """Blend two poses (t = 0 -> a, 1 -> b)."""
    if t <= 0:
        return a
    if t >= 1:
        return b
    zero = (0.0, 0.0, 0.0)
    rot = {k: _lerp(a.rot.get(k, zero), b.rot.get(k, zero), t) for k in set(a.rot) | set(b.rot)}
    return Pose(
        hips=_lerp(a.hips, b.hips, t),
        rot=rot,
        arm_L=_mix_arm(a.arm_L, b.arm_L, t),
        arm_R=_mix_arm(a.arm_R, b.arm_R, t),
        leg_L=Leg(_lerp(a.leg_L.ankle, b.leg_L.ankle, t), _lerp(a.leg_L.pitch, b.leg_L.pitch, t)),
        leg_R=Leg(_lerp(a.leg_R.ankle, b.leg_R.ankle, t), _lerp(a.leg_R.pitch, b.leg_R.pitch, t)),
        skirt=_lerp(a.skirt, b.skirt, t),
        prop=_lerp(a.prop, b.prop, t),
        prop_yaw=_lerp(a.prop_yaw, b.prop_yaw, t),
        wheel=_lerp(a.wheel, b.wheel, t),
    )


def _add_rot(p: Pose, extra: dict) -> Pose:
    zero = (0.0, 0.0, 0.0)
    rot = dict(p.rot)
    for k, v in extra.items():
        rot[k] = _addv(rot.get(k, zero), v)
    return replace(p, rot=rot)


def _arms(left: Arm) -> tuple[Arm, Arm]:
    """A left arm target and its mirror for the right arm."""
    return left, Arm(left.grip, _mx(left.pos, -1), _mx(left.fingers, -1), _mx(left.palm, -1))


# Age cues (C-T2 carry-overs): a deeper stoop spread over hips, spine and chest, the neck well
# forward and the head tipped back so the face still reads in 3/4; a short shuffle gait.
TRUNK_STAND = {
    "hips": (6.0, 0.0, 0.0),
    "spine": (8.0, 0.0, 0.0),
    "chest": (7.0, 0.0, 0.0),
    "neck": (16.0, 0.0, 0.0),
    "head": (-30.0, 0.0, 0.0),
}
TRUNK_SIT = {
    "hips": (-5.0, 0.0, 0.0),
    "spine": (7.0, 0.0, 0.0),
    "chest": (8.0, 0.0, 0.0),
    "neck": (15.0, 0.0, 0.0),
    "head": (-22.0, 0.0, 0.0),
}
TRUNK_FREE = {  # no walker: a milder stoop
    "hips": (3.0, 0.0, 0.0),
    "spine": (6.0, 0.0, 0.0),
    "chest": (6.0, 0.0, 0.0),
    "neck": (15.0, 0.0, 0.0),
    "head": (-24.0, 0.0, 0.0),
}

STAND_HIPS = (0.0, 0.01, -0.025)
WALK_HIPS_Z = -0.035
SEAT_Z = 0.45  # bench seat top (true m; H7: 0.45 m true x display scale)
SEAT_EDGE_Y = 0.21  # bench seat front edge, behind the root (her back is +y)
SIT_HIPS = (0.0, SEAT_EDGE_Y + 0.07, 0.48 - HIP_Z)
SIT_ANKLE = (LEG_X, SEAT_EDGE_Y + 0.07 - THIGH - 0.015, 0.30)
CHAIR_SEAT_Z = 0.43
CHAIR_HIPS = (0.0, 0.03, 0.46 - HIP_Z)
CHAIR_ANKLE = (LEG_X, 0.03 - THIGH - 0.03, 0.275)

SIDE_HAND = Arm(0.0, (0.30, -0.05, 0.53), (0.05, -0.15, -1.0), (-1.0, 0.0, 0.0))
LAP_HAND = Arm(0.0, (0.10, -0.12, 0.665), (-0.3, -0.8, -0.45), (0.0, 0.0, -1.0))
GRIP = Arm(1.0)


def _lap(seat_hips: Vec) -> Arm:
    dy, dz = seat_hips[1] - SIT_HIPS[1], seat_hips[2] - SIT_HIPS[2]
    x, y, z = LAP_HAND.pos
    return replace(LAP_HAND, pos=(x, y + SIT_HIPS[1] + dy, z + dz))


def stand_pose(variant: str) -> Pose:
    if variant == "wheelchair":
        return chair_pose()
    if variant == "none":
        la, ra = _arms(SIDE_HAND)
        return Pose(hips=STAND_HIPS, rot=dict(TRUNK_FREE), arm_L=la, arm_R=ra)
    return Pose(hips=STAND_HIPS, rot=dict(TRUNK_STAND))


def sit_pose(variant: str) -> Pose:
    la, ra = _arms(_lap(SIT_HIPS))
    park = PARK.get(variant, ((0.0, 0.0, 0.0), 0.0))
    return Pose(
        hips=SIT_HIPS,
        rot=dict(TRUNK_SIT),
        arm_L=la,
        arm_R=ra,
        leg_L=Leg(SIT_ANKLE, 25.0),
        leg_R=Leg(_mx(SIT_ANKLE, -1), 25.0),
        skirt=1.0,
        prop=park[0],
        prop_yaw=park[1],
    )


def chair_pose(hands: str = "rim") -> Pose:
    if hands == "rim":
        la, ra = GRIP, GRIP
    else:
        lap = replace(LAP_HAND, pos=(0.10, CHAIR_HIPS[1] - 0.16, 0.465 + CHAIR_HIPS[2] + 0.17))
        la, ra = _arms(lap)
    return Pose(
        hips=CHAIR_HIPS,
        rot=dict(TRUNK_SIT),
        arm_L=la,
        arm_R=ra,
        leg_L=Leg(CHAIR_ANKLE, 10.0),
        leg_R=Leg(_mx(CHAIR_ANKLE, -1), 10.0),
        skirt=1.0,
    )


# Where the prop waits while she sits: a nudge to her front-right, still within reach.
PARK = {"walker": ((-0.12, -0.06, 0.0), -15.0), "stroller": ((-0.12, -0.06, 0.0), -15.0)}

# --- clips ---------------------------------------------------------------------------------

# Walk cycle (one cycle = two steps). The clip is in place: during stance a foot slides back
# at stride / duration, so the runtime sets rate = speed / (stride * scale / duration).
STRIDE = {"walker": 0.56, "stroller": 0.56, "none": 0.56, "wheelchair": math.pi * WHEEL_R}
WALK_DURATION = {"walker": 0.9, "stroller": 0.9, "none": 0.9, "wheelchair": 1.2}
STEP_LIFT = 0.03


def durations(variant: str) -> dict[str, float]:
    chair = variant == "wheelchair"
    return {
        "walk": WALK_DURATION[variant],
        "idle": 3.0,
        "sit_down": 1.0 if chair else 1.4,
        "sit_idle": 4.0,
        "stand_up": 1.0 if chair else 1.4,
        "look": 3.6,
    }


def frame_count(duration: float) -> int:
    return round(duration * FPS)


def _ss(a: float, b: float, t: float) -> float:
    return smoothstep(a, b, t)


def _keys(keys: list[tuple[float, float]], t: float) -> float:
    """Smoothstep between (time, value) keys."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:], strict=False):
        if t <= t1:
            return v0 + (v1 - v0) * smoothstep(t0, t1, t)
    return keys[-1][1]


def _foot(phase: float, half: float) -> tuple[float, float]:
    """(y, lift) of an ankle over one cycle in place: stance (phase 0-0.5) slides from front
    (-half) to back (+half) at constant speed; swing returns it with a small lift."""
    phase %= 1.0
    if phase < 0.5:
        return -half + 2 * half * (phase / 0.5), 0.0
    s = (phase - 0.5) / 0.5
    e = 0.5 - 0.5 * math.cos(math.pi * s)
    return half - 2 * half * e, STEP_LIFT * math.sin(math.pi * s)


def walk_pose(variant: str, t: float) -> Pose:
    dur = WALK_DURATION[variant]
    ph = t / dur
    if variant == "wheelchair":
        return chair_push(t)
    base = stand_pose(variant)
    half = STRIDE[variant] / 4  # each foot travels half a stride per step, centred under the hip
    yl, ll = _foot(ph, half)
    yr, lr = _foot(ph + 0.5, half)
    w = 2 * math.pi * ph
    bob = 0.006 * math.cos(2 * w)  # highest at mid-stance of each foot
    sway = 0.008 * math.sin(w)  # over the stance foot
    hips = (STAND_HIPS[0] + sway, STAND_HIPS[1], WALK_HIPS_Z + bob)
    legs = {
        "leg_L": Leg((LEG_X, hips[1] + yl, ANKLE_Z + ll), -8.0 * ll / STEP_LIFT),
        "leg_R": Leg((-LEG_X, hips[1] + yr, ANKLE_Z + lr), -8.0 * lr / STEP_LIFT),
    }
    p = replace(base, hips=hips, **legs)
    p = _add_rot(
        p,
        {
            "hips": (0.0, -2.0 * math.sin(w), 3.0 * math.sin(w)),
            "chest": (0.0, 1.0 * math.sin(w), -2.5 * math.sin(w)),
            "head": (1.0 * math.cos(2 * w), 0.0, 0.0),
        },
    )
    if variant == "none":  # arms swing against the legs
        sw = 0.07 * math.sin(w)
        la = replace(SIDE_HAND, pos=_addv(SIDE_HAND.pos, (0.0, sw, 0.01 * abs(math.sin(w)))))
        ra = _arms(replace(SIDE_HAND, pos=_addv(SIDE_HAND.pos, (0.0, -sw, 0.0))))[1]
        p = replace(p, arm_L=la, arm_R=ra)
    return p


def chair_push(t: float) -> Pose:
    """Wheelchair walk: the wheels turn half a turn per cycle (six spokes, so the loop is
    seamless); both hands push on the rims for a quarter of the cycle, then lift back."""
    dur = WALK_DURATION["wheelchair"]
    ph = (t / dur) % 1.0
    omega = math.pi / dur  # rad/s
    a0, a1 = math.radians(-10), math.radians(35)
    push = (a1 - a0) / omega / dur  # share of the cycle with the hands on the rims
    if ph < push:
        ang, lift = a0 + omega * ph * dur, 0.03
    else:
        s = (ph - push) / (1 - push)
        e = 0.5 - 0.5 * math.cos(math.pi * s)
        ang, lift = a1 + (a0 - a1) * e, 0.03 + 0.06 * math.sin(math.pi * s)
    pos = rim_point(ang, lift)
    tangent = (0.0, -math.cos(ang), -math.sin(ang))
    la = Arm(0.0, pos, _norm(_addv(tangent, (0.0, 0.0, -0.6))), _norm((0.25, 0.0, -1.0)))
    la, ra = _arms(la)
    lean = 4.0 * math.sin(math.pi * min(1.0, ph / max(push, 1e-6)))
    p = replace(chair_pose(), arm_L=la, arm_R=ra, wheel=omega * t)
    return _add_rot(p, {"chest": (lean, 0.0, 0.0)})


def idle_pose(variant: str, t: float) -> Pose:
    base = stand_pose(variant)
    w = 2 * math.pi * t / 3.0
    p = replace(base, hips=_addv(base.hips, (0.0, 0.0, 0.002 * math.sin(w))))
    return _add_rot(
        p,
        {
            "chest": (1.0 * math.sin(w), 0.0, 0.0),
            "head": (-1.0 * math.sin(w), 0.0, 2.0 * math.sin(w)),
        },
    )


LOOK_KEYS = [
    (0.0, 0.0),
    (0.5, 0.0),
    (1.0, 40.0),
    (1.6, 40.0),
    (2.2, -38.0),
    (2.8, -38.0),
    (3.3, 0.0),
]


def look_pose(variant: str, t: float) -> Pose:
    """Pause and look around (UNKNOWN events): head left, hold, right, hold, back."""
    yaw = _keys(LOOK_KEYS, t)
    peer = 3.0 * _keys([(0.0, 0.0), (0.8, 1.0), (2.9, 1.0), (3.4, 0.0)], t)
    return _add_rot(
        stand_pose(variant),
        {
            "chest": (peer, 0.0, 0.25 * yaw),
            "neck": (0.0, 0.0, 0.3 * yaw),
            "head": (0.0, -0.06 * yaw, 0.45 * yaw),
        },
    )


def sit_idle_pose(variant: str, t: float) -> Pose:
    base = chair_pose("lap") if variant == "wheelchair" else sit_pose(variant)
    w = 2 * math.pi * t / 4.0
    p = replace(base, hips=_addv(base.hips, (0.0, 0.0, 0.0015 * math.sin(w))))
    return _add_rot(
        p,
        {
            "chest": (1.2 * math.sin(w), 0.0, 0.0),
            "head": (-1.0 * math.sin(w), 0.0, 6.0 * math.sin(w)),
        },
    )


def sit_down_pose(variant: str, t: float) -> Pose:
    if variant == "wheelchair":  # already seated: hands from the rims to the lap
        return mix(chair_pose("rim"), chair_pose("lap"), _ss(0.1, 0.9, t))
    stand, sit = stand_pose(variant), sit_pose(variant)
    has_prop = variant in PARK
    # 0-0.4 s: nudge the prop to its park spot (hands on); 0.3-0.7 s: hands to the lap
    park = _ss(0.0, 0.4, t) if has_prop else 0.0
    hands = _ss(0.3, 0.7, t) if has_prop else _ss(0.2, 0.9, t)
    # 0.15-0.75 s: two small steps back towards the bench; 0.7-1.3 s: up onto the seat
    back = 0.08
    yl = back * _ss(0.15, 0.45, t)
    yr = back * _ss(0.45, 0.75, t)
    lift_l = STEP_LIFT * math.sin(math.pi * _ss(0.15, 0.45, t))
    lift_r = STEP_LIFT * math.sin(math.pi * _ss(0.45, 0.75, t))
    body = _ss(0.7, 1.3, t)
    hips_back = _lerp(stand.hips, (stand.hips[0], back, stand.hips[2] - 0.01), _ss(0.15, 0.75, t))
    pre = replace(
        stand,
        hips=hips_back,
        leg_L=Leg((LEG_X, yl, ANKLE_Z + lift_l)),
        leg_R=Leg((-LEG_X, yr, ANKLE_Z + lift_r)),
    )
    pre = _add_rot(pre, {"spine": (6.0 * park * (1 - body), 0.0, 0.0)})
    p = mix(pre, sit, body)
    arm_l = _mix_arm(stand.arm_L, sit.arm_L, hands)
    arm_r = _mix_arm(stand.arm_R, sit.arm_R, hands)
    pk = PARK.get(variant, ((0.0, 0.0, 0.0), 0.0))
    return replace(
        p,
        arm_L=arm_l,
        arm_R=arm_r,
        prop=_lerp((0.0, 0.0, 0.0), pk[0], park),
        prop_yaw=pk[1] * park,
    )


def stand_up_pose(variant: str, t: float) -> Pose:
    """`sit_down` played backwards: off the seat, step forward, hands to the prop, pull it in."""
    return sit_down_pose(variant, durations(variant)["sit_down"] - t)


POSES = {
    "walk": walk_pose,
    "idle": idle_pose,
    "sit_down": sit_down_pose,
    "sit_idle": sit_idle_pose,
    "stand_up": stand_up_pose,
    "look": look_pose,
}


def clip_pose(variant: str, clip: str, t: float) -> Pose:
    if variant not in VARIANTS:
        raise ValueError(f"unknown variant {variant!r}")
    return POSES[clip](variant, t)
