"""Deterministic directions along the chosen graph path, without inferred street facts."""

import math

from .models import LonLat, Maneuver, ManeuverAction, RouteSegment
from .world import World

CONTINUE_LIMIT_DEG = 20
SLIGHT_LIMIT_DEG = 60
TURN_LIMIT_DEG = 150


def turn_action(incoming: float | None, outgoing: float | None) -> ManeuverAction:
    """Clockwise deltas turn right. A directionless edge cannot establish a turn."""
    if incoming is None or outgoing is None:
        return "continue"
    delta = (outgoing - incoming + 180) % 360 - 180
    angle = abs(delta)
    if angle < CONTINUE_LIMIT_DEG:
        return "continue"
    if angle > TURN_LIMIT_DEG:
        return "u_turn"
    side = "right" if delta > 0 else "left"
    if angle < SLIGHT_LIMIT_DEG:
        return "slight_right" if side == "right" else "slight_left"
    return "turn_right" if side == "right" else "turn_left"


def _bearing(a: LonLat, b: LonLat) -> float | None:
    if a[:2] == b[:2]:
        return None
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    y = math.sin(lon2 - lon1) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lon2 - lon1)
    return math.degrees(math.atan2(y, x)) % 360


def _tangents(points: list[LonLat]) -> tuple[float | None, float | None]:
    pairs = [(a, b) for a, b in zip(points, points[1:], strict=False) if a[:2] != b[:2]]
    if not pairs:
        return None, None
    start = _bearing(*pairs[0])
    # The arrival tangent is the reverse bearing at the last point, turned 180 degrees.
    a, b = pairs[-1]
    end = (_bearing(b, a) + 180) % 360
    return start, end


def _rounded_bearing(bearing: float | None) -> float | None:
    return None if bearing is None else round(bearing, 1) % 360


def build_maneuvers(world: World, nodes: list[str], segments: list[RouteSegment]) -> list[Maneuver]:
    """Preserve every real turn and every name/type/access/rule boundary.

    Distances use the solver's physical edge lengths, not its preference weights or straight
    chords. Edge geometry is oriented in travel order before computing local tangents.
    """
    if not segments:
        return [
            Maneuver(
                index=1,
                action="arrive",
                distance_m=0,
                bearing_deg=None,
                street_name=None,
                edge_type=None,
                access_level="unknown",
                rule_id="no_basis_v1",
                segment_ids=[],
                point=world.node_coords[nodes[-1]],
            )
        ]
    steps: list[Maneuver] = []
    previous_signature = None
    previous_end = None
    for node, segment in zip(nodes[:-1], segments, strict=True):
        edge = world.edges[segment.edge_id]
        points = edge.coords if edge.from_node == node else list(reversed(edge.coords))
        start, end = _tangents(points)
        signature = (edge.name, edge.type, segment.access_level, segment.rule_id)
        action = turn_action(previous_end, start)
        if not steps:
            action = "depart"
        elif (
            action == "continue" and edge.type == "crossing" and previous_signature[1] != "crossing"
        ):
            action = "cross"
        if action == "continue" and signature == previous_signature:
            steps[-1].distance_m += edge.length_m
            steps[-1].segment_ids.append(edge.id)
        else:
            steps.append(
                Maneuver(
                    index=len(steps) + 1,
                    action=action,
                    distance_m=edge.length_m,
                    bearing_deg=_rounded_bearing(start),
                    street_name=edge.name,
                    edge_type=edge.type,
                    access_level=segment.access_level,
                    rule_id=segment.rule_id,
                    segment_ids=[edge.id],
                    point=points[0] if points else world.node_coords[node],
                )
            )
        previous_signature, previous_end = signature, end
    last = steps[-1]
    steps.append(
        Maneuver(
            index=len(steps) + 1,
            action="arrive",
            distance_m=0,
            bearing_deg=_rounded_bearing(previous_end),
            street_name=last.street_name,
            edge_type=last.edge_type,
            access_level=last.access_level,
            rule_id=last.rule_id,
            segment_ids=[],
            point=world.node_coords[nodes[-1]],
        )
    )
    for step in steps:
        step.distance_m = round(step.distance_m, 1)
    return steps
