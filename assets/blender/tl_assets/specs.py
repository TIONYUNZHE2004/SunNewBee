"""Asset specs: sizes, LOD triangle caps, byte budgets, palettes and precinct groups.

Pure Python (never imports bpy). The single source of truth for the Blender builders, the
packer's manifest and the committed-glb tests. Sizes are (w along x, h, d along z) in metres,
in the glTF frame: origin at the footprint centre on the ground, frontage facing +z.
Values marked "[?]" are starting values, tuned at the owner gates.
"""

import re
from dataclasses import dataclass, field

ROLES = ("primary", "secondary", "accent", "glass", "dark", "metal", "foliage", "light")
# The role contract has no "water" role: decorative water inside a building asset (the Kanopi
# podium pool) is role glass with this aux. The role material lights glass only below
# uLitShare (< 1), so it never glows; the tests look it up by this value.
WATER_AUX = 0.995

# Same names and order as data/scripts/build_archetypes.py (tested).
ARCHETYPES: tuple[str, ...] = (
    "link_intermediate",
    "link_long",
    "superlink",
    "semi_d",
    "bungalow",
    "townhouse",
    "shop_office",
    "highrise",
    "school",
    "mosque",
    "factory",
    "mall",
    "generic",
)
# Copy of build_archetypes.STOREY_HEIGHT_M (tested equal); highrise and generic have none.
STOREY_HEIGHT_M: dict[str, float] = {
    "link_intermediate": 8.5,
    "link_long": 8.5,
    "superlink": 9.0,
    "semi_d": 9.0,
    "bungalow": 9.0,
    "townhouse": 6.0,
    "shop_office": 11.0,
    "school": 14.0,  # [?] starting value
    "mosque": 15.0,  # [?] starting value
    "factory": 10.0,  # [?] starting value
    "mall": 9.0,  # [?] starting value
}

LOD_MAX_M: tuple[float | None, ...] = (300.0, 1500.0, None)  # buildings; None = to infinity
MAX_TOTAL_BYTES = 12_000_000
ARCHETYPE_MAX_BYTES = 400_000
LANDMARK_MAX_BYTES = 1_500_000
KIT_MAX_BYTES = 1_500_000


@dataclass(frozen=True)
class Variant:
    id: str
    size: tuple[float, float, float]  # (w along x, h, d along z) metres
    tris: tuple[int, ...]  # triangle cap per LOD
    max_m: tuple[float | None, ...]  # camera distance up to which each LOD is drawn
    y_range: tuple[float, float] | None = None  # allowed LOD0 y max (replaces size h ± 1)
    x_range: tuple[float, float] | None = None  # allowed LOD0 x extent (replaces size w)
    z_range: tuple[float, float] | None = None  # allowed LOD0 z extent (replaces size d)


@dataclass(frozen=True)
class AssetSpec:
    id: str
    group: str  # "archetype" | "landmark" | "kit"
    file: str
    variants: tuple[Variant, ...]
    max_bytes: int
    repeat: str = "none"  # "frontage": units repeat along the frontage (rows)
    frontage: str = "short"  # which OBB side is the frontage for a single unit
    fit_xz: tuple[float, float] = (0.75, 1.35)
    fit_y: tuple[float, float] = (0.6, 1.6)
    variant_by_group: dict[str, str] = field(default_factory=dict)
    decorative: bool = False
    placement: str | None = None  # landmarks: "anchor" | "obb" | "deferred"
    jitter: dict[str, float] = field(default_factory=dict)  # {"scale": 0.04, "hue": 0.05}
    design_storeys: int | None = None  # a design (not surveyed) storey count, shown as such
    height_basis: str | None = None  # where the modelled height comes from


# --- precincts and palettes -----------------------------------------------------------

PRECINCT_GROUPS: tuple[tuple[str, str], ...] = (
    ("green", r"elmina green"),
    ("ridge", r"ridge"),
    ("valley", r"valley"),
    ("denai_alam", r"denai alam"),
    ("city_centre", r"city centre|lakeside|kanopi"),
    ("business_park", r"business park"),
)
_PRECINCT_RES = tuple((g, re.compile(rx, re.IGNORECASE)) for g, rx in PRECINCT_GROUPS)


def precinct_group(precinct: str | None) -> str:
    """The palette group of an OSM precinct name: first matching regex wins, else "default"."""
    if precinct:
        for group, rx in _PRECINCT_RES:
            if rx.search(precinct):
                return group
    return "default"


Palette = tuple[tuple[str, str, str], ...]  # [(primary, secondary, accent)]

_RESIDENTIAL: dict[str, Palette] = {
    "default": (
        ("#f2efe8", "#3d4147", "#8a8f96"),
        ("#e9e4da", "#4a4e55", "#a07a55"),
        ("#dfe2e4", "#33373d", "#6d737a"),
    ),
    "green": (
        ("#f4f0e6", "#3a3d42", "#9b7350"),
        ("#ece6d8", "#45484e", "#b08a62"),
        ("#f7f5ef", "#2f3236", "#7d6a58"),
    ),
    "valley": (
        ("#e6e7e8", "#50545a", "#a0563f"),
        ("#f1f1ef", "#3e4247", "#8c4a36"),
        ("#d9dbdd", "#2e3135", "#b06a4f"),
    ),
    "ridge": (
        ("#f5f5f3", "#2b2e33", "#3f444b"),
        ("#e4e6e3", "#383c41", "#6b7b6e"),
    ),
    "denai_alam": (
        ("#efe6d2", "#8a4b35", "#b9a27f"),
        ("#e8dcc6", "#7a4332", "#9e8a6c"),
        ("#f0ece2", "#5b5f66", "#a89878"),
    ),
}
_COMMERCIAL: dict[str, Palette] = {  # owner gate P4 round 1: warm primaries and accents
    "default": (  # (primary walls and membrane roofs, secondary, accent terracotta or timber)
        ("#ece6da", "#4a4e55", "#b8704f"),
        ("#e2dacb", "#3a3e44", "#b49a6e"),
        ("#f1ebe1", "#5a5f66", "#c4855e"),
    ),
}
_KIT_DEFAULT: dict[str, Palette] = {  # [?] starting values
    "default": (("#d8d6d0", "#3d4147", "#8a8f96"),),
}

RESIDENTIAL_ARCHETYPES = frozenset(
    {"link_intermediate", "link_long", "superlink", "semi_d", "bungalow", "townhouse"}
)

# asset id, or "residential" / "commercial" -> precinct group -> [(primary, secondary, accent)]
PALETTES: dict[str, dict[str, Palette]] = {
    "residential": _RESIDENTIAL,
    "commercial": _COMMERCIAL,
    "people": _KIT_DEFAULT,
    "vehicles": _KIT_DEFAULT,
    "trees": _KIT_DEFAULT,
    "furniture": _KIT_DEFAULT,
    "construction": _KIT_DEFAULT,
}


def palette_for(asset_id: str) -> dict[str, Palette]:
    """The palette groups an asset uses: its own entry, else residential or commercial."""
    if asset_id in PALETTES:
        return PALETTES[asset_id]
    return PALETTES["residential" if asset_id in RESIDENTIAL_ARCHETYPES else "commercial"]


# --- the size, LOD and triangle table -------------------------------------------------


def _bv(vid: str, size, tris, **ranges) -> Variant:
    """A building variant (archetype or landmark): building LOD distances."""
    return Variant(vid, tuple(float(s) for s in size), tuple(tris), LOD_MAX_M, **ranges)


def _archetype(aid: str, variants, **kw) -> AssetSpec:
    kw.setdefault("variant_by_group", {"default": variants[0].id})
    return AssetSpec(
        aid, "archetype", f"archetypes/{aid}.glb", tuple(variants), ARCHETYPE_MAX_BYTES, **kw
    )


_MODERN_IN = {"valley": "modern", "ridge": "modern", "city_centre": "modern", "default": "gable"}

_ARCHETYPE_SPECS = (
    # OSM built footprints are 5.6–7.3 × 14–17 m
    _archetype(
        "link_intermediate",
        [_bv(v, (6.4, 8.5, 15.5), (6000, 700, 40)) for v in ("gable", "modern")],
        repeat="frontage",
        variant_by_group=dict(_MODERN_IN),
    ),
    _archetype(
        "link_long",
        [_bv(v, (6.7, 8.5, 24.0), (6500, 750, 40)) for v in ("gable", "modern")],
        repeat="frontage",
        variant_by_group=dict(_MODERN_IN),
    ),
    _archetype("superlink", [_bv("modern", (11.0, 9.0, 21.0), (7000, 800, 40))]),  # solar: metal
    _archetype(
        "semi_d",  # one half of the pair
        [_bv(v, (12.5, 9.0, 24.0), (7000, 800, 40)) for v in ("gable", "modern")],
        variant_by_group=dict(_MODERN_IN),
    ),
    _archetype("bungalow", [_bv("hip", (15.0, 9.0, 18.0), (6000, 700, 40))], fit_xz=(0.7, 1.5)),
    _archetype("townhouse", [_bv("flat", (7.0, 6.0, 13.0), (4000, 500, 30))], repeat="frontage"),
    # five-foot way; blank sign band (role light)
    _archetype(
        "shop_office",
        [_bv("row", (6.7, 11.0, 22.0), (8000, 900, 40))],
        repeat="frontage",
        frontage="long",
    ),
    # the loader picks the variant with the nearest h
    _archetype(
        "highrise",
        [
            _bv("mid", (25.0, 40.0, 25.0), (25000, 3000, 120)),
            _bv("tall", (30.0, 100.0, 30.0), (25000, 3000, 120)),
        ],
        fit_y=(0.6, 1.5),
    ),
    _archetype(
        "school",
        [_bv("block", (20.0, 14.0, 15.0), (12000, 1500, 60))],  # h: [?] starting value
        repeat="frontage",
        frontage="long",
    ),
    _archetype(
        "mosque",
        [_bv("hall", (30.0, 15.0, 30.0), (20000, 2500, 150), y_range=(14.0, 32.0))],  # h: [?]
    ),
    _archetype(
        "factory", [_bv("shed", (30.0, 10.0, 40.0), (4000, 600, 40))], fit_xz=(0.5, 2.0)
    ),  # h: [?] starting value
    _archetype(
        "mall", [_bv("box", (60.0, 9.0, 60.0), (15000, 2000, 80))], fit_xz=(0.4, 3.0)
    ),  # h: [?] starting value
    # only footprints with fill >= 0.85
    _archetype("generic", [_bv("box", (10.0, 9.0, 10.0), (3000, 400, 24))], fit_xz=(0.3, 4.0)),
)


def _landmark(aid: str, variant: Variant, placement: str, **extra) -> AssetSpec:
    return AssetSpec(
        aid,
        "landmark",
        f"landmarks/{aid}.glb",
        (variant,),
        LANDMARK_MAX_BYTES,
        variant_by_group={"default": variant.id},
        placement=placement,
        **extra,
    )


KANOPI_OBB = (88.88, 27.79)  # OBB (long, short) of the traced outline, metres
MALL_BBOX = (237.08, 284.96)  # lakeside_mall outline bbox (x, z), metres; pinned to the seed

_LANDMARK_SPECS = (
    # From its OSM outline (way/1308938137). The local bbox (x east, z = -north, around the
    # ring centroid) is 237.08 x 284.96 m; a test pins these numbers to the seed. The canopy
    # overhangs the outline by up to 1.5 m a side, so the extent is bbox - 0.1 .. bbox + 3.1.
    _landmark(
        "lakeside_mall",
        _bv(
            "osm",
            (MALL_BBOX[0], 9.0, MALL_BBOX[1]),
            (80000, 10000, 1500),
            y_range=(8.0, 12.0),
            x_range=(MALL_BBOX[0] - 0.1, MALL_BBOX[0] + 3.1),
            z_range=(MALL_BBOX[1] - 0.1, MALL_BBOX[1] + 3.1),
        ),
        "anchor",
    ),
    # Placed on its traced tower outline (landmarks.geojson match "traced_outline", from
    # data/seed/elmina/sources/landmark_outlines.geojson).
    # A residential slab on a podium; its footprint is the OBB of the traced outline
    # (KANOPI_OBB, 88.88 x 27.79 m), so the web fit lands at sx, sz ~ 1. The slab keeps the
    # traced depth (ruling P4-AB): it stands 1 m in from every podium edge. The 36 storeys are the
    # developer's design height, not a survey: 36 x 3.2 m = 115.2 m of tower on an 8.7 m podium
    # (OSM way 1545153991, 8.71 m), plus a thin crown, 130 m in all.
    _landmark(
        "kanopi",
        _bv(
            "tower",
            (88.9, 130.0, 27.8),
            (50000, 8000, 600),
            y_range=(126.0, 132.0),
            x_range=(KANOPI_OBB[0] * 0.96, KANOPI_OBB[0] * 1.04),
            z_range=(KANOPI_OBB[1] * 0.96, KANOPI_OBB[1] * 1.04),
        ),
        "obb",
        frontage="long",
        design_storeys=36,
        height_basis=(
            "design height (36 storeys, Sime Darby Property), under construction; "
            "36 x 3.2 m tower on an 8.7 m podium"
        ),
    ),
    # No public drawing; outside the hero radius. Deferred to P4.
    _landmark(
        "masjid_denai_alam",
        _bv("main", (40.0, 18.0, 40.0), (40000, 5000, 400), y_range=(16.0, 34.0)),
        "deferred",
    ),
)


def _mid(rng: tuple[float, float]) -> float:
    return round((rng[0] + rng[1]) / 2, 2)


def _kv(vid: str, size, tris, max_m, *, x=None, y=None, z=None) -> Variant:
    """A kit variant; any axis with a range takes the middle of that range as its size."""
    w, h, d = size
    size = (_mid(x) if x else w, _mid(y) if y else h, _mid(z) if z else d)
    return Variant(
        vid,
        tuple(float(s) for s in size),
        tuple(tris),
        tuple(max_m),
        y_range=y,
        x_range=x,
        z_range=z,
    )


def _kit(aid: str, variants, jitter=None) -> AssetSpec:
    return AssetSpec(
        aid,
        "kit",
        f"kits/{aid}.glb",
        tuple(variants),
        KIT_MAX_BYTES,
        variant_by_group={"default": variants[0].id},
        decorative=True,
        jitter=dict(jitter or {}),
    )


_TREE_LODS = (4000, 600, 60)
_TREE_MAX = (300.0, 1500.0, None)
_TREES = _kit(
    "trees",
    [
        _kv(
            "rain_tree",
            (20.0, 16.0, 20.0),
            (6000, 600, 60),
            _TREE_MAX,
            x=(15.0, 25.0),
            y=(12.0, 20.0),
        ),
        _kv("coconut_palm", (6.0, 15.0, 6.0), _TREE_LODS, _TREE_MAX, y=(10.0, 20.0)),
        _kv("royal_palm", (5.0, 16.0, 5.0), _TREE_LODS, _TREE_MAX, y=(12.0, 20.0)),
        _kv("frangipani", (4.5, 4.5, 4.5), _TREE_LODS, _TREE_MAX, x=(3.0, 6.0), y=(3.0, 6.0)),
        _kv("flame_tree", (11.0, 9.0, 11.0), _TREE_LODS, _TREE_MAX, x=(8.0, 14.0)),
        _kv("oil_palm", (8.5, 9.0, 8.5), _TREE_LODS, _TREE_MAX, x=(7.0, 10.0), y=(6.0, 12.0)),
        _kv("shrub_round", (1.2, 1.0, 1.2), _TREE_LODS, _TREE_MAX, y=(0.6, 1.5)),
        _kv("shrub_hedge", (2.0, 1.0, 0.8), _TREE_LODS, _TREE_MAX, y=(0.6, 1.5)),
    ],
    jitter={"scale": 0.12},
)

_FURN_LODS = (800, 120)
_FURN_MAX = (150.0, 300.0)
_FURNITURE = _kit(  # street lamps carry role `light` heads
    "furniture",
    [
        _kv("lamp_single", (1.5, 9.0, 0.4), _FURN_LODS, _FURN_MAX, y=(8.0, 10.0)),
        _kv("lamp_double", (3.0, 9.0, 0.4), _FURN_LODS, _FURN_MAX, y=(8.0, 10.0)),
        _kv("bench", (1.8, 0.85, 0.6), _FURN_LODS, _FURN_MAX),
        _kv("bus_shelter", (6.0, 2.8, 2.0), _FURN_LODS, _FURN_MAX),
        _kv("bollard", (0.25, 1.0, 0.25), _FURN_LODS, _FURN_MAX),
        _kv("bin", (0.6, 1.0, 0.6), _FURN_LODS, _FURN_MAX),
        _kv("traffic_light", (0.6, 4.5, 0.6), _FURN_LODS, _FURN_MAX),
        _kv("sign_post_blank", (0.8, 2.6, 0.1), _FURN_LODS, _FURN_MAX),
        _kv("railing_2m", (2.0, 1.1, 0.1), _FURN_LODS, _FURN_MAX),
    ],
)

_PEOPLE_LODS = (1500, 250)
_PEOPLE_MAX = (80.0, 300.0)
_ADULT_Y = (1.6, 1.8)
_CHILD_Y = (1.2, 1.45)
_PEOPLE = _kit(
    "people",
    [
        _kv("office_man", (0.5, 1.7, 0.3), _PEOPLE_LODS, _PEOPLE_MAX, y=_ADULT_Y),
        _kv("office_woman", (0.5, 1.7, 0.3), _PEOPLE_LODS, _PEOPLE_MAX, y=_ADULT_Y),
        _kv("tudung_baju_kurung", (0.5, 1.7, 0.35), _PEOPLE_LODS, _PEOPLE_MAX, y=_ADULT_Y),
        _kv("older_adult", (0.5, 1.7, 0.35), _PEOPLE_LODS, _PEOPLE_MAX, y=_ADULT_Y),
        _kv("jogger", (0.5, 1.7, 0.5), _PEOPLE_LODS, _PEOPLE_MAX, y=_ADULT_Y),
        _kv("cyclist", (0.6, 1.7, 1.7), _PEOPLE_LODS, _PEOPLE_MAX, y=_ADULT_Y),
        _kv("parent_stroller", (0.6, 1.7, 1.4), _PEOPLE_LODS, _PEOPLE_MAX, y=_ADULT_Y),
        _kv("school_boy", (0.4, 1.3, 0.3), _PEOPLE_LODS, _PEOPLE_MAX, y=_CHILD_Y),
        _kv("school_girl", (0.4, 1.3, 0.3), _PEOPLE_LODS, _PEOPLE_MAX, y=_CHILD_Y),
        _kv("child", (0.4, 1.3, 0.3), _PEOPLE_LODS, _PEOPLE_MAX, y=_CHILD_Y),
    ],
    jitter={"scale": 0.03},
)

_CAR_LODS = (3000, 400)
_HEAVY_LODS = (5000, 600)
_CAR_MAX = (150.0, 1500.0)
_VEHICLES = _kit(  # z_range = length; unbranded
    "vehicles",
    [
        _kv("hatchback", (1.7, 1.5, 3.85), _CAR_LODS, _CAR_MAX, z=(3.7, 4.0)),
        _kv("city_car", (1.6, 1.5, 3.7), _CAR_LODS, _CAR_MAX, z=(3.6, 3.8)),
        _kv("sedan", (1.8, 1.45, 4.6), _CAR_LODS, _CAR_MAX, z=(4.4, 4.8)),
        _kv("mpv", (1.8, 1.7, 4.7), _CAR_LODS, _CAR_MAX, z=(4.5, 4.9)),
        _kv("pickup", (1.85, 1.8, 5.25), _CAR_LODS, _CAR_MAX, z=(5.1, 5.4)),
        _kv("motorcycle", (0.75, 1.1, 1.95), _CAR_LODS, _CAR_MAX, z=(1.8, 2.1)),
        _kv("delivery_motorcycle", (0.75, 1.3, 2.0), _CAR_LODS, _CAR_MAX, z=(1.8, 2.2)),
        _kv("bus", (2.5, 3.2, 11.5), _HEAVY_LODS, _CAR_MAX, z=(10.5, 12.5)),
        _kv("lorry", (2.4, 3.2, 8.0), _HEAVY_LODS, _CAR_MAX, z=(7.0, 9.0)),
    ],
    jitter={"scale": 0.02},
)

_CON_LODS = (6000, 600, 60)
_CON_MAX = (300.0, 1500.0, None)
_CONSTRUCTION = _kit(
    "construction",
    [
        _kv(
            "tower_crane", (53.0, 50.0, 4.0), _CON_LODS, _CON_MAX, x=(52.5, 53.5), y=(40.0, 60.0)
        ),  # keeps LOD2; 42 m jib + 11 m counter jib
        _kv("mobile_crane", (2.8, 4.0, 12.0), _CON_LODS, _CON_MAX),
        _kv("excavator", (3.0, 3.2, 9.0), _CON_LODS, _CON_MAX),
        _kv("cement_mixer", (2.5, 3.6, 8.5), _CON_LODS, _CON_MAX),
        _kv("site_cabin", (2.4, 2.6, 6.0), _CON_LODS, _CON_MAX),
        _kv("hoarding_6m", (6.0, 2.4, 0.2), _CON_LODS, _CON_MAX, x=(5.9, 6.1)),
        _kv("scaffold_bay", (2.5, 6.0, 1.2), _CON_LODS, _CON_MAX),
        _kv("material_stack", (2.4, 1.2, 1.2), _CON_LODS, _CON_MAX),
    ],
)

ASSETS: dict[str, AssetSpec] = {
    s.id: s
    for s in (
        *_ARCHETYPE_SPECS,
        *_LANDMARK_SPECS,
        _PEOPLE,
        _VEHICLES,
        _TREES,
        _FURNITURE,
        _CONSTRUCTION,
    )
}

# Pipeline calibration: a 10 × 10 × 10 box with a 2 m porch slab (role secondary) on +z.
TEST_ASSETS: dict[str, AssetSpec] = {
    "calib": AssetSpec(
        "calib",
        "archetype",
        "test/calib.glb",
        (Variant("a", (10.0, 10.0, 12.0), (3000, 600, 60), LOD_MAX_M),),
        ARCHETYPE_MAX_BYTES,
        variant_by_group={"default": "a"},
    ),
}


EXTENT_SLACK = (-0.1, 1.2)  # size check only: eaves may overhang 0.6 m per side
HEIGHT_SLACK = 1.0  # size check only: y max within h +- 1


def bounds_errors(v: Variant, bounds) -> list[str]:
    """Why LOD0 `bounds` ((min xyz), (max xyz)) don't fit the variant; empty when they do.

    A given x_range / y_range / z_range replaces the size check exactly (no slack); otherwise
    the x and z extents must be within [size - 0.1, size + 1.2] and the y max within h +- 1.
    """
    lo, hi = bounds
    errs = []
    for axis, label, rng in ((0, "x extent", v.x_range), (2, "z extent", v.z_range)):
        extent = hi[axis] - lo[axis]
        if rng is not None:
            if not rng[0] <= extent <= rng[1]:
                errs.append(f"{v.id}: {label} {extent:.3f} outside range {rng}")
        elif not v.size[axis] + EXTENT_SLACK[0] <= extent <= v.size[axis] + EXTENT_SLACK[1]:
            errs.append(f"{v.id}: {label} {extent:.3f} outside size {v.size[axis]} -0.1/+1.2")
    if v.y_range is not None:
        if not v.y_range[0] <= hi[1] <= v.y_range[1]:
            errs.append(f"{v.id}: y max {hi[1]:.3f} outside range {v.y_range}")
    elif abs(hi[1] - v.size[1]) > HEIGHT_SLACK:
        errs.append(f"{v.id}: y max {hi[1]:.3f} outside size h {v.size[1]} +-1")
    return errs


def get_spec(asset_id: str) -> AssetSpec:
    """An asset or test asset by id (KeyError names the unknown id)."""
    if asset_id in ASSETS:
        return ASSETS[asset_id]
    if asset_id in TEST_ASSETS:
        return TEST_ASSETS[asset_id]
    raise KeyError(f"unknown asset {asset_id!r}")
