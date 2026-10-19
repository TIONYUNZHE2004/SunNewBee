"""The hero's props as pure geometry (no bpy): stroller and wheelchair (the walker is
`parts.walker_parts`). Scripted, so no third-party credit is needed.

Frame: the hero's rest frame (Blender z-up, true metres, she faces -y). A part is
`(group, role, mesh)` like in `parts.py`. The wheelchair's rear wheels are a separate mesh
(`wheelchair_wheels`) parented to the `wheels` bone, which turns about the axle (x axis).
"""

import math

from . import geom
from .rig import RIM_R, RIM_X, WHEEL_AXLE, WHEEL_R

Part = tuple[str, str, geom.Mesh]

STROLLER_BAR = (0.20, -0.36, 0.66)  # left end of the handlebar
STROLLER_GRIP = (0.15, -0.36, 0.681)  # palm target on the bar (left)


def _pair(x: float, fn) -> list[Part]:
    return [*fn(x), *fn(-x)]


def stroller_parts() -> list[Part]:
    bx, by, bz = STROLLER_BAR
    out: list[Part] = [
        ("bar", "grip", geom.tube([(-bx, by, bz), (bx, by, bz)], [0.022, 0.022], 10)),
    ]

    def side(x: float) -> list[Part]:
        s = 1 if x > 0 else -1
        rear = geom.catmull_rom(
            [(s * 0.19, by, bz), (s * 0.19, -0.42, 0.45), (s * 0.20, -0.50, 0.10)], 3
        )
        front = geom.catmull_rom(
            [(s * 0.19, -0.47, 0.40), (s * 0.18, -0.70, 0.22), (s * 0.17, -0.92, 0.075)], 3
        )
        return [
            ("frame", "metal", geom.tube(rear, [0.016] * len(rear), 8)),
            ("frame", "metal", geom.tube(front, [0.014] * len(front), 8)),
            (
                "wheel",
                "wheel",
                geom.ellipsoid((s * 0.215, -0.50, 0.075), (0.022, 0.075, 0.075), 14, 7),
            ),
            ("wheel", "wheel", geom.ellipsoid((s * 0.18, -0.92, 0.05), (0.018, 0.05, 0.05), 12, 6)),
        ]

    out += _pair(1.0, side)
    # bassinet with a canopy over the head end (towards her), soft pastel
    out.append(("basket", "basket", geom.ellipsoid((0.0, -0.68, 0.42), (0.17, 0.27, 0.10), 20, 9)))
    canopy = geom.lathe(
        [(0.0, 0.17), (0.12, 0.15), (0.17, 0.08), (0.18, 0.0), (0.0, -0.01)], 18, sy=0.75
    )
    out.append(
        (
            "basket",
            "canopy",
            geom.transform(canopy, geom.rot_x(math.radians(-30)), move=(0.0, -0.53, 0.46)),
        )
    )
    out.append(
        ("frame", "metal", geom.tube([(-0.19, -0.47, 0.40), (0.19, -0.47, 0.40)], [0.013] * 2, 8))
    )
    return out


def wheelchair_parts() -> list[Part]:
    """Seat, backrest, frame, push handles, footrest and casters (not the rear wheels)."""
    out: list[Part] = [
        ("seat", "grip", geom.ellipsoid((0.0, 0.0, 0.41), (0.25, 0.23, 0.022), 20, 6)),
        ("seat", "grip", geom.ellipsoid((0.0, 0.275, 0.63), (0.235, 0.028, 0.19), 20, 8)),
        ("seat", "grip", geom.ellipsoid((0.0, -0.27, 0.198), (0.17, 0.08, 0.012), 16, 5)),
    ]

    def side(x: float) -> list[Part]:
        s = 1 if x > 0 else -1
        frame = geom.catmull_rom(
            [
                (s * 0.25, 0.32, 0.86),
                (s * 0.25, 0.30, 0.62),
                (s * 0.25, 0.27, 0.43),
                (s * 0.25, -0.20, 0.43),
                (s * 0.22, -0.28, 0.28),
                (s * 0.15, -0.30, 0.205),
            ],
            2,
        )
        return [
            ("frame", "metal", geom.tube(frame, [0.015] * len(frame), 8)),
            (
                "frame",
                "grip",
                geom.tube([(s * 0.25, 0.32, 0.86), (s * 0.25, 0.42, 0.87)], [0.02] * 2, 8),
            ),
            (
                "frame",
                "metal",
                geom.tube([(s * 0.23, -0.20, 0.43), (s * 0.23, -0.23, 0.08)], [0.012] * 2, 8),
            ),
            (
                "frame",
                "metal",
                geom.tube(
                    [(s * 0.25, 0.06, 0.43), (s * 0.27, WHEEL_AXLE[1], WHEEL_AXLE[2])],
                    [0.012] * 2,
                    8,
                ),
            ),
            (
                "caster",
                "wheel",
                geom.ellipsoid((s * 0.23, -0.24, 0.05), (0.018, 0.05, 0.05), 12, 6),
            ),
        ]

    return out + _pair(1.0, side)


def wheelchair_wheels() -> list[Part]:
    """Both rear wheels: tyre, hand rim, hub and six spokes (60-degree symmetry, so the walk
    clip's half turn per cycle loops seamlessly)."""
    ax, ay, az = WHEEL_AXLE
    out: list[Part] = []
    for s in (1, -1):
        x = s * 0.30

        def ring(radius: float, xx: float, n: int = 36):
            return [
                (xx, ay + radius * math.sin(a), az + radius * math.cos(a))
                for a in (i * math.tau / n for i in range(n))
            ]

        out.append(
            (
                "wheels",
                "wheel",
                geom.tube(ring(WHEEL_R - 0.02, x, 28), [0.022] * 28, 6, closed=True),
            )
        )
        out.append(
            (
                "wheels",
                "metal",
                geom.tube(ring(RIM_R, s * (RIM_X + 0.015), 24), [0.009] * 24, 5, closed=True),
            )
        )
        out.append(("wheels", "metal", geom.ellipsoid((x, ay, az), (0.03, 0.035, 0.035), 10, 5)))
        for i in range(6):
            a = i * math.tau / 6
            tip = (x, ay + (WHEEL_R - 0.03) * math.sin(a), az + (WHEEL_R - 0.03) * math.cos(a))
            out.append(
                ("wheels", "metal", geom.tube([(x, ay, az), tip], [0.007] * 2, 5, cap_rings=1))
            )
    return out
