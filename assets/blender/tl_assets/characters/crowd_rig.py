"""The crowd rig (C-T6), pure Python: one 19-bone skeleton per body (same names everywhere),
skin weights, the clip poses and a reference skinning function for tests and renders.

Frame: Blender z-up, true metres, a person faces -y, her left is +x (as `crowd.py`). The bind
pose is the upright A-pose of `crowd.person_parts`. A pose is, per bone, its world rotation
`R` (3x3 rows, applied to rest-frame offsets from the bone head) and its world head position;
a rest point `p` of bone `b` lands at `head_b + R_b (p - rest_head_b)`. `export_crowd.py`
turns these into keyed FK (no constraints ship), so C-T7 can bake them to textures.

Clips (in place: the root never moves; the runtime moves the agent and sets the rate from
`stride / duration`, as for the hero):
- `walk`, `idle`: free hands.
- `walk_walker`, `idle_walker`, `walk_stroller`, `idle_stroller`: hands on the prop grips.
- `walk_wheelchair`, `idle_wheelchair`: seated; the walk pushes the hand rims and turns the
  `wheels` bone a quarter turn per cycle (the wheel is a four-spoke cross, so it loops).
"""

import math
from dataclasses import dataclass
from functools import cache, lru_cache

from . import crowd
from .parts import smoothstep
from .rig import Bone, _chain, normalise, two_bone

Vec = tuple[float, float, float]
Mat = tuple[Vec, Vec, Vec]

FPS = 30
MAX_BONES = 20
MODES = ("free", "walker", "stroller", "wheelchair")
IDLE_DURATION = 3.0
I3: Mat = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


# --- small linear algebra ----------------------------------------------------------------


def mm(a: Mat, b: Mat) -> Mat:
    return tuple(
        tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)) for i in range(3)
    )  # type: ignore[return-value]


def mv(a: Mat, v) -> Vec:
    return (
        a[0][0] * v[0] + a[0][1] * v[1] + a[0][2] * v[2],
        a[1][0] * v[0] + a[1][1] * v[1] + a[1][2] * v[2],
        a[2][0] * v[0] + a[2][1] * v[1] + a[2][2] * v[2],
    )


def rx(a: float) -> Mat:
    c, s = math.cos(a), math.sin(a)
    return ((1.0, 0.0, 0.0), (0.0, c, -s), (0.0, s, c))


def ry(a: float) -> Mat:
    c, s = math.cos(a), math.sin(a)
    return ((c, 0.0, s), (0.0, 1.0, 0.0), (-s, 0.0, c))


def rz(a: float) -> Mat:
    c, s = math.cos(a), math.sin(a)
    return ((c, -s, 0.0), (s, c, 0.0), (0.0, 0.0, 1.0))


def _add(a, b, k: float = 1.0) -> Vec:
    return (a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k)


def _sub(a, b) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _unit(a) -> Vec:
    n = math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def align(a: Vec, b: Vec) -> Mat:
    """The minimal rotation taking unit vector `a` onto unit vector `b`."""
    a, b = _unit(a), _unit(b)
    v = (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
    c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    if c > 1 - 1e-12:
        return I3
    if c < -1 + 1e-12:
        return rx(math.pi) if abs(a[0]) < 0.9 else rz(math.pi)
    k = 1.0 / (1.0 + c)
    vx = ((0.0, -v[2], v[1]), (v[2], 0.0, -v[0]), (-v[1], v[0], 0.0))
    vx2 = mm(vx, vx)
    return tuple(tuple(I3[i][j] + vx[i][j] + vx2[i][j] * k for j in range(3)) for i in range(3))  # type: ignore[return-value]


# --- skeleton ----------------------------------------------------------------------------


def _mx(v: Vec, k: int) -> Vec:
    return (v[0] * k, v[1], v[2])


@dataclass(frozen=True)
class Wheelchair:
    seat_top: float
    seat_y: float
    seat_d: float  # half depth
    back_y: float
    back_top: float
    foot_y: float
    foot_z: float  # footrest top
    width: float  # frame half width
    wheel_x: float
    wheel_r: float
    rim_x: float
    rim_r: float
    axle: Vec
    caster_r: float
    hips: Vec  # seated hips bone head
    ankle: Vec  # seated left ankle


def wheelchair_dims(b: crowd.Body) -> Wheelchair:
    """A wheelchair fitted to a body: feet flat on the footrest, thighs level on the seat."""
    lay = crowd.layout(b)
    s = lay.s
    thigh = lay.hip_z - lay.knee_z
    shin = lay.knee_z - lay.ankle_z
    foot_z = 0.10 * s
    ankle_z = foot_z + lay.ankle_z
    hz = ankle_z + shin * 0.97
    ankle_y = -thigh * 0.97
    seat_top = hz - 0.058 * s
    back_y = lay.hip_w * lay.depth + 0.03 * s
    front = -thigh * 0.85
    seat_y, seat_d = (back_y + front) / 2, (back_y - front) / 2
    width = lay.hip_w + 0.045 * s
    wheel_x = width + 0.03 * s
    wheel_r = 0.78 * seat_top
    return Wheelchair(
        seat_top=seat_top,
        seat_y=seat_y,
        seat_d=seat_d,
        back_y=back_y,
        back_top=hz + 0.55 * (lay.shoulder_z - lay.hip_z),
        foot_y=ankle_y - 0.03 * s,
        foot_z=foot_z,
        width=width,
        wheel_x=wheel_x,
        wheel_r=wheel_r,
        rim_x=wheel_x + 0.03 * s,
        rim_r=wheel_r * 0.88,
        axle=(0.0, seat_y + seat_d * 0.4, wheel_r),
        caster_r=0.045 * s,
        hips=(0.0, 0.0, hz),
        ankle=(lay.leg_x, ankle_y, ankle_z),
    )


@cache
def bones(body_id: str) -> tuple[Bone, ...]:
    """19 bones: root, trunk (hips, spine, chest, head), arms and legs (3 each side), the
    non-deform `prop` and `wheels`. Same names and parents for every body."""
    b = crowd.BODIES[body_id]
    lay = crowd.layout(b)
    s = lay.s
    sj, d = lay.shoulder_joint, lay.arm_dir
    el = _add(sj, d, lay.upper)
    wr = _add(sj, d, lay.upper + lay.fore)
    tip = _add(wr, d, 0.08 * s)
    out = [
        Bone("root", (0.0, 0.0, 0.0), (0.0, 0.0, 0.1 * s), None, False),
        Bone("hips", (0.0, 0.0, lay.hip_z), (0.0, 0.0, lay.waist_z), "root"),
        Bone("spine", (0.0, 0.0, lay.waist_z), (0.0, 0.0, lay.chest_z), "hips"),
        Bone("chest", (0.0, 0.0, lay.chest_z), (0.0, 0.0, lay.chin), "spine"),
        Bone("head", (0.0, 0.0, lay.chin), (0.0, 0.0, lay.height), "chest"),
    ]
    for side, k in (("L", 1), ("R", -1)):
        lx = lay.leg_x * k
        out += [
            Bone(f"upper_arm_{side}", _mx(sj, k), _mx(el, k), "chest"),
            Bone(f"forearm_{side}", _mx(el, k), _mx(wr, k), f"upper_arm_{side}"),
            Bone(f"hand_{side}", _mx(wr, k), _mx(tip, k), f"forearm_{side}"),
            Bone(f"thigh_{side}", (lx, 0.0, lay.hip_z), (lx, 0.0, lay.knee_z), "hips"),
            Bone(f"shin_{side}", (lx, 0.0, lay.knee_z), (lx, 0.0, lay.ankle_z), f"thigh_{side}"),
            Bone(f"foot_{side}", (lx, 0.0, lay.ankle_z), _mx(lay.toe, k), f"shin_{side}"),
        ]
    w = wheelchair_dims(b)
    out.append(Bone("prop", (0.0, 0.0, 0.0), (0.0, -0.1 * s, 0.0), "root", False))
    out.append(Bone("wheels", w.axle, _add(w.axle, (0.1 * s, 0.0, 0.0)), "prop", False))
    return tuple(out)


BONE_NAMES = tuple(b.name for b in bones("adult_man"))


# --- skin weights --------------------------------------------------------------------------


def _trunk(lay: crowd.Layout, z: float) -> dict[str, float]:
    s = lay.s
    knots = [
        (lay.hip_z + 0.02 * s, "hips"),
        (lay.waist_z + 0.02 * s, "spine"),
        (lay.chest_z, "spine"),
        (lay.chest_z + 0.05 * s, "chest"),
    ]
    return _chain(knots, z)


def _mix(acc: dict[str, float], w: dict[str, float], k: float) -> None:
    if k <= 0:
        return
    for name, v in w.items():
        acc[name] = acc.get(name, 0.0) + v * k


def _legs(lay: crowd.Layout, v, lobe: float) -> dict[str, float]:
    """Below the hips: soft left/right lobes on the thighs, the shins below the knee."""
    s = lay.s
    x, _y, z = v
    k = smoothstep(lay.knee_z + 0.05 * s, lay.knee_z - 0.08 * s, z)
    sl = smoothstep(-lobe * s, lobe * s, x)
    return {
        "thigh_L": (1 - k) * sl,
        "thigh_R": (1 - k) * (1 - sl),
        "shin_L": k * sl,
        "shin_R": k * (1 - sl),
    }


def vertex_weights(body_id: str, group: str, v) -> dict[str, float]:
    """Skin weights of one bind-pose vertex in part group `group`: <= 4 bones, sum 1."""
    lay = crowd.layout(crowd.BODIES[body_id])
    s = lay.s
    x, _y, z = v
    if group in ("face", "hood", "hair", "headwear"):
        w = {"head": 1.0}
    elif group.startswith("shoe_"):
        w = {f"foot_{group[-1]}": 1.0}
    elif group.startswith("hand_"):
        w = {f"hand_{group[-1]}": 1.0}
    elif group.startswith("arm_"):
        side = group[-1]
        sj, d = lay.shoulder_joint, lay.arm_dir
        p = (abs(x) - sj[0], v[1] - sj[1], z - sj[2])
        t = (p[0] * d[0] + p[1] * d[1] + p[2] * d[2]) / (lay.upper + lay.fore)
        knots = [
            (0.0, "chest"),
            (0.1, f"upper_arm_{side}"),
            (0.42, f"upper_arm_{side}"),
            (0.58, f"forearm_{side}"),
            (0.95, f"forearm_{side}"),
            (1.06, f"hand_{side}"),
        ]
        w = _chain(knots, t)
    elif group.startswith("leg_"):
        side = group[-1]
        w = _chain(
            [
                (-(lay.knee_z + 0.04 * s), f"thigh_{side}"),
                (-(lay.knee_z - 0.04 * s), f"shin_{side}"),
            ],
            -z,
        )
    elif group in ("torso", "skirt", "cape"):
        w = {}
        if group == "skirt":
            u = smoothstep(lay.hip_z + 0.02 * s, lay.hip_z - 0.10 * s, z)
            lobe = 0.05
        else:
            u = smoothstep(lay.hip_z, lay.hip_z - 0.05 * s, z)
            lobe = 0.04
        _mix(w, _trunk(lay, z), 1 - u)
        _mix(w, _legs(lay, v, lobe), u)
        if group == "cape":
            h = 0.9 * smoothstep(lay.shoulder_z + 0.01 * s, lay.chin + 0.03 * s, z)
            for name in list(w):
                if name != "head":
                    m = w[name] * h
                    w[name] -= m
                    w["head"] = w.get("head", 0.0) + m
    else:
        raise ValueError(f"no weights for group {group!r}")
    return normalise(w)


# --- clips ---------------------------------------------------------------------------------


def clip_names(mode: str) -> tuple[str, str]:
    if mode == "free":
        return ("walk", "idle")
    if mode not in MODES:
        raise ValueError(mode)
    return (f"walk_{mode}", f"idle_{mode}")


def _parse(clip: str) -> tuple[str, str]:
    kind, _, mode = clip.partition("_")
    if kind not in ("walk", "idle") or (mode or "free") not in MODES:
        raise ValueError(f"unknown clip {clip!r}")
    return kind, mode or "free"


WALK_DURATION = {"child": 0.8, "school_age": 0.9, "adult_man": 1.0, "adult_woman": 1.0}
STRIDE_K = {"child": 1.25, "school_age": 1.3, "adult_man": 1.3, "adult_woman": 1.25}


def duration(body_id: str, clip: str) -> float:
    kind, mode = _parse(clip)
    if kind == "idle":
        return IDLE_DURATION
    if mode == "walker":
        return 1.2
    if mode == "stroller":
        return 1.1
    if mode == "wheelchair":
        return 1.0
    return WALK_DURATION.get(body_id, 1.1)


def stride(body_id: str, clip: str) -> float:
    """Ground travelled per walk cycle (true metres); 0 for idles."""
    kind, mode = _parse(clip)
    if kind == "idle":
        return 0.0
    b = crowd.BODIES[body_id]
    if mode == "wheelchair":
        return math.pi / 2 * wheelchair_dims(b).wheel_r
    lay = crowd.layout(b)
    leg = lay.hip_z - lay.ankle_z
    if mode == "walker":
        return 0.85 * leg
    if mode == "stroller":
        return 1.15 * leg
    return STRIDE_K.get(body_id, 0.95) * leg


IDLE_KEY_STEP = 3  # idles are slow (breathing, a look around): one key per 3 frames (10 fps)


def key_frames(clip: str, d: float) -> list[int]:
    """Timeline frames (at `FPS`) that carry a key; the last equals the first pose (loops).
    Walks key every frame; idles every `IDLE_KEY_STEP` frames (linear in between)."""
    n = max(1, round(d * FPS))
    step = IDLE_KEY_STEP if clip.startswith("idle") and n % IDLE_KEY_STEP == 0 else 1
    return list(range(0, n + 1, step))


@dataclass(frozen=True)
class Trunk:
    hips: Vec  # hips bone head offset from rest
    yaw_h: float = 0.0
    pitch_h: float = 0.0
    roll_h: float = 0.0
    pitch_s: float = 0.0
    yaw_c: float = 0.0
    pitch_c: float = 0.0
    pitch_head: float = 0.0
    yaw_head: float = 0.0


IDLE_EXTRA_STOOP = 8.0  # degrees
LEAN = {"free": 0.0, "walker": 12.0, "stroller": 7.0, "wheelchair": 4.0}


def _trunk_pose(body_id: str, mode: str, kind: str, ph: float, *, neutral: bool = False) -> Trunk:
    b = crowd.BODIES[body_id]
    lay = crowd.layout(b)
    s = lay.s
    # older bodies stand more bent while idle than when they walk (age cue)
    st = b.stoop + (
        IDLE_EXTRA_STOOP if kind == "idle" and b.stoop and mode != "wheelchair" else 0.0
    )
    lean = LEAN[mode] + (3.0 if kind == "walk" and mode == "free" else 0.0)
    bend = st + lean
    pitch_h = math.radians(0.15 * st + 0.3 * lean)
    pitch_s = math.radians(0.35 * st + 0.3 * lean)
    pitch_c = math.radians(0.5 * st + 0.4 * lean)
    pitch_head = -math.radians(0.75 * bend)
    tau = 2 * math.pi
    if mode == "wheelchair":
        w = wheelchair_dims(b)
        hips = _sub(w.hips, (0.0, 0.0, lay.hip_z))
        if neutral:
            return Trunk(hips, 0, pitch_h, 0, pitch_s, 0, pitch_c, pitch_head)
        if kind == "walk":
            push = math.sin(tau * ph) * 0.5 + 0.5
            return Trunk(
                hips,
                0,
                pitch_h,
                0,
                pitch_s,
                0,
                pitch_c + math.radians(5) * push,
                pitch_head - math.radians(3) * push,
            )
        breath = math.sin(tau * 2 * ph)
        return Trunk(
            hips,
            0,
            pitch_h,
            0,
            pitch_s,
            0,
            pitch_c + math.radians(1.2) * breath,
            pitch_head,
            math.radians(14) * math.sin(tau * ph),
        )
    c = _crouch(body_id, mode, kind)
    if neutral:
        return Trunk((0.0, 0.0, -c), 0, pitch_h, 0, pitch_s, 0, pitch_c, pitch_head)
    if kind == "walk":
        bob = 0.006 * s * (0.5 + 0.5 * math.cos(2 * tau * ph))
        sway = 0.008 * s * math.sin(tau * ph)
        yaw = math.radians(2.0 if mode != "free" else 5.0)
        yaw_h = -yaw * math.cos(tau * ph)
        yaw_c = -yaw_h * (1.0 if mode != "free" else 1.6)
        return Trunk(
            (sway, 0.0, -c - bob),
            yaw_h,
            pitch_h,
            0,
            pitch_s,
            yaw_c,
            pitch_c,
            pitch_head,
            -0.4 * yaw_c,
        )
    breath = math.sin(tau * 2 * ph)
    hips = (0.01 * s * math.sin(tau * ph), 0.0, -c - 0.002 * s * (0.5 + 0.5 * breath))
    look = math.radians(12 if mode == "free" else 7) * math.sin(tau * ph)
    return Trunk(
        hips,
        0,
        pitch_h,
        math.radians(1.0) * math.sin(tau * ph),
        pitch_s,
        0,
        pitch_c + math.radians(1.2) * breath,
        pitch_head,
        look,
    )


def _crouch(body_id: str, mode: str, kind: str) -> float:
    lay = crowd.layout(crowd.BODIES[body_id])
    leg = lay.hip_z - lay.ankle_z
    reach = 0.975 * leg
    half = (
        stride(body_id, f"walk_{mode}" if mode != "free" else "walk") / 4 if kind == "walk" else 0.0
    )
    half = math.hypot(half, 0.02 * lay.s)
    return max(0.004 * lay.s, leg - math.sqrt(reach * reach - half * half))


def _rest(body_id: str) -> dict[str, Bone]:
    return {b.name: b for b in bones(body_id)}


def _trunk_fk(body_id: str, tr: Trunk) -> dict[str, tuple[Mat, Vec]]:
    rb = _rest(body_id)
    rh = mm(mm(rz(tr.yaw_h), rx(tr.pitch_h)), ry(tr.roll_h))
    rs = mm(rh, rx(tr.pitch_s))
    rc = mm(mm(rs, rz(tr.yaw_c)), rx(tr.pitch_c))
    rhd = mm(mm(rc, rx(tr.pitch_head)), rz(tr.yaw_head))
    hips = _add(rb["hips"].head, tr.hips)
    spine = _add(hips, mv(rh, _sub(rb["spine"].head, rb["hips"].head)))
    chest = _add(spine, mv(rs, _sub(rb["chest"].head, rb["spine"].head)))
    head = _add(chest, mv(rc, _sub(rb["head"].head, rb["chest"].head)))
    return {
        "root": (I3, (0.0, 0.0, 0.0)),
        "hips": (rh, hips),
        "spine": (rs, spine),
        "chest": (rc, chest),
        "head": (rhd, head),
    }


def _attach(pose, rb, parent: str, child: str) -> Vec:
    r, h = pose[parent]
    return _add(h, mv(r, _sub(rb[child].head, rb[parent].head)))


def grip_target(body_id: str, mode: str) -> Vec:
    """Left hand-centre target on the walker grip or the stroller bar (rest frame): 86% of
    the arm's reach from the shoulder of the neutral push pose, forward and down."""
    lay = crowd.layout(crowd.BODIES[body_id])
    rb = _rest(body_id)
    pose = _trunk_fk(body_id, _trunk_pose(body_id, mode, "idle", 0.0, neutral=True))
    sh = _attach(pose, rb, "chest", "upper_arm_L")
    reach = lay.upper + lay.fore + lay.hand_c
    direction = _unit((0.10, -0.50, -0.86) if mode == "walker" else (0.02, -0.72, -0.69))
    return _add(sh, direction, 0.86 * reach)


def rim_point(w: Wheelchair, angle: float, side: int = 1, out: float = 0.0) -> Vec:
    ax = w.axle
    return (
        (w.rim_x + out) * side,
        ax[1] - w.rim_r * math.sin(angle),
        ax[2] + w.rim_r * math.cos(angle),
    )


def wheel_angle(body_id: str, clip: str, t: float) -> float:
    kind, mode = _parse(clip)
    if mode != "wheelchair" or kind != "walk":
        return 0.0
    return math.pi / 2 * t / duration(body_id, clip)


@lru_cache(maxsize=4096)
def _solve(body_id: str, clip: str, t: float):
    kind, mode = _parse(clip)
    b = crowd.BODIES[body_id]
    lay = crowd.layout(b)
    s = lay.s
    rb = _rest(body_id)
    d = duration(body_id, clip)
    ph = (t / d) % 1.0
    tau = 2 * math.pi
    pose = _trunk_fk(body_id, _trunk_pose(body_id, mode, kind, ph))
    joints: dict[str, Vec] = {}
    errs: dict[str, float] = {}

    # legs
    w = wheelchair_dims(b) if mode == "wheelchair" else None
    for side, k, off in (("L", 1, 0.0), ("R", -1, 0.5)):
        hip = _attach(pose, rb, "hips", f"thigh_{side}")
        if w is not None:
            target = _mx(w.ankle, k)
            pole = (0.0, -0.3, 1.0)
        elif kind == "walk":
            sd = stride(body_id, clip)
            u = (ph + off) % 1.0
            lift = (0.02 if mode == "walker" else 0.035) * s
            if u < 0.5:
                y, z = -sd / 4 + sd * u, lay.ankle_z
            else:
                q = (u - 0.5) / 0.5
                y = sd / 4 - sd / 2 * (q * q * (3 - 2 * q))
                z = lay.ankle_z + lift * math.sin(math.pi * q)
            target = (lay.leg_x * k, y, z)
            pole = (0.0, -1.0, 0.15)
        else:
            target = (lay.leg_x * k, 0.0, lay.ankle_z)
            pole = (0.0, -1.0, 0.15)
        thigh = lay.hip_z - lay.knee_z
        shin = lay.knee_z - lay.ankle_z
        knee, end = two_bone(hip, target, thigh, shin, pole)
        pose[f"thigh_{side}"] = (align((0, 0, -1), _sub(knee, hip)), hip)
        pose[f"shin_{side}"] = (align((0, 0, -1), _sub(end, knee)), knee)
        pose[f"foot_{side}"] = (I3, end)
        joints[f"ankle_{side}"] = end
        errs[f"leg_{side}"] = math.dist(end, target)

    # arms
    da = lay.arm_dir
    reach2 = lay.fore + lay.hand_c
    for side, k in (("L", 1), ("R", -1)):
        sh = _attach(pose, rb, "chest", f"upper_arm_{side}")
        dk = _mx(da, k)
        target = None
        if mode in ("walker", "stroller"):
            target = _mx(grip_target(body_id, mode), k)
        elif w is not None:
            if kind == "walk":
                u = ph
                if u < 0.5:
                    ang = math.radians(-10 + 45 * u / 0.5)
                    target = rim_point(w, ang, k)
                else:
                    q = (u - 0.5) / 0.5
                    ang = math.radians(35 - 45 * (q * q * (3 - 2 * q)))
                    lift = math.sin(math.pi * q)
                    target = _add(rim_point(w, ang, k), (0.03 * s * k, 0.0, 0.05 * s), lift)
            else:
                target = rim_point(w, math.radians(8), k)
        if target is None:
            if kind == "walk":
                amp = math.radians(12 if b.stoop else 22)
                swing = -amp * math.cos(tau * ph) * k
                bend = math.radians(14) + max(0.0, swing) * 0.4
            else:
                swing = math.radians(2) * math.sin(tau * ph)
                bend = math.radians(8)
            rc = pose["chest"][0]
            r_up = mm(rc, rx(-swing))
            r_fo = mm(r_up, rx(-bend))
            elbow = _add(sh, mv(r_up, dk), lay.upper)
            end = _add(elbow, mv(r_fo, dk), reach2)
        else:
            pole = (0.6 * k, 0.35, -0.8)
            elbow, end = two_bone(sh, target, lay.upper, reach2, pole)
            r_up = align(dk, _sub(elbow, sh))
            r_fo = align(dk, _sub(end, elbow))
            errs[f"hand_{side}"] = math.dist(end, target)
        wrist = _add(elbow, mv(r_fo, dk), lay.fore)
        pose[f"upper_arm_{side}"] = (r_up, sh)
        pose[f"forearm_{side}"] = (r_fo, elbow)
        pose[f"hand_{side}"] = (r_fo, wrist)
        joints[f"hand_{side}"] = end
        joints[f"shoulder_{side}"] = sh

    pose["prop"] = (I3, (0.0, 0.0, 0.0))
    pose["wheels"] = (rx(wheel_angle(body_id, clip, t)), rb["wheels"].head)
    ordered = {n: pose[n] for n in BONE_NAMES}
    return ordered, joints, errs


def pose(body_id: str, clip: str, t: float) -> dict[str, tuple[Mat, Vec]]:
    """Per bone (in `BONE_NAMES` order): world rotation and world head position."""
    return _solve(body_id, clip, float(t))[0]


def joints(body_id: str, clip: str, t: float) -> dict[str, Vec]:
    return _solve(body_id, clip, float(t))[1]


def reach_errors(body_id: str, clip: str, t: float) -> dict[str, float]:
    """Distance (m) between each IK target (ankles, hands on grips or rims) and the reached end."""
    return _solve(body_id, clip, float(t))[2]


def skin_parts(body_id: str, parts, clip: str, t: float):
    """Reference linear blend skinning of bind-pose parts (tests and contact-sheet renders)."""
    p = pose(body_id, clip, t)
    rb = _rest(body_id)
    out = []
    for group, role, (pv, pf) in parts:
        nv = []
        for v in pv:
            w = {group: 1.0} if group in ("prop", "wheels") else vertex_weights(body_id, group, v)
            acc = [0.0, 0.0, 0.0]
            for name, wt in w.items():
                r, h = p[name]
                q = _add(h, mv(r, _sub(v, rb[name].head)))
                for j in range(3):
                    acc[j] += q[j] * wt
            nv.append(tuple(acc))
        out.append((group, role, (nv, pf)))
    return out
