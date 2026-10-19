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


def build(stats: dict[str, dict], sizes: dict[str, int], as_of: str) -> dict:
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
        "as_of": as_of,
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
        },
        "bench": {
            "seatY": rig.SEAT_Z,
            "frontEdgeZ": to_gltf((0.0, rig.SEAT_EDGE_Y, 0.0))[2],
        },
        "variants": variants,
    }
