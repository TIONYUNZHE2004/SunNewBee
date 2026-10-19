"""The hero's proportions and palette (pure; shared by the Blender builder and the tests).

The hero is modelled at true scale (1.55 m standing, Blender z-up, facing -y = glTF +z).
The web view draws people at 1.4-1.55x (R-J3), so the displayed height is 2.17-2.40 m; the
build uses `DISPLAY_SCALE` = 1.5 (2.33 m).

H4: head height (crown to chin, tudung included) is 1/2.4-1/2.8 of the standing height.
"""

HEIGHT = 1.55  # crown of the tudung, true metres
HEAD_TOP = HEIGHT
CHIN_Z = 0.98  # lowest point of the face (chin)
H4_RANGE = (2.4, 2.8)
DISPLAY_SCALE = 1.5
DISPLAY_SCALE_RANGE = (1.42, 1.55)  # keeps the displayed height inside 2.2-2.5 m

# Clay pastel palette (sRGB hex). Purple baju kurung, a slightly deeper kain, lilac tudung.
PALETTE = {
    "skin": "#e2b08a",
    "baju": "#8a63cc",
    "kain": "#7352b8",
    "baju_trim": "#b99ae6",
    "tudung": "#cdb0ee",
    "tudung_trim": "#b996e3",
    "shoe": "#7a5444",
    "eye": "#2b2330",
    "eye_hi": "#ffffff",
    "blush": "#f39a9e",
    "mouth": "#b0545a",
    "brow": "#a89aa6",
    "glasses": "#8a6a52",
    "metal": "#c9d2dc",
    "grip": "#566476",
    "wheel": "#3d434d",
    "basket": "#9cc7b4",
}


def hex_rgb(value: str) -> tuple[float, float, float]:
    """sRGB hex -> 0..1 floats (still sRGB)."""
    v = value.lstrip("#")
    return tuple(int(v[i : i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore[return-value]


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def head_ratio(height: float, head_top: float, chin_z: float) -> float:
    """Standing height divided by head height (crown to chin)."""
    return height / (head_top - chin_z)


def h4_ok(ratio: float) -> bool:
    lo, hi = H4_RANGE
    return lo <= ratio <= hi
