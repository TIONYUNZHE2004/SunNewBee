"""Crowd looks (C-T6, P2) and the crowd manifest, pure.

A look is a body + an outfit (+ a prop) + a palette (role -> sRGB hex). Meshes are per body and
outfit; looks that share them differ by palette (the role is in TEXCOORD_0.u, see
`crowd.role_u`), or by prop. Colours are clay pastels named by role, so B-T1's clay token table
can map them; the palette rows are listed in the manifest in look order (C-T7 palette texture:
u = role, v = look row).

Decorative only (P9): crowd figures sit under "Decorative details are illustrative.".
"""

from dataclasses import dataclass, field

from . import crowd, crowd_rig

SKIN = {"light": "#ebc6a3", "medium": "#dcae88", "tan": "#c08c64", "deep": "#94654a"}
HAIR = {"black": "#2f2a2e", "brown": "#4a3a33", "grey": "#bdb8bc", "white": "#dcd8d6"}

BASE = {
    "eye": "#2b2330",
    "blush": "#f2a0a0",
    "shoe": "#5a4a44",
    "hair": HAIR["black"],
    "headwear": "#1f1d22",
    "headwear_trim": "#3a363c",
    "accent": "#e2b85c",
    "prop_metal": "#c9d2dc",
    "prop_grip": "#566476",
    "prop_wheel": "#3d434d",
    "prop_fabric": "#9cc7b4",
    "prop_canopy": "#78b09a",
    "glasses": "#8a6a52",
}


def _mix(a: str, b: str, t: float) -> str:
    ca = [int(a[i : i + 2], 16) for i in (1, 3, 5)]
    cb = [int(b[i : i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(ca, cb, strict=True))


@dataclass(frozen=True)
class Look:
    id: str
    body: str
    outfit: str
    prop: str | None
    palette: dict[str, str] = field(hash=False)


def _look(id_: str, body: str, outfit: str, prop: str | None = None, **c: str) -> Look:
    skin = SKIN[c.pop("skin", "medium")]
    hair = HAIR.get(c.get("hair", "black"), c.get("hair", HAIR["black"]))
    c.pop("hair", None)
    top = c["top"]
    pal = dict(BASE)
    pal.update(
        skin=skin,
        hair=hair,
        top=top,
        top_trim=_mix(top, "#ffffff", 0.4),
        bottom=c.get("bottom", top),
        outer=c.get("outer", _mix(top, "#2a2a33", 0.35)),
    )
    pal.update(c)
    if body == "older_woman":  # slightly muted clothes: an age cue next to the adult woman
        for r in ("top", "top_trim", "bottom", "outer", "headwear", "headwear_trim"):
            pal[r] = _mix(pal[r], MUTE, 0.25)
    if "headwear_trim" not in c and "headwear" in c:
        pal["headwear_trim"] = _mix(c["headwear"], "#000000", 0.15)
    assert set(pal) == set(crowd.ROLES), sorted(set(crowd.ROLES) ^ set(pal))
    return Look(id_, body, outfit, prop, pal)


MUTE = "#a29d97"
WHITE = "#f6f5f1"
BLACK_SHOE = "#2c2a2e"
SNEAKER = "#ece8e0"
SONGKOK = "#1f1d22"

LOOKS: tuple[Look, ...] = (
    # child
    _look(
        "child_casual_orange",
        "child",
        "casual_shorts",
        top="#f2a65a",
        bottom="#5b7fb8",
        shoe=SNEAKER,
    ),
    _look(
        "child_casual_mint",
        "child",
        "casual_shorts",
        skin="light",
        top="#7fc8a9",
        bottom="#3f4a6b",
        shoe="#f2c14e",
        hair="brown",
    ),
    _look(
        "child_baju_melayu_teal",
        "child",
        "baju_melayu",
        top="#5fb3c9",
        accent="#d9b44a",
        headwear=SONGKOK,
        headwear_trim="#3d7f99",
    ),
    _look(
        "child_baju_kurung_pink",
        "child",
        "baju_kurung",
        top="#f29bb8",
        bottom="#e07fa3",
        headwear="#fbe3ec",
        accent="#e2b85c",
    ),
    # school_age
    _look(
        "school_shirt_navy",
        "school_age",
        "school_shirt",
        top=WHITE,
        bottom="#1f2a44",
        shoe=BLACK_SHOE,
        accent="#e07a6a",
    ),
    _look(
        "school_shirt_green",
        "school_age",
        "school_shirt",
        skin="tan",
        top=WHITE,
        bottom="#1d3a2e",
        shoe=BLACK_SHOE,
        accent="#6a8fd1",
    ),
    _look(
        "school_pinafore_navy",
        "school_age",
        "school_pinafore",
        top=WHITE,
        outer="#2c3e70",
        headwear=WHITE,
        shoe=SNEAKER,
        accent="#f2b5c7",
    ),
    _look(
        "school_pinafore_teal",
        "school_age",
        "school_pinafore",
        skin="tan",
        top=WHITE,
        outer="#2f7f86",
        headwear=WHITE,
        shoe=SNEAKER,
        accent="#9ad0e6",
    ),
    _look(
        "school_casual_yellow",
        "school_age",
        "casual_tee",
        skin="light",
        top="#f5d76e",
        bottom="#4b5a7a",
        shoe=SNEAKER,
    ),
    # adult_man
    _look(
        "man_baju_melayu_teal",
        "adult_man",
        "baju_melayu",
        top="#4fa3a5",
        accent="#2f3f63",
        headwear=SONGKOK,
        headwear_trim="#d9b44a",
    ),
    _look(
        "man_baju_melayu_maroon",
        "adult_man",
        "baju_melayu",
        skin="tan",
        top="#a94f5f",
        accent="#d9b44a",
        headwear=SONGKOK,
        headwear_trim="#7a3343",
    ),
    _look(
        "man_office_blue",
        "adult_man",
        "office_shirt",
        skin="light",
        top="#cfe0f2",
        bottom="#3a3f4b",
        accent="#c0504d",
        shoe=BLACK_SHOE,
    ),
    _look(
        "man_office_white",
        "adult_man",
        "office_shirt",
        skin="deep",
        top="#f4f2ec",
        bottom="#26324a",
        accent="#3f6fb5",
        shoe=BLACK_SHOE,
    ),
    _look(
        "man_casual_sky", "adult_man", "casual_tee", top="#8fb8de", bottom="#4a5f8a", shoe=SNEAKER
    ),
    _look(
        "man_casual_stroller",
        "adult_man",
        "casual_tee",
        "stroller",
        skin="light",
        top="#e8a87c",
        bottom="#6b6f5a",
        prop_fabric="#a9c6e8",
        prop_canopy="#7ea6d6",
    ),
    _look(
        "man_casual_wheelchair",
        "adult_man",
        "casual_tee",
        "wheelchair",
        skin="deep",
        top="#9fd3b5",
        bottom="#4a4f63",
    ),
    # adult_woman
    _look(
        "woman_baju_kurung_purple",
        "adult_woman",
        "baju_kurung",
        top="#9b7fd4",
        bottom="#7d62bd",
        headwear="#d8c6f2",
    ),
    _look(
        "woman_baju_kurung_green",
        "adult_woman",
        "baju_kurung",
        skin="tan",
        top="#7cc49a",
        bottom="#5aa77c",
        headwear="#f3e7c9",
    ),
    _look(
        "woman_baju_kurung_stroller",
        "adult_woman",
        "baju_kurung",
        "stroller",
        top="#f0a07a",
        bottom="#d9845f",
        headwear="#f7d8c4",
        prop_fabric="#f4c2d0",
        prop_canopy="#e89ab2",
    ),
    _look(
        "woman_office_navy",
        "adult_woman",
        "office_tudung",
        top="#f3efe6",
        outer="#4b5d7a",
        bottom="#3a3f4b",
        headwear="#c9a7a0",
        shoe=BLACK_SHOE,
    ),
    _look(
        "woman_office_wheelchair",
        "adult_woman",
        "office_tudung",
        "wheelchair",
        skin="tan",
        top="#f3efe6",
        outer="#7a6a58",
        bottom="#2f3540",
        headwear="#9ec1d9",
    ),
    _look(
        "woman_casual_bob",
        "adult_woman",
        "casual_bob",
        skin="light",
        top="#f6c26b",
        bottom="#5a74a8",
        shoe=SNEAKER,
    ),
    _look(
        "woman_casual_tudung",
        "adult_woman",
        "casual_tudung",
        top="#e88fa0",
        bottom="#40465a",
        headwear="#6fa8b8",
        shoe=SNEAKER,
    ),
    # older_man
    _look(
        "oldman_baju_melayu_cream",
        "older_man",
        "baju_melayu",
        top="#e9dcb5",
        accent="#5a3d6b",
        headwear=SONGKOK,
        headwear_trim="#d9b44a",
        hair="grey",
    ),
    _look(
        "oldman_baju_melayu_walker",
        "older_man",
        "baju_melayu",
        "walker",
        skin="tan",
        top="#7aa6c9",
        accent="#2e3f5c",
        headwear=SONGKOK,
        headwear_trim="#c9a24a",
        hair="grey",
    ),
    _look(
        "oldman_office_batik",
        "older_man",
        "office_batik",
        skin="light",
        top="#c98a4b",
        accent="#2f5d62",
        bottom="#3b3a3f",
        hair="grey",
        shoe=BLACK_SHOE,
    ),
    _look(
        "oldman_casual_kopiah",
        "older_man",
        "casual_kopiah",
        top="#a8c8a0",
        bottom="#5c5a52",
        headwear="#f3f1ea",
        headwear_trim="#d9d5c8",
        hair="white",
    ),
    _look(
        "oldman_kopiah_wheelchair",
        "older_man",
        "casual_kopiah",
        "wheelchair",
        skin="deep",
        top="#d3b4d9",
        bottom="#45474f",
        headwear="#f3f1ea",
        headwear_trim="#d9d5c8",
        hair="white",
    ),
    # older_woman
    _look(
        "oldwoman_baju_kurung_blue",
        "older_woman",
        "baju_kurung",
        top="#6f9fd8",
        bottom="#4f7fbf",
        headwear="#cfe0f5",
    ),
    _look(
        "oldwoman_baju_kurung_walker",
        "older_woman",
        "baju_kurung",
        "walker",
        skin="tan",
        top="#e3a86b",
        bottom="#c98a52",
        headwear="#f5dfc4",
    ),
    _look(
        "oldwoman_casual_tudung",
        "older_woman",
        "casual_tudung",
        top="#9c8bb8",
        bottom="#4b4558",
        headwear="#e8c7d4",
    ),
    _look(
        "oldwoman_casual_bun",
        "older_woman",
        "casual_bun",
        skin="light",
        top="#e6b7c3",
        bottom="#4c5160",
        hair="grey",
        shoe=SNEAKER,
    ),
    _look(
        "oldwoman_bun_walker",
        "older_woman",
        "casual_bun",
        "walker",
        skin="light",
        top="#a7cbbf",
        bottom="#5b5a66",
        hair="white",
    ),
)

LOD_MAX_M = (60.0, 300.0)  # LOD1 beyond 60 m, hidden beyond 300 m (P4)


def prop_meshes(prop: str | None) -> list[str]:
    """Mesh node stems of a prop: the wheelchair's rear wheels ride the `wheels` bone."""
    if prop is None:
        return []
    return (
        ["prop_wheelchair", "prop_wheelchair_wheels"] if prop == "wheelchair" else [f"prop_{prop}"]
    )


def modes_for(body: str) -> list[str]:
    return ["free"] + sorted({lk.prop for lk in LOOKS if lk.body == body and lk.prop})


def clips_for(body: str) -> list[str]:
    return [c for m in modes_for(body) for c in crowd_rig.clip_names(m)]


def build_manifest(stats: dict[str, dict], sizes: dict[str, int]) -> dict:
    """`stats[body]`: {"bones", "clips": {name: {duration, frames}}, "meshes": {node: tris}}."""
    bodies = {}
    for bid, b in crowd.BODIES.items():
        st = stats[bid]
        lay = crowd.layout(b)
        bodies[bid] = {
            "file": f"characters/crowd_{bid}.glb",
            "bytes": sizes[bid],
            "label": b.label,
            "height": round(b.height, 4),
            "headRatio": b.head_ratio,
            "stoopDeg": b.stoop,
            "hipY": round(lay.hip_z, 4),
            "outfits": list(crowd.BODY_OUTFITS[bid]),
            "props": [m for m in modes_for(bid) if m != "free"],
            "clips": {
                c: {
                    "duration": round(st["clips"][c]["duration"], 4),
                    # timeline frames at 30 fps (duration x 30 + 1); `keys` of them are keyed
                    # (walks: every frame; idles: every 3rd, linear between) - sample through
                    # a mixer at any rate, never read raw tracks per frame
                    "frames": st["clips"][c]["frames"],
                    "keys": len(crowd_rig.key_frames(c, crowd_rig.duration(bid, c))),
                    "keyFps": crowd_rig.FPS
                    // (crowd_rig.IDLE_KEY_STEP if c.startswith("idle") else 1),
                    "loop": True,
                    "stride": round(crowd_rig.stride(bid, c), 4),
                }
                for c in clips_for(bid)
            },
        }
    looks = []
    for lk in LOOKS:
        meshes = stats[lk.body]["meshes"]
        mode = lk.prop or "free"
        walk, idle = crowd_rig.clip_names(mode)
        nodes = [lk.outfit, *prop_meshes(lk.prop)]
        missing = [f"{n}__LOD{i}" for n in nodes for i in (0, 1) if f"{n}__LOD{i}" not in meshes]
        if missing:  # never a silent 0-triangle look
            raise KeyError(f"{lk.id}: no mesh {missing} in crowd_{lk.body}.glb")
        tris = [sum(meshes[f"{n}__LOD{i}"] for n in nodes) for i in (0, 1)]
        looks.append(
            {
                "id": lk.id,
                "body": lk.body,
                "outfit": lk.outfit,
                "prop": lk.prop,
                "mesh": lk.outfit,
                "propMeshes": prop_meshes(lk.prop),
                "clips": {"walk": walk, "idle": idle},
                "tris": tris,
                "palette": lk.palette,
            }
        )
    return {
        "version": 1,
        "decorative": True,
        "note": "Decorative details are illustrative.",
        "roles": list(crowd.ROLES),
        "roleUv": "TEXCOORD_0.x = (role index + 0.5) / roles.length",
        "bones": list(crowd_rig.BONE_NAMES),
        "lods": [
            {"suffix": "__LOD0", "maxTris": crowd.LOD_MAX_TRIS[0], "maxM": LOD_MAX_M[0]},
            {"suffix": "__LOD1", "maxTris": crowd.LOD_MAX_TRIS[1], "maxM": LOD_MAX_M[1]},
        ],
        "outfits": {
            oid: {"label": o.label, "category": o.category, "headwear": o.headwear}
            for oid, o in crowd.OUTFITS.items()
        },
        "bodies": bodies,
        "looks": looks,
    }
