"""Pure mesh generators for the scripted characters (no bpy; tested with pytest).

Every generator returns `(verts, faces)`: verts are `(x, y, z)` tuples in Blender's z-up frame,
faces are tuples of vertex indices (triangles and quads). Shells are closed, so a smooth-shaded
mesh has no holes, and every part stays a separate shell that a skin modifier or a vertex
group can claim later (C-T3 rig).
"""

import math
from collections.abc import Callable, Sequence

Vec = tuple[float, float, float]
Mat = tuple[Vec, Vec, Vec]
Mesh = tuple[list[Vec], list[tuple[int, ...]]]


def catmull_rom(points: Sequence[Sequence[float]], samples: int) -> list[tuple[float, ...]]:
    """A uniform Catmull-Rom spline through `points` with `samples` steps per segment.
    The result starts and ends on the end points and passes through every control point."""
    pts = [tuple(float(c) for c in p) for p in points]
    if len(pts) < 2 or samples < 1:
        return pts
    ext = [pts[0], *pts, pts[-1]]
    out: list[tuple[float, ...]] = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for s in range(samples):
            t = s / samples
            t2, t3 = t * t, t * t * t
            out.append(
                tuple(
                    0.5
                    * (
                        2 * b
                        + (-a + c) * t
                        + (2 * a - 5 * b + 4 * c - d) * t2
                        + (-a + 3 * b - 3 * c + d) * t3
                    )
                    for a, b, c, d in zip(p0, p1, p2, p3, strict=True)
                )
            )
    out.append(pts[-1])
    return out


def tri_count(faces: Sequence[Sequence[int]]) -> int:
    return sum(len(f) - 2 for f in faces)


def lathe(
    profile: Sequence[tuple[float, float]],
    segments: int,
    *,
    sx: float = 1.0,
    sy: float = 1.0,
    center: Vec = (0.0, 0.0, 0.0),
    dz: Callable[[float, int], float] | None = None,
    dr: Callable[[float, int], float] | None = None,
) -> Mesh:
    """Revolve a `(radius, z)` profile around the z axis.

    A profile point with radius 0 becomes a single pole vertex. `sx`/`sy` squash the rings into
    ellipses; `dz(theta, k)` shifts ring `k` vertically per angle (theta 0 = +x, -pi/2 = -y, the
    character's front), which shapes hems; `dr(theta, k)` adds to the radius (folds, a hump).
    """
    verts: list[Vec] = []
    rings: list[list[int] | int] = []
    cx, cy, cz = center
    for k, (r, z) in enumerate(profile):
        if r <= 1e-9:
            verts.append((cx, cy, cz + z))
            rings.append(len(verts) - 1)
            continue
        ring = []
        for s in range(segments):
            theta = s * math.tau / segments - math.pi / 2  # vertex 0 faces the front (-y)
            off = dz(theta, k) if dz else 0.0
            rr = max(1e-4, r + (dr(theta, k) if dr else 0.0))
            verts.append(
                (cx + rr * sx * math.cos(theta), cy + rr * sy * math.sin(theta), cz + z + off)
            )
            ring.append(len(verts) - 1)
        rings.append(ring)
    faces: list[tuple[int, ...]] = []
    for a, b in zip(rings, rings[1:], strict=False):
        if isinstance(a, int) and isinstance(b, int):
            continue
        if isinstance(a, int):
            faces += [(a, b[(s + 1) % segments], b[s]) for s in range(segments)]
        elif isinstance(b, int):
            faces += [(a[s], a[(s + 1) % segments], b) for s in range(segments)]
        else:
            faces += [
                (a[s], a[(s + 1) % segments], b[(s + 1) % segments], b[s]) for s in range(segments)
            ]
    return verts, faces


def ellipsoid(center: Vec, radii: Vec, segments: int = 24, rings: int = 12) -> Mesh:
    """A UV ellipsoid (closed), pole axis z."""
    rx, ry, rz = radii
    profile = [
        (math.sin(math.pi * i / rings), rz * math.cos(math.pi * i / rings))
        for i in range(rings + 1)
    ]
    profile[0], profile[-1] = (0.0, rz), (0.0, -rz)
    return lathe(profile, segments, sx=rx, sy=ry, center=center)


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(a):
    n = math.sqrt(_dot(a, a)) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def tube(
    path: Sequence[Vec],
    radii: Sequence[float],
    segments: int = 12,
    *,
    closed: bool = False,
    cap_rings: int = 3,
) -> Mesh:
    """A swept circle along `path` (one radius per point). Open tubes get rounded
    (hemispherical) caps so the shell is closed; `closed=True` makes a loop (a torus-like ring)."""
    n = len(path)
    tangents = []
    for i in range(n):
        if closed:
            t = _sub(path[(i + 1) % n], path[i - 1])
        else:
            t = _sub(path[min(i + 1, n - 1)], path[max(i - 1, 0)])
        tangents.append(_norm(t))
    # parallel-transport frames, seeded with an axis least aligned with the first tangent
    seed = min(
        ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)), key=lambda a: abs(_dot(a, tangents[0]))
    )
    normal = _norm(_cross(tangents[0], seed))
    frames = []
    for t in tangents:
        normal = _norm(_sub(normal, tuple(c * _dot(normal, t) for c in t)))
        frames.append((normal, _cross(t, normal)))

    verts: list[Vec] = []
    ring_ids: list[list[int] | int] = []

    def add_ring(center, nrm, bin_, r):
        ids = []
        for s in range(segments):
            a = s * math.tau / segments
            ca, sa = math.cos(a) * r, math.sin(a) * r
            verts.append(tuple(center[j] + nrm[j] * ca + bin_[j] * sa for j in range(3)))
            ids.append(len(verts) - 1)
        return ids

    def cap(end: int, sign: float) -> list[list[int] | int]:
        c, t, (nrm, bin_), r = path[end], tangents[end], frames[end], radii[end]
        out: list[list[int] | int] = []
        for k in range(cap_rings, 0, -1):
            phi = (math.pi / 2) * k / (cap_rings + 1)
            off = tuple(c[j] + sign * t[j] * r * math.sin(phi) for j in range(3))
            out.append(add_ring(off, nrm, bin_, r * math.cos(phi)))
        verts.append(tuple(c[j] + sign * t[j] * r for j in range(3)))
        out.append(len(verts) - 1)
        return out

    body = [add_ring(path[i], *frames[i], radii[i]) for i in range(n)]
    if closed:
        ring_ids = [*body, body[0]]
    else:
        start = cap(0, -1.0)[::-1]
        end = cap(n - 1, 1.0)
        ring_ids = [*start, *body, *end]
    faces: list[tuple[int, ...]] = []
    for a, b in zip(ring_ids, ring_ids[1:], strict=False):
        if isinstance(a, int):
            faces += [(a, b[(s + 1) % segments], b[s]) for s in range(segments)]
        elif isinstance(b, int):
            faces += [(a[s], a[(s + 1) % segments], b) for s in range(segments)]
        else:
            faces += [
                (a[s], a[(s + 1) % segments], b[(s + 1) % segments], b[s]) for s in range(segments)
            ]
    return verts, faces


def orient_z_to(direction: Sequence[float]) -> Mat:
    """A rotation matrix (rows) that maps +z onto `direction` (Rodrigues)."""
    d = _norm(tuple(float(c) for c in direction))
    z = (0.0, 0.0, 1.0)
    c = _dot(z, d)
    if c > 1 - 1e-12:
        return ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
    if c < -1 + 1e-12:
        return ((1.0, 0.0, 0.0), (0.0, -1.0, 0.0), (0.0, 0.0, -1.0))
    v = _cross(z, d)
    k = 1.0 / (1.0 + c)
    vx, vy, vz = v
    return (
        (1 - k * (vy * vy + vz * vz), k * vx * vy - vz, k * vx * vz + vy),
        (k * vx * vy + vz, 1 - k * (vx * vx + vz * vz), k * vy * vz - vx),
        (k * vx * vz - vy, k * vy * vz + vx, 1 - k * (vx * vx + vy * vy)),
    )


def rot_x(angle: float) -> Mat:
    c, s = math.cos(angle), math.sin(angle)
    return ((1.0, 0.0, 0.0), (0.0, c, -s), (0.0, s, c))


def mat_vec(m: Mat, v: Sequence[float]) -> Vec:
    return tuple(_dot(row, v) for row in m)  # type: ignore[return-value]


def transform(
    mesh: Mesh, m: Mat, pivot: Vec = (0.0, 0.0, 0.0), move: Vec = (0.0, 0.0, 0.0)
) -> Mesh:
    """Rotate a mesh about `pivot` by `m`, then translate by `move`."""
    verts, faces = mesh
    out = []
    for v in verts:
        r = mat_vec(m, _sub(v, pivot))
        out.append(
            (r[0] + pivot[0] + move[0], r[1] + pivot[1] + move[1], r[2] + pivot[2] + move[2])
        )
    return out, faces


def ellipsoid_point(center: Vec, radii: Vec, azimuth: float, elevation: float) -> tuple[Vec, Vec]:
    """Point and outward normal on an axis-aligned ellipsoid. Azimuth 0 is the front (-y),
    positive towards +x; elevation is up from the equator (radians)."""
    rx, ry, rz = radii
    ux = math.sin(azimuth) * math.cos(elevation)
    uy = -math.cos(azimuth) * math.cos(elevation)
    uz = math.sin(elevation)
    p = (center[0] + rx * ux, center[1] + ry * uy, center[2] + rz * uz)
    n = _norm((ux / rx, uy / ry, uz / rz))
    return p, n
