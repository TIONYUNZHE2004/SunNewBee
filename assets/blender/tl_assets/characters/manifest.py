"""The hero manifest (`apps/web/public/city/characters/manifest.json`), pure.

Built by `pack.py --heroes` from the per-variant stats that `export_hero.py` writes next to
each raw glb. Coordinates are glTF (y up, she faces +z), true metres: the runtime multiplies
them by `displayScale` (R-J3), exactly as it scales the hero object.
"""

from . import proportions as P
from . import rig

PROFILES = {
    "walker": "older_adult_rest",
    "stroller": "stroller",
    "wheelchair": "wheelchair",
    "none": "walking",
}


def to_gltf(v) -> list[float]:
    """Blender (x, y, z) -> glTF (x, z, -y)."""
    x, y, z = v
    return [round(x, 4), round(z, 4), round(-y, 4) + 0.0]


def _box(b) -> dict:
    """A Blender-frame box -> glTF {min, max}."""
    (x0, y0, z0), (x1, y1, z1) = b
    lo, hi = to_gltf((x0, y1, z0)), to_gltf((x1, y0, z1))
    return {"min": lo, "max": hi}


def build(stats: dict[str, dict], sizes: dict[str, int]) -> dict:
    variants = {}
    for v in rig.VARIANTS:
        if v not in stats:
            continue
        s = stats[v]
        variants[v] = {
            "file": f"characters/hero_{v}.glb",
            "bytes": sizes[v],
            "profile": PROFILES[v],
            "lods": s["lods"],
            "clips": {
                c: {"duration": round(i["duration"], 4), "loop": i["loop"]}
                for c, i in s["clips"].items()
            },
            "stride": round(rig.STRIDE[v], 4),
            "walkDuration": rig.WALK_DURATION[v],
            "sitHips": to_gltf(s["sit"]["hips"]),
            "seated": v == "wheelchair",
        }
    return {
        "version": 1,
        "displayScale": P.DISPLAY_SCALE,
        "clips": list(rig.CLIPS),
        "bones": {
            "palm": ["palm_L", "palm_R"],
            "grip": ["grip_L", "grip_R"],
            "hand": ["hand_L", "hand_R"],
            "foot": ["foot_L", "foot_R"],
            "hips": "hips",
            "head": "head",
            "prop": "prop",
            "wheels": "wheels",
            "contacts": list(rig.CONTACTS),
        },
        "bench": {
            "seatY": rig.SEAT_Z,
            "frontEdgeZ": to_gltf((0.0, rig.SEAT_EDGE_Y, 0.0))[2],
            "seat": _box(rig.BENCH_SEAT),
            "back": _box(rig.BENCH_BACK),
        },
        "variants": variants,
    }
