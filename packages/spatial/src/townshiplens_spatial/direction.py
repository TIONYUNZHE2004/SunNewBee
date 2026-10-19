"""Mapped vehicle direction, relative to each edge's original OSM way orientation."""

from .models import Edge

ONEWAY_KEYS = ("oneway:motorcar", "oneway:motor_vehicle", "oneway:vehicle", "oneway")
CONDITIONAL_KEYS = tuple(f"{key}:conditional" for key in ONEWAY_KEYS)


def direction_rule(edge: Edge) -> tuple[int | None, str | None, str | None]:
    """1 = forward, -1 = reverse, 0 = both, None = unsupported/time-dependent."""
    tags = edge.osm_tags
    for key in ONEWAY_KEYS:
        if key not in tags:
            continue
        value = tags[key].strip().lower()
        if value in {"yes", "1", "true"}:
            return 1, key, value
        if value == "-1":
            return -1, key, value
        if value in {"no", "0", "false"}:
            return 0, key, value
        return None, key, value
    if tags.get("junction") == "roundabout":
        return 1, "junction", "roundabout"
    return 0, None, None


def direction_unknown(edge: Edge) -> bool:
    return any(k in edge.osm_tags for k in CONDITIONAL_KEYS) or direction_rule(edge)[0] is None


def allows_direction(edge: Edge, profile_id: str, from_node: str) -> bool:
    if profile_id != "drive" or any(k in edge.osm_tags for k in CONDITIONAL_KEYS):
        return True
    direction = direction_rule(edge)[0]
    return (
        from_node == edge.from_node
        if direction == 1
        else from_node == edge.to_node
        if direction == -1
        else True
    )
