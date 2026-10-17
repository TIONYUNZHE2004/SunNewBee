"""Attribute catalogue (docs/04-architecture/world-model-schema.md section 2.4)."""

from typing import Any

_NUMBER = ("number", None)
_BOOL = ("boolean", None)
_TEXT = ("text", None)


def _enum(*values: str) -> tuple[str, frozenset[str]]:
    return ("enum", frozenset(values))


ATTRIBUTE_TYPES: dict[str, tuple[str, frozenset[str] | None]] = {
    "step_count": _NUMBER,
    "step_height_cm": _NUMBER,
    "incline_pct": _NUMBER,
    "width_m": _NUMBER,
    "ramp": _BOOL,
    "tactile_paving": _BOOL,
    "lit": _BOOL,
    "seating_adjacent": _BOOL,
    "seating": _BOOL,
    "covered": _BOOL,
    "surface": _enum(
        "asphalt", "concrete", "paving_stones", "tiles", "gravel",
        "grass", "grating", "metal", "unpaved", "wood",
    ),
    "surface_condition": _enum("good", "uneven", "obstructed"),
    "kerb": _enum("flush", "lowered", "raised", "rolled"),
    "crossing": _enum("traffic_signals", "marked", "unmarked", "no"),  # crossing segments
    "handrail": _enum("both", "one_side", "none"),
    "sidewalk": _enum("both", "one_side", "none", "separate"),  # major_road edges (Task 31)
    "shelter": _enum("covered", "partial", "none"),
    "door_type": _enum("automatic", "push", "pull", "sliding", "revolving", "none"),
    "wheelchair": _enum("yes", "limited", "no"),
    "opening_hours": _TEXT,
    "name": _TEXT,
}  # fmt: skip

# Resident/staff-readable names, one per catalogue key. The agent builds its answer wording from
# these; test_attribute_catalogue.py keeps them in step with ATTRIBUTE_TYPES and the web catalogue.
ATTRIBUTE_LABELS: dict[str, str] = {
    "step_count": "Steps",
    "step_height_cm": "Step height (cm)",
    "incline_pct": "Incline (%)",
    "width_m": "Width (m)",
    "ramp": "Ramp",
    "tactile_paving": "Tactile paving",
    "lit": "Lighting",
    "seating_adjacent": "Seating nearby",
    "seating": "Seating",
    "covered": "Covered",
    "surface": "Surface",
    "surface_condition": "Surface condition",
    "kerb": "Kerb",
    "handrail": "Handrail",
    "crossing": "Crossing type",
    "sidewalk": "Sidewalk",
    "shelter": "Shelter",
    "door_type": "Door type",
    "wheelchair": "Wheelchair access",
    "opening_hours": "Opening hours",
    "name": "Name",
}


def validate_value(key: str, value: Any) -> str | None:
    """Return an error message if value is invalid for a catalogued key, else None.
    Unknown keys return None (callers fall back to comparing with the existing value)."""
    spec = ATTRIBUTE_TYPES.get(key)
    if spec is None:
        return None
    kind, allowed = spec
    if kind == "number":
        if isinstance(value, bool) or not isinstance(value, int | float):
            return f"{key} must be a number"
    elif kind == "boolean":
        if not isinstance(value, bool):
            return f"{key} must be a boolean"
    elif kind == "enum":
        if not isinstance(value, str) or value not in (allowed or ()):
            return f"{key} must be one of: {', '.join(sorted(allowed or ()))}"
    elif kind == "text" and not isinstance(value, str):
        return f"{key} must be a string"
    return None
